import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const dir = fileURLToPath(new URL('.', import.meta.url));
const url = 'http://127.0.0.1:47821';
let win;
let tray;
let quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { win?.show(); win?.focus(); });

app.whenReady().then(async () => {
  // Dashboard server (also receives Claude Code hook events) runs inside the app.
  await import('./server.mjs');

  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 640,
    title: 'tokenOffice', backgroundColor: '#f5f6f2', autoHideMenuBar: true,
    icon: join(dir, 'build/icon.png'),
  });
  win.loadURL(url);
  // Closing the window keeps the app (and hook receiver) alive in the tray.
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } });

  tray = new Tray(nativeImage.createFromPath(join(dir, 'build/icon.png')).resize({ width: 16 }));
  tray.setToolTip('tokenOffice');
  tray.on('click', () => win.show());
  const menu = () => Menu.buildFromTemplate([
    { label: '열기', click: () => win.show() },
    { label: '윈도우 시작 시 자동 실행', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: item => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { type: 'separator' },
    { label: '종료', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu());
});

app.on('before-quit', () => { quitting = true; });
