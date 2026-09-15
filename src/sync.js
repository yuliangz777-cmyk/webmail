import { simpleParser } from 'mailparser';
import { Mailbox } from './store.js';
import { connect, fetchNewMessages, listFolders } from './imap.js';

/** `createClient` is a seam for tests; production always uses the real IMAP client. */
export async function syncFolders(config, { onEvent = () => {}, createClient = connect } = {}) {
  const mailbox = await new Mailbox(config.mailboxDir).open();
  const client = await createClient(config);
  const summary = [];

  try {
    const available = new Set((await listFolders(client)).map((f) => f.path));

    for (const folder of config.folders) {
      if (!available.has(folder)) {
        onEvent({ type: 'folder-missing', folder });
        summary.push({ folder, saved: 0, skipped: 0, missing: true });
        continue;
      }
      summary.push(await syncFolder({ client, mailbox, config, folder, onEvent }));
    }
  } finally {
    await client.logout().catch(() => {});
    await mailbox.save();
  }

  return { summary, mailbox };
}

async function syncFolder({ client, mailbox, config, folder, onEvent }) {
  const folderSlug = Mailbox.slug(folder);
  let cursor = { startUid: 1, reset: false };
  let uidValidity = mailbox.folderState(folder).uidValidity;
  let saved = 0;
  let skipped = 0;
  let highestUid = mailbox.folderState(folder).lastUid ?? 0;

  const stream = fetchNewMessages(
    client,
    folder,
    { since: config.since, limit: config.limit },
    (info) => {
      uidValidity = String(info.uidValidity);
      cursor = mailbox.resolveCursor(folder, info.uidValidity);
      if (cursor.reset) highestUid = 0;
      onEvent({ type: 'folder-open', folder, total: info.exists, cursor });
      return cursor.startUid;
    },
  );

  for await (const message of stream) {
    highestUid = Math.max(highestUid, message.uid);

    const id = `${folderSlug}:${message.uid}`;
    if (mailbox.has(id)) {
      skipped += 1;
      continue;
    }

    const parsed = await simpleParser(message.source);
    if (mailbox.hasMessageId(parsed.messageId)) {
      skipped += 1;
      continue;
    }

    const record = await mailbox.addMessage(
      {
        id,
        folder,
        folderSlug,
        uid: message.uid,
        messageId: parsed.messageId ?? null,
        date: (parsed.date ?? message.internalDate ?? new Date()).toISOString(),
        subject: parsed.subject ?? '(無主旨)',
        from: addresses(parsed.from)[0] ?? null,
        to: addresses(parsed.to),
        cc: addresses(parsed.cc),
        flags: [...(message.flags ?? [])],
        seen: Boolean(message.flags?.has('\\Seen')),
        size: message.size ?? message.source.length,
        snippet: snippet(parsed),
      },
      message.source,
      parsed.attachments ?? [],
    );

    saved += 1;
    onEvent({ type: 'message', folder, record, saved });
  }

  mailbox.setFolderState(folder, {
    uidValidity,
    lastUid: highestUid,
    syncedAt: new Date().toISOString(),
  });

  const result = { folder, saved, skipped, reset: cursor.reset, missing: false };
  onEvent({ type: 'folder-done', ...result });
  return result;
}

function addresses(field) {
  return (field?.value ?? [])
    .filter((entry) => entry.address || entry.name)
    .map((entry) => ({ name: entry.name || null, address: entry.address || null }));
}

function snippet(parsed) {
  const text = parsed.text ?? stripHtml(parsed.html ?? '');
  return text.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function stripHtml(html) {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}
