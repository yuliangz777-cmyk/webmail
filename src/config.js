import 'dotenv/config';
import path from 'node:path';

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return !/^(0|false|no|off)$/i.test(value.trim());
}

function int(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function list(value, fallback) {
  const items = (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

export function loadConfig() {
  const env = process.env;

  const config = {
    imap: {
      host: (env.IMAP_HOST ?? '').trim(),
      port: int(env.IMAP_PORT, 993),
      secure: bool(env.IMAP_SECURE, true),
      user: (env.IMAP_USER ?? '').trim(),
      pass: env.IMAP_PASS ?? '',
      rejectUnauthorized: bool(env.IMAP_TLS_REJECT_UNAUTHORIZED, true),
    },
    folders: list(env.SYNC_FOLDERS, ['INBOX']),
    mailboxDir: path.resolve(env.MAILBOX_DIR?.trim() || './data/mailbox'),
    limit: int(env.SYNC_LIMIT, 0),
    since: (env.SYNC_SINCE ?? '').trim() || null,
    http: {
      host: (env.HTTP_HOST ?? '').trim() || '127.0.0.1',
      port: int(env.HTTP_PORT, 8025),
    },
  };

  if (config.since && Number.isNaN(Date.parse(config.since))) {
    throw new Error(`SYNC_SINCE 不是合法的日期："${config.since}"（格式應為 YYYY-MM-DD）`);
  }

  return config;
}

/** Credentials are only needed for commands that actually talk to the server. */
export function requireImapCredentials(config) {
  const missing = [];
  if (!config.imap.host) missing.push('IMAP_HOST');
  if (!config.imap.user) missing.push('IMAP_USER');
  if (!config.imap.pass) missing.push('IMAP_PASS');

  if (missing.length) {
    throw new Error(
      `缺少設定：${missing.join(', ')}\n` +
        '請複製 .env.example 成 .env 並填入你的 NTU 帳號密碼。',
    );
  }
}
