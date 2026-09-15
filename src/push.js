/**
 * Web Push notifications, sent by this machine straight to the browser vendor's
 * push service. No third-party account and no quota: Apple and Google relay the
 * message but the payload is encrypted to the subscription's own keys, so the
 * relay cannot read a subject line any more than it can read the mailbox.
 *
 * On iOS this only works once the app has been added to the home screen.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import webpush from 'web-push';

const INDIVIDUAL_LIMIT = 3; // beyond this a single summary beats a burst of alerts

export function isConfigured(config) {
  return Boolean(config.push?.publicKey && config.push?.privateKey);
}

export function generateKeys() {
  return webpush.generateVAPIDKeys();
}

function configure(config) {
  webpush.setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey);
}

/* ── stored subscriptions ────────────────────────────────────────────────── */

function storePath(config) {
  return path.join(config.mailboxDir, 'push-subscriptions.json');
}

export async function loadSubscriptions(config) {
  try {
    return JSON.parse(await fs.readFile(storePath(config), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function saveSubscriptions(config, subscriptions) {
  const file = storePath(config);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify(subscriptions, null, 2)}\n`);
  await fs.rename(`${file}.tmp`, file);
}

export async function addSubscription(config, subscription) {
  assertUsable(subscription);

  const subscriptions = await loadSubscriptions(config);
  const existing = subscriptions.findIndex((entry) => entry.endpoint === subscription.endpoint);
  const record = { ...subscription, addedAt: new Date().toISOString() };

  // Re-subscribing from the same device replaces its old keys rather than
  // stacking up entries that would each get their own copy of every alert.
  if (existing >= 0) subscriptions[existing] = record;
  else subscriptions.push(record);

  await saveSubscriptions(config, subscriptions);
  return subscriptions.length;
}

/**
 * Validate at the door. A subscription stored with malformed keys cannot ever be
 * delivered to, and would otherwise fail on every sync from then on.
 */
function assertUsable(subscription) {
  if (!subscription?.endpoint) throw new Error('訂閱資料缺少 endpoint');
  if (!/^https:\/\//.test(subscription.endpoint)) throw new Error('endpoint 必須是 https 網址');

  const { p256dh, auth } = subscription.keys ?? {};
  if (!p256dh || !auth) throw new Error('訂閱資料缺少 keys.p256dh 或 keys.auth');

  // p256dh is an uncompressed P-256 public key: 65 bytes, and auth is 16.
  if (base64UrlLength(p256dh) !== 65) throw new Error('keys.p256dh 長度不正確，應為 65 bytes');
  if (base64UrlLength(auth) !== 16) throw new Error('keys.auth 長度不正確，應為 16 bytes');
}

function base64UrlLength(value) {
  try {
    return Buffer.from(value, 'base64url').length;
  } catch {
    return -1;
  }
}

export async function removeSubscription(config, endpoint) {
  const subscriptions = await loadSubscriptions(config);
  const remaining = subscriptions.filter((entry) => entry.endpoint !== endpoint);

  if (remaining.length !== subscriptions.length) await saveSubscriptions(config, remaining);
  return remaining.length;
}

/* ── sending ─────────────────────────────────────────────────────────────── */

export function buildNotifications(records) {
  const newest = [...records].sort((a, b) => b.date.localeCompare(a.date));

  if (newest.length > INDIVIDUAL_LIMIT) {
    const senders = [...new Set(newest.map(sender))].slice(0, 3).join('、');
    return [
      {
        title: `${newest.length} 封新信`,
        body: senders,
        tag: 'webmail-digest',
        url: './',
      },
    ];
  }

  // Only sender and subject travel, matching what the LINE card sends.
  return newest.map((record) => ({
    title: sender(record),
    body: record.subject || '(無主旨)',
    tag: `webmail-${record.id ?? record.uid}`,
    url: './',
  }));
}

export async function notifyNewMail(config, records, { send = webpush.sendNotification.bind(webpush) } = {}) {
  if (!records.length || !isConfigured(config)) return { sent: 0, pruned: 0 };

  configure(config);
  const subscriptions = await loadSubscriptions(config);
  if (!subscriptions.length) return { sent: 0, pruned: 0, reason: 'no-subscriptions' };

  const notifications = buildNotifications(records);
  const expired = new Set();
  let sent = 0;

  for (const subscription of subscriptions) {
    for (const notification of notifications) {
      try {
        await send(subscription, JSON.stringify(notification));
        sent += 1;
      } catch (error) {
        // 404/410 mean the browser threw the subscription away — the app was
        // uninstalled or permission revoked. Drop it instead of retrying forever.
        if (error.statusCode === 404 || error.statusCode === 410) {
          expired.add(subscription.endpoint);
          break;
        }
        throw new Error(describeSendError(error));
      }
    }
  }

  for (const endpoint of expired) await removeSubscription(config, endpoint);
  return { sent, pruned: expired.size };
}

function sender(record) {
  return record.from?.name || record.from?.address || '未知寄件者';
}

function describeSendError(error) {
  const status = error.statusCode;

  if (status === 401 || status === 403) {
    return (
      `推播服務拒絕了這次請求（HTTP ${status}）。\n` +
      'VAPID 金鑰可能與訂閱時用的不同——換過金鑰的話，手機要重新開啟通知。'
    );
  }
  if (status === 413) return '通知內容太大，無法送出。';
  if (status === 429) return '推播服務要求降低頻率，這次沒有送出。';
  return `送出通知失敗${status ? `（HTTP ${status}）` : ''}：${error.message}`;
}
