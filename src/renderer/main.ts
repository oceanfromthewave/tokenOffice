// Dashboard: polls the local hook receiver for Claude Code and Codex sessions.
import { LOOKS, type Look } from '../shared/pixels.ts';
import type { ActivityItem, AgentRecord, AgentState, ChatMessage, Provider, Snapshot } from '../shared/types.ts';
import { Office, type OfficeAgent } from './office/office.ts';
import { headUrl, propUrl } from './office/sprites.ts';

/** `key` names whoever this is across sessions (project for a session, type for a subagent) so a rename sticks. */
interface ViewAgent extends OfficeAgent { role: string; key: string; baseName: string; projectLabel?: string; provider?: Provider }
interface Stats { tools: number; turns: number; events: number }
interface ActivityRow {
  agent: string;
  text: string;
  detail: string;
  at: number;
  icon: string;
  tool: string;
  provider?: Provider;
  sourceId?: string;
  projectId?: string;
}
interface ProjectRef { project: string; parent: string; id: string }

const LABEL: Record<AgentState, string> = { working: '작업 중', break: '휴식 중', done: '완료', waiting: '응답 대기', error: '오류' };
const PROVIDER_NAME: Record<Provider, string> = { claude: 'Claude Code', codex: 'Codex' };
const POLL_MS = 1500;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const office = new Office($<HTMLCanvasElement>('#office-canvas'), id => select(id));
let agents: ViewAgent[] = [];
let live = false;
let selected = '';
let lastTurns = 0;
let lastSnapshot: Snapshot | undefined;
let activityRows: ActivityRow[] = [];
let knownProjects = new Map<string, ProjectRef>();
let chatAgentId = '';
const chatPending = new Set<string>();
let chatPollTimer = 0;

// ---------------- names and characters people chose ----------------
interface Profile { name?: string; look?: Look }
const PROFILE_STORE = 'tokenOffice.profiles';
const ALL_LOOKS: Look[] = [...LOOKS, 'bot'];
const LOOK_LABEL: Record<Look, string> = {
  momo: '안경 쓴 직원', lumi: '긴 머리 직원', tori: '헤드폰 쓴 직원', koko: '모자 쓴 직원',
  jun: '수염 난 직원', mina: '안경 쓴 긴 머리 직원', yuna: '올림머리 직원', dami: '은발 직원', bot: '로봇',
};
function loadProfiles(): Record<string, Profile> {
  try { return JSON.parse(localStorage.getItem(PROFILE_STORE) ?? '{}') as Record<string, Profile>; } catch { return {}; }
}
let profiles = loadProfiles();
function saveProfiles() {
  // browser storage can be unavailable (private window); then a rename lasts until the window closes
  try { localStorage.setItem(PROFILE_STORE, JSON.stringify(profiles)); } catch { /* keep the in-memory copy */ }
}

// ---------------- shared rendering ----------------
function render(stats: Stats, instant = false) {
  office.setAgents(agents, instant);
  renderSidebar();
  const working = agents.filter(a => a.state === 'working').length;
  $('#agent-count').textContent = String(agents.length);
  $('#active-count').textContent = `${working} / ${agents.length}`;
  $('#tool-count').textContent = String(stats.tools);
  $('#turn-count').textContent = String(stats.turns);
  $('#event-count').textContent = String(stats.events);
  $('#mood').textContent = mood();
  $('#room-text').textContent = agents.length ? (working ? `${working}명 작업 중` : '모두 쉬는 중') : '아무도 없어요';
  $('#empty-office').hidden = agents.length > 0;
  if (stats.turns > lastTurns) office.print();
  lastTurns = stats.turns;
}

function mood(): string {
  if (agents.some(a => a.state === 'error')) return '문제 발생';
  if (agents.some(a => a.state === 'waiting')) return '확인 필요';
  const working = agents.filter(a => a.state === 'working').length;
  if (!agents.length) return '조용함';
  return working === 0 ? '휴식 시간' : working === agents.length ? '집중 모드' : '평화로움';
}

function renderSidebar() {
  const list = $('#agent-list');
  list.replaceChildren(...agents.map(a => {
    const row = el('div', `agent-row${a.id === selected ? ' selected' : ''}`);
    const pick = el('button', 'agent-pick');
    pick.type = 'button';
    const avatar = el('span', `mini-avatar${a.state === 'working' ? ' online' : ''}`);
    avatar.style.backgroundImage = `url(${headUrl(a.look)})`;
    const meta = el('span', 'agent-meta');
    meta.append(el('strong', '', a.name), el('small', '', `${LABEL[a.state]} · ${a.role}`));
    pick.append(avatar, meta);
    pick.addEventListener('click', () => select(a.id));
    const edit = el('button', 'rename-btn', '✎');
    edit.type = 'button';
    edit.title = '이름 바꾸기';
    edit.setAttribute('aria-label', `${a.name} 이름 바꾸기`);
    edit.addEventListener('click', () => openRename(a));
    row.append(pick, edit);
    return row;
  }));
  renderChatTargets();
}

function projectLabels() {
  const nameCounts = new Map<string, number>();
  for (const ref of knownProjects.values()) nameCounts.set(ref.project, (nameCounts.get(ref.project) ?? 0) + 1);
  const labels = new Map<string, string>();
  for (const ref of knownProjects.values()) {
    labels.set(ref.id, (nameCounts.get(ref.project) ?? 0) > 1 && ref.parent ? `${ref.parent}/${ref.project}` : ref.project);
  }
  const labelCounts = new Map<string, number>();
  for (const label of labels.values()) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  for (const ref of knownProjects.values()) {
    if ((labelCounts.get(labels.get(ref.id) ?? '') ?? 0) > 1) labels.set(ref.id, `${labels.get(ref.id)} · ${ref.id.slice(0, 5)}`);
  }
  return labels;
}

function updateActivityProjectOptions() {
  const select = $<HTMLSelectElement>('#activity-project-filter');
  const labels = projectLabels();
  const options = [...labels].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  const signature = JSON.stringify(options);
  if (select.dataset.options === signature) return;
  const previous = select.value;
  select.replaceChildren(new Option('모든 프로젝트', 'all'), ...options.map(option => new Option(option.label, option.value)));
  select.dataset.options = signature;
  select.value = options.some(option => option.value === previous) ? previous : 'all';
}

function groupedActivity(items: ActivityRow[]) {
  const groups: (ActivityRow & { count: number })[] = [];
  const recentTools = new Map<string, ActivityRow & { count: number }>();
  for (const item of items) {
    if (!item.tool || !item.sourceId) { groups.push({ ...item, count: 1 }); continue; }
    const key = [item.sourceId, item.provider, item.projectId, item.tool, item.text].join('\0');
    let group = recentTools.get(key);
    if (!group || group.at - item.at > 30_000) {
      group = { ...item, count: 1 };
      recentTools.set(key, group);
      groups.push(group);
    } else group.count += 1;
  }
  return groups;
}

function drawActivity() {
  const list = $('#activity-list');
  const provider = $<HTMLSelectElement>('#activity-provider-filter').value;
  const project = $<HTMLSelectElement>('#activity-project-filter').value;
  const filtered = activityRows.filter(item =>
    (provider === 'all' || item.provider === provider) && (project === 'all' || item.projectId === project));
  const items = groupedActivity(filtered).slice(0, 8);
  if (!items.length) {
    list.replaceChildren(el('div', 'activity-empty', activityRows.length ? '조건에 맞는 활동이 없어요.' : '아직 기록된 활동이 없어요.'));
    return;
  }
  list.replaceChildren(...items.map(item => {
    const row = el('div', 'activity-row');
    const text = el('div', 'activity-text');
    text.append(el('strong', '', item.agent), document.createTextNode(` ${item.text}${item.count > 1 ? ` · ${item.count}회` : ''}`), el('small', '', item.detail));
    row.append(el('div', 'activity-icon', item.icon), text, el('span', 'activity-time', ago(item.at)));
    return row;
  }));
}

function renderActivity(items: ActivityRow[], enabled = live) {
  activityRows = items;
  const providerFilter = $<HTMLSelectElement>('#activity-provider-filter');
  const projectFilter = $<HTMLSelectElement>('#activity-project-filter');
  providerFilter.disabled = !enabled;
  projectFilter.disabled = !enabled;
  updateActivityProjectOptions();
  drawActivity();
}

$('#activity-provider-filter').addEventListener('change', drawActivity);
$('#activity-project-filter').addEventListener('change', drawActivity);

function renderQueue(items: { icon: string; title: string; detail: string; tag: string; wait?: boolean }[]) {
  $('#queue-list').replaceChildren(...items.map(item => {
    const row = el('div', 'queue-item');
    const copy = el('div', 'queue-copy');
    copy.append(el('strong', '', item.title), el('small', '', item.detail));
    row.append(el('span', 'queue-symbol', item.icon), copy, el('span', `queue-tag${item.wait ? ' wait' : ''}`, item.tag));
    return row;
  }));
}

function select(id: string) {
  const agent = agents.find(a => a.id === id);
  if (!agent) return;
  selected = id;
  office.select(id);
  if (!agent.isSubagent) {
    chatAgentId = id;
    $<HTMLSelectElement>('#chat-agent-select').value = id;
    void loadChatHistory(id);
  }
  renderSidebar();
  toast(`${agent.name} · ${LABEL[agent.state]}${agent.tool ? ` · ${agent.tool}` : ''}`);
}

let toastTimer = 0;
function toast(message: string) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.classList.remove('show'), 2400);
}

const ago = (at: number) => {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  return s < 10 ? '방금' : s < 60 ? `${s}초 전` : s < 3600 ? `${Math.floor(s / 60)}분 전` : `${Math.floor(s / 3600)}시간 전`;
};
const iconFor = (text: string, tool: string) => (tool ? '⌘' : text.includes('완료') ? '✓' : text.includes('대기') ? '!' : text.includes('오류') ? '×' : '✦');

// ---------------- live mode ----------------
const looks = new Map<string, Look>();
let nextLook = 0;
// New sessions get a friendly random name instead of the folder name; it sticks for the life of the session.
const PERSON_NAMES = ['하루', '보리', '단비', '누리', '미르', '솔이', '나래', '다온', '가람', '소담', '라온', '별하', '지오', '해솔', '윤슬', '도담'];
const ROBOT_NAMES = ['삐삐', '뚝딱', '볼트', '너트', '깡통', '반짝', '찌릿', '또롱', '덜컹', '빙글'];
const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)]!;
const AUTO_NAME_STORE = 'tokenOffice.autoNames';
const autoNames = new Map<string, string>(((): [string, string][] => {
  try { return JSON.parse(localStorage.getItem(AUTO_NAME_STORE) ?? '[]') as [string, string][]; } catch { return []; }
})());

function autoName(record: AgentRecord, taken: Set<string>): string {
  let name = autoNames.get(record.id);
  if (!name) {
    const pool = record.isSubagent ? ROBOT_NAMES : PERSON_NAMES;
    const free = pool.filter(n => !taken.has(n));
    name = free.length ? free[Math.floor(Math.random() * free.length)]! : `${pick(pool)} ${taken.size + 1}`;
    autoNames.set(record.id, name);
    // remember the last few sessions only
    try { localStorage.setItem(AUTO_NAME_STORE, JSON.stringify([...autoNames].slice(-60))); } catch { /* names last until reload */ }
  }
  return name;
}

function projectIdentity(record: Pick<AgentRecord, 'project' | 'projectParent' | 'projectId'>) {
  return record.projectId || [record.projectParent, record.project].filter(Boolean).join('/') || record.project;
}

function rememberProjects(snapshot: Snapshot) {
  for (const item of [...snapshot.agents, ...snapshot.activity]) {
    if (!item.project) continue;
    const id = projectIdentity(item);
    knownProjects.set(id, { id, project: item.project, parent: item.projectParent });
  }
}

function fromRecords(records: AgentRecord[], labels: Map<string, string>): ViewAgent[] {
  const taken = new Set(records.map(r => autoNames.get(r.id)).filter((n): n is string => Boolean(n)));
  const seen = new Map<string, number>();
  return records.map(r => {
    if (!looks.has(r.id)) looks.set(r.id, r.isSubagent ? 'bot' : LOOKS[nextLook++ % LOOKS.length]!);
    const projectId = projectIdentity(r);
    const key = r.isSubagent
      ? r.provider === 'claude' ? `sub:${r.agentType || r.name}` : `codex:sub:${r.agentType || r.name}`
      : `main:${r.provider}:${projectId}`;
    const legacyKey = r.provider === 'claude' ? `main:${r.project}` : `codex:main:${r.project}`;
    const profile = profiles[key] ?? profiles[legacyKey] ?? {};
    const generated = autoName(r, taken);
    taken.add(generated);
    const name = profile.name || generated;
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    const projectLabel = labels.get(projectId) ?? r.project;
    return {
      id: r.id,
      provider: r.provider,
      key,
      baseName: generated,
      projectLabel,
      name: count > 1 ? `${name} ${count}` : name,
      look: profile.look ?? looks.get(r.id)!,
      state: r.state,
      tool: r.tool,
      isSubagent: r.isSubagent,
      // the folder (or the subagent's type) still shows under the name
      role: [PROVIDER_NAME[r.provider], r.isSubagent ? r.agentType || '서브에이전트' : projectLabel, r.tool].filter(Boolean).join(' · '),
    };
  });
}

function applySnapshot(snapshot: Snapshot) {
  lastSnapshot = snapshot;
  const first = !live;
  live = true;
  rememberProjects(snapshot);
  const labels = projectLabels();
  agents = fromRecords(snapshot.agents, labels);
  const providerText = snapshot.providers.map(provider => {
    const lastSeen = snapshot.lastSeenAt[provider];
    return `${PROVIDER_NAME[provider]} · ${lastSeen ? ago(lastSeen) : '수신 기록 있음'}`;
  });
  const seenTimes = Object.values(snapshot.lastSeenAt).filter((at): at is number => typeof at === 'number');
  const latestEvent = Math.max(0, ...seenTimes);
  const pill = $('#live-pill');
  $('#live-text').textContent = providerText.join('  /  ') || '실제 이벤트 수신 대기';
  pill.title = '연결 여부가 아닌, 제공자별 마지막 훅 이벤트 시각이에요.';
  pill.classList.toggle('recent', latestEvent > 0 && Date.now() - latestEvent < 60_000);
  const sourceNames = snapshot.providers.map(provider => PROVIDER_NAME[provider]).join(' + ') || '연동 도구';
  $('#hero-text').textContent = agents.length ? `${sourceNames} 세션의 실제 상태를 보여주고 있어요.` : `${sourceNames}의 새 이벤트를 기다리고 있어요. 마지막 이벤트는 ${latestEvent ? ago(latestEvent) : '아직 없어요'}.`;
  render(snapshot.metrics, first);
  renderActivity(snapshot.activity.map((a: ActivityItem) => ({
    agent: a.agent,
    text: a.text,
    detail: [PROVIDER_NAME[a.provider], labels.get(projectIdentity(a)) ?? a.project].filter(Boolean).join(' · '),
    at: a.at,
    icon: iconFor(a.text, a.tool),
    tool: a.tool,
    provider: a.provider,
    sourceId: a.sourceId,
    projectId: projectIdentity(a),
  })));
  renderQueue([{ icon: 'i', title: '선택한 에이전트에 메시지를 보내세요', detail: '쉬는 세션을 CLI로 재개해요. 기존 권한 정책이 적용되고, 이 화면에서는 권한을 승인할 수 없어요.', tag: '안내' }]);
  renderChatTargets();
}

async function poll() {
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (!response.ok) throw new Error(String(response.status));
    const snapshot = (await response.json()) as Snapshot;
    if (snapshot.connected) applySnapshot(snapshot);
    $('#sync-text').textContent = '방금 업데이트';
  } catch {
    $('#sync-text').textContent = '수신기에 연결할 수 없어요';
  }
}

// ---------------- agent chat ----------------
function renderChatTargets() {
  const select = $<HTMLSelectElement>('#chat-agent-select');
  const targets = agents.filter(agent => !agent.isSubagent);
  const signature = JSON.stringify(targets.map(agent => [agent.id, agent.name, agent.projectLabel]));
  if (select.dataset.options !== signature) {
    const previous = chatAgentId;
    select.replaceChildren(new Option('에이전트를 선택해 주세요', ''), ...targets.map(agent =>
      new Option(`${agent.name} · ${agent.provider ? PROVIDER_NAME[agent.provider] : ''} · ${agent.projectLabel ?? agent.role}`, agent.id)));
    select.dataset.options = signature;
    chatAgentId = targets.some(agent => agent.id === previous) ? previous : '';
  }
  select.disabled = !targets.length;
  select.value = chatAgentId;
  updateChatControls();
}

function updateChatControls() {
  const target = agents.find(agent => agent.id === chatAgentId && !agent.isSubagent);
  const input = $<HTMLInputElement>('#chat-input');
  const button = $<HTMLButtonElement>('#chat-form .send-btn');
  const busy = Boolean(target && (target.state === 'working' || target.state === 'waiting'));
  const pending = Boolean(target && chatPending.has(target.id));
  input.disabled = !target || busy || pending;
  button.disabled = !target || busy || pending;
  $('#chat-status').textContent = !target
    ? agents.some(agent => !agent.isSubagent) ? '메시지를 보낼 에이전트를 선택해 주세요.' : '훅 이벤트가 도착하면 실제 세션에 메시지를 보낼 수 있어요.'
    : pending ? `${target.name}의 답변을 기다리고 있어요.`
      : busy ? `${target.name}이 현재 작업 중이에요. 작업이 끝나면 메시지를 보낼 수 있어요.`
        : `${target.name} 세션에 다음 메시지를 보낼 수 있어요.`;
}

function renderChat(messages: ChatMessage[], agent: ViewAgent) {
  const list = $('#chat-messages');
  if (!messages.length) {
    list.replaceChildren(el('div', 'activity-empty', `${agent.name}에게 보낸 메시지가 아직 없어요.`));
    return;
  }
  list.replaceChildren(...messages.map(message => {
    const row = el('div', `chat-message ${message.role}${message.status === 'sending' ? ' sending' : ''}${message.status === 'error' ? ' error' : ''}`);
    const body = el('p', '', message.status === 'sending' ? '응답 생성 중…' : message.text);
    const label = message.role === 'user' ? '나' : agent.name;
    const status = message.status === 'sending' ? '응답 중' : message.status === 'error' ? '전달 실패' : ago(message.at);
    row.append(body, el('small', '', `${label} · ${status}`));
    return row;
  }));
  list.scrollTop = list.scrollHeight;
}

async function loadChatHistory(agentId: string): Promise<boolean> {
  if (!agentId) {
    $('#chat-messages').replaceChildren(el('div', 'activity-empty', '에이전트를 선택하면 대화 기록이 여기에 표시돼요.'));
    updateChatControls();
    return false;
  }
  try {
    const response = await fetch(`/api/chat?agentId=${encodeURIComponent(agentId)}`, { cache: 'no-store' });
    const body = await response.json() as { messages?: ChatMessage[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? '채팅 기록을 불러오지 못했어요.');
    const messages = body.messages ?? [];
    const agent = agents.find(item => item.id === agentId);
    const pending = messages.some(message => message.status === 'sending');
    if (pending) chatPending.add(agentId); else chatPending.delete(agentId);
    if (agentId === chatAgentId && agent) renderChat(messages, agent);
    updateChatControls();
    if (agentId === chatAgentId) {
      if (pending && !chatPollTimer) chatPollTimer = window.setInterval(() => void loadChatHistory(chatAgentId), 1200);
      if (!pending && chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = 0; }
    }
    return pending;
  } catch (error) {
    if (agentId === chatAgentId) $('#chat-status').textContent = (error as Error).message;
    return false;
  }
}

$('#chat-agent-select').addEventListener('change', event => {
  if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = 0; }
  const id = (event.currentTarget as HTMLSelectElement).value;
  chatAgentId = id;
  const agent = agents.find(item => item.id === id);
  if (agent) { selected = id; office.select(id); renderSidebar(); }
  void loadChatHistory(id);
  updateChatControls();
});

$('#chat-form').addEventListener('submit', async event => {
  event.preventDefault();
  const target = agents.find(agent => agent.id === chatAgentId && !agent.isSubagent);
  const input = $<HTMLInputElement>('#chat-input');
  const message = input.value.trim();
  if (!target || !message || target.state === 'working' || target.state === 'waiting' || chatPending.has(target.id)) return;
  const targetId = target.id;
  chatPending.add(targetId);
  updateChatControls();
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: targetId, text: message }),
    });
    const body = await response.json() as { error?: string };
    if (!response.ok) throw new Error(body.error ?? '메시지를 보내지 못했어요.');
    if (chatAgentId === targetId) input.value = '';
    await loadChatHistory(targetId);
  } catch (error) {
    chatPending.delete(targetId);
    toast((error as Error).message);
    updateChatControls();
  }
});

// ---------------- tool connections ----------------
interface SetupStatus { connected: boolean; node: boolean; settingsPath: string }
type ToolProvider = 'claude' | 'codex';
const setups: Partial<Record<ToolProvider, SetupStatus>> = {};
const SETUP_UI: Record<ToolProvider, { name: string; url: string }> = {
  claude: { name: 'Claude Code', url: '/api/setup' },
  codex: { name: 'Codex', url: '/api/setup/codex' },
};

function renderSetup(provider: ToolProvider) {
  const setup = setups[provider];
  if (!setup) return;
  const prefix = provider === 'claude' ? 'claude' : 'codex';
  $(`#${prefix}-setup-state`).textContent = setup.connected ? (provider === 'codex' ? '등록됨' : '연결됨') : '연결 안 됨';
  $(`#${prefix}-setup-note`).textContent = !setup.node
    ? 'Node.js가 있어야 훅이 실행돼요. 설치한 뒤 다시 연결해 주세요.'
    : provider === 'codex'
      ? setup.connected ? 'Codex CLI에서 /hooks를 열고 tokenOffice 훅을 검토하고 신뢰하면 새 세션부터 보여요.'
        : '누르면 Codex 사용자 설정에 훅을 추가해요. 기존 설정은 보존하고 백업해요.'
      : setup.connected ? '새로 여는 Claude Code 세션부터 사무실에 나타나요.'
        : '누르면 Claude Code 사용자 설정에 훅을 추가해요. 기존 설정은 보존하고 백업해요.';
  const button = $<HTMLButtonElement>(`#${prefix}-setup-button`);
  button.hidden = false;
  button.textContent = setup.connected ? '연결 해제' : '연결하기';
}

async function loadSetups() {
  await Promise.all((Object.keys(SETUP_UI) as ToolProvider[]).map(async provider => {
    try {
      const response = await fetch(SETUP_UI[provider].url, { cache: 'no-store' });
      if (response.ok) { setups[provider] = (await response.json()) as SetupStatus; renderSetup(provider); }
    } catch { /* the receiver is down; the sync text already says so */ }
  }));
}

async function toggleSetup(provider: ToolProvider) {
  const setup = setups[provider];
  const button = $<HTMLButtonElement>(`#${provider}-setup-button`);
  button.disabled = true;
  try {
    const endpoint = provider === 'codex' ? '/api/setup/codex' : '/api/setup';
    const response = await fetch(`${endpoint}/${setup?.connected ? 'disconnect' : 'connect'}`, { method: 'POST' });
    const body = (await response.json()) as SetupStatus & { error?: string };
    if (!response.ok) { toast(body.error ?? '연결 설정을 바꾸지 못했어요.'); return; }
    setups[provider] = body;
    renderSetup(provider);
    toast(body.connected
      ? provider === 'codex' ? 'Codex 훅을 등록했어요. Codex CLI의 /hooks에서 검토하고 신뢰해 주세요.' : '연결했어요. 새 Claude Code 세션부터 나타나요.'
      : `${SETUP_UI[provider].name} 연결을 해제했어요.`);
  } catch {
    toast('수신기에 연결할 수 없어요.');
  } finally {
    button.disabled = false;
  }
}

$('#claude-setup-button').addEventListener('click', () => void toggleSetup('claude'));
$('#codex-setup-button').addEventListener('click', () => void toggleSetup('codex'));
window.addEventListener('focus', () => void loadSetups());

// ---------------- rename ----------------
const dialog = $<HTMLDialogElement>('#rename-dialog');
const nameInput = $<HTMLInputElement>('#rename-input');
let renaming: ViewAgent | undefined;

function openRename(agent: ViewAgent) {
  renaming = agent;
  nameInput.value = profiles[agent.key]?.name ?? agent.name.replace(/ \d+$/, '');
  const picker = $('#look-picker');
  picker.replaceChildren(el('legend', '', '캐릭터'), ...ALL_LOOKS.map(look => {
    const label = el('label');
    const radio = el('input');
    radio.type = 'radio';
    radio.name = 'look';
    radio.value = look;
    radio.checked = look === agent.look;
    radio.setAttribute('aria-label', LOOK_LABEL[look]);
    const face = el('span');
    face.style.backgroundImage = `url(${headUrl(look, 3)})`;
    label.title = LOOK_LABEL[look];
    label.append(radio, face);
    return label;
  }));
  $('#rename-note').textContent = agent.isSubagent ? `${agent.role} 서브에이전트에 계속 적용돼요.`
    : agent.projectLabel ? `"${agent.projectLabel}" 프로젝트 세션에 계속 적용돼요.`
    : '이 세션 캐릭터에 계속 적용돼요.';
  dialog.showModal();
  nameInput.select();
}

function refresh() {
  if (live && lastSnapshot) applySnapshot(lastSnapshot);
  else render({ tools: 0, turns: 0, events: 0 }, true);
}

dialog.addEventListener('close', () => {
  const agent = renaming;
  renaming = undefined;
  if (!agent || dialog.returnValue !== 'save') return;
  const name = nameInput.value.trim().slice(0, 16);
  const look = dialog.querySelector<HTMLInputElement>('input[name="look"]:checked')?.value as Look | undefined;
  profiles = { ...profiles, [agent.key]: { ...(name && name !== agent.baseName ? { name } : {}), ...(look ? { look } : {}) } };
  saveProfiles();
  refresh();
  toast(`${name || agent.baseName}(으)로 바꿨어요`);
});
$('#rename-reset').addEventListener('click', () => {
  if (renaming) { const { [renaming.key]: _, ...rest } = profiles; profiles = rest; saveProfiles(); }
  dialog.close('reset');
  refresh();
});
$('#office-canvas').addEventListener('dblclick', () => {
  const agent = agents.find(a => a.id === selected);
  if (agent) openRename(agent);
});

// ---------------- chrome ----------------
function updateClock() {
  const now = new Date();
  $('#current-date').textContent = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' }).format(now);
  $('#current-time').textContent = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(now);
  const hour = now.getHours();
  $('#greeting').textContent = hour < 6 ? '늦은 밤이에요' : hour < 12 ? '좋은 아침이에요' : hour < 18 ? '좋은 오후예요' : '좋은 저녁이에요';
}

$('#menu-button').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
$('#brand-mark').style.backgroundImage = `url(${propUrl('house')})`;

updateClock();
setInterval(updateClock, 30_000);
$('#live-text').textContent = '실제 이벤트 수신 대기';
render({ tools: 0, turns: 0, events: 0 }, true);
renderActivity([], false);
renderQueue([{ icon: 'i', title: '실제 세션을 기다리고 있어요', detail: 'Claude Code 또는 Codex를 연결하고 CLI에서 세션을 시작해 주세요.', tag: '대기 중' }]);
void loadSetups();
poll();
setInterval(poll, POLL_MS);
