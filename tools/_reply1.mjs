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

// ==================================================== 1. model
{
  const file = 'src/annotations/model.ts';
  let t = readFileSync(file, 'utf8');

  const anchor = '/** A rectangle in unrotated page space at scale 1. */';
  if (!t.includes(anchor)) throw new Error('AnnotRect anchor');
  t = t.replace(
    anchor,
    J([
      '/**',
      ' * One message in an annotation\'s thread.',
      ' *',
      ' * `at` is kept so a thread keeps its order after a reload; the store sorts by page and',
      ' * creation time, which says nothing about the order within one conversation.',
      ' */',
      'export interface AnnotReply {',
      '  author: string;',
      '  text: string;',
      '  at: number;',
      '}',
      '',
      anchor,
    ]),
  );

  const field = '  /** Which standard stamp this is, for `stamp` annotations. */\n  stampId?: StampId | undefined;';
  if (!t.includes(field)) throw new Error('stampId anchor');
  t = t.replace(
    field,
    J([
      field,
      '  /** Replies in the annotation\'s thread, oldest first. */',
      '  replies?: AnnotReply[] | undefined;',
    ]),
  );

  // add(): copy replies — the same place that once dropped fontSize and stampId.
  const addAnchor = "        ...(annotation.stampId !== undefined ? { stampId: annotation.stampId } : {}),";
  if (!t.includes(addAnchor)) throw new Error('add anchor');
  t = t.replace(
    addAnchor,
    J([
      addAnchor,
      '        ...(annotation.replies && annotation.replies.length > 0 ? { replies: annotation.replies } : {}),',
    ]),
  );

  // parse()
  const parseAnchor = "    stampId: isStampId(a['stampId']) ? a['stampId'] : undefined,";
  if (!t.includes(parseAnchor)) throw new Error('parse anchor');
  t = t.replace(
    parseAnchor,
    J([
      parseAnchor,
      "    replies: parseReplies(a['replies']),",
    ]),
  );

  // helper
  const helperAnchor = 'export function isStampId(value: unknown): value is StampId {';
  if (!t.includes(helperAnchor)) throw new Error('helper anchor');
  t = t.replace(
    helperAnchor,
    J([
      '/** Replies read back from storage, dropping anything that is not a complete message. */',
      'function parseReplies(value: unknown): AnnotReply[] | undefined {',
      "  if (!Array.isArray(value)) return undefined;",
      '  const out: AnnotReply[] = [];',
      '  for (const entry of value) {',
      "    if (!entry || typeof entry !== 'object') continue;",
      "    const author = typeof (entry as { author?: unknown }).author === 'string' ? (entry as { author: string }).author : '';",
      "    const text = typeof (entry as { text?: unknown }).text === 'string' ? (entry as { text: string }).text : '';",
      "    const at = typeof (entry as { at?: unknown }).at === 'number' ? (entry as { at: number }).at : 0;",
      "    if (text === '') continue;",
      '    out.push({ author, text, at });',
      '  }',
      '  return out.length > 0 ? out : undefined;',
      '}',
      '',
      helperAnchor,
    ]),
  );

  writeFileSync(file, t);
  console.log('  ' + file);
}

// ==================================================== 2. panel
{
  const file = 'src/sidebar/annotations.ts';
  let t = readFileSync(file, 'utf8');

  t = t.replace(
    '  kindLabel(kind: AnnotKind): string;',
    J(['  kindLabel(kind: AnnotKind): string;', '  /** Add a message to the annotation\'s thread. */', '  onReply(id: string, text: string): void;', '  replyLabel(): string;']),
  );

  // Put the author inside the body rather than on the row, and add the thread below it.
  const broken = /        const body = document\.createElement\('div'\);\n        body\.className = 'annot-body';\n[\s\S]*?    const label = document\.createElement\('div'\);/;
  const found = broken.exec(t);
  if (!found) throw new Error('body block not found');
  t = t.replace(
    found[0],
    J([
      "        const body = document.createElement('div');",
      "        body.className = 'annot-body';",
      '',
      '        // The author is what makes a comment attributable when several people annotate',
      '        // the same file, so it belongs on the row rather than buried in the detail.',
      '        if (item.author) {',
      "          const author = document.createElement('div');",
      "          author.className = 'annot-author';",
      '          author.textContent = item.author;',
      '          body.appendChild(author);',
      '        }',
      '',
      "        const label = document.createElement('div');",
    ]),
  );

  const tail = /        row\.appendChild\(body\);\n/;
  if (!tail.test(t)) throw new Error('body append');
  t = t.replace(
    tail,
    J([
      '        row.appendChild(body);',
      '',
      '        // The thread sits under the annotation it belongs to, indented, so a long',
      '        // conversation does not push the annotation itself off the row.',
      '        for (const reply of item.replies ?? []) {',
      "          const node = document.createElement('div');",
      "          node.className = 'annot-reply';",
      "          const who = document.createElement('span');",
      "          who.className = 'annot-reply-author';",
      "          who.textContent = reply.author || '—';",
      "          const what = document.createElement('span');",
      "          what.className = 'annot-reply-text';",
      '          what.textContent = reply.text;',
      '          node.append(who, what);',
      '          body.appendChild(node);',
      '        }',
      '',
      "        const reply = document.createElement('button');",
      "        reply.type = 'button';",
      "        reply.className = 'annot-reply-add';",
      "        reply.dataset['action'] = 'reply';",
      "        reply.textContent = '+';",
      "        reply.title = this.options.replyLabel();",
      '        row.appendChild(reply);',
      '',
    ]),
  );

  writeFileSync(file, t);
  console.log('  ' + file);
}

// ==================================================== 3. panel click handling for replies
{
  const file = 'src/sidebar/annotations.ts';
  let t = readFileSync(file, 'utf8');
  const m = /addEventListener\('click',[\s\S]{0,600}?\n    \}\);\n/.exec(t);
  if (!m) throw new Error('click handler not found');
  const handler = m[0];
  if (!handler.includes("action'] === 'reply'")) {
    t = t.replace(
      handler,
      J([
        "    this.host.addEventListener('click', (event) => {",
        "      const target = event.target as HTMLElement | null;",
        "      const action = target?.dataset?.['action'];",
        "      const row = target?.closest('.annot-row') as HTMLElement | null;",
        "      const id = row?.dataset?.['annotId'];",
        "      if (action === 'delete' && id) {",
        '        this.options.onDelete(id);',
        '        return;',
        '      }',
        "      if (action === 'reply' && id) {",
        '        const text = window.prompt(this.options.replyLabel());',
        '        if (text && text.trim() !== \'\') this.options.onReply(id, text.trim());',
        '        return;',
        '      }',
        "      if (id) this.options.onSelect(id);",
        '    });',
        '',
      ]),
    );
  }
  writeFileSync(file, t);
  console.log('  ' + file + ' (click)');
}

// ==================================================== 4. main wiring
{
  const file = 'src/main.ts';
  let t = readFileSync(file, 'utf8');

  const optionsAnchor = "      kindLabel: (kind) => i18n.resolveCommand(kindCommandId(kind))?.title ?? kind,";
  if (!t.includes(optionsAnchor)) throw new Error('panel options anchor');
  t = t.replace(
    optionsAnchor,
    J([
      optionsAnchor,
      '      replyLabel: () => i18n.t(\'annotReply\'),',
      '      onReply: (id, text) => {',
      '        const item = annotations.byId(id);',
      '        if (!item) return;',
      '        annotations.update(id, {',
      '          replies: [...(item.replies ?? []), { author: annotations.defaultAuthor, text, at: Date.now() }],',
      '        });',
      '        history.record(snapshotAnnotations());',
      '      },',
    ]),
  );
  writeFileSync(file, t);
  console.log('  ' + file);
}

// ==================================================== 5. strings
patch('src/i18n/packs/zh-CN.ts', [
  [
    '    annotStamp:',
    J([
      "    annotReply: '添加回复',",
      '    annotStamp:',
    ]),
  ],
]);
patch('src/i18n/packs/en.ts', [
  [
    '    annotStamp:',
    J([
      "    annotReply: 'Add a reply',",
      '    annotStamp:',
    ]),
  ],
]);

console.log('回复：模型/面板/接线 完成');
