// Generates self-authored PDF fixtures for this project. No third-party documents
// are used: the files are written directly in PDF syntax.
//
//   node tools/make-fixture.mjs [pages] [outPath] [--outline]
//
// The outline is a two-level bookmark tree so the sidebar's outline pane has
// something real to display and resolve.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const WANT_OUTLINE = process.argv.includes('--outline');
const PAGES = Number(args[0] ?? 24);
const OUT = args[1] ?? 'public/fixtures/test.pdf';

const W = 595; // A4 @ 72dpi
const H = 842;

/** Deterministic colour per page so rendered pages are visually distinguishable. */
function bandColors(i) {
  const hue = (i * 37) % 360;
  const c = (h) => {
    const x = (1 - Math.abs(((h / 60) % 2) - 1)) * 0.78;
    const [r, g, b] =
      h < 60 ? [0.78, x, 0] : h < 120 ? [x, 0.78, 0] : h < 180 ? [0, 0.78, x]
      : h < 240 ? [0, x, 0.78] : h < 300 ? [x, 0, 0.78] : [0.78, 0, x];
    return [r, g, b].map((v) => v.toFixed(3)).join(' ');
  };
  return { top: c(hue), bottom: c((hue + 180) % 360) };
}

function contentFor(i) {
  const { top, bottom } = bandColors(i);

  // Centre the page label using Helvetica's built-in advance widths, so the text
  // stays inside the MediaBox instead of running off the right edge.
  // "Page N" = P(667) a(556) g(556) e(556) space(278) + 556 per digit.
  const fontSize = 110;
  const textWidth = ((2613 + 556 * String(i).length) / 1000) * fontSize;
  const textX = Math.round((W - textWidth) / 2);

  return `q
${top} rg
0 ${H - 120} ${W} 120 re f
${bottom} rg
0 0 ${W} 60 re f
Q
q
0.85 0.85 0.88 rg
60 200 475 420 re f
Q
q
0.15 0.17 0.22 rg
60 200 475 6 re f
60 614 475 6 re f
Q
BT
/F1 ${fontSize} Tf
0.10 0.12 0.16 rg
${textX} ${H - 330} Td
(Page ${i}) Tj
ET
BT
/F1 20 Tf
0.35 0.37 0.42 rg
60 ${H - 375} Td
(Self-authored test fixture - page ${i} of ${PAGES}) Tj
ET
BT
/F1 14 Tf
0.45 0.47 0.52 rg
60 170 Td
(Checks: text rendering, vector fills, page sizing, zoom, rotation.) Tj
ET
q
0.9 0.3 0.2 rg
70 220 ${Math.min(440, 40 + i * 15)} 24 re f
Q
q
0.2 0.55 0.9 rg
70 256 ${Math.max(20, 440 - i * 12)} 24 re f
Q
q
0.25 0.7 0.4 rg
70 292 ${((i * 53) % 440) + 20} 24 re f
Q
`;
}

function escapePdfText(value) {
  return value.replace(/([\\()])/g, '\\$1');
}

// ---------------------------------------------------------------- build objects

const objects = []; // objects[i] is the body of object number i+1
const add = (body) => objects.push(body);

add(''); // 1: catalog (filled in later)
add(''); // 2: pages   (filled in later)
add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'); // 3

const pageObjNums = [];
for (let i = 1; i <= PAGES; i++) {
  const content = contentFor(i);
  add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`);
  add(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length} 0 R >>`,
  );
  pageObjNums.push(objects.length);
}

// ---------------------------------------------------------------- outline

let outlineRootNum = 0;

if (WANT_OUTLINE) {
  const clampPage = (p) => Math.min(Math.max(1, p), PAGES);
  const tree = [
    {
      title: 'Chapter 1 - Rendering',
      page: 1,
      children: [
        { title: 'Section 1.1 - Vector fills', page: clampPage(2) },
        { title: 'Section 1.2 - Text runs', page: clampPage(3) },
        { title: 'Section 1.3 - Colour bands', page: clampPage(4) },
      ],
    },
    {
      title: 'Chapter 2 - Navigation',
      page: clampPage(10),
      children: [
        { title: 'Page counter & jump', page: clampPage(11) },
        { title: 'Thumbnail strip', page: clampPage(12) },
      ],
    },
    { title: 'Chapter 3 - Transformations', page: clampPage(20) },
    { title: 'Unresolvable destination (negative test)', page: null },
  ];

  add(''); // outline root placeholder
  outlineRootNum = objects.length;

  const flat = [];

  function addLevel(nodes, parentIdx) {
    const idxs = [];
    for (const node of nodes) {
      add('');
      const idx = flat.length;
      flat.push({
        node,
        objNum: objects.length,
        parentIdx,
        firstChild: -1,
        lastChild: -1,
        prev: -1,
        next: -1,
      });
      idxs.push(idx);
    }
    for (let i = 0; i < idxs.length; i++) {
      flat[idxs[i]].prev = i > 0 ? idxs[i - 1] : -1;
      flat[idxs[i]].next = i < idxs.length - 1 ? idxs[i + 1] : -1;
    }
    for (const idx of idxs) {
      const kids = flat[idx].node.children ?? [];
      if (kids.length > 0) {
        const kidIdxs = addLevel(kids, idx);
        flat[idx].firstChild = kidIdxs[0];
        flat[idx].lastChild = kidIdxs[kidIdxs.length - 1];
      }
    }
    return idxs;
  }

  const topIdxs = addLevel(tree, -1);

  const descendants = (idx) => {
    let n = 0;
    const stack = [idx];
    while (stack.length > 0) {
      const cur = flat[stack.pop()];
      const kids = [];
      if (cur.firstChild >= 0) {
        let k = cur.firstChild;
        while (k >= 0) {
          kids.push(k);
          k = flat[k].next;
        }
      }
      n += kids.length;
      stack.push(...kids);
    }
    return n;
  };

  for (const item of flat) {
    const parts = [
      `/Title (${escapePdfText(item.node.title)})`,
      `/Parent ${item.parentIdx >= 0 ? flat[item.parentIdx].objNum : outlineRootNum} 0 R`,
    ];
    if (item.prev >= 0) parts.push(`/Prev ${flat[item.prev].objNum} 0 R`);
    if (item.next >= 0) parts.push(`/Next ${flat[item.next].objNum} 0 R`);
    if (item.firstChild >= 0) {
      const count = descendants(flat.indexOf(item));
      parts.push(`/First ${flat[item.firstChild].objNum} 0 R`);
      parts.push(`/Last ${flat[item.lastChild].objNum} 0 R`);
      parts.push(`/Count ${count}`);
    }
    // A null page deliberately produces an entry with no usable destination.
    if (item.node.page !== null) {
      parts.push(`/Dest [${pageObjNums[clampPage(item.node.page) - 1]} 0 R /Fit]`);
    }
    objects[item.objNum - 1] = `<< ${parts.join(' ')} >>`;
  }

  objects[outlineRootNum - 1] =
    `<< /Type /Outlines /First ${flat[topIdxs[0]].objNum} 0 R ` +
    `/Last ${flat[topIdxs[topIdxs.length - 1]].objNum} 0 R /Count ${flat.length} >>`;
}

// ---------------------------------------------------------------- roots

objects[0] =
  `<< /Type /Catalog /Pages 2 0 R` + (WANT_OUTLINE ? ` /Outlines ${outlineRootNum} 0 R /PageMode /UseOutlines` : '') + ' >>';
objects[1] = `<< /Type /Pages /Count ${PAGES} /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] >>`;

// ---------------------------------------------------------------- serialise

let pdf = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n';
const offsets = [0];
for (let i = 0; i < objects.length; i++) {
  offsets.push(Buffer.byteLength(pdf, 'latin1'));
  pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
}
const xrefStart = Buffer.byteLength(pdf, 'latin1');

pdf += `xref\n0 ${objects.length + 1}\n`;
pdf += '0000000000 65535 f \n';
for (let i = 1; i <= objects.length; i++) {
  pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
}
pdf +=
  `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ` +
  `/Info << /Title (Test Fixture - ${PAGES} pages) /Producer (self-authored) >> >>\n`;
pdf += `startxref\n${xrefStart}\n%%EOF\n`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.from(pdf, 'latin1'));

console.log(`已生成: ${OUT}`);
console.log(`  页数    ${PAGES}`);
console.log(`  大纲    ${WANT_OUTLINE ? '有（两级，含 1 个无目标条目作反例）' : '无'}`);
console.log(`  对象数  ${objects.length}`);
console.log(`  大小    ${Buffer.byteLength(pdf, 'latin1')} 字节`);
