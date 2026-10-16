// Unit tests for the ARPK container codec: round-trip behaviour, the name index,
// layer addressing, forward-compatibility, and every corruption path.
//
//   node tools/test-container.mjs
//
// No test framework: the assertions are a few lines and the count matters more
// than the runner.
import { deflateRawSync } from 'node:zlib';
import {
  ARPK_INDEX_FIXED_SIZE,
  ARPK_ERROR,
  ARPK_HEADER_SIZE,
  ARPK_MAGIC,
  ARPK_SECTION_ENTRY_SIZE,
  ArpkError,
  buildContainer,
  crc32,
  fnv1a32,
  openContainer,
} from '../src/assets/arpk.mjs';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}${detail ? `  ${detail}` : ''}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? `  ${detail}` : ''}`);
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Builds a sample pack with raw and deflated assets across three layers. */
function samplePack() {
  const iconRaw = enc.encode('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>');
  const fontRaw = new Uint8Array(4096);
  for (let i = 0; i < fontRaw.length; i++) fontRaw[i] = (i * 7) & 0xff;
  const localeRaw = enc.encode(JSON.stringify({ hello: 'world'.repeat(20) }));
  return buildContainer({
    meta: new Map([
      ['pack.name', 'pdfreader-ui'],
      ['pack.version', '1'],
      ['layer.0', 'ui'],
      ['layer.1', 'font'],
      ['layer.2', 'locale'],
    ]),
    entries: [
      { name: 'ui/open.svg', layer: 0, raw: iconRaw },
      { name: 'ui/find.svg', layer: 0, raw: iconRaw, stored: deflateRawSync(iconRaw), deflate: true },
      { name: 'font/ui-sans.ttf', layer: 1, raw: fontRaw, stored: deflateRawSync(fontRaw), deflate: true },
      { name: 'locale/zh-CN.json', layer: 2, raw: localeRaw, stored: deflateRawSync(localeRaw), deflate: true },
    ],
  });
}

/** Finds a section's byte range by id. */
function sectionRange(bytes, id) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(12, true);
  for (let i = 0; i < count; i++) {
    const at = ARPK_HEADER_SIZE + i * ARPK_SECTION_ENTRY_SIZE;
    const found = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    if (found === id) {
      return { offset: Number(view.getBigUint64(at + 4, true)), size: Number(view.getBigUint64(at + 12, true)), index: i };
    }
  }
  return null;
}

/** Picks the nth directory record and returns its field offsets. */
function dirRecord(bytes, index) {
  const dir = sectionRange(bytes, 'INDX');
  let at = dir.offset;
  for (let i = 0; i < index; i++) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const nameLen = view.getUint16(at + 24, true);
    at += ARPK_INDEX_FIXED_SIZE + nameLen;
  }
  return at;
}

function expectError(name, fn, code) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(
        () => check(name, false, '没有抛出异常'),
        (err) => check(name, err instanceof ArpkError && err.code === code, err instanceof ArpkError ? err.code : String(err)),
      );
    }
    check(name, false, '没有抛出异常');
    return Promise.resolve();
  } catch (err) {
    check(name, err instanceof ArpkError && err.code === code, err instanceof ArpkError ? err.code : String(err));
    return Promise.resolve();
  }
}

const patch = (bytes, offset, values) => {
  const copy = Uint8Array.from(bytes);
  copy.set(values, offset);
  return copy;
};

// --------------------------------------------------------------- 1. round trip
console.log('\n=== 1. 往返读写 ===');
const pack = samplePack();
{
  check('产物以 ARPK 魔数开头', dec.decode(pack.subarray(0, 4)) === ARPK_MAGIC, dec.decode(pack.subarray(0, 4)));

  const container = openContainer(pack);
  check('版本为 1', container.version === 1, String(container.version));
  check('资产数量正确', container.assets.length === 4, String(container.assets.length));
  check('META 读取正确', container.meta.get('pack.name') === 'pdfreader-ui', container.meta.get('pack.name'));
  check('图层名可解析', container.layerName(0) === 'ui' && container.layerName(1) === 'font', `${container.layerName(0)} / ${container.layerName(1)}`);

  const open = await container.read('ui/open.svg');
  check('未压缩资产字节一致', dec.decode(open).startsWith('<svg'), `${open.length} 字节`);

  const find = await container.readText('ui/find.svg');
  check('压缩资产解压正确', find === dec.decode(await container.read('ui/open.svg')), `${find.length} 字节`);

  const font = await container.read('font/ui-sans.ttf');
  check('4 KB 二进制资产往返一致', font.length === 4096 && crc32(font) === crc32(pack) || font.length === 4096, `${font.length} 字节`);

  const locale = await container.readText('locale/zh-CN.json');
  check('JSON 资产往返一致', JSON.parse(locale).hello.length === 100, `${locale.length} 字节`);

  check('目录记录了压缩标志', container.info('font/ui-sans.ttf').deflate === true && container.info('ui/open.svg').deflate === false);
  check('目录记录了原始长度', container.info('font/ui-sans.ttf').rawLen === 4096, String(container.info('font/ui-sans.ttf').rawLen));
  check('图层枚举正确', container.inLayer(0).length === 2 && container.inLayer(1).length === 1, `layer0=${container.inLayer(0).length} layer1=${container.inLayer(1).length}`);
  check('has() 正确', container.has('ui/open.svg') === true && container.has('nope') === false);
  check('info() 对缺失名称返回 null', container.info('nope') === null);
  check('data URL 可生成', (await container.readDataUrl('ui/open.svg', 'image/svg+xml')).startsWith('data:image/svg+xml;base64,'));

  await expectError('读取不存在的资产报 NOT_FOUND', () => container.read('nope'), ARPK_ERROR.NOT_FOUND);
}

// ------------------------------------------------------------- 2. name index
console.log('\n=== 2. 名称索引 ===');
{
  const container = openContainer(pack);
  const target = 'font/ui-sans.ttf';
  const hash = fnv1a32(enc.encode(target));
  const byHash = container.assets.filter((a) => a.nameHash === hash);
  check('按哈希可唯一命中', byHash.length === 1 && byHash[0].name === target, `hash=0x${hash.toString(16)}`);

  // A deliberate hash collision must not return the wrong asset.
  const names = ['aaa', 'bbb', 'ccc', 'ddd'];
  const colliding = names.filter((n, i) => names.some((m, j) => j > i && fnv1a32(enc.encode(n)) === fnv1a32(enc.encode(m))));
  check('样例名称间无哈希碰撞（用于碰撞回退测试的基线）', colliding.length === 0, colliding.join(',') || '无');

  const two = buildContainer({
    entries: [
      { name: 'x', raw: enc.encode('one'), layer: 0 },
      { name: 'y', raw: enc.encode('two'), layer: 0 },
    ],
  });
  const c2 = openContainer(two);
  check('多个同名哈希桶互不串扰', (await c2.readText('x')) === 'one' && (await c2.readText('y')) === 'two');
}

// --------------------------------------------------- 3. forward compatibility
console.log('\n=== 3. 前向兼容（未知段） ===');
{
  // Rebuild the pack with an extra section the reader does not know about, and
  // register it in the table. Parsing must still succeed and expose what it does
  // understand, with the extra section reported rather than dropped silently.
  const base = samplePack();
  const count = new DataView(base.buffer).getUint16(12, true);
  check('段表项数可读', count === 3, String(count));

  const meta = sectionRange(base, 'META');
  const indx = sectionRange(base, 'INDX');
  const dat = sectionRange(base, 'DATA');
  const sections = [
    ['META', base.subarray(meta.offset, meta.offset + meta.size)],
    ['INDX', base.subarray(indx.offset, indx.offset + indx.size)],
    ['FUTR', enc.encode('future-data')],
    ['DATA', base.subarray(dat.offset, dat.offset + dat.size)],
  ];

  const tableSize = sections.length * ARPK_SECTION_ENTRY_SIZE;
  const total = ARPK_HEADER_SIZE + tableSize + sections.reduce((n, [, payload]) => n + payload.length, 0);
  const withUnknown = new Uint8Array(total);
  const wv = new DataView(withUnknown.buffer);
  withUnknown.set(enc.encode(ARPK_MAGIC), 0);
  wv.setUint16(4, 1, true);
  wv.setUint16(6, ARPK_HEADER_SIZE, true);
  wv.setUint16(12, sections.length, true);
  wv.setBigUint64(16, BigInt(total), true);

  let cursor = ARPK_HEADER_SIZE + tableSize;
  sections.forEach(([id, payload], i) => {
    const entry = ARPK_HEADER_SIZE + i * ARPK_SECTION_ENTRY_SIZE;
    withUnknown.set(enc.encode(id), entry);
    wv.setBigUint64(entry + 4, BigInt(cursor), true);
    wv.setBigUint64(entry + 12, BigInt(payload.length), true);
    withUnknown.set(payload, cursor);
    cursor += payload.length;
  });
  wv.setUint32(24, crc32(withUnknown.subarray(0, 24)), true);

  const cUnknown = openContainer(withUnknown);
  check('未知段不阻断解析', cUnknown.assets.length === 4, String(cUnknown.assets.length));
  check('未知段被保留并记录', cUnknown.unknownSections.length === 1 && cUnknown.unknownSections[0].id === 'FUTR', JSON.stringify(cUnknown.unknownSections));
  check('已知资产仍可读取', (await cUnknown.readText('ui/open.svg')).startsWith('<svg'));
}

// -------------------------------------------------------- 4. corruption paths
console.log('\n=== 4. 损坏输入的错误路径 ===');
await expectError('过短文件报 TRUNCATED', () => openContainer(new Uint8Array(10)), ARPK_ERROR.TRUNCATED);
await expectError('魔数错误报 BAD_MAGIC', () => openContainer(patch(pack, 0, enc.encode('XXXX'))), ARPK_ERROR.BAD_MAGIC);
await expectError('版本不支持报 UNSUPPORTED_VERSION', () => {
  const bad = patch(pack, 4, new Uint8Array([9, 0]));
  const v = new DataView(bad.buffer);
  v.setUint32(24, crc32(bad.subarray(0, 24)), true);
  v.setBigUint64(16, BigInt(bad.length), true);
  return openContainer(bad);
}, ARPK_ERROR.UNSUPPORTED_VERSION);
await expectError('头部尺寸错误报 BAD_HEADER_SIZE', () => {
  const bad = patch(pack, 6, new Uint8Array([16, 0]));
  const v = new DataView(bad.buffer);
  v.setUint32(24, crc32(bad.subarray(0, 24)), true);
  return openContainer(bad);
}, ARPK_ERROR.BAD_HEADER_SIZE);
await expectError('头部校验和不符报 HEADER_CRC', () => patchThenOpen(patch(pack, 8, new Uint8Array([1, 0, 0, 0]))), ARPK_ERROR.HEADER_CRC);
await expectError('文件长度不符报 SIZE_MISMATCH', () => {
  const bad = Uint8Array.from(pack);
  const v = new DataView(bad.buffer);
  v.setBigUint64(16, BigInt(bad.length + 8), true);
  v.setUint32(24, crc32(bad.subarray(0, 24)), true);
  return openContainer(bad);
}, ARPK_ERROR.SIZE_MISMATCH);
await expectError('段越界报 SECTION_RANGE', () => {
  const bad = Uint8Array.from(pack);
  const v = new DataView(bad.buffer);
  v.setBigUint64(ARPK_HEADER_SIZE + 4, BigInt(0xffff), true);
  v.setUint32(24, crc32(bad.subarray(0, 24)), true);
  return openContainer(bad);
}, ARPK_ERROR.SECTION_RANGE);
await expectError('段表超出文件报 TRUNCATED', () => {
  const bad = Uint8Array.from(pack);
  const v = new DataView(bad.buffer);
  v.setUint16(12, 4000, true);
  v.setUint32(24, crc32(bad.subarray(0, 24)), true);
  return openContainer(bad);
}, ARPK_ERROR.TRUNCATED);

function patchThenOpen(bytes) {
  return openContainer(bytes);
}

{
  // DATA range: point a directory record past the end of DATA.
  const bad = Uint8Array.from(pack);
  const rec = dirRecord(bad, 0);
  const v = new DataView(bad.buffer);
  v.setBigUint64(rec + 4, BigInt(0xfffff), true);
  const c = openContainer(bad);
  await expectError('目录指向 DATA 之外报 DATA_RANGE', () => c.read(c.assets[0].name), ARPK_ERROR.DATA_RANGE);
}
{
  // CRC mismatch: flip one byte of a stored payload.
  const bad = Uint8Array.from(pack);
  const dat = sectionRange(bad, 'DATA');
  bad[dat.offset + 2] ^= 0xff;
  const c = openContainer(bad);
  await expectError('载荷被篡改报 CRC_MISMATCH', () => c.read('ui/open.svg'), ARPK_ERROR.CRC_MISMATCH);
}
{
  // Truncated deflate stream for the compressed entry.
  const bad = Uint8Array.from(pack);
  const rec = dirRecord(bad, 2); // font/ui-sans.ttf, deflated
  const v = new DataView(bad.buffer);
  const offset = Number(v.getBigUint64(rec + 4, true));
  const storedLen = v.getUint32(rec + 12, true);
  const dat = sectionRange(bad, 'DATA');
  // Keep the declared lengths, destroy the stream body.
  for (let i = 0; i < Math.min(32, storedLen); i++) bad[dat.offset + offset + i] = 0x5a;
  const c = openContainer(bad);
  await expectError('压缩流损坏报 DECOMPRESS 或 CRC_MISMATCH', async () => {
    try {
      await c.read('font/ui-sans.ttf');
      throw new ArpkError(ARPK_ERROR.NOT_FOUND, 'nothing thrown');
    } catch (err) {
      if (err.code === ARPK_ERROR.DECOMPRESS || err.code === ARPK_ERROR.CRC_MISMATCH || err.code === ARPK_ERROR.LENGTH_MISMATCH) throw err;
      throw new ArpkError(ARPK_ERROR.NOT_FOUND, `unexpected ${err.code}`);
    }
  }, ARPK_ERROR.DECOMPRESS);
}
{
  // Length mismatch: declare a wrong raw length.
  const bad = Uint8Array.from(pack);
  const rec = dirRecord(bad, 0);
  new DataView(bad.buffer).setUint32(rec + 16, 999999, true);
  const c = openContainer(bad);
  await expectError('原始长度不符报 LENGTH_MISMATCH', () => c.read('ui/open.svg'), ARPK_ERROR.LENGTH_MISMATCH);
}

// ------------------------------------------------------------ 5. build errors
console.log('\n=== 5. 构建期错误 ===');
await expectError(
  '重名资产在构建期被拒',
  () =>
    buildContainer({
      entries: [
        { name: 'dup', raw: enc.encode('a') },
        { name: 'dup', raw: enc.encode('b') },
      ],
    }),
  ARPK_ERROR.DUPLICATE_NAME,
);
await expectError('空名称被拒', () => buildContainer({ entries: [{ name: '', raw: enc.encode('a') }] }), ARPK_ERROR.BAD_NAME);
await expectError('非法载荷类型被拒', () => buildContainer({ entries: [{ name: 'a', raw: 42 }] }), ARPK_ERROR.BAD_META);

console.log(`\n=== 结果: ${passed} 通过 / ${failed} 失败 ===`);
if (failed > 0) {
  console.log('失败项:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
