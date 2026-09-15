import { ImapFlow } from 'imapflow';

export async function connect(config) {
  const client = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: { user: config.imap.user, pass: config.imap.pass },
    tls: { rejectUnauthorized: config.imap.rejectUnauthorized },
    logger: false,
  });

  try {
    await client.connect();
  } catch (error) {
    throw new Error(describeConnectionError(error, config));
  }
  return client;
}

export async function listFolders(client) {
  const folders = await client.list();
  return folders.map((folder) => ({
    path: folder.path,
    name: folder.name,
    specialUse: folder.specialUse ?? null,
    selectable: !folder.flags?.has('\\Noselect'),
  }));
}

/**
 * Yield messages in `folder` that the caller has not seen yet.
 *
 * `resolveStart` is handed the open mailbox and returns the first UID worth
 * fetching; it runs inside the lock because UIDVALIDITY is only known then, and
 * its answer bounds the fetch so message bodies below it are never downloaded.
 */
export async function* fetchNewMessages(client, folder, { since, limit }, resolveStart) {
  const lock = await client.getMailboxLock(folder);
  try {
    const startUid = resolveStart(client.mailbox);

    // `uid:'N:*'` always returns at least the highest message, even when it is
    // below N, so every hit still has to be checked against startUid.
    const range = { uid: `${startUid}:*` };
    if (since) range.since = new Date(since);

    let yielded = 0;
    for await (const message of client.fetch(range, {
      uid: true,
      flags: true,
      internalDate: true,
      size: true,
      source: true,
    })) {
      if (message.uid < startUid) continue;
      yield message;
      yielded += 1;
      if (limit > 0 && yielded >= limit) break;
    }
  } finally {
    lock.release();
  }
}

function describeConnectionError(error, config) {
  const target = `${config.imap.host}:${config.imap.port}`;
  const code = error.code;

  if (error.authenticationFailed || /auth/i.test(error.responseText ?? '')) {
    return (
      `登入 ${target} 失敗：帳號或密碼不正確。\n` +
      '· 確認 IMAP_USER 要不要含 @ntu.edu.tw（有些伺服器只吃帳號本身）\n' +
      '· 如果信箱掛在 Google Workspace，IMAP_PASS 必須是「應用程式密碼」\n' +
      '· 部分系所信箱預設關閉 IMAP，要先到 webmail 設定頁開啟'
    );
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return `找不到主機 ${config.imap.host}，請確認 IMAP_HOST 是否正確。`;
  }
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ECONNRESET') {
    return (
      `無法連線到 ${target}。\n` +
      '· 台大部分信箱服務限制校外連線，請確認是否需要先連上 NTU VPN\n' +
      '· 確認 IMAP_PORT（SSL 通常是 993）'
    );
  }
  if (/certificate|self.signed|DEPTH_ZERO/i.test(error.message)) {
    return (
      `${target} 的 TLS 憑證驗證失敗：${error.message}\n` +
      '若確定主機正確，可暫時設定 IMAP_TLS_REJECT_UNAUTHORIZED=false。'
    );
  }
  return `連線 ${target} 失敗：${error.message}`;
}
