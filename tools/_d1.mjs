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

// ------------------------------------------------------------- markup
patch('index.html', [
  [
    '            <button id="tab-annotations" class="tab" role="tab" title="批注">批注</button>',
    J([
      '            <button id="tab-annotations" class="tab" role="tab" title="批注">批注</button>',
      '            <button id="tab-search" class="tab" role="tab" title="搜索结果">搜索</button>',
    ]),
  ],
  [
    J([
      '          <div id="pane-annotations" class="sidebar-pane hidden">',
      '            <div id="annotations" class="annotations"></div>',
      '          </div>',
    ]),
    J([
      '          <div id="pane-annotations" class="sidebar-pane hidden">',
      '            <div id="annotations" class="annotations"></div>',
      '          </div>',
      '          <div id="pane-search" class="sidebar-pane hidden">',
      '            <div id="search-results" class="search-results"></div>',
      '          </div>',
    ]),
  ],
]);

// ------------------------------------------------------------- strings
patch('src/i18n/packs/zh-CN.ts', [
  [
    '    annotReply:',
    J([
      "    searchResults: '搜索结果',",
      "    searchIdle: '输入要查找的内容，结果会按页列在这里。',",
      "    searchEmpty: '没有匹配的内容。',",
      "    searchSummary: '{a} 处匹配，分布在 {b} 页',",
      '    annotReply:',
    ]),
  ],
]);
patch('src/i18n/packs/en.ts', [
  [
    '    annotReply:',
    J([
      "    searchResults: 'Search results',",
      "    searchIdle: 'Type what to look for; the matches are listed here by page.',",
      "    searchEmpty: 'No matches.',",
      "    searchSummary: '{a} matches on {b} pages',",
      '    annotReply:',
    ]),
  ],
]);

// ------------------------------------------------------------- main
{
  const file = 'src/main.ts';
  let lines = readFileSync(file, 'utf8').split('\n');
  const find = (s, from = 0) => lines.findIndex((l, i) => i >= from && l.includes(s));
  const insertBefore = (match, newLines, label) => {
    const i = find(match);
    if (i < 0) throw new Error(`未找到: ${label ?? match}`);
    lines.splice(i, 0, ...newLines);
    console.log(`  + ${newLines.length} @ ${label ?? match}`);
  };
  const insertAfter = (match, newLines, label) => {
    const i = find(match);
    if (i < 0) throw new Error(`未找到: ${label ?? match}`);
    lines.splice(i + 1, 0, ...newLines);
    console.log(`  + ${newLines.length} @ ${label ?? match}`);
  };

  insertBefore("import { AnnotationPanel } from './sidebar/annotations.js';", [
    "import { SearchResults } from './sidebar/search-results.js';",
  ], 'search import');

  insertAfter("  tabAnnotations: mustFind<HTMLButtonElement>('tab-annotations'),", [
    "  tabSearch: mustFind<HTMLButtonElement>('tab-search'),",
  ], 'tab ref');
  insertAfter("  paneAnnotations: mustFind<HTMLElement>('pane-annotations'),", [
    "  paneSearch: mustFind<HTMLElement>('pane-search'),",
    "  searchResults: mustFind<HTMLElement>('search-results'),",
  ], 'pane refs');

  insertBefore("type TabName = 'thumbnails' | 'outline' | 'annotations';", [
    "type TabName = 'thumbnails' | 'outline' | 'annotations' | 'search';",
  ], 'tab type');
  {
    const dup = lines.filter((l) => l.trim() === "type TabName = 'thumbnails' | 'outline' | 'annotations';").length;
    if (dup > 0) {
      const i = find("type TabName = 'thumbnails' | 'outline' | 'annotations';");
      lines.splice(i, 1);
      console.log('  - 旧 TabName 行');
    }
  }

  insertBefore('function showTab(which: TabName): void {', [
    '/** The match list, kept in step with the find bar. */',
    'const searchResults = new SearchResults(ui.searchResults, {',
    '  pageLabel: (page) => `${i18n.t(\'pageGoto\')} ${page}`.replace(/\\s*…$/, \'\'),',
    "  idleText: () => i18n.t('searchIdle'),",
    "  emptyText: () => i18n.t('searchEmpty'),",
    "  summaryText: (matches, pages) => i18n.t('searchSummary').replace('{a}', String(matches)).replace('{b}', String(pages)),",
    '  onSelect: (index) => {',
    '    const hit = findIndex.selectAt(index);',
    '    repaintAllHighlights();',
    '    updateFindCount();',
    '    if (hit) viewer.gotoPage(hit.page);',
    '    searchResults.render();',
    '  },',
    '});',
    '',
    'function showTab(which: TabName): void {',
  ], 'search results instance');

  {
    const i = find('function showTab(which: TabName): void {');
    // insert the search tab lines inside showTab
    const target = find("  ui.paneAnnotations.classList.toggle('hidden', which !== 'annotations');", i);
    if (target < 0) throw new Error('showTab body anchor');
    lines.splice(target + 1, 0, ...[
      "  ui.tabSearch.classList.toggle('active', which === 'search');",
      "  ui.paneSearch.classList.toggle('hidden', which !== 'search');",
      "  if (which === 'search') searchResults.render();",
    ]);
    console.log('  + 3 @ showTab body');
  }

  // Keep the list in step with every search.
  insertBefore("  const hit = findIndex.currentHit;\n  if (hit) viewer.gotoPage(hit.page);", [
    '    searchResults.render();',
  ], 'find render');
  {
    const i = find("  const hit = findIndex.currentHit;", find('async function runFind'));
    if (i < 0) throw new Error('runFind tail anchor');
    lines.splice(i, 0, '  searchResults.render();');
    console.log('  + 1 @ runFind before navigating');
  }

  // Bind the tab button.
  insertBefore("bindCommand(CMD.TabAnnotations, ui.tabAnnotations, { onClick: () => showTab('annotations') });", [
    "bindCommand(CMD.TabSearch, ui.tabSearch, { onClick: () => showTab('search') });",
  ], 'search tab binding');

  writeFileSync(file, lines.join('\n'));
  console.log('  src/main.ts');
}

console.log('搜索结果面板接线完成');
