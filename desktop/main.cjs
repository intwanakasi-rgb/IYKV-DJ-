const { app, BrowserWindow, session, shell } = require('electron');
const path = require('node:path');

app.setName('IYK DeckLab');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
  callback(permission === 'midi');
});
session.defaultSession.setPermissionCheckHandler((_webContents, permission) => permission === 'midi');

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 680,
    backgroundColor: '#0c0d11',
    title: 'IYK DeckLab',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== `file://${path.join(__dirname, '..', 'index.html')}`) event.preventDefault();
  });
  window.loadFile(path.join(__dirname, '..', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
