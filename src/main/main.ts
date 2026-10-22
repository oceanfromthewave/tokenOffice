// Electron shell: runs the hook receiver in-process and shows the dashboard in a tray app.
import { app, BrowserWindow, Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron';
import updater from 'electron-updater';
import { join } from 'node:path';
import { DEFAULT_PORT, HOST, startServer } from '../server/server.ts';

const { autoUpdater } = updater; // CommonJS package: take the named export off the default
const port = Number(process.env.TOKEN_OFFICE_PORT) || DEFAULT_PORT;
const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;
let win: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
let updateReady = ''; // version waiting to be installed

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { win?.show(); win?.focus(); });
app.on('before-quit', () => { quitting = true; });

function notify(title: string, content: string) {
  tray?.displayBalloon({ title, content, iconType: 'info' });
}

function buildMenu() {
  const items: MenuItemConstructorOptions[] = [
    { label: '열기', click: () => win?.show() },
    {
      label: '윈도우 시작 시 자동 실행', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: item => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    updateReady
      ? { label: `재시작해서 ${updateReady}로 업데이트`, click: () => autoUpdater.quitAndInstall() }
      : { label: '업데이트 확인', enabled: app.isPackaged, click: () => checkForUpdates(true) },
    { label: `버전 ${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: '종료', click: () => { quitting = true; app.quit(); } },
  ];
  tray?.setContextMenu(Menu.buildFromTemplate(items));
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

  tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 16 }));
  tray.setToolTip('tokenOffice');
  tray.on('click', () => win?.show());
  buildMenu();
  setUpUpdates();
});
