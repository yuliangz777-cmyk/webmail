import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * The local mailbox on disk:
 *
 *   <mailboxDir>/
 *     index.json                       every message we have, metadata only
 *     state.json                       per-folder IMAP sync cursors
 *     <folderSlug>/
 *       messages/00000042.eml          the untouched RFC822 source
 *       attachments/00000042/0-report.pdf
 */
export class Mailbox {
  constructor(rootDir) {
    this.root = rootDir;
    this.indexPath = path.join(rootDir, 'index.json');
    this.statePath = path.join(rootDir, 'state.json');
    this.messages = [];
    this.state = {};
    this.byId = new Map();
    this.messageIds = new Set();
  }

  static slug(folder) {
    const cleaned = folder
      .replace(/[\\/]+/g, '.')
      .replace(/[^A-Za-z0-9._\-一-鿿]/g, '_')
      .replace(/^\.+/, '');
    return cleaned || 'folder';
  }

  async open() {
    await fs.mkdir(this.root, { recursive: true });
    this.messages = await readJson(this.indexPath, []);
    this.state = await readJson(this.statePath, {});

    for (const message of this.messages) {
      this.byId.set(message.id, message);
      if (message.messageId) this.messageIds.add(message.messageId);
    }
    return this;
  }

  folderState(folder) {
    return this.state[folder] ?? { uidValidity: null, lastUid: 0, syncedAt: null };
  }

  setFolderState(folder, next) {
    this.state[folder] = { ...this.folderState(folder), ...next };
  }

  /** A folder's UIDs are only meaningful while UIDVALIDITY holds; if it changed, start over. */
  resolveCursor(folder, uidValidity) {
    const saved = this.folderState(folder);
    const current = String(uidValidity);
    if (saved.uidValidity && saved.uidValidity !== current) {
      return { startUid: 1, reset: true, previousUidValidity: saved.uidValidity };
    }
    return { startUid: (saved.lastUid ?? 0) + 1, reset: false };
  }

  has(id) {
    return this.byId.has(id);
  }

  hasMessageId(messageId) {
    return Boolean(messageId) && this.messageIds.has(messageId);
  }

  async addMessage(entry, source, attachments) {
    const folderDir = path.join(this.root, entry.folderSlug);
    const stem = String(entry.uid).padStart(8, '0');
    const relativeSource = path.join(entry.folderSlug, 'messages', `${stem}.eml`);

    await fs.mkdir(path.join(folderDir, 'messages'), { recursive: true });
    await fs.writeFile(path.join(this.root, relativeSource), source);

    const saved = [];
    if (attachments.length) {
      const attachmentDir = path.join(folderDir, 'attachments', stem);
      await fs.mkdir(attachmentDir, { recursive: true });

      for (const [index, attachment] of attachments.entries()) {
        const filename = safeFilename(attachment.filename, index, attachment.contentType);
        const relative = path.join(entry.folderSlug, 'attachments', stem, `${index}-${filename}`);
        await fs.writeFile(path.join(this.root, relative), attachment.content);
        saved.push({
          index,
          filename,
          contentType: attachment.contentType ?? 'application/octet-stream',
          size: attachment.size ?? attachment.content.length,
          file: toPosix(relative),
        });
      }
    }

    const record = { ...entry, file: toPosix(relativeSource), attachments: saved };
    this.messages.push(record);
    this.byId.set(record.id, record);
    if (record.messageId) this.messageIds.add(record.messageId);
    return record;
  }

  async save() {
    this.messages.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    await writeJson(this.indexPath, this.messages);
    await writeJson(this.statePath, this.state);
  }

  readSource(message) {
    return fs.readFile(path.join(this.root, message.file));
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`讀取 ${file} 失敗：${error.message}`);
  }
}

/** Write through a temp file so an interrupted run can't truncate the index. */
async function writeJson(file, data) {
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(data, null, 2)}\n`);
  await fs.rename(temp, file);
}

function safeFilename(filename, index, contentType) {
  const base = (filename ?? '').replace(/[\\/\0]/g, '_').trim();
  if (base && base !== '.' && base !== '..') return base.slice(0, 180);
  const extension = contentType?.split('/')[1]?.replace(/[^\w.-]/g, '') ?? 'bin';
  return `attachment-${index}.${extension}`;
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}
