import { cp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'public');
const out = join(root, 'dist');
// public/ is the complete website; tests and deployment files live outside it.
await stat(join(source, 'index.html'));
await rm(out, { recursive: true, force: true });
await cp(source, out, { recursive: true, filter: file => !file.split(/[\\/]/).pop().startsWith('.') });
console.log('已生成 dist/，可直接上传到静态网站服务器。');
