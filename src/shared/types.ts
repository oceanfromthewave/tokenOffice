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
  agentType: string;
  state: AgentState;
  tool: string;
  isSubagent: boolean;
  startedAt: number;
  updatedAt: number;
}

export interface ActivityItem {
  id: string;
  at: number;
  provider: Provider;
  agent: string;
  project: string;
  text: string;
  tool: string;
}

export interface Snapshot {
  connected: boolean;
  providers: Provider[];
  agents: AgentRecord[];
  activity: ActivityItem[];
  metrics: { events: number; tools: number; turns: number };
  updatedAt: number;
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
  toolName?: unknown;
  notificationType?: unknown;
}
