import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simpleParser } from 'mailparser';
import { Mailbox } from './store.js';

const PUBLIC_DIR = path.resolve(fileURLToPath(new URL('../public', import.meta.url)));

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export async function serve(config) {
  const server = http.createServer((req, res) => {
    handle(req, res, config).catch((error) => {
      send(res, 500, { error: error.message });
    });
  });

  await new Promise((resolve) => server.listen(config.http.port, config.http.host, resolve));
  return server;
}

async function handle(req, res, config) {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

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
