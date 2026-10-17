// Writes public/fixtures/form.pdf: one page carrying two real /Widget annotations.
//
// The reader's highlight-fields option has to find form fields, and there is no other
// fixture with any. Two rectangles declared as widgets are enough to prove detection,
// placement and the toggle; nothing here claims to be a fillable form.
//
// Object numbers are assigned in dependency order and referenced by name, because the
// first version of this file hard-coded "3 0 R" and that number was the content stream.
//
//   node tools/make-form-fixture.mjs
import { writeFileSync } from 'node:fs';

const bodies = [];
const add = (body) => {
  bodies.push(body);
  return bodies.length;
};

const catalogNumber = add('');
const pagesNumber = add('');
const pageNumber = add('');
const contentNumber = add('');
const fontNumber = add(
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
);

const widget = (rect, fieldName) =>
  add(
    `<< /Type /Annot /Subtype /Widget /FT /Tx /T (${fieldName}) /Rect [${rect}] ` +
      `/F 4 /P ${pageNumber} 0 R /DA (/Helv 12 Tf 0 0 0.6 rg) >>`,
  );

const firstWidget = widget('40 200 200 230', 'name');
const secondWidget = widget('40 150 200 180', 'reference');

const content = [
  'q 1 1 1 rg 0 0 400 300 re f Q',
  'q 0.2 0.2 0.2 rg BT /F1 14 Tf 40 265 Td (Form field fixture) Tj ET Q',
  'q 0.6 0.6 0.6 RG 40 200 160 30 re S Q',
  'q 0.6 0.6 0.6 RG 40 150 160 30 re S Q',
].join('\n');

bodies[catalogNumber - 1] = `<< /Type /Catalog /Pages ${pagesNumber} 0 R >>`;
bodies[pagesNumber - 1] = `<< /Type /Pages /Kids [${pageNumber} 0 R] /Count 1 >>`;
bodies[pageNumber - 1] =
  `<< /Type /Page /Parent ${pagesNumber} 0 R /MediaBox [0 0 400 300] ` +
  `/Resources << /Font << /F1 ${fontNumber} 0 R >> >> /Contents ${contentNumber} 0 R ` +
  `/Annots [${firstWidget} 0 R ${secondWidget} 0 R] >>`;
bodies[contentNumber - 1] =
  `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;

let pdf = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n';
const offsets = [];
for (let i = 0; i < bodies.length; i++) {
  offsets.push(Buffer.byteLength(pdf, 'latin1'));
  pdf += `${i + 1} 0 obj\n${bodies[i]}\nendobj\n`;
}
const xrefStart = Buffer.byteLength(pdf, 'latin1');
pdf += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
pdf += `trailer\n<< /Size ${bodies.length + 1} /Root ${catalogNumber} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

writeFileSync('public/fixtures/form.pdf', Buffer.from(pdf, 'latin1'));
console.log(
  `public/fixtures/form.pdf 已生成：页=${pageNumber} 内容=${contentNumber} 字段=${firstWidget},${secondWidget}`,
);
