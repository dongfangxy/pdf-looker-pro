import { readFileSync, writeFileSync } from 'node:fs';

const J = (l) => l.join('\n');
function patch(file, edits) {
  let t = readFileSync(file, 'utf8');
  for (const [from, to] of edits) {
    if (!t.includes(from)) throw new Error(`${file}: anchor ${JSON.stringify(from.slice(0, 80))}`);
    t = t.replace(from, to);
  }
  writeFileSync(file, t);
  console.log('  ' + file);
}

// ------------------------------------------------------------------ main process
patch('electron/main.cjs', [
  [
    "  ipcMain.handle('desktop:settings-read', () => settings);",
    J([
      '  /**',
      '   * Lists the PDFs under a folder and grants read access to them.',
      '   *',
      '   * The grant is the point: `read-file` refuses anything the user has not opened, and a',
      '   * folder the user names here is exactly as explicit as one they pick from a dialogue.',
      '   * Depth and count are bounded so a folder pointed at by mistake cannot walk a whole',
      '   * disk.',
      '   */',
      "  ipcMain.handle('desktop:list-pdfs', async (_event, payload) => {",
      '    const root = path.resolve(String(payload?.path ?? \'\'));',
      '    try {',
      '      const info = await fs.stat(root);',
      "      if (!info.isDirectory()) return { ok: false, error: 'not a directory' };",
      '    } catch {',
      "      return { ok: false, error: 'folder not found' };",
      '    }',
      '',
      '    const files = [];',
      '    const walk = async (dir, depth) => {',
      '      if (depth > MAX_SEARCH_DEPTH || files.length >= MAX_SEARCH_FILES) return;',
      '      let entries;',
      '      try {',
      '        entries = await fs.readdir(dir, { withFileTypes: true });',
      '      } catch {',
      '        return;',
      '      }',
      '      for (const entry of entries) {',
      '        if (files.length >= MAX_SEARCH_FILES) return;',
      '        const full = path.join(dir, entry.name);',
      '        if (entry.isDirectory()) {',
      '          await walk(full, depth + 1);',
      '          continue;',
      '        }',
      '        if (!entry.isFile() || !/\\.pdf$/i.test(entry.name)) continue;',
      '        grantedPaths.add(full);',
      '        files.push(full);',
      '      }',
      '    };',
      '    await walk(root, 0);',
      '    return { ok: true, files, truncated: files.length >= MAX_SEARCH_FILES };',
      '  });',
      '',
      "  ipcMain.handle('desktop:settings-read', () => settings);",
    ]),
  ],
]);

// Constants next to the other limits.
{
  const file = 'electron/main.cjs';
  let t = readFileSync(file, 'utf8');
  if (!t.includes('MAX_SEARCH_FILES')) {
    const anchor = 'const grantedPaths = new Set();';
    if (!t.includes(anchor)) throw new Error('grantedPaths anchor');
    t = t.replace(
      anchor,
      J([
        anchor,
        '',
        '/** Bounds on a folder search, so a mistaken path cannot walk a whole disk. */',
        'const MAX_SEARCH_FILES = 200;',
        'const MAX_SEARCH_DEPTH = 4;',
      ]),
    );
    writeFileSync(file, t);
    console.log('  electron/main.cjs (limits)');
  }
}

// ------------------------------------------------------------------ preload
patch('electron/preload.cjs', [
  [
    "    readFile: (path) => ipcRenderer.invoke('desktop:read-file', { path }),",
    J([
      "    readFile: (path) => ipcRenderer.invoke('desktop:read-file', { path }),",
      "    listPdfs: (path) => ipcRenderer.invoke('desktop:list-pdfs', { path }),",
    ]),
  ],
]);

// ------------------------------------------------------------------ bridge type
patch('src/platform/desktop.ts', [
  [
    '  readFile(path: string): Promise<OpenedFile | null>;',
    J([
      '  readFile(path: string): Promise<OpenedFile | null>;',
      '  /**',
      '   * PDFs under a folder, recursively.',
      '   *',
      '   * Listing also grants read access to what it finds: a folder the reader names is as',
      '   * explicit a permission as one they pick from a dialogue.',
      '   */',
      '  listPdfs(path: string): Promise<{ ok: boolean; files?: string[]; error?: string; truncated?: boolean }>;',
    ]),
  ],
]);

console.log('文件夹搜索：主进程与桥接 完成');
