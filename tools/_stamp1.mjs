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

// ================================================== 1. model
{
  const file = 'src/annotations/model.ts';
  let t = readFileSync(file, 'utf8');
  t = t.replace("  'measure-area',\n", "  'measure-area',\n  'stamp',\n");
  const anchor = 'export interface AnnotRect {';
  if (!t.includes(anchor)) throw new Error('AnnotRect anchor');
  t = t.replace(
    anchor,
    J([
      '/**',
      ' * The standard stamps.',
      ' *',
      ' * A closed set rather than free text: every other reader recognises these six by name,',
      ' * and a stamp a reader cannot name is only a picture of a stamp.',
      ' */',
      "export type StampId = 'approved' | 'confidential' | 'draft' | 'reviewed' | 'void' | 'final';",
      '',
      'export const STAMP_IDS: readonly StampId[] = [',
      "  'approved',",
      "  'confidential',",
      "  'draft',",
      "  'reviewed',",
      "  'void',",
      "  'final',",
      '];',
      '',
      'export const DEFAULT_STAMP: StampId = \'approved\';',
      '',
      '/** Stamp colours, in the ink families these marks conventionally use. */',
      'export const STAMP_COLORS: Record<StampId, string> = {',
      "  approved: '#1f8f4e',",
      "  confidential: '#c0392b',",
      "  draft: '#7f8c8d',",
      "  reviewed: '#2c6fbb',",
      "  void: '#c0392b',",
      "  final: '#1f8f4e',",
      '};',
      '',
      '/** The `/Name` written into the PDF, which is how other readers recognise a stamp. */',
      'export const STAMP_PDF_NAMES: Record<StampId, string> = {',
      "  approved: 'Approved',",
      "  confidential: 'Confidential',",
      "  draft: 'Draft',",
      "  reviewed: 'Reviewed',",
      "  void: 'Void',",
      "  final: 'Final',",
      '};',
      '',
      '/** i18n key for the word drawn on the stamp. */',
      'export const STAMP_LABEL_KEYS: Record<StampId, string> = {',
      "  approved: 'stampApproved',",
      "  confidential: 'stampConfidential',",
      "  draft: 'stampDraft',",
      "  reviewed: 'stampReviewed',",
      "  void: 'stampVoid',",
      "  final: 'stampFinal',",
      '};',
      '',
      'export function isStampId(value: unknown): value is StampId {',
      "  return typeof value === 'string' && (STAMP_IDS as readonly string[]).includes(value);",
      '}',
      '',
      anchor,
    ]),
  );
  // field on the annotation
  const fieldAnchor = '  /** Sticky-note body. */\n  note?: string;';
  if (!t.includes(fieldAnchor)) throw new Error('note field anchor');
  t = t.replace(
    fieldAnchor,
    J([
      '  /** Sticky-note body. */',
      '  note?: string;',
      '  /** Which standard stamp this is, for `stamp` annotations. */',
      '  stampId?: StampId;',
    ]),
  );
  // parsing
  const parseAnchor = "    author: typeof a['author'] === 'string' ? a['author'] : 'unk";
  if (!t.includes(parseAnchor)) throw new Error('parse author anchor');
  t = t.replace(
    /(    author: typeof a\['author'\] === 'string' \? a\['author'\] : '[^']*',\n)/,
    (m) => m + "    stampId: isStampId(a['stampId']) ? a['stampId'] : undefined,\n",
  );
  writeFileSync(file, t);
  console.log('  ' + file);
}

// ================================================== 2. tool name
patch('src/tools/tool-manager.ts', [
  ["    | 'note'", "    | 'note'\n    | 'stamp'"],
]);

// ================================================== 3. layer
patch('src/annotations/layer.ts', [
  ["    note: 'note',", "    note: 'note',\n    stamp: 'stamp',"],
  [
    '  /** How the layer asks which colour a new annotation should take. */',
    J([
      '  /** How the layer asks which colour a new annotation should take. */',
    ]),
  ],
  [
    J([
      '    if (kind === \'note\') {',
      '      event.preventDefault();',
      '      event.stopPropagation();',
      '      void this.addNote(page, point);',
      '      return;',
      '    }',
    ]),
    J([
      '    if (kind === \'note\') {',
      '      event.preventDefault();',
      '      event.stopPropagation();',
      '      void this.addNote(page, point);',
      '      return;',
      '    }',
      '',
      '    if (kind === \'stamp\') {',
      '      event.preventDefault();',
      '      event.stopPropagation();',
      '      this.addStamp(page, point);',
      '      return;',
      '    }',
    ]),
  ],
  [
    J([
      "      } else if (item.kind === 'note') {",
      '        part.style.background = item.color;',
      "        part.style.borderRadius = '3px';",
      "        part.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)';",
      '      }',
    ]),
    J([
      "      } else if (item.kind === 'note') {",
      '        part.style.background = item.color;',
      "        part.style.borderRadius = '3px';",
      "        part.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)';",
      "      } else if (item.kind === 'stamp') {",
      '        // Two rules and centred lettering: the shape readers recognise as a stamp.',
      '        part.style.border = `${Math.max(1, strokePx)}px solid ${item.color}`;',
      "        part.style.outline = `${Math.max(1, strokePx * 0.6)}px solid ${item.color}`;",
      "        part.style.outlineOffset = `${Math.max(1, strokePx * 1.4)}px`;",
      "        part.style.borderRadius = '4px';",
      '        part.style.background = withAlpha(item.color, 0.08);',
      '        part.style.color = item.color;',
      "        part.style.display = 'flex';",
      "        part.style.alignItems = 'center';",
      "        part.style.justifyContent = 'center';",
      "        part.style.textAlign = 'center';",
      "        part.style.fontWeight = '700';",
      "        part.style.letterSpacing = `${0.5 * scale}px`;",
      "        part.style.textTransform = 'uppercase';",
      '        part.style.fontSize = `${Math.max(7, (item.fontSize ?? 15) * scale)}px`;',
      "        part.style.overflow = 'hidden';",
      '        part.textContent = item.note ?? \'\';',
      '      }',
    ]),
  ],
]);

// ================================================== 4. flatten
patch('src/pdf/flatten.ts', [
  ["  strokeDash?: boolean | undefined;", "  strokeDash?: boolean | undefined;\n  /** Word drawn on a stamp. */\n  stampLabel?: string | undefined;"],
  [
    J([
      "      case 'textbox':",
      "      case 'callout':",
      "      case 'note': {",
    ]),
    J([
      "      case 'stamp': {",
      '        if (!item.rect) break;',
      '        const [x1, y1, x2, y2] = map.rect(item.rect);',
      '        const word = (item.stampLabel ?? \'\').slice(0, 24);',
      '        const border = Math.max(1, width);',
      '        parts.push(`q ${color} RG ${num(border)} w`);',
      '        parts.push(`${num(x1)} ${num(y1)} ${num(x2 - x1)} ${num(y2 - y1)} re S`);',
      '        const inset = border * 1.8;',
      '        parts.push(',
      '          `${num(x1 + inset)} ${num(y1 + inset)} ${num(x2 - x1 - inset * 2)} ` +',
      '            `${num(y2 - y1 - inset * 2)} re S`,',
      '        );',
      '        parts.push(\'Q\');',
      '        if (word !== \'\') {',
      '          needsFont = true;',
      '          // Fitted to the box rather than fixed: a long word must not spill outside the',
      '          // border it is supposed to sit inside.',
      '          const size = Math.max(4, Math.min((y2 - y1) * 0.42, ((x2 - x1) * 0.82) / Math.max(1, word.length * 0.62)));',
      '          const textWidth = word.length * size * 0.62;',
      '          parts.push(textOperators(word.toUpperCase(), (x1 + x2) / 2 - textWidth / 2, (y1 + y2) / 2 - size * 0.36, size, color));',
      '        }',
      '        break;',
      '      }',
      "      case 'textbox':",
      "      case 'callout':",
      "      case 'note': {",
    ]),
  ],
]);

// ================================================== 5. writer
patch('src/pdf/annotate.ts', [
  ["    case 'measure-area': return 'Polygon';", "    case 'measure-area': return 'Polygon';\n    case 'stamp': return 'Stamp';"],
  [
    "  entries['Subtype'] = name(subtypeFor(input.kind));",
    J([
      "  entries['Subtype'] = name(subtypeFor(input.kind));",
      '',
      "  // `/Name` is what makes a stamp a stamp to another reader, rather than a rectangle",
      '  // that happens to have words in it.',
      "  if (input.kind === 'stamp' && input.stampName) {",
      "    entries['Name'] = name(input.stampName);",
      '  }',
    ]),
  ],
  [
    '  author?: string | undefined;',
    '  author?: string | undefined;\n  /** Standard stamp name, written as `/Name`. */\n  stampName?: string | undefined;',
  ],
]);

// ================================================== 6. reader
patch('src/pdf/import.ts', [
  ["  const KNOWN_SUBTYPES = new Set([", "  const KNOWN_SUBTYPES = new Set([\n    'Stamp',"],
  ['  author?: string;', '  author?: string;\n  /** Standard stamp name, from `/Name`. */\n  stampName?: string;'],
  [
    "  const author = textOf(annotation.value.get('T'));",
    J([
      "  const author = textOf(annotation.value.get('T'));",
      "  if (subtype === 'Stamp') {",
      "    const stampName = nameOf(annotation.value.get('Name'));",
      '    if (stampName) item.stampName = stampName;',
      '  }',
    ]),
  ],
]);

console.log('戳记基础接线完成');
