// In-memory office state built from Claude Code and Codex hook events. Nothing here touches disk or the network.
import type { ActivityItem, AgentRecord, ChatMessage, HookEvent, Provider, Snapshot } from '../shared/types.ts';

const ACTIVITY_LIMIT = 16;
const STALE_MS = 4 * 60 * 60 * 1000;
const FINISHED_SUBAGENT_MS = 20_000;

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
        if (agent.isSubagent) {
          this.agents.delete(id);
          this.projectPaths.delete(id);
        } else {
          this.agents.set(id, { ...agent, state: 'break', tool: '', updatedAt: now });
        }
      }
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
    return { id: agent.id, provider: agent.provider, sessionId: agent.sessionId, cwd: this.projectPaths.get(id), state: agent.state, isSubagent: agent.isSubagent };
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
