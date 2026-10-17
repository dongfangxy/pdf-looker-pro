/**
 * Creating PDFs from nothing.
 *
 * The rewrite module modifies an existing document; these two paths have no source to
 * parse. Both emit the same minimal structure by hand — catalog, one flat page tree,
 * pages, content, and a cross-reference table — because it is short enough that a
 * generator would be more machinery than the output deserves.
 */

/** A page written by the generator. */
export interface NewPage {
  /** Media box in points. */
  box: [number, number, number, number];
  /** Content-stream operators. Omitted for a blank page. */
  content?: string;
  /** JPEG bytes to draw across the page, already compressed. */
  jpeg?: { bytes: Uint8Array; width: number; height: number };
}

const HEADER = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n';

function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** US Letter, the default for a new document. */
export const DEFAULT_BOX: [number, number, number, number] = [0, 0, 595, 842];

/** Builds a PDF from explicit pages. */
export function createPdf(pages: readonly NewPage[]): Uint8Array {
  if (pages.length === 0) throw new Error('新建文档至少需要一页');

  // Object numbers: 1 catalog, 2 page tree, then three per page (page, content, image).
  const catalogNumber = 1;
  const treeNumber = 2;
  let next = 3;

  const chunks: string[] = [];
  const offsets = new Map<number, number>();
  let offset = HEADER.length;
  const push = (objectNumber: number, text: string): void => {
    offsets.set(objectNumber, offset);
    chunks.push(text);
    offset += text.length;
  };

  const pageNumbers: number[] = [];
  const bodies: Array<{ pageNumber: number; page: string; content?: string | undefined; image?: string | undefined }> = [];

  for (const page of pages) {
    const pageNumber = next++;
    const contentNumber = next++;
    const imageNumber = page.jpeg ? next++ : null;
    pageNumbers.push(pageNumber);

    const operations = page.jpeg
      ? `q\n${page.box[2] - page.box[0]} 0 0 ${page.box[3] - page.box[1]} ${page.box[0]} ${page.box[1]} cm\n/Im0 Do\nQ`
      : (page.content ?? '');

    const resources = imageNumber
      ? `<< /XObject << /Im0 ${imageNumber} 0 R >> >>`
      : '<< >>';

    bodies.push({
      pageNumber,
      page:
        `${pageNumber} 0 obj\n<< /Type /Page /Parent ${treeNumber} 0 R ` +
        `/MediaBox [${page.box.map((v) => formatNumber(v)).join(' ')}] ` +
        `/Resources ${resources} /Contents ${contentNumber} 0 R >>\nendobj\n`,
      content:
        `${contentNumber} 0 obj\n<< /Length ${operations.length} >>\nstream\n${operations}\nendstream\nendobj\n`,
      image:
        page.jpeg && imageNumber
          ? `${imageNumber} 0 obj\n<< /Type /XObject /Subtype /Image ` +
            `/Width ${page.jpeg.width} /Height ${page.jpeg.height} ` +
            `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
            `/Length ${page.jpeg.bytes.length} >>\nstream\n` +
            latin1ToString(page.jpeg.bytes) +
            `\nendstream\nendobj\n`
          : undefined,
    });
  }

  push(
    catalogNumber,
    `${catalogNumber} 0 obj\n<< /Type /Catalog /Pages ${treeNumber} 0 R >>\nendobj\n`,
  );
  push(
    treeNumber,
    `${treeNumber} 0 obj\n<< /Type /Pages /Kids [${pageNumbers.map((n) => `${n} 0 R`).join(' ')}] ` +
      `/Count ${pageNumbers.length} >>\nendobj\n`,
  );

  for (const body of bodies) {
    push(body.pageNumber, body.page);
    if (body.content) push(body.pageNumber + 1, body.content);
    if (body.image) push(body.pageNumber + 2, body.image);
  }

  const xrefOffset = offset;
  const size = next;
  const lines: string[] = [`xref\n0 ${size}\n`, '0000000000 65535 f \n'];
  for (let objectNumber = 1; objectNumber < size; objectNumber++) {
    const at = offsets.get(objectNumber);
    lines.push(at === undefined ? '0000000000 65535 f \n' : `${String(at).padStart(10, '0')} 00000 n \n`);
  }
  chunks.push(lines.join(''));

  chunks.push(
    `trailer\n<< /Size ${size} /Root ${catalogNumber} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );

  return latin1(HEADER + chunks.join(''));
}

/** A document of blank pages. */
export function createBlankPdf(pageCount: number, box: [number, number, number, number] = DEFAULT_BOX): Uint8Array {
  const count = Math.max(1, Math.min(500, Math.round(pageCount)));
  return createPdf(Array.from({ length: count }, () => ({ box })));
}

/**
 * A one-page document holding an image, scaled to fill the page.
 *
 * The bytes must already be JPEG: a reader that hands over a PNG would otherwise force
 * this writer to carry a PNG encoder, and every browser can produce a JPEG from a canvas
 * in one call.
 */
export function createPdfFromJpeg(
  bytes: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  if (bytes.length === 0) throw new Error('图像数据为空');
  if (!(width > 0) || !(height > 0)) throw new Error('图像尺寸无效');
  return createPdf([{ box: [0, 0, width, height], jpeg: { bytes, width, height } }]);
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function latin1ToString(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}
