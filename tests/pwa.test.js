import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveHost, tailscaleAddress } from '../src/network.js';

const PUBLIC_DIR = path.resolve(fileURLToPath(new URL('../public', import.meta.url)));

test('manifest lists every icon it references, at the declared size', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(PUBLIC_DIR, 'manifest.webmanifest'), 'utf8'));

  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'), '需要 maskable 圖示');

  for (const icon of manifest.icons) {
    const file = path.join(PUBLIC_DIR, icon.src);
    const png = await fs.readFile(file);

    assert.equal(png.subarray(1, 4).toString(), 'PNG', `${icon.src} 不是 PNG`);
    // IHDR width/height live at bytes 16..24 of every PNG.
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    assert.equal(`${width}x${height}`, icon.sizes, `${icon.src} 尺寸與 manifest 不符`);
  }
});

test('the app shell precached by the service worker actually exists', async () => {
  const source = await fs.readFile(path.join(PUBLIC_DIR, 'sw.js'), 'utf8');
  const shell = source
    .slice(source.indexOf('const SHELL = ['), source.indexOf('];', source.indexOf('const SHELL = [')))
    .match(/'([^']+)'/g)
    .map((entry) => entry.slice(1, -1));

  assert.ok(shell.length >= 5);
  for (const entry of shell) {
    if (entry === './') continue;
    await fs.access(path.join(PUBLIC_DIR, entry));
  }
});

test('index.html carries the tags iOS needs for a home-screen install', async () => {
  const html = await fs.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

  assert.match(html, /rel="manifest"/);
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /serviceWorker/);
});

test('a plain host is used verbatim', () => {
  assert.equal(resolveHost('127.0.0.1'), '127.0.0.1');
  assert.equal(resolveHost('0.0.0.0'), '0.0.0.0');
});

test('HTTP_HOST=tailscale resolves to a CGNAT address, or explains why it cannot', () => {
  const address = tailscaleAddress();

  if (address) {
    assert.equal(resolveHost('tailscale'), address);
    assert.match(address, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./);
  } else {
    assert.throws(() => resolveHost('tailscale'), /Tailscale/);
  }
});
