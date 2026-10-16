'use strict';
/**
 * Preload bridge.
 *
 * This is the only surface the renderer gets. Context isolation stays on, Node
 * integration stays off, and every capability is an explicit named function rather
 * than a general "invoke anything" channel.
 */
const { contextBridge, ipcRenderer } = require('electron');

/** Wraps an ipcRenderer.on subscription so the renderer can unsubscribe. */
function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('desktop', {
  /** Presence check: the renderer branches on this instead of sniffing the UA. */
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },

  /** Replaces the application menu. The descriptor comes from the language pack. */
  setMenu: (descriptor) => ipcRenderer.invoke('desktop:set-menu', descriptor),
  /** Sets the window title, and the platform's edited indicator. */
  setWindowTitle: (title, edited) => ipcRenderer.invoke('desktop:set-title', { title, edited }),

  /** Native open dialog. Returns file bytes so the renderer needs no fs access. */
  openFileDialog: () => ipcRenderer.invoke('desktop:open-dialog'),
  /** Native save dialog; resolves to the chosen path or null. */
  saveFileDialog: (options) => ipcRenderer.invoke('desktop:save-dialog', options),
  /** Writes bytes to an already-chosen path (used after saveFileDialog). */
  writeFile: (path, bytes) => ipcRenderer.invoke('desktop:write-file', { path, bytes }),
  /** Reads a file chosen earlier, e.g. from the recent list. */
  readFile: (path) => ipcRenderer.invoke('desktop:read-file', { path }),

  settings: {
    read: () => ipcRenderer.invoke('desktop:settings-read'),
    patch: (patch) => ipcRenderer.invoke('desktop:settings-patch', patch),
  },

  /** Menu clicks arrive here as command ids. */
  onMenuCommand: (callback) => subscribe('desktop:menu-command', callback),
  /** A file opened through association, argv, or a second instance. */
  onOpenFile: (callback) => subscribe('desktop:open-file', callback),
  /** Pulls a file queued before this renderer started listening. */
  takePendingOpen: () => ipcRenderer.invoke('desktop:take-pending-open'),
  /** The window is closing; return a promise to delay it if work is pending. */
  onCloseRequested: (callback) => subscribe('desktop:close-requested', callback),
  /** Confirms the close may proceed. */
  confirmClose: () => ipcRenderer.send('desktop:close-confirmed'),
});
