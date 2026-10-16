// Sets the version in one step.
//
//   node tools/bump-version.mjs 1.1.0
//
// The version lives in two places — `package.json`, which electron-builder stamps into
// the artefact, and `src/product.ts`, which the About dialog shows. They had already
// drifted once (0.1.0 against 1.0.0), so this keeps them together.
import { readFileSync, writeFileSync } from 'node:fs';

const next = process.argv[2];
if (!next) {
  console.error('用法: node tools/bump-version.mjs <版本号>   例如 1.1.0');
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(next)) {
  console.error(`不是合法的语义化版本号: ${next}`);
  process.exit(1);
}

// ------------------------------------------------------------------ package.json
const pkgFile = 'package.json';
const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
const previous = pkg.version;
pkg.version = next;
writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');

// ------------------------------------------------------------------- product.ts
const productFile = 'src/product.ts';
let product = readFileSync(productFile, 'utf8');
const marker = /export const PRODUCT_VERSION = '[^']*';/;
if (!marker.test(product)) {
  console.error(`${productFile}: 找不到 PRODUCT_VERSION`);
  process.exit(1);
}
product = product.replace(marker, `export const PRODUCT_VERSION = '${next}';`);
writeFileSync(productFile, product);

console.log(`${previous} -> ${next}`);
console.log('  已更新 package.json');
console.log('  已更新 src/product.ts');
console.log('');
console.log('下一步:');
console.log('  npm run build && npm run pack && npm run test:desktop');
console.log(`  git commit -am "Release ${next}" && git tag v${next} && git push --follow-tags`);
