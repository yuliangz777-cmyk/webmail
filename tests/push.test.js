import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  addSubscription,
  buildNotifications,
  generateKeys,
  isConfigured,
  loadSubscriptions,
  notifyNewMail,
  removeSubscription,
} from '../src/push.js';

async function tempConfig(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webmail-push-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const { publicKey, privateKey } = generateKeys();
  return {
    mailboxDir: path.join(dir, 'mailbox'),
    push: { publicKey, privateKey, subject: 'mailto:me@ntu.edu.tw' },
  };
}

// Real-shaped keys: p256dh is an uncompressed P-256 point (65 bytes), auth 16.
const keys = (seed = 1) => ({
  p256dh: Buffer.alloc(65, seed).toString('base64url'),
  auth: Buffer.alloc(16, seed).toString('base64url'),
});

const sub = (id) => ({ endpoint: `https://push.example/${id}`, keys: keys() });

const mail = (subject, name, date = '2025-09-12T01:00:00.000Z') => ({
  id: subject,
  date,
  subject,
  from: { name, address: `${name}@ntu.edu.tw` },
});

test('a device re-subscribing replaces its entry instead of stacking', async (t) => {
  const config = await tempConfig(t);

  await addSubscription(config, sub('a'));
  await addSubscription(config, sub('b'));
  assert.equal(await addSubscription(config, { ...sub('a'), keys: keys(9) }), 2);

  const stored = await loadSubscriptions(config);
  assert.equal(stored.length, 2);
  assert.equal(stored.find((entry) => entry.endpoint.endsWith('/a')).keys.p256dh, keys(9).p256dh);
});

test('unsubscribing removes only that device', async (t) => {
  const config = await tempConfig(t);
  await addSubscription(config, sub('a'));
  await addSubscription(config, sub('b'));

  assert.equal(await removeSubscription(config, 'https://push.example/a'), 1);
  assert.equal(await removeSubscription(config, 'https://push.example/missing'), 1);
  assert.deepEqual((await loadSubscriptions(config)).map((e) => e.endpoint), ['https://push.example/b']);
});

test('a few messages notify individually, a burst collapses into one summary', () => {
  const three = [mail('a', '甲'), mail('b', '乙'), mail('c', '丙')];
  assert.equal(buildNotifications(three).length, 3);

  const many = Array.from({ length: 9 }, (_, i) => mail(`s${i}`, `寄件者${i}`));
  const digest = buildNotifications(many);
  assert.equal(digest.length, 1);
  assert.match(digest[0].title, /^9 封新信$/);
});

test('notifications carry sender and subject, and nothing else', () => {
  const [notice] = buildNotifications([
    { ...mail('期中考公告', '教務處'), snippet: '這段內文不應該離開這台機器' },
  ]);

  assert.equal(notice.title, '教務處');
  assert.equal(notice.body, '期中考公告');
  assert.doesNotMatch(JSON.stringify(notice), /不應該離開/);
});

test('each message gets its own tag so alerts do not overwrite each other', () => {
  const tags = buildNotifications([mail('a', '甲'), mail('b', '乙')]).map((n) => n.tag);
  assert.equal(new Set(tags).size, 2);
});

test('every subscribed device receives the notification', async (t) => {
  const config = await tempConfig(t);
  await addSubscription(config, sub('phone'));
  await addSubscription(config, sub('tablet'));

  const sent = [];
  const result = await notifyNewMail(config, [mail('a', '甲')], {
    send: async (subscription, payload) => sent.push([subscription.endpoint, JSON.parse(payload)]),
  });

  assert.equal(result.sent, 2);
  assert.deepEqual(sent.map(([endpoint]) => endpoint).sort(), [
    'https://push.example/phone',
    'https://push.example/tablet',
  ]);
});

test('a subscription the browser discarded is pruned, not retried forever', async (t) => {
  const config = await tempConfig(t);
  await addSubscription(config, sub('gone'));
  await addSubscription(config, sub('live'));

  const result = await notifyNewMail(config, [mail('a', '甲')], {
    send: async (subscription) => {
      if (subscription.endpoint.endsWith('/gone')) {
        throw Object.assign(new Error('Gone'), { statusCode: 410 });
      }
    },
  });

  assert.equal(result.pruned, 1);
  assert.deepEqual((await loadSubscriptions(config)).map((e) => e.endpoint), ['https://push.example/live']);
});

test('a mismatched VAPID key is reported as needing re-subscription', async (t) => {
  const config = await tempConfig(t);
  await addSubscription(config, sub('a'));

  await assert.rejects(
    () =>
      notifyNewMail(config, [mail('a', '甲')], {
        send: async () => {
          throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
        },
      }),
    /重新開啟通知/,
  );
});

test('nothing is sent without keys, without mail, or without devices', async (t) => {
  const config = await tempConfig(t);
  const send = async () => assert.fail('不應該送出');

  assert.equal(isConfigured({ push: {} }), false);
  await notifyNewMail({ ...config, push: {} }, [mail('a', '甲')], { send });
  await notifyNewMail(config, [], { send });

  const result = await notifyNewMail(config, [mail('a', '甲')], { send });
  assert.equal(result.reason, 'no-subscriptions');
});

test('a subscription with unusable keys is refused rather than stored', async (t) => {
  const config = await tempConfig(t);
  const valid = sub('ok');

  await addSubscription(config, valid);

  // Anything stored here fails on every later sync, so it never gets stored.
  for (const [broken, expected] of [
    [{ keys: valid.keys }, /endpoint/],
    [{ ...valid, endpoint: 'http://push.example/x' }, /https/],
    [{ ...valid, keys: { auth: valid.keys.auth } }, /p256dh/],
    [{ ...valid, keys: { ...valid.keys, p256dh: 'short' } }, /65 bytes/],
    [{ ...valid, keys: { ...valid.keys, auth: 'short' } }, /16 bytes/],
  ]) {
    await assert.rejects(() => addSubscription(config, broken), expected);
  }

  assert.equal((await loadSubscriptions(config)).length, 1);
});
