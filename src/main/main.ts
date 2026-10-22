// Electron shell: runs the hook receiver in-process and shows the dashboard in a tray app.
import { app, BrowserWindow, Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron';
import updater from 'electron-updater';
import { join } from 'node:path';
import { connectHooks, disconnectHooks, refreshHookScript, setupStatus } from '../server/hooksetup.ts';
import { codexSetupStatus, connectCodexHooks, disconnectCodexHooks, refreshCodexHookScript } from '../server/codex-hooksetup.ts';
import { DEFAULT_PORT, HOST, startServer } from '../server/server.ts';

const { autoUpdater } = updater; // CommonJS package: take the named export off the default
const port = Number(process.env.TOKEN_OFFICE_PORT) || DEFAULT_PORT;
const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;
let win: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
let updateReady = ''; // version waiting to be installed
let claudeHooked = false;
let codexHooked = false;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { win?.show(); win?.focus(); });
app.on('before-quit', () => { quitting = true; });

function notify(title: string, content: string) {
  tray?.displayBalloon({ title, content, iconType: 'info' });
}

function buildMenu() {
  const items: MenuItemConstructorOptions[] = [
    { label: '열기', click: () => win?.show() },
    { label: 'Claude Code 연결', type: 'checkbox', checked: claudeHooked, click: () => void toggleHooks('claude') },
    { label: 'Codex 연결', type: 'checkbox', checked: codexHooked, click: () => void toggleHooks('codex') },
    {
      label: '윈도우 시작 시 자동 실행', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: item => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    updateReady
      // silent install (no wizard), then start the new version
      ? { label: `재시작해서 ${updateReady}로 업데이트`, click: () => autoUpdater.quitAndInstall(true, true) }
      : { label: '업데이트 확인', enabled: app.isPackaged, click: () => checkForUpdates(true) },
    { label: `버전 ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: '종료', click: () => { quitting = true; app.quit(); } },
  ];
  tray?.setContextMenu(Menu.buildFromTemplate(items));
}

async function toggleHooks(provider: 'claude' | 'codex') {
  try {
    const current = provider === 'claude' ? claudeHooked : codexHooked;
    const status = provider === 'claude'
      ? await (current ? disconnectHooks() : connectHooks())
      : await (current ? disconnectCodexHooks() : connectCodexHooks());
    if (provider === 'claude') claudeHooked = status.connected;
    else codexHooked = status.connected;
    const name = provider === 'claude' ? 'Claude Code' : 'Codex';
    notify('tokenOffice', status.connected
      ? (!status.node ? '연결했지만 Node.js가 없어 훅이 실행되지 않아요. Node.js를 설치해 주세요.'
        : provider === 'codex' ? 'Codex 훅을 등록했어요. Codex CLI의 /hooks에서 tokenOffice 훅을 검토하고 신뢰해 주세요.'
          : 'Claude Code와 연결했어요. 새로 여는 세션부터 사무실에 나타나요.')
      : `${name} 연결을 해제했어요.`);
  } catch (error) {
    notify('연결 설정 실패', (error as Error).message);
  }
  buildMenu();
}

/** Checks GitHub Releases. Downloads happen in the background; the new version installs on the next restart. */
async function checkForUpdates(manual = false) {
  if (!app.isPackaged) return;
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!manual) return;
    const latest = result?.updateInfo.version;
    notify('tokenOffice', !latest || latest === app.getVersion() ? '최신 버전을 쓰고 있어요.' : `${latest}을 받는 중이에요. 다 받으면 알려드릴게요.`);
  } catch (error) {
    if (manual) notify('업데이트 확인 실패', (error as Error).message);
  }
}

function setUpUpdates() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', info => {
    updateReady = info.version;
    buildMenu();
    notify('업데이트 준비 완료', `${info.version}을 받았어요. 트레이 메뉴에서 재시작하거나, 다음에 앱을 끌 때 설치돼요.`);
  });
  autoUpdater.on('error', error => console.warn(`Update check failed: ${error.message}`));
  void checkForUpdates();
  setInterval(() => void checkForUpdates(), UPDATE_CHECK_MS);
}

app.whenReady().then(async () => {
  const icon = join(app.getAppPath(), 'build/icon.png');
  try {
    await startServer(port);
  } catch (error) {
    // Another copy (for example `npm start`) already owns the port; show that one instead of failing.
    console.warn(`Hook receiver not started here: ${(error as Error).message}`);
  }

  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 960, minHeight: 640,
    title: 'tokenOffice', backgroundColor: '#12162a', autoHideMenuBar: true, icon,
  });
  win.loadURL(`http://${HOST}:${port}/`);
  // Closing the window keeps the app (and the hook receiver) alive in the tray.
  win.on('close', event => { if (!quitting) { event.preventDefault(); win?.hide(); } });
  // The dashboard can also connect/disconnect, so refresh the tray checkboxes when the window returns.
  win.on('focus', () => void Promise.all([setupStatus(), codexSetupStatus()]).then(([claude, codex]) => {
    claudeHooked = claude.connected;
    codexHooked = codex.connected;
    buildMenu();
  }));

  tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 16 }));
  tray.setToolTip('tokenOffice');
  tray.on('click', () => win?.show());
  const [claude, codex] = await Promise.all([setupStatus(), codexSetupStatus()]);
  claudeHooked = claude.connected;
  codexHooked = codex.connected;
  void refreshHookScript();
  void refreshCodexHookScript();
  buildMenu();
  setUpUpdates();
});
