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


// ================================================== layer
{
  const file = 'src/annotations/layer.ts';
  let t = readFileSync(file, 'utf8');
  const edits = [
    ["  note: 'note',", "  note: 'note',\n    stamp: 'stamp',"],
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
        "        part.textContent = item.note ?? '';",
        '      }',
      ]),
    ],
  ];
  for (const [from, to] of edits) {
    if (!t.includes(from)) throw new Error(`${file}: anchor ${JSON.stringify(from.slice(0, 70))}`);
    t = t.replace(from, to);
  }
  writeFileSync(file, t);
  console.log('  ' + file);
}

// ================================================== flatten
patch('src/pdf/flatten.ts', [
  [
    '  strokeDash?: boolean | undefined;',
    J([
      '  strokeDash?: boolean | undefined;',
      '  /** Word drawn on a stamp. */',
      '  stampLabel?: string | undefined;',
    ]),
  ],
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
      "        const word = (item.stampLabel ?? '').slice(0, 24);",
      '        const border = Math.max(1, width);',
      '        parts.push(`q ${color} RG ${num(border)} w`);',
      '        parts.push(`${num(x1)} ${num(y1)} ${num(x2 - x1)} ${num(y2 - y1)} re S`);',
      '        const inset = border * 1.8;',
      '        parts.push(',
      '          `${num(x1 + inset)} ${num(y1 + inset)} ${num(x2 - x1 - inset * 2)} ` +',
      '            `${num(y2 - y1 - inset * 2)} re S`,',
      '        );',
      "        parts.push('Q');",
      "        if (word !== '') {",
      '          needsFont = true;',
      '          // Fitted to the box rather than fixed: a long word must not spill outside',
      '          // the border it is meant to sit inside.',
      '          const size = Math.max(',
      '            4,',
      '            Math.min((y2 - y1) * 0.42, ((x2 - x1) * 0.82) / Math.max(1, word.length * 0.62)),',
      '          );',
      '          const textWidth = word.length * size * 0.62;',
      '          parts.push(',
      '            textOperators(',
      '              word.toUpperCase(),',
      '              (x1 + x2) / 2 - textWidth / 2,',
      '              (y1 + y2) / 2 - size * 0.36,',
      '              size,',
      '              color,',
      '            ),',
      '          );',
      '        }',
      '        break;',
      '      }',
      "      case 'textbox':",
      "      case 'callout':",
      "      case 'note': {",
    ]),
  ],
]);

// ================================================== writer
patch('src/pdf/annotate.ts', [
  [
    "    case 'measure-area': return 'Polygon';",
    J([
      "    case 'measure-area': return 'Polygon';",
      "    case 'stamp': return 'Stamp';",
    ]),
  ],
  [
    "  entries['Subtype'] = name(subtypeFor(input.kind));",
    J([
      "  entries['Subtype'] = name(subtypeFor(input.kind));",
      '',
      '  // `/Name` is what makes a stamp a stamp to another reader, rather than a rectangle',
      '  // that happens to have words in it.',
      "  if (input.kind === 'stamp' && input.stampName) {",
      "    entries['Name'] = name(input.stampName);",
      '  }',
    ]),
  ],
  [
    '  author?: string | undefined;',
    J([
      '  author?: string | undefined;',
      '  /** Standard stamp name, written as `/Name`. */',
      '  stampName?: string | undefined;',
    ]),
  ],
]);

// ================================================== reader
patch('src/pdf/import.ts', [
  ['  const KNOWN_SUBTYPES = new Set([', "  const KNOWN_SUBTYPES = new Set([\n    'Stamp',"],
  [
    '  author?: string;',
    J([
      '  author?: string;',
      '  /** Standard stamp name, from `/Name`. */',
      '  stampName?: string;',
    ]),
  ],
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

console.log('戳记接线（除 model）完成');
