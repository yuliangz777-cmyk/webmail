import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

async function build(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webmail-demo-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const out = path.join(dir, 'site');
  await run('node', [path.join(ROOT, 'tools', 'build-demo.mjs'), out]);
  return out;
}

test('the demo build wires the shim in and drops the service worker', async (t) => {
  const out = await build(t);
  const html = await fs.readFile(path.join(out, 'index.html'), 'utf8');

  assert.match(html, /demo-data\.js/);
  assert.match(html, /demo-shim\.js/);
  assert.ok(
    html.indexOf('demo-shim.js') < html.indexOf('app.js'),
    'the shim has to replace fetch before the app module runs',
  );

  // Without a server the app's API calls can never succeed, so a cached shell
  // would only produce a confusing offline state.
  assert.doesNotMatch(html, /serviceWorker/);
  await assert.rejects(fs.access(path.join(out, 'sw.js')));
});

test('the demo ships the assets its HTML references', async (t) => {
  const out = await build(t);

  for (const file of ['app.js', 'styles.css', 'demo-data.js', 'demo-shim.js', 'manifest.webmanifest', '.nojekyll']) {
    await fs.access(path.join(out, file));
  }
  await fs.access(path.join(out, 'icons', 'icon-192.png'));
});

test('the demo notice says the mail is not real', async (t) => {
  const out = await build(t);
  const html = await fs.readFile(path.join(out, 'index.html'), 'utf8');

  assert.match(html, /展示版/);
  assert.match(await fs.readFile(path.join(out, 'styles.css'), 'utf8'), /#demo-notice/);
});

test('every demo message carries what the list and reader render', async () => {
  const source = await fs.readFile(path.join(ROOT, 'tools', 'demo-data.js'), 'utf8');
  const window = {};
  new Function('window', source)(window);

  assert.ok(window.DEMO_MAIL.length >= 5);
  for (const message of [...window.DEMO_MAIL, window.DEMO_INCOMING]) {
    for (const field of ['id', 'folder', 'uid', 'date', 'subject', 'from', 'snippet']) {
      assert.ok(message[field] !== undefined, `${message.id ?? '?'} 缺少 ${field}`);
    }
    assert.ok(Array.isArray(message.attachments));
    assert.ok(message.html || message.text, `${message.id} 沒有內容`);
    assert.ok(!Number.isNaN(Date.parse(message.date)));
  }

  // The folder picker is built from these, so more than one keeps it meaningful.
  assert.ok(new Set(window.DEMO_MAIL.map((m) => m.folder)).size >= 2);
});
