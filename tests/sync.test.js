import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { syncFolders } from '../src/sync.js';
import { Mailbox } from '../src/store.js';

/** Minimal stand-in for the bits of ImapFlow that syncFolders touches. */
function fakeClient({ uidValidity = 1, messages = [] }) {
  return {
    mailbox: { uidValidity, exists: messages.length, path: 'INBOX' },
    list: async () => [{ path: 'INBOX', name: 'INBOX', flags: new Set() }],
    getMailboxLock: async () => ({ release() {} }),
    async *fetch(range) {
      const start = Number(String(range.uid).split(':')[0]);
      const hits = messages.filter((m) => m.uid >= start);
      // Mirror the IMAP quirk: `N:*` still returns the highest message when the
      // range matches nothing, so the caller's own filter is exercised.
      yield* hits.length ? hits : messages.slice(-1);
    },
    logout: async () => {},
  };
}

function eml({ uid, subject, from = 'sender@ntu.edu.tw', messageId, body = 'hello' }) {
  const source = Buffer.from(
    [
      `Message-ID: <${messageId ?? `${uid}@ntu.edu.tw`}>`,
      `From: NTU Sender <${from}>`,
      'To: me@ntu.edu.tw',
      `Subject: ${subject}`,
      'Date: Mon, 01 Sep 2025 10:00:00 +0800',
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
      '',
    ].join('\r\n'),
  );
  return { uid, flags: new Set(['\\Seen']), internalDate: new Date(), size: source.length, source };
}

async function tempConfig() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webmail-test-'));
  return {
    dir,
    config: { mailboxDir: path.join(dir, 'mailbox'), folders: ['INBOX'], limit: 0, since: null },
  };
}

test('saves new messages and records the sync cursor', async (t) => {
  const { dir, config } = await tempConfig();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const messages = [eml({ uid: 1, subject: '第一封' }), eml({ uid: 2, subject: '第二封' })];
  const { summary } = await syncFolders(config, {
    createClient: async () => fakeClient({ messages }),
  });

  assert.equal(summary[0].saved, 2);

  const mailbox = await new Mailbox(config.mailboxDir).open();
  assert.equal(mailbox.messages.length, 2);
  assert.deepEqual(mailbox.messages.map((m) => m.subject), ['第一封', '第二封']);
  assert.equal(mailbox.folderState('INBOX').lastUid, 2);

  const source = await mailbox.readSource(mailbox.messages[0]);
  assert.match(source.toString(), /Subject: 第一封/);
});

test('a second run only fetches messages above the cursor', async (t) => {
  const { dir, config } = await tempConfig();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const first = [eml({ uid: 1, subject: '舊信' })];
  await syncFolders(config, { createClient: async () => fakeClient({ messages: first }) });

  const ranges = [];
  const second = [...first, eml({ uid: 2, subject: '新信' })];
  const { summary } = await syncFolders(config, {
    createClient: async () => {
      const client = fakeClient({ messages: second });
      const inner = client.fetch.bind(client);
      client.fetch = async function* (range, options) {
        ranges.push(range.uid);
        yield* inner(range, options);
      };
      return client;
    },
  });

  assert.deepEqual(ranges, ['2:*'], 'should resume from the stored cursor');
  assert.equal(summary[0].saved, 1);
  assert.equal((await new Mailbox(config.mailboxDir).open()).messages.length, 2);
});

test('re-downloads everything when UIDVALIDITY changes', async (t) => {
  const { dir, config } = await tempConfig();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  await syncFolders(config, {
    createClient: async () => fakeClient({ uidValidity: 1, messages: [eml({ uid: 9, subject: '舊' })] }),
  });

  const ranges = [];
  await syncFolders(config, {
    createClient: async () => {
      const client = fakeClient({
        uidValidity: 2,
        messages: [eml({ uid: 1, subject: '重編號', messageId: 'renumbered' })],
      });
      const inner = client.fetch.bind(client);
      client.fetch = async function* (range, options) {
        ranges.push(range.uid);
        yield* inner(range, options);
      };
      return client;
    },
  });

  assert.deepEqual(ranges, ['1:*'], 'a changed UIDVALIDITY invalidates the cursor');
  const mailbox = await new Mailbox(config.mailboxDir).open();
  assert.equal(mailbox.folderState('INBOX').uidValidity, '2');
  assert.equal(mailbox.folderState('INBOX').lastUid, 1);
});

test('skips a message already stored under the same Message-ID', async (t) => {
  const { dir, config } = await tempConfig();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  await syncFolders(config, {
    createClient: async () => fakeClient({ messages: [eml({ uid: 1, messageId: 'dup', subject: 'A' })] }),
  });

  // Same Message-ID arriving under a fresh UID, e.g. after the server re-filed it.
  const { summary } = await syncFolders(config, {
    createClient: async () =>
      fakeClient({ messages: [eml({ uid: 5, messageId: 'dup', subject: 'A again' })] }),
  });

  assert.equal(summary[0].saved, 0);
  assert.equal(summary[0].skipped, 1);
  assert.equal((await new Mailbox(config.mailboxDir).open()).messages.length, 1);
});

test('reports folders that do not exist on the server', async (t) => {
  const { dir, config } = await tempConfig();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const { summary } = await syncFolders(
    { ...config, folders: ['INBOX', '不存在的資料夾'] },
    { createClient: async () => fakeClient({ messages: [eml({ uid: 1, subject: 'x' })] }) },
  );

  assert.equal(summary[1].missing, true);
  assert.equal(summary[1].saved, 0);
});
