#!/usr/bin/env node
/**
 * Build the GitHub Pages demo.
 *
 *     node tools/build-demo.mjs [outDir]
 *
 * The demo is public/ verbatim plus a shim that answers the app's own fetch
 * calls from sample data, so the published interface is the real one rather
 * than a mock-up that can drift away from it.
 */
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const serve = args.includes('--serve');
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = path.resolve(args.find((arg) => !arg.startsWith('--')) ?? path.join(ROOT, '_site'));

const NOTICE = `    <div id="demo-notice">
      展示版 · 信件為範例資料，沒有連到任何信箱。<a href="https://github.com/yuliangz777-cmyk/webmail">原始碼</a>
    </div>
`;

const NOTICE_STYLE = `
#demo-notice {
  padding: 9px 20px;
  font-size: 12.5px;
  color: var(--muted);
  background: color-mix(in srgb, var(--accent) 7%, var(--panel));
  border-bottom: 1px solid var(--line);
}

#demo-notice a { color: var(--accent); }

@media (max-width: 760px) { #demo-notice { padding: 9px 16px; } }
`;

await fs.rm(OUT, { recursive: true, force: true });
await fs.cp(path.join(ROOT, 'public'), OUT, { recursive: true });

// The demo has no server, so the service worker would cache a shell whose API
// calls can never succeed. Drop it rather than ship a confusing offline state.
await fs.rm(path.join(OUT, 'sw.js'), { force: true });

for (const file of ['demo-data.js', 'demo-shim.js']) {
  await fs.copyFile(path.join(ROOT, 'tools', file), path.join(OUT, file));
}

const html = await fs.readFile(path.join(ROOT, 'public', 'index.html'), 'utf8');
const patched = html
  .replace('<title>本機收件匣</title>', '<title>本機收件匣 · 展示版</title>')
  .replace(
    '    <script type="module" src="./app.js"></script>\n',
    '    <script src="./demo-data.js"></script>\n' +
      '    <script src="./demo-shim.js"></script>\n' +
      '    <script type="module" src="./app.js"></script>\n',
  )
  .replace(/\n    <script>\n      \/\/ Registered outside[\s\S]*?<\/script>\n/, '\n')
  .replace('    <div id="banner" hidden></div>\n', `${NOTICE}    <div id="banner" hidden></div>\n`);

if (patched === html) throw new Error('index.html 的結構變了，build-demo 需要更新');
await fs.writeFile(path.join(OUT, 'index.html'), patched);

const css = await fs.readFile(path.join(ROOT, 'public', 'styles.css'), 'utf8');
await fs.writeFile(path.join(OUT, 'styles.css'), css + NOTICE_STYLE);

// Pages would otherwise run the output through Jekyll.
await fs.writeFile(path.join(OUT, '.nojekyll'), '');

const files = await fs.readdir(OUT, { recursive: true });
console.log(`demo → ${path.relative(ROOT, OUT)}/  (${files.length} files)`);

if (serve) {
  const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
  };

  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.join(OUT, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));

    if (!file.startsWith(OUT)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await fs.readFile(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });

  server.listen(8099, '127.0.0.1', () => console.log('預覽：http://127.0.0.1:8099  (Ctrl+C 結束)'));
}
