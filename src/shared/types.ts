// Shapes exchanged between the hook receiver (server) and the dashboard (renderer).

export type AgentState = 'working' | 'break' | 'done' | 'waiting' | 'error';

export interface AgentRecord {
  id: string;
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
  agent: string;
  project: string;
  text: string;
  tool: string;
}

export interface Snapshot {
  connected: boolean;
  agents: AgentRecord[];
  activity: ActivityItem[];
  metrics: { events: number; tools: number; turns: number };
  updatedAt: number;
}

/** What the Claude Code hook forwards. Everything is optional because it comes from outside. */
export interface HookEvent {
  event?: unknown;
  sessionId?: unknown;
  agentId?: unknown;
  agentType?: unknown;
  teammateName?: unknown;
  project?: unknown;
  toolName?: unknown;
  notificationType?: unknown;
}
