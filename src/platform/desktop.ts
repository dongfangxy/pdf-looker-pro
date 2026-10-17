/**
 * Desktop bridge.
 *
 * The renderer is a plain web application that also runs inside Electron. This
 * module is the single place that knows the difference: when the preload bridge is
 * absent every call degrades to a no-op (or a DOM fallback), so the same bundle
 * runs in a browser and in the packaged window without branching all over the UI.
 */

export interface MenuCommandItem {
  type: 'command';
  id: number;
  label: string;
  accelerator?: string;
  enabled?: boolean;
  checked?: boolean;
  /** Per-item payload, e.g. the path behind a recent-file entry. */
  data?: string;
}

export interface MenuRoleItem {
  type: 'role';
  role: string;
  label: string;
}

export interface MenuSeparator {
  type: 'separator';
}

export interface MenuSubmenu {
  type?: 'submenu';
  label: string;
  items: MenuItem[];
}

export type MenuItem = MenuCommandItem | MenuRoleItem | MenuSeparator | MenuSubmenu;

export interface MenuDescriptor {
  menus: { label: string; items: MenuItem[] }[];
}

export interface MenuCommandPayload {
  id: number;
  data?: string;
}

export interface OpenedFile {
  path: string;
  name: string;
  bytes?: Uint8Array;
  error?: string;
}

export interface DesktopSettings {
  window: { width: number; height: number; x: number | null; y: number | null; maximized: boolean };
  recents: { path: string; name: string; at: number }[];
  language: string;
  viewMode: string;
  lastOpenDir: string | null;
}

interface DesktopBridge {
  isDesktop: true;
  platform: string;
  versions: { electron: string; chrome: string };
  setMenu(descriptor: MenuDescriptor): Promise<boolean>;
  setWindowTitle(title: string, edited: boolean): Promise<boolean>;
  openFileDialog(): Promise<OpenedFile | null>;
  saveFileDialog(options: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>;
  writeFile(path: string, bytes: Uint8Array): Promise<{ ok: boolean; path?: string; error?: string }>;
  readFile(path: string): Promise<OpenedFile | null>;
  settings: {
    read(): Promise<DesktopSettings>;
    patch(patch: Partial<DesktopSettings>): Promise<DesktopSettings>;
  };
  onMenuCommand(callback: (payload: { id: number; data?: string }) => void): () => void;
  onOpenFile(callback: (payload: { path: string; name: string }) => void): () => void;
  takePendingOpen(): Promise<{ path: string; name: string } | null>;
  onCloseRequested(callback: () => void): () => void;
  confirmClose(): void;
  /** Opens the platform print dialogue for the current window. */
  print(options?: { printBackground?: boolean }): Promise<{ ok: boolean; reason?: string }>;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

/** The bridge, or null when running in an ordinary browser tab. */
export const desktop: DesktopBridge | null = typeof window !== 'undefined' && window.desktop ? window.desktop : null;

export const isDesktop = desktop !== null;

/** True when the platform wants Command instead of Control in accelerators. */
export const isMac = desktop?.platform === 'darwin';

/** Pushes a menu built from the active language pack. No-op in a browser. */
export async function applyMenu(descriptor: MenuDescriptor): Promise<void> {
  if (!desktop) return;
  try {
    await desktop.setMenu(descriptor);
  } catch {
    // A failed menu update must never take the reader down.
  }
}

export async function setWindowTitle(title: string, edited: boolean): Promise<void> {
  if (!desktop) {
    document.title = edited ? `${title} *` : title;
    return;
  }
  await desktop.setWindowTitle(title, edited);
}
