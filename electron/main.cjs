const { app, BrowserWindow, dialog, Menu, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const entryPath = path.join(__dirname, '..', 'dist', 'index.html');
const entryUrl = pathToFileURL(entryPath);
let mainWindow;

function isAppUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === entryUrl.protocol && url.host === entryUrl.host && url.pathname === entryUrl.pathname;
  } catch {
    return false;
  }
}

function openInBrowser(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      shell.openExternal(url.href).catch((error) => console.error('Não foi possível abrir o link:', error));
    }
  } catch {
    // Links inválidos ou de outros protocolos não são abertos.
  }
}

const webPreferences = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  // A janela de controle continua enviando a simulação ao segundo monitor.
  backgroundThrottling: false,
};

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      openInBrowser(url);
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    // #visual = 2ª janela (cena 3D); #tela=N = janela de tela (simulador completo espelhado)
    const hash = isAppUrl(url) ? new URL(url).hash : '';
    if (hash === '#visual' || /^#tela=\d+$/.test(hash)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1280,
          height: hash === '#visual' ? 760 : 800,
          backgroundColor: '#0a1017',
          autoHideMenuBar: true,
          webPreferences,
        },
      };
    }
    openInBrowser(url);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'SX-1 · Simulador de Submarino',
    backgroundColor: '#0a1017',
    show: false,
    webPreferences,
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
    // Evita deixar a visualização aberta sem o motor da simulação.
    for (const window of BrowserWindow.getAllWindows()) window.close();
  });
  await mainWindow.loadFile(entryPath);
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'Arquivo', submenu: [{ label: 'Sair', role: 'quit' }] },
    { label: 'Editar', submenu: [
      { label: 'Desfazer', role: 'undo' },
      { label: 'Refazer', role: 'redo' },
      { type: 'separator' },
      { label: 'Recortar', role: 'cut' },
      { label: 'Copiar', role: 'copy' },
      { label: 'Colar', role: 'paste' },
      { label: 'Selecionar tudo', role: 'selectAll' },
    ] },
    { label: 'Exibir', submenu: [
      { label: 'Tamanho original', role: 'resetZoom' },
      { label: 'Aumentar', role: 'zoomIn' },
      { label: 'Diminuir', role: 'zoomOut' },
      { type: 'separator' },
      { label: 'Tela cheia', role: 'togglefullscreen' },
    ] },
  ]));
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch(showStartupError);
    }
  });
}).catch(showStartupError);

function showStartupError(error) {
  dialog.showErrorBox('Não foi possível iniciar o SX-1', `${error.message}\n\nSe estiver usando o código-fonte, execute npm run desktop.`);
  app.quit();
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
