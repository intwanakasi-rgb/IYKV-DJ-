const { app, BrowserWindow, session, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const appUrl = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

app.setName('IYK DeckLab');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');


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
    if (url !== appUrl) event.preventDefault();
  });
  window.loadFile(path.join(__dirname, '..', 'index.html'));
}

app.whenReady().then(() => {
  const isTrusted = (contents) => contents?.getURL() === appUrl;
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(permission === 'midi' && isTrusted(contents));
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission) =>
    permission === 'midi' && isTrusted(contents));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

