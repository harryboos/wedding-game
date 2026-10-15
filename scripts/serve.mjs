import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const host = option('--host', '127.0.0.1');
const port = Number(option('--port', process.env.PORT || 4173));
if (!host || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('请提供有效的 --host 和 --port。');
await stat(resolve(root, 'index.html')).catch(() => { throw new Error('请先运行 npm run build 生成 dist/。'); });
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-cache');
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.split('/').some(part => part.startsWith('.')) || pathname.includes('\0') || pathname.includes('\\')) throw new Error('Invalid path');
    let file = resolve(root, '.' + pathname);
    if (file !== resolve(root) && !file.startsWith(resolve(root) + sep)) throw new Error('Invalid path');
    const info = await stat(file);
    if (info.isDirectory()) {
      if (!url.pathname.endsWith('/')) { res.writeHead(301, { Location: url.pathname + '/' + url.search }); res.end(); return; }
      file = resolve(file, 'index.html');
    }
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': content.length });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (_) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('找不到这个页面，请返回游戏大厅。');
  }
});
server.listen(port, host, () => console.log(`Local: http://${host}:${port}\n按 Ctrl+C 停止预览。`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
