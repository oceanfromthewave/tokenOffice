// Dashboard: polls the local hook receiver and shows live Claude Code sessions; plays a demo until the first event arrives.
import { LOOKS, type Look } from '../shared/pixels.ts';
import type { ActivityItem, AgentRecord, AgentState, Snapshot } from '../shared/types.ts';
import { Office, type OfficeAgent } from './office/office.ts';
import { headUrl, propUrl } from './office/sprites.ts';

/** `key` names whoever this is across sessions (project for a session, type for a subagent) so a rename sticks. */
interface ViewAgent extends OfficeAgent { role: string; key: string; baseName: string }
interface Stats { tools: number; turns: number; events: number }

const LABEL: Record<AgentState, string> = { working: '작업 중', break: '휴식 중', done: '완료', waiting: '응답 대기', error: '오류' };
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

// ---------------- names and characters people chose ----------------
interface Profile { name?: string; look?: Look }
const PROFILE_STORE = 'tokenOffice.profiles';
const ALL_LOOKS: Look[] = [...LOOKS, 'bot'];
const LOOK_LABEL: Record<Look, string> = { momo: '안경 쓴 직원', lumi: '긴 머리 직원', tori: '헤드폰 쓴 직원', koko: '모자 쓴 직원', bot: '로봇' };
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
  $('#empty-office').hidden = !live || agents.length > 0;
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
}

function renderActivity(items: { agent: string; text: string; detail: string; at: number; icon: string }[]) {
  const list = $('#activity-list');
  if (!items.length) { list.replaceChildren(el('div', 'activity-empty', '아직 기록된 활동이 없어요.')); return; }
  list.replaceChildren(...items.map(item => {
    const row = el('div', 'activity-row');
    const text = el('div', 'activity-text');
    text.append(el('strong', '', item.agent), document.createTextNode(` ${item.text}`), el('small', '', item.detail));
    row.append(el('div', 'activity-icon', item.icon), text, el('span', 'activity-time', ago(item.at)));
    return row;
  }));
}

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
function fromRecords(records: AgentRecord[]): ViewAgent[] {
  const seen = new Map<string, number>();
  return records.map(r => {
    if (!looks.has(r.id)) looks.set(r.id, r.isSubagent ? 'bot' : LOOKS[nextLook++ % LOOKS.length]!);
    const key = r.isSubagent ? `sub:${r.agentType || r.name}` : `main:${r.project}`;
    const profile = profiles[key] ?? {};
    const name = profile.name || r.name;
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return {
      id: r.id,
      key,
      baseName: r.name,
      name: count > 1 ? `${name} ${count}` : name,
      look: profile.look ?? looks.get(r.id)!,
      state: r.state,
      tool: r.tool,
      isSubagent: r.isSubagent,
      role: [r.isSubagent ? r.project : '', r.tool || (r.isSubagent ? '서브에이전트' : 'Claude Code')].filter(Boolean).join(' · '),
    };
  });
}

function applySnapshot(snapshot: Snapshot) {
  lastSnapshot = snapshot;
  const first = !live;
  live = true;
  stopDemo();
  agents = fromRecords(snapshot.agents);
  $('#live-text').textContent = 'Claude Code 연결됨';
  $('#live-pill').classList.add('connected');
  $('#hero-text').textContent = agents.length ? 'Claude Code 세션의 실제 상태를 보여주고 있어요.' : 'Claude Code 세션이 끝났어요. 새 세션을 기다리고 있어요.';
  render(snapshot.metrics, first);
  renderActivity(snapshot.activity.map((a: ActivityItem) => ({ agent: a.agent, text: a.text, detail: [a.project, a.tool].filter(Boolean).join(' · '), at: a.at, icon: iconFor(a.text, a.tool) })));
  renderQueue([{ icon: 'i', title: '이 대시보드는 상태를 보여주기만 해요', detail: '작업은 Claude Code 창에서 직접 맡겨 주세요.', tag: '안내' }]);
  const input = $<HTMLInputElement>('#task-input');
  input.disabled = true;
  input.placeholder = 'Claude Code에 직접 입력해 주세요';
  $<HTMLButtonElement>('.send-btn').disabled = true;
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

// ---------------- demo mode ----------------
const demoStats: Stats = { tools: 42, turns: 6, events: 0 };
const demoLog: { agent: string; text: string; detail: string; at: number; icon: string }[] = [];
const demoQueue = [
  { icon: '✍', title: '기능 소개 문서 정리', detail: '모모에게 배정 · 예상 5분', tag: '대기 중' },
  { icon: '⌕', title: '사용 흐름 한번 살펴보기', detail: '토리에게 배정 · 예상 8분', tag: '준비 중', wait: true },
];
const DEMO_TOOLS = ['Edit', 'Read', 'Bash', 'Grep', 'WebSearch', 'Write'];
const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)]!;
let demoTimers: number[] = [];

const DEMO_DEFAULTS: Record<string, { name: string; look: Look }> = {
  momo: { name: '모모', look: 'momo' }, lumi: { name: '루미', look: 'lumi' }, tori: { name: '토리', look: 'tori' }, koko: { name: '코코', look: 'koko' }, helper: { name: 'Explore', look: 'bot' },
};
function demoProfile(agent: ViewAgent) {
  const base = DEMO_DEFAULTS[agent.id] ?? { name: agent.baseName, look: agent.look };
  const profile = profiles[agent.key] ?? {};
  agent.name = profile.name || base.name;
  agent.look = profile.look ?? base.look;
  return agent;
}
function demoAgent(id: string, state: AgentState, tool: string, role: string, isSubagent = false): ViewAgent {
  const base = DEMO_DEFAULTS[id]!;
  return demoProfile({ id, key: `demo:${id}`, baseName: base.name, name: base.name, look: base.look, state, tool, isSubagent, role });
}
function demoAgents(): ViewAgent[] {
  return [
    demoAgent('momo', 'working', 'Edit', '문서 정리'),
    demoAgent('lumi', 'break', '', '리서치'),
    demoAgent('tori', 'working', 'Bash', '코드 리뷰'),
    demoAgent('koko', 'waiting', '', '테스트 정리'),
  ];
}

function demoLogEntry(agent: ViewAgent, text: string) {
  demoLog.unshift({ agent: agent.name, text, detail: [agent.role, agent.tool].filter(Boolean).join(' · '), at: Date.now(), icon: iconFor(text, agent.tool) });
  demoLog.length = Math.min(demoLog.length, 6);
  renderActivity(demoLog);
}

function demoChange(agent: ViewAgent, state: AgentState, tool = '') {
  agent.state = state;
  agent.tool = tool;
  if (tool) demoStats.tools += 1;
  if (state === 'break') demoStats.turns += 1;
  demoLogEntry(agent, state === 'working' ? `${tool} 사용 중` : state === 'break' ? '응답 완료, 잠깐 휴식' : state === 'waiting' ? '권한 확인 대기' : LABEL[state]);
  render(demoStats);
}

function startDemo() {
  agents = demoAgents();
  render(demoStats, true);
  renderActivity(demoLog);
  renderQueue(demoQueue);
  demoTimers.push(window.setInterval(() => {
    const people = agents.filter(a => !a.isSubagent);
    const agent = pick(people);
    if (agent.state === 'working') demoChange(agent, Math.random() < 0.25 ? 'waiting' : 'break');
    else demoChange(agent, 'working', pick(DEMO_TOOLS));
  }, 7000));
  // now and then a helper robot comes in through the door, works for a while and leaves
  demoTimers.push(window.setInterval(() => {
    if (agents.some(a => a.isSubagent)) return;
    const helper = demoAgent('helper', 'working', 'Grep', '서브에이전트', true);
    agents = [...agents, helper];
    demoChange(helper, 'working', 'Grep');
    demoTimers.push(window.setTimeout(() => demoChange(helper, 'done'), 16000));
    demoTimers.push(window.setTimeout(() => { agents = agents.filter(a => a !== helper); render(demoStats); }, 24000));
  }, 30000));
}

function stopDemo() {
  demoTimers.forEach(t => { clearInterval(t); clearTimeout(t); });
  demoTimers = [];
}

$('#task-form').addEventListener('submit', event => {
  event.preventDefault();
  if (live) return;
  const input = $<HTMLInputElement>('#task-input');
  const title = input.value.trim();
  if (!title) { input.focus(); return; }
  const agent = agents.find(a => !a.isSubagent && a.state === 'break') ?? agents.find(a => !a.isSubagent && a.state !== 'working');
  if (!agent) { toast('지금은 모두 일하는 중이에요. 잠시 후 다시 맡겨 주세요.'); return; }
  demoQueue.unshift({ icon: '✦', title, detail: `${agent.name}에게 배정 · 방금 추가`, tag: '진행 중' });
  renderQueue(demoQueue);
  demoChange(agent, 'working', 'Edit');
  input.value = '';
  toast(`${agent.name}에게 맡겼어요 (데모)`);
});

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
  $('#rename-note').textContent = agent.key.startsWith('main:') ? `"${agent.key.slice(5)}" 폴더에서 연 세션에 계속 적용돼요.`
    : agent.key.startsWith('sub:') ? `${agent.key.slice(4)} 서브에이전트에 계속 적용돼요.`
    : '데모 캐릭터에 적용돼요.';
  dialog.showModal();
  nameInput.select();
}

function refresh() {
  if (live && lastSnapshot) applySnapshot(lastSnapshot);
  else { agents.forEach(demoProfile); render(demoStats); }
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
startDemo();
poll();
setInterval(poll, POLL_MS);
