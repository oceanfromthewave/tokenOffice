// Electron shell: runs the hook receiver in-process and shows the dashboard in a tray app.
import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import { join } from 'node:path';
import { DEFAULT_PORT, HOST, startServer } from '../server/server.ts';

const port = Number(process.env.TOKEN_OFFICE_PORT) || DEFAULT_PORT;
let win: BrowserWindow | undefined;
let quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { win?.show(); win?.focus(); });
app.on('before-quit', () => { quitting = true; });

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

  const tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 16 }));
  tray.setToolTip('tokenOffice');
  tray.on('click', () => win?.show());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '열기', click: () => win?.show() },
    {
      label: '윈도우 시작 시 자동 실행', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: item => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    { label: '종료', click: () => { quitting = true; app.quit(); } },
  ]));
});
