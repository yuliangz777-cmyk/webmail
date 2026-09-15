import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simpleParser } from 'mailparser';
import { Mailbox } from './store.js';
import { syncFolders } from './sync.js';
import { requireImapCredentials } from './config.js';
import { resolveHost } from './network.js';
import { isConfigured as lineConfigured, notifyNewMail as notifyLine } from './line.js';
import {
  addSubscription,
  isConfigured as pushConfigured,
  notifyNewMail as notifyPush,
  removeSubscription,
} from './push.js';

const PUBLIC_DIR = path.resolve(fileURLToPath(new URL('../public', import.meta.url)));

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** One sync at a time: concurrent runs would fight over the index file. */
let inFlightSync = null;

export async function serve(config) {
  const server = http.createServer((req, res) => {
    handle(req, res, config).catch((error) => {
      send(res, 500, { error: error.message });
    });
  });

  const host = resolveHost(config.http.host);
  await new Promise((resolve, reject) => {
    server.once('error', (error) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(
              `連接埠 ${config.http.port} 已被占用——可能是另一個 webmail 還開著。\n` +
                '關掉它，或在 .env 改 HTTP_PORT。',
            )
          : error,
      );
    });
    server.listen(config.http.port, host, resolve);
  });
  return server;
}

async function handle(req, res, config) {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname === '/api/sync') return runSync(req, res, config);
  if (url.pathname === '/api/push/key') return sendPushKey(res, config);
  if (url.pathname === '/api/push/subscribe') return subscribePush(req, res, config);
  if (url.pathname === '/api/push/unsubscribe') return unsubscribePush(req, res, config);
  if (url.pathname === '/api/messages') return listMessages(res, config, url);
  if (url.pathname.startsWith('/api/messages/')) {
    return readMessage(res, config, decodeURIComponent(url.pathname.slice('/api/messages/'.length)));
  }
  if (url.pathname.startsWith('/api/attachments/')) {
    const [id, index] = url.pathname.slice('/api/attachments/'.length).split('/');
    return sendAttachment(res, config, decodeURIComponent(id), Number(index));
  }
  return sendStatic(res, url.pathname);
}

async function runSync(req, res, config) {
  if (req.method !== 'POST') return send(res, 405, { error: '請用 POST' });

  if (!inFlightSync) {
    inFlightSync = (async () => {
      requireImapCredentials(config);

      const arrived = [];
      const { summary } = await syncFolders(config, {
        onEvent: (event) => {
          if (event.type === 'message') arrived.push(event.record);
        },
      });

      // Mail is already on disk, so a failed notification must not fail the request.
      if (arrived.length) await notify(config, arrived);
      return { summary, saved: arrived.length };
    })().finally(() => {
      inFlightSync = null;
    });
  }

  try {
    send(res, 200, await inFlightSync);
  } catch (error) {
    send(res, 502, { error: error.message });
  }
}

/** Notify over every configured channel; a channel that fails is logged, not thrown. */
export async function notify(config, records) {
  const channels = [
    pushConfigured(config) && ['通知', () => notifyPush(config, records)],
    lineConfigured(config) && ['LINE', () => notifyLine(config, records)],
  ].filter(Boolean);

  const results = [];
  for (const [name, run] of channels) {
    try {
      results.push({ channel: name, ...(await run()) });
    } catch (error) {
      console.error(`${name}推播失敗（信件已存好）：${error.message}`);
      results.push({ channel: name, error: error.message });
    }
  }
  return results;
}

function sendPushKey(res, config) {
  if (!pushConfigured(config)) {
    return send(res, 503, { error: '伺服器還沒設定 VAPID 金鑰，請先跑 npm run push:keys。' });
  }
  send(res, 200, { key: config.push.publicKey });
}

async function subscribePush(req, res, config) {
  if (req.method !== 'POST') return send(res, 405, { error: '請用 POST' });

  try {
    const count = await addSubscription(config, await readJsonBody(req));
    send(res, 200, { subscribed: true, devices: count });
  } catch (error) {
    send(res, 400, { error: error.message });
  }
}

async function unsubscribePush(req, res, config) {
  if (req.method !== 'POST') return send(res, 405, { error: '請用 POST' });

  try {
    const { endpoint } = await readJsonBody(req);
    send(res, 200, { devices: await removeSubscription(config, endpoint) });
  } catch (error) {
    send(res, 400, { error: error.message });
  }
}

async function readJsonBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('請求內容過大');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('請求不是合法的 JSON');
  }
}

async function listMessages(res, config, url) {
  const mailbox = await new Mailbox(config.mailboxDir).open();
  const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const folder = url.searchParams.get('folder') ?? '';

  let messages = mailbox.messages;
  if (folder) messages = messages.filter((m) => m.folder === folder);
  if (query) messages = messages.filter((m) => matches(m, query));

  send(res, 200, {
    folders: [...new Set(mailbox.messages.map((m) => m.folder))].sort(),
    state: mailbox.state,
    total: messages.length,
    messages: messages
      .slice()
      .reverse()
      .slice(0, 500)
      .map(({ id, folder: f, date, subject, from, seen, attachments, snippet }) => ({
        id,
        folder: f,
        date,
        subject,
        from,
        seen,
        attachmentCount: attachments.length,
        snippet,
      })),
  });
}

async function readMessage(res, config, id) {
  const mailbox = await new Mailbox(config.mailboxDir).open();
  const message = mailbox.byId.get(id);
  if (!message) return send(res, 404, { error: '找不到這封信' });

  const parsed = await simpleParser(await mailbox.readSource(message));
  send(res, 200, {
    ...message,
    html: parsed.html || null,
    text: parsed.text ?? '',
  });
}

async function sendAttachment(res, config, id, index) {
  const mailbox = await new Mailbox(config.mailboxDir).open();
  const attachment = mailbox.byId.get(id)?.attachments?.[index];
  if (!attachment) return send(res, 404, { error: '找不到附件' });

  // Paths come from the index we wrote ourselves, but re-check the boundary so a
  // tampered index cannot read outside the mailbox directory.
  const file = path.resolve(mailbox.root, attachment.file);
  if (!file.startsWith(path.resolve(mailbox.root) + path.sep)) {
    return send(res, 403, { error: '附件路徑不合法' });
  }

  res.writeHead(200, {
    'content-type': attachment.contentType,
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
  });
  res.end(await fs.readFile(file));
}

async function sendStatic(res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, relative);
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== PUBLIC_DIR) {
    return send(res, 403, { error: 'forbidden' });
  }

  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

function send(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function matches(message, query) {
  const haystack = [
    message.subject,
    message.snippet,
    message.from?.name,
    message.from?.address,
    ...message.to.map((t) => t.address),
  ];
  return haystack.some((value) => value?.toLowerCase().includes(query));
}
