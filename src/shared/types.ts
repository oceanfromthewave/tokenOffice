// Shapes exchanged between the hook receiver (server) and the dashboard (renderer).

export type AgentState = 'working' | 'break' | 'done' | 'waiting' | 'error';
export type Provider = 'claude' | 'codex';

export interface AgentRecord {
  id: string;
  provider: Provider;
  sessionId: string;
  agentId: string;
  name: string;
  project: string;
  projectParent: string;
  projectId: string;
  agentType: string;
  state: AgentState;
  tool: string;
  isSubagent: boolean;
  /** True until a new hook event confirms this restored roster entry is live again. */
  restored?: boolean;
  startedAt: number;
  updatedAt: number;
}

export interface ActivityItem {
  id: string;
  at: number;
  provider: Provider;
  sourceId: string;
  agent: string;
  project: string;
  projectParent: string;
  projectId: string;
  text: string;
  tool: string;
}

export interface Snapshot {
  connected: boolean;
  providers: Provider[];
  lastSeenAt: Partial<Record<Provider, number>>;
  agents: AgentRecord[];
  activity: ActivityItem[];
  metrics: { events: number; tools: number; turns: number };
  updatedAt: number;
}

export type MeetingState = 'queued' | 'speaking' | 'complete' | 'error';
export interface MeetingTurn {
  agentId: string;
  name: string;
  provider: Provider;
  state: MeetingState;
  text: string;
}
export interface AgentMeeting {
  id: string;
  agenda: string;
  status: 'running' | 'complete' | 'complete_with_errors';
  startedAt: number;
  updatedAt: number;
  turns: MeetingTurn[];
}

export interface ChatMessage {
  id: string;
  agentId: string;
  role: 'user' | 'assistant';
  text: string;
  at: number;
  status: 'complete' | 'sending' | 'error';
}

/** Sanitized fields forwarded by either tool's hook. Everything is optional because it comes from outside. */
export interface HookEvent {
  provider?: unknown;
  event?: unknown;
  sessionId?: unknown;
  agentId?: unknown;
  agentType?: unknown;
  teammateName?: unknown;
  project?: unknown;
  projectParent?: unknown;
  projectId?: unknown;
  cwd?: unknown;
  toolName?: unknown;
  notificationType?: unknown;
}
