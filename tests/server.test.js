import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Mailbox } from '../src/store.js';
import { serve } from '../src/server.js';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webmail-http-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const config = {
    mailboxDir: path.join(dir, 'mailbox'),
    http: { host: '127.0.0.1', port: 0 },
    imap: { host: '', user: '', pass: '' },
    folders: ['INBOX'],
  };

  const mailbox = await new Mailbox(config.mailboxDir).open();
  const source = Buffer.from(
    'From: NTU <sender@ntu.edu.tw>\r\nSubject: 系上公告\r\n\r\n請於期限前完成選課。\r\n',
  );
  await mailbox.addMessage(
    {
      id: 'INBOX:1',
      folder: 'INBOX',
      folderSlug: 'INBOX',
      uid: 1,
      messageId: '<a@ntu.edu.tw>',
      date: '2025-09-01T02:00:00.000Z',
      subject: '系上公告',
      from: { name: 'NTU', address: 'sender@ntu.edu.tw' },
      to: [{ name: null, address: 'me@ntu.edu.tw' }],
      cc: [],
      flags: [],
      seen: false,
      size: source.length,
      snippet: '請於期限前完成選課。',
    },
    source,
    [{ filename: '選課須知.txt', contentType: 'text/plain', content: Buffer.from('內容'), size: 6 }],
  );
  await mailbox.save();

  const server = await serve(config);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  return (route, options) => fetch(`http://127.0.0.1:${port}${route}`, options);
}

test('lists messages and exposes the folders present locally', async (t) => {
  const get = await fixture(t);
  const data = await (await get('/api/messages')).json();

  assert.equal(data.total, 1);
  assert.deepEqual(data.folders, ['INBOX']);
  assert.equal(data.messages[0].subject, '系上公告');
  assert.equal(data.messages[0].attachmentCount, 1);
});

test('search matches subject and sender, and misses everything else', async (t) => {
  const get = await fixture(t);

  assert.equal((await (await get('/api/messages?q=公告')).json()).total, 1);
  assert.equal((await (await get('/api/messages?q=sender@ntu')).json()).total, 1);
  assert.equal((await (await get('/api/messages?q=zzzz')).json()).total, 0);
});

test('reads one message with its parsed body', async (t) => {
  const get = await fixture(t);
  const message = await (await get('/api/messages/INBOX%3A1')).json();

  assert.match(message.text, /請於期限前完成選課/);
  assert.equal(message.attachments.length, 1);
});

test('serves an attachment with its original filename', async (t) => {
  const get = await fixture(t);
  const response = await get('/api/attachments/INBOX%3A1/0');

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get('content-disposition'),
    new RegExp(encodeURIComponent('選課須知.txt')),
  );
  assert.equal(await response.text(), '內容');
});

test('returns 404 for a message that is not in the local mailbox', async (t) => {
  const get = await fixture(t);
  assert.equal((await get('/api/messages/INBOX%3A999')).status, 404);
});

test('refuses to serve files outside the public directory', async (t) => {
  const get = await fixture(t);
  const response = await get('/../package.json');
  assert.ok([403, 404].includes(response.status), `unexpected status ${response.status}`);
});

test('the sync endpoint rejects GET', async (t) => {
  const get = await fixture(t);
  const response = await get('/api/sync');

  assert.equal(response.status, 405);
  assert.match((await response.json()).error, /POST/);
});

test('syncing without credentials reports what is missing instead of hanging', async (t) => {
  const get = await fixture(t);
  const response = await get('/api/sync', { method: 'POST' });

  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /IMAP_HOST/);
});

test('serves the manifest and service worker the installed app needs', async (t) => {
  const get = await fixture(t);

  const manifest = await get('/manifest.webmanifest');
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers.get('content-type'), /manifest\+json/);

  const sw = await get('/sw.js');
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('content-type'), /javascript/);

  const icon = await get('/icons/icon-192.png');
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get('content-type'), 'image/png');
});

test('serves the browser UI at the root', async (t) => {
  const get = await fixture(t);
  const response = await get('/');

  assert.equal(response.status, 200);
  assert.match(await response.text(), /本機收件匣/);
});
