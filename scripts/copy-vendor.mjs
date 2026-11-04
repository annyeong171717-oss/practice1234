import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'vendor');
mkdirSync(outDir, { recursive: true });

const files = [
  ['node_modules/marked/marked.min.js', 'marked.min.js'],
  ['node_modules/dompurify/dist/purify.min.js', 'purify.min.js'],
];

for (const [from, to] of files) {
  copyFileSync(join(root, from), join(outDir, to));
  console.log(`vendor: ${to}`);
}
