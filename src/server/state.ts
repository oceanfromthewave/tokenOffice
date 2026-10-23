// Local office state built from Claude Code and Codex hook events. Current sessions and recent activity are persisted.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ActivityItem, AgentRecord, ChatMessage, HookEvent, Provider, Snapshot } from '../shared/types.ts';
import type { DiscoveredSession } from './session-discovery.ts';

const ACTIVITY_LIMIT = 200;
const STALE_MS = 4 * 60 * 60 * 1000;
const FINISHED_SUBAGENT_MS = 20_000;
const SAVED_AGENT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SAVED_AGENT_LIMIT = 100;
const SAVE_DEBOUNCE_MS = 500;

const text = (value: unknown, max = 80) => (typeof value === 'string' ? value.slice(0, max) : '');

export class OfficeState {
  private agents = new Map<string, AgentRecord>();
  private activity: ActivityItem[] = [];
  private projectPaths = new Map<string, string>();
  private chats = new Map<string, ChatMessage[]>();
  private connected = false;
  private providers = new Set<Provider>();
  private lastSeenAt: Partial<Record<Provider, number>> = {};
  private metrics = { events: 0, tools: 0, turns: 0 };
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private persistQueue: Promise<void> = Promise.resolve();
  private persistencePath?: string;

  constructor(persistencePath?: string) { this.persistencePath = persistencePath; }

  /** Restores activity history only. Agent rows are rebuilt from live CLI sessions and hook events. */
  async restore(now = Date.now()): Promise<void> {
    if (!this.persistencePath) return;
    let saved: unknown;
    try {
      saved = JSON.parse(await readFile(this.persistencePath, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`Could not read remembered agents: ${(error as Error).message}`);
      return;
    }
    if (!saved || typeof saved !== 'object' || !Array.isArray((saved as { agents?: unknown }).agents)) return;
    const records = (saved as { version?: unknown; agents: unknown[]; activity?: unknown });
    if (records.version !== 1 && records.version !== 2) return;
    if (Array.isArray(records.activity)) {
      this.activity = records.activity
        .map(value => this.cleanActivity(value, now))
        .filter((value): value is ActivityItem => Boolean(value))
        .sort((a, b) => b.at - a.at)
        .slice(0, ACTIVITY_LIMIT);
    }
  }

  /** Adds sessions found in the currently-running CLI processes before their next hook event. */
  restoreOpenSessions(sessions: DiscoveredSession[]) {
    for (const session of sessions) {
      const id = `${session.provider}:${session.sessionId}:main`;
      const existing = this.agents.get(id);
      if (existing) {
        this.agents.set(id, {
          ...existing,
          state: session.state,
          restored: true,
          cliOpen: true,
          startedAt: Math.min(existing.startedAt, session.startedAt),
          updatedAt: Math.max(existing.updatedAt, session.updatedAt),
        });
      } else {
        this.agents.set(id, {
          id, provider: session.provider, sessionId: session.sessionId, agentId: '',
          name: session.project, project: session.project, projectParent: session.projectParent,
          projectId: session.projectId, agentType: '', state: session.state, tool: '', isSubagent: false,
          restored: true, cliOpen: true, startedAt: session.startedAt, updatedAt: session.updatedAt,
        });
      }
      if (this.projectPaths.get(id) !== session.cwd) this.projectPaths.set(id, session.cwd);
    }
    // Replace any legacy roster with the sessions confirmed live at startup.
    this.schedulePersist();
  }

  exportBackup() {
    return {
      version: 1,
      agents: this.rememberedAgents(),
      activity: this.activity.slice(0, ACTIVITY_LIMIT),
    };
  }

  importBackup(input: unknown, now = Date.now()) {
    if (!input || typeof input !== 'object') throw new Error('백업 파일 형식이 올바르지 않아요.');
    const backup = input as { version?: unknown; agents?: unknown; activity?: unknown };
    if (backup.version !== 1 || !Array.isArray(backup.agents)) throw new Error('지원하지 않는 백업 파일이에요.');

    const validAgents = backup.agents
      .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object'))
      .map(value => ({ value, updatedAt: Number(value.updatedAt) }))
      .filter(({ value, updatedAt }) => (value.provider === 'claude' || value.provider === 'codex')
        && typeof value.sessionId === 'string' && value.sessionId.length > 0 && value.sessionId.length <= 100
        && typeof value.project === 'string' && Number.isFinite(updatedAt) && updatedAt <= now
        && updatedAt >= now - SAVED_AGENT_MAX_AGE_MS)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, SAVED_AGENT_LIMIT);

    let matchedLiveAgents = 0;
    for (const { value } of validAgents) {
      const provider = value.provider as Provider;
      const sessionId = value.sessionId as string;
      const id = `${provider}:${sessionId}:main`;
      const cwd = typeof value.cwd === 'string' && value.cwd.length <= 2048 ? value.cwd : '';
      const existing = this.agents.get(id);
      // Backups restore activity, but an inactive saved session must not become an agent.
      if (!existing) continue;
      matchedLiveAgents += 1;
      if (cwd && !this.projectPaths.has(id)) this.projectPaths.set(id, cwd);
    }
    if (Array.isArray(backup.activity)) {
      const imported = backup.activity
        .map(value => this.cleanActivity(value, now))
        .filter((value): value is ActivityItem => Boolean(value));
      const merged = new Map([...imported, ...this.activity].map(item => [item.id, item]));
      this.activity = [...merged.values()].sort((a, b) => b.at - a.at).slice(0, ACTIVITY_LIMIT);
    }
    this.schedulePersist();
    return { agents: matchedLiveAgents, activity: this.activity.length };
  }

  /** Applies one hook event. Returns false when the event is not usable. */
  handle(data: HookEvent, now = Date.now()): boolean {
    const event = text(data.event, 48);
    const sessionId = text(data.sessionId, 100);
    const agentId = text(data.agentId, 100);
    if (!event || !sessionId) return false;

    const provider: Provider = data.provider === 'codex' ? 'codex' : 'claude';
    this.connected = true;
    this.providers.add(provider);
    this.lastSeenAt[provider] = now;
    this.metrics.events += 1;
    const key = `${provider}:${sessionId}:${agentId || 'main'}`;
    const toolName = text(data.toolName, 60);
    const project = text(data.project, 48) || (provider === 'codex' ? 'Codex' : 'Claude Code');
    const projectParent = text(data.projectParent, 48);
    const projectId = text(data.projectId, 16);
    const cwd = text(data.cwd, 2048);
    if (cwd) this.projectPaths.set(key, cwd);

    if (event === 'SessionEnd' && !agentId) {
      for (const [id, agent] of this.agents) {
        if (agent.provider !== provider || agent.sessionId !== sessionId) continue;
        this.log(agent, event, '', now);
        this.agents.delete(id);
        this.projectPaths.delete(id);
        this.chats.delete(id);
      }
      this.schedulePersist();
      return true;
    }

    const previous = this.agents.get(key);
    const isSubagent = Boolean(agentId);
    const agent: AgentRecord = {
      id: key,
      provider,
      sessionId,
      agentId,
      name: isSubagent ? text(data.agentType, 32) || text(data.teammateName, 32) || 'Subagent' : project,
      project,
      projectParent,
      projectId,
      agentType: text(data.agentType, 32) || previous?.agentType || '',
      state: previous?.state ?? 'break',
      tool: previous?.tool ?? '',
      isSubagent,
      restored: false,
      startedAt: previous?.startedAt ?? now,
      updatedAt: now,
    };

    switch (event) {
      case 'SessionStart':
        agent.state = 'break';
        agent.tool = '';
        break;
      case 'UserPromptSubmit':
      case 'PreToolUse':
      case 'PostToolUse':
        agent.state = 'working';
        agent.tool = toolName || (event === 'UserPromptSubmit' ? '' : agent.tool);
        if (event === 'PreToolUse') this.metrics.tools += 1;
        break;
      case 'Notification':
        if (data.notificationType === 'permission_prompt' || data.notificationType === 'elicitation_dialog') agent.state = 'waiting';
        break;
      case 'PermissionRequest':
        agent.state = 'waiting';
        break;
      case 'SubagentStart':
        agent.state = 'working';
        break;
      case 'SubagentStop':
        agent.state = 'done';
        agent.tool = '';
        break;
      case 'TeammateIdle':
        agent.state = 'break';
        break;
      case 'Stop':
        agent.state = 'break';
        agent.tool = '';
        if (!isSubagent) this.metrics.turns += 1;
        break;
      case 'StopFailure':
        agent.state = 'error';
        agent.tool = '';
        break;
      case 'Interrupt':
        agent.state = 'break';
        agent.tool = '';
        break;
    }

    this.agents.set(key, agent);
    this.log(agent, event, toolName, now);
    this.schedulePersist();
    return true;
  }

  snapshot(now = Date.now()): Snapshot {
    this.clean(now);
    return {
      connected: this.connected,
      providers: [...this.providers],
      lastSeenAt: { ...this.lastSeenAt },
      agents: [...this.agents.values()].sort((a, b) => a.startedAt - b.startedAt),
      activity: this.activity.slice(0, ACTIVITY_LIMIT),
      metrics: { ...this.metrics },
      updatedAt: now,
    };
  }

  chatTarget(id: string) {
    const agent = this.agents.get(id);
    if (!agent) return undefined;
    return { id: agent.id, name: agent.name, provider: agent.provider, sessionId: agent.sessionId, cwd: this.projectPaths.get(id), state: agent.state, isSubagent: agent.isSubagent };
  }

  chatHistory(agentId: string) {
    return [...(this.chats.get(agentId) ?? [])];
  }

  startChat(agentId: string, message: string, now = Date.now()) {
    const user: ChatMessage = { id: `${now}-${Math.random().toString(36).slice(2, 8)}`, agentId, role: 'user', text: message, at: now, status: 'complete' };
    const assistant: ChatMessage = { id: `${user.id}-reply`, agentId, role: 'assistant', text: '', at: now, status: 'sending' };
    const history = [...(this.chats.get(agentId) ?? []), user, assistant].slice(-40);
    this.chats.set(agentId, history);
    return assistant.id;
  }

  finishChat(agentId: string, assistantId: string, text: string, error = false) {
    const history = this.chats.get(agentId) ?? [];
    this.chats.set(agentId, history.map(message => message.id === assistantId
      ? { ...message, text, status: error ? 'error' : 'complete' }
      : message));
  }

  private clean(now: number) {
    for (const [id, agent] of this.agents) {
      const stale = agent.updatedAt < now - STALE_MS;
      const finished = agent.isSubagent && agent.state === 'done' && agent.updatedAt < now - FINISHED_SUBAGENT_MS;
      if (agent.isSubagent && (stale || finished)) {
        this.agents.delete(id);
        this.projectPaths.delete(id);
      }
    }
  }

  private schedulePersist() {
    if (!this.persistencePath) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      this.persistQueue = this.persistQueue
        .catch(() => {})
        .then(() => this.persist())
        .catch(error => console.warn(`Could not save remembered agents: ${(error as Error).message}`));
    }, SAVE_DEBOUNCE_MS);
    this.persistTimer.unref?.();
  }

  private async persist() {
    if (!this.persistencePath) return;
    const agents = this.rememberedAgents();
    const temporaryPath = `${this.persistencePath}.${process.pid}.tmp`;
    await mkdir(dirname(this.persistencePath), { recursive: true });
    await writeFile(temporaryPath, JSON.stringify({ version: 2, agents, activity: this.activity.slice(0, ACTIVITY_LIMIT) }), 'utf8');
    await rename(temporaryPath, this.persistencePath);
  }

  private rememberedAgents() {
    return [...this.agents.values()]
      .filter(agent => !agent.isSubagent)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, SAVED_AGENT_LIMIT)
      .map(agent => ({
        provider: agent.provider,
        sessionId: agent.sessionId,
        name: agent.name,
        project: agent.project,
        projectParent: agent.projectParent,
        projectId: agent.projectId,
        startedAt: agent.startedAt,
        updatedAt: agent.updatedAt,
        cwd: this.projectPaths.get(agent.id),
      }));
  }

  private cleanActivity(input: unknown, now: number): ActivityItem | undefined {
    if (!input || typeof input !== 'object') return undefined;
    const item = input as Record<string, unknown>;
    if ((item.provider !== 'claude' && item.provider !== 'codex') || typeof item.at !== 'number'
      || !Number.isFinite(item.at) || item.at > now || item.at < now - SAVED_AGENT_MAX_AGE_MS) return undefined;
    const value = (key: string, max: number) => typeof item[key] === 'string' ? (item[key] as string).slice(0, max) : '';
    if (!value('id', 120) || !value('sourceId', 220) || !value('text', 120)) return undefined;
    return {
      id: value('id', 120), at: item.at, provider: item.provider,
      sourceId: value('sourceId', 220), agent: value('agent', 48),
      project: value('project', 48), projectParent: value('projectParent', 48),
      projectId: value('projectId', 16), text: value('text', 120), tool: value('tool', 60),
    };
  }

  private log(agent: AgentRecord, event: string, tool: string, now: number) {
    const labels: Record<string, string> = {
      SessionStart: '세션 시작',
      UserPromptSubmit: '새 작업 시작',
      PreToolUse: `${tool || '도구'} 사용 시작`,
      PostToolUse: `${tool || '도구'} 사용 완료`,
      Notification: '사용자 확인 대기',
      PermissionRequest: '권한 확인 대기',
      SubagentStart: `${agent.agentType || '서브에이전트'} 시작`,
      SubagentStop: `${agent.agentType || '서브에이전트'} 완료`,
      TeammateIdle: `${agent.name} 대기 중`,
      Stop: '응답 완료',
      StopFailure: '실행 중 오류',
      SessionEnd: '세션 종료',
      Interrupt: '작업 중단',
    };
    this.activity.unshift({
      id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
      at: now,
      provider: agent.provider,
      sourceId: agent.id,
      agent: agent.name,
      project: agent.project,
      projectParent: agent.projectParent,
      projectId: agent.projectId,
      text: labels[event] ?? '상태 업데이트',
      tool,
    });
    this.activity.length = Math.min(this.activity.length, ACTIVITY_LIMIT);
  }
}
