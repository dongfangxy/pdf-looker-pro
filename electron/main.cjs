'use strict';
/**
 * Electron main process.
 *
 * The renderer is served over a privileged `app://` scheme rather than `file://`:
 * Chromium refuses to construct a Worker from a `file://` script when the page
 * origin is opaque, and the PDF engine runs in a worker.
 *
 * Everything the desktop shell adds beyond the web build — the native menu, native
 * file dialogs, window geometry, the recent list, single-instance behaviour and
 * file associations — is funnelled through the preload bridge so the renderer stays
 * a plain web application that also happens to run in a browser.
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', 'dist');
const SCHEME = 'app';
const HOST = 'bundle';
const ENTRY = `${SCHEME}://${HOST}/index.html`;

/** Content types for the asset kinds the bundle actually contains. */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.arpk': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.bcmap': 'application/octet-stream',
  '.icc': 'application/vnd.iccprofile',
  '.bin': 'application/octet-stream',
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
  },
]);

// ------------------------------------------------------------------- settings

const DEFAULT_SETTINGS = {
  window: { width: 1280, height: 880, x: null, y: null, maximized: false },
  recents: [],
  language: 'zh-CN',
  viewMode: 'continuous',
  theme: 'dark',
  showStatusBar: true,
  pageGap: 'normal',
  defaultViewMode: 'continuous',
  defaultZoomMode: 'fit-width',
  lastOpenDir: null,
};

/** Keys the renderer is allowed to persist through the settings bridge. */
const PERSISTED_KEYS = [
  'language',
  'viewMode',
  'theme',
  'showStatusBar',
  'showSidebar',
  'pageGap',
  'defaultViewMode',
  'defaultZoomMode',
  'styles',
  'hiddenCommands',
];
const MAX_RECENTS = 12;

let settings = { ...DEFAULT_SETTINGS };
let settingsPath = '';
let settingsWriteTimer = null;

/**
 * Carries preferences over from the previous product name.
 *
 * Renaming the application moves Electron's userData directory, which would
 * silently drop the recent list and every preference. This runs once, before the
 * settings are first read.
 */
async function migrateLegacySettings() {
  const target = path.join(app.getPath('userData'), 'settings.json');
  try {
    await fs.access(target);
    return; // Already have settings under the new name.
  } catch {
    // No settings yet: this may be the first launch after the rename.
  }
  const legacy = path.join(path.dirname(app.getPath('userData')), 'pdfreader', 'settings.json');
  try {
    await fs.copyFile(legacy, target);
  } catch {
    // Nothing to carry over; a fresh install starts with defaults.
  }
}

async function loadSettings() {
  settingsPath = path.join(app.getPath('userData'), 'settings.json');
  try {
    const parsed = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    settings = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      window: { ...DEFAULT_SETTINGS.window, ...(parsed.window ?? {}) },
      recents: Array.isArray(parsed.recents) ? parsed.recents.slice(0, MAX_RECENTS) : [],
    };
  } catch {
    // A missing or unreadable settings file is not an error: defaults apply.
    settings = { ...DEFAULT_SETTINGS };
  }
}

function scheduleSettingsWrite() {
  if (settingsWriteTimer) clearTimeout(settingsWriteTimer);
  settingsWriteTimer = setTimeout(() => {
    settingsWriteTimer = null;
    fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8').catch(() => undefined);
  }, 250);
}

// ---------------------------------------------------------------- file access

/**
 * Paths the user has already chosen through a dialog or the recent list.
 *
 * The renderer can only read and write these, so a compromised renderer cannot use
 * the bridge as a general filesystem API.
 */
const grantedPaths = new Set();

// Bounds on a folder search, so a mistaken path cannot walk a whole disk.
const MAX_SEARCH_FILES = 200;
const MAX_SEARCH_DEPTH = 4;

function grantPath(target) {
  const resolved = path.resolve(target);
  grantedPaths.add(resolved);
  // The annotation sidecar lives beside its document, so choosing one grants both.
  grantedPaths.add(`${resolved}.arpk`);
  return resolved;
}

// --------------------------------------------------------------------- window

let mainWindow = null;
let pendingOpenPath = null;
let closeConfirmed = false;

function resolveAsset(requestUrl) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.host !== HOST) return null;
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const full = path.normalize(path.join(ROOT, relative || 'index.html'));
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return full;
}

/** Restores saved geometry only when it still lands on a connected display. */
function restoredBounds() {
  const saved = settings.window;
  const width = Number.isInteger(saved.width) ? saved.width : 1280;
  const height = Number.isInteger(saved.height) ? saved.height : 880;
  if (!Number.isInteger(saved.x) || !Number.isInteger(saved.y)) return { width, height };
  const displays = require('electron').screen.getAllDisplays();
  const visible = displays.some((display) => {
    const area = display.workArea;
    return saved.x < area.x + area.width - 80 && saved.x + width > area.x + 80 && saved.y < area.y + area.height - 40 && saved.y + height > area.y;
  });
  return visible ? { x: saved.x, y: saved.y, width, height } : { width, height };
}

function captureBounds(win) {
  if (!win || win.isDestroyed()) return;
  const maximized = win.isMaximized();
  // Only record the restored geometry, so un-maximising returns to a usable size.
  if (!maximized && !win.isMinimized()) {
    const bounds = win.getBounds();
    settings.window = { ...settings.window, ...bounds, maximized: false };
  } else {
    settings.window = { ...settings.window, maximized };
  }
  scheduleSettingsWrite();
}

function createWindow() {
  const win = new BrowserWindow({
    ...restoredBounds(),
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#3a3a3c',
    title: 'PDF Reader',
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  if (settings.window.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  win.on('resize', () => captureBounds(win));
  win.on('move', () => captureBounds(win));
  win.on('maximize', () => captureBounds(win));
  win.on('unmaximize', () => captureBounds(win));

  // Ask the renderer first: unsaved annotations may need a prompt.
  win.on('close', (event) => {
    captureBounds(win);
    if (closeConfirmed) return;
    event.preventDefault();
    win.webContents.send('desktop:close-requested', {});
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

/** Ids of commands the renderer marked as "applies to the focused window". */
function buildMenu(descriptor) {
  const menus = Array.isArray(descriptor?.menus) ? descriptor.menus : [];

  const toItem = (entry) => {
    if (!entry || typeof entry !== 'object') return null;
    if (entry.type === 'separator') return { type: 'separator' };
    const item = { label: String(entry.label ?? '') };
    if (entry.accelerator) item.accelerator = String(entry.accelerator);
    if (typeof entry.enabled === 'boolean') item.enabled = entry.enabled;
    if (typeof entry.checked === 'boolean') item.checked = entry.checked;
    if (Array.isArray(entry.items)) {
      item.submenu = entry.items.map(toItem).filter(Boolean);
      return item.submenu.length > 0 ? item : null;
    }
    if (entry.type === 'role') {
      item.role = entry.role;
      return item;
    }
    const id = Number(entry.id);
    if (!Number.isFinite(id)) return null;
    // `data` carries per-item payloads such as a recent file path.
    const data = typeof entry.data === 'string' ? entry.data : undefined;
    item.click = () => mainWindow?.webContents.send('desktop:menu-command', { id, data });
    return item;
  };

  const template = menus.map((menu) => ({
    label: String(menu.label ?? ''),
    submenu: (Array.isArray(menu.items) ? menu.items : []).map(toItem).filter(Boolean),
  }));

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  return true;
}

/** Extracts a PDF path from a command line, ignoring switches. */
function pdfFromArgv(argv) {
  for (const arg of argv.slice(1)) {
    if (typeof arg !== 'string' || arg.startsWith('-')) continue;
    if (/\.pdf$/i.test(arg)) return path.resolve(arg);
  }
  return null;
}

async function deliverOpenPath(target) {
  const resolved = grantPath(target);
  if (!mainWindow || mainWindow.webContents.isLoading()) {
    pendingOpenPath = resolved;
    return;
  }
  mainWindow.webContents.send('desktop:open-file', { path: resolved, name: path.basename(resolved) });
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

// ------------------------------------------------------------------ IPC wiring

function registerIpc() {
  ipcMain.handle('desktop:set-menu', (_event, descriptor) => buildMenu(descriptor));

  ipcMain.handle('desktop:set-title', (_event, payload) => {
    if (!mainWindow) return false;
    const title = typeof payload?.title === 'string' && payload.title.length > 0 ? payload.title : 'PDF Reader';
    mainWindow.setTitle(payload?.edited === true ? `${title} *` : title);
    mainWindow.setDocumentEdited?.(payload?.edited === true);
    return true;
  });

  ipcMain.handle('desktop:open-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open PDF',
      defaultPath: settings.lastOpenDir ?? undefined,
      properties: ['openFile'],
      filters: [
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = grantPath(result.filePaths[0]);
    settings.lastOpenDir = path.dirname(filePath);
    scheduleSettingsWrite();
    try {
      const bytes = await fs.readFile(filePath);
      return { path: filePath, name: path.basename(filePath), bytes: new Uint8Array(bytes) };
    } catch (err) {
      return { path: filePath, name: path.basename(filePath), error: String(err) };
    }
  });

  ipcMain.handle('desktop:save-dialog', async (_event, options) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: typeof options?.title === 'string' ? options.title : 'Save',
      defaultPath: typeof options?.defaultPath === 'string' ? options.defaultPath : undefined,
      filters: Array.isArray(options?.filters) ? options.filters : [{ name: 'All files', extensions: ['*'] }],
    });
    if (result.canceled || !result.filePath) return null;
    return grantPath(result.filePath);
  });

  ipcMain.handle('desktop:write-file', async (_event, payload) => {
    const target = path.resolve(String(payload?.path ?? ''));
    if (!grantedPaths.has(target)) return { ok: false, error: 'path was not chosen by the user' };
    try {
      await fs.writeFile(target, Buffer.from(payload.bytes));
      return { ok: true, path: target };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('desktop:read-file', async (_event, payload) => {
    const target = path.resolve(String(payload?.path ?? ''));
    if (!grantedPaths.has(target)) return null;
    try {
      const bytes = await fs.readFile(target);
      return { path: target, name: path.basename(target), bytes: new Uint8Array(bytes) };
    } catch {
      return null;
    }
  });

  /**
   * Lists the PDFs under a folder and grants read access to them.
   *
   * The grant is the point: `read-file` refuses anything the user has not opened, and a
   * folder the user names here is exactly as explicit as one they pick from a dialogue.
   * Depth and count are bounded so a folder pointed at by mistake cannot walk a whole
   * disk.
   */
  ipcMain.handle('desktop:list-pdfs', async (_event, payload) => {
    const root = path.resolve(String(payload?.path ?? ''));
    try {
      const info = await fs.stat(root);
      if (!info.isDirectory()) return { ok: false, error: 'not a directory' };
    } catch {
      return { ok: false, error: 'folder not found' };
    }

    const files = [];
    const walk = async (dir, depth) => {
      if (depth > MAX_SEARCH_DEPTH || files.length >= MAX_SEARCH_FILES) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (files.length >= MAX_SEARCH_FILES) return;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full, depth + 1);
          continue;
        }
        if (!entry.isFile() || !/\.pdf$/i.test(entry.name)) continue;
        grantedPaths.add(full);
        files.push(full);
      }
    };
    await walk(root, 0);
    return { ok: true, files, truncated: files.length >= MAX_SEARCH_FILES };
  });

  ipcMain.handle('desktop:settings-read', () => settings);

  /**
   * Pulls a file that was queued before the renderer was listening.
   *
   * The main process learns about a command-line or association file as soon as the
   * page finishes loading, but the renderer only subscribes once its resource pack
   * has loaded. Without a pull path that message would be delivered into the void.
   */
// Printing is a renderer-driven flow: the page builds the printable document and
// the print stylesheet selects it, so the main process only raises the dialogue.
ipcMain.handle('desktop:print', async (event, options) => {
  const contents = event.sender;
  return new Promise((resolve) => {
    try {
      contents.print(
        {
          silent: false,
          printBackground: options && options.printBackground === false ? false : true,
          margins: { marginType: 'none' },
        },
        (success, failureReason) => resolve({ ok: success === true, reason: failureReason }),
      );
    } catch (error) {
      resolve({ ok: false, reason: String(error && error.message ? error.message : error) });
    }
  });
});
  ipcMain.handle('desktop:take-pending-open', () => {
    const target = pendingOpenPath;
    pendingOpenPath = null;
    return target ? { path: target, name: path.basename(target) } : null;
  });

  ipcMain.handle('desktop:settings-patch', (_event, patch) => {
    if (!patch || typeof patch !== 'object') return settings;
    for (const key of PERSISTED_KEYS) {
      if (patch[key] !== undefined) settings[key] = patch[key];
    }
    if (Array.isArray(patch.recents)) settings.recents = patch.recents.slice(0, MAX_RECENTS);
    scheduleSettingsWrite();
    return settings;
  });

  ipcMain.on('desktop:close-confirmed', () => {
    closeConfirmed = true;
    mainWindow?.close();
  });
}

// ----------------------------------------------------------------------- life

// A second launch focuses the existing window and forwards any file argument.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const target = pdfFromArgv(argv);
    if (target) void deliverOpenPath(target);
    else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    void deliverOpenPath(filePath);
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId('local.pdfreader');

    protocol.handle(SCHEME, async (request) => {
      const file = resolveAsset(request.url);
      if (!file) return new Response('Not found', { status: 404 });
      try {
        const data = await fs.readFile(file);
        const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
        return new Response(data, { status: 200, headers: { 'content-type': type } });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });

    await migrateLegacySettings();
    await loadSettings();
    registerIpc();

    mainWindow = createWindow();
    mainWindow.webContents.once('did-finish-load', () => {
      const fromArgv = pdfFromArgv(process.argv);
      const target = pendingOpenPath ?? fromArgv;
      pendingOpenPath = null;
      if (target) void deliverOpenPath(target);
    });
    await mainWindow.loadURL(ENTRY);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
        void mainWindow.loadURL(ENTRY);
      }
    });
  });

  app.on('before-quit', () => {
    if (settingsWriteTimer) {
      clearTimeout(settingsWriteTimer);
      settingsWriteTimer = null;
      try {
        require('node:fs').writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
      } catch {
        // Losing the final write only costs the last few pixels of window geometry.
      }
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
