const listEl = document.getElementById('messages');
const readerEl = document.getElementById('reader');
const searchEl = document.getElementById('search');
const folderEl = document.getElementById('folder');
const countEl = document.getElementById('count');
const syncEl = document.getElementById('sync');
const notifyEl = document.getElementById('notify');
const bannerEl = document.getElementById('banner');

let selectedId = null;
let debounce;

searchEl.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(refresh, 180);
});
folderEl.addEventListener('change', refresh);
syncEl.addEventListener('click', sync);
const OFFLINE_NOTE = '離線中 —— 顯示的是上次抓下來的信。';
addEventListener('online', () => banner(null));
addEventListener('offline', () => banner(OFFLINE_NOTE, 'warn'));

await refresh();
// A cold start while offline fires no 'offline' event, so check directly.
if (!navigator.onLine) banner(OFFLINE_NOTE, 'warn');
await setUpNotifications();

/** Ask the machine running the server to fetch new mail from NTU. */
async function sync() {
  syncEl.disabled = true;
  syncEl.textContent = '收信中…';
  banner(null);

  try {
    const result = await fetchJson('/api/sync', { method: 'POST' });
    banner(result.saved ? `收到 ${result.saved} 封新信。` : '沒有新信。', 'ok');
    await refresh();
  } catch (error) {
    banner(
      navigator.onLine
        ? `收信失敗：${error.message}`
        : '連不上跑著 webmail 的那台電腦，可能已關機或離開 Tailscale。',
      'warn',
    );
  } finally {
    syncEl.disabled = false;
    syncEl.textContent = '收信';
  }
}

function banner(message, tone) {
  bannerEl.hidden = !message;
  bannerEl.textContent = message ?? '';
  bannerEl.className = tone ?? '';
}

async function refresh() {
  const params = new URLSearchParams();
  if (searchEl.value.trim()) params.set('q', searchEl.value.trim());
  if (folderEl.value) params.set('folder', folderEl.value);

  let data;
  try {
    data = await fetchJson(`/api/messages?${params}`);
  } catch {
    banner('連不上伺服器，顯示的是快取內容。', 'warn');
    return;
  }
  syncFolderOptions(data.folders);
  countEl.textContent = `${data.total} 封`;
  render(data.messages);
}

function syncFolderOptions(folders) {
  const current = folderEl.value;
  if (folderEl.dataset.loaded === folders.join('|')) return;

  folderEl.dataset.loaded = folders.join('|');
  folderEl.replaceChildren(new Option('全部資料夾', ''));
  for (const folder of folders) folderEl.append(new Option(folder, folder));
  folderEl.value = current;
}

function render(messages) {
  if (!messages.length) {
    listEl.replaceChildren(Object.assign(document.createElement('li'), {
      className: 'empty',
      textContent: '沒有符合的信件。還沒同步過的話，先在終端機跑 npm run sync。',
    }));
    return;
  }

  listEl.replaceChildren(...messages.map((message) => {
    const li = document.createElement('li');
    li.dataset.id = message.id;
    li.tabIndex = 0;
    if (!message.seen) li.classList.add('unread');
    if (message.id === selectedId) li.setAttribute('aria-current', 'true');

    li.append(
      row(
        text('span', 'from', message.from?.name || message.from?.address || '未知寄件者'),
        text('span', 'when', formatDate(message.date)),
      ),
      text('div', 'subject', message.subject + (message.attachmentCount ? ' 📎' : '')),
      text('div', 'snippet', message.snippet || ''),
    );

    li.addEventListener('click', () => open(message.id));
    li.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open(message.id);
      }
    });
    return li;
  }));
}

async function open(id) {
  selectedId = id;
  for (const li of listEl.children) {
    li.toggleAttribute('aria-current', li.dataset.id === id);
    if (li.dataset.id === id) li.setAttribute('aria-current', 'true');
  }

  readerEl.replaceChildren(text('p', 'empty', '載入中…'));
  const message = await fetchJson(`/api/messages/${encodeURIComponent(id)}`);

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.append(
    text('div', '', `寄件者：${describe(message.from)}`),
    text('div', '', `收件者：${message.to.map(describe).join(', ') || '—'}`),
    text('div', '', `${new Date(message.date).toLocaleString()} · ${message.folder} · UID ${message.uid}`),
  );

  const body = document.createElement('div');
  body.className = 'body';
  if (message.html) {
    // Remote HTML is rendered in a sandboxed frame so it cannot run scripts or
    // phone home with tracking pixels.
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', '');
    frame.srcdoc = message.html;
    body.append(frame);
  } else {
    body.append(text('pre', '', message.text || '（這封信沒有文字內容）'));
  }

  readerEl.replaceChildren(text('h2', '', message.subject), meta, body);

  if (message.attachments.length) {
    const box = document.createElement('div');
    box.className = 'attachments';
    box.append(text('strong', '', `附件（${message.attachments.length}）`), document.createElement('br'));
    for (const attachment of message.attachments) {
      const link = document.createElement('a');
      link.href = `/api/attachments/${encodeURIComponent(id)}/${attachment.index}`;
      link.textContent = `${attachment.filename} · ${formatSize(attachment.size)}`;
      box.append(link);
    }
    readerEl.append(box);
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? response.statusText);
  return data;
}

function row(...children) {
  const div = document.createElement('div');
  div.className = 'row';
  div.append(...children);
  return div;
}

function text(tag, className, content) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = content;
  return el;
}

function describe(address) {
  if (!address) return '未知';
  return address.name ? `${address.name} <${address.address}>` : address.address;
}

function formatDate(iso) {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

/* ── notifications ───────────────────────────────────────────────────────── */

/**
 * Show the opt-in button only where a subscription can actually be made. On iOS
 * that means the app has been added to the home screen; in a plain tab the
 * PushManager is missing, and offering a button that cannot work is worse than
 * offering nothing.
 */
async function setUpNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;

  const registration = await navigator.serviceWorker.ready.catch(() => null);
  if (!registration) return;

  if (await registration.pushManager.getSubscription()) {
    notifyEl.hidden = false;
    notifyEl.textContent = '通知已開啟';
    notifyEl.disabled = true;
    return;
  }
  if (Notification.permission === 'denied') return;

  notifyEl.hidden = false;
  notifyEl.addEventListener('click', () => subscribe(registration));
}

async function subscribe(registration) {
  notifyEl.disabled = true;

  try {
    if ((await Notification.requestPermission()) !== 'granted') {
      banner('通知權限被拒絕了。要改的話到系統設定裡找這個 App。', 'warn');
      notifyEl.hidden = true;
      return;
    }

    const { key } = await fetchJson('/api/push/key');

    // subscribe() reaches out to the browser vendor's push service and can hang
    // indefinitely when that is unreachable, which would leave the button dead
    // with nothing said. Fail loudly instead.
    const subscription = await withTimeout(
      registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(key),
      }),
      20000,
      '連不上瀏覽器的推播服務，請檢查網路後再試一次。',
    );

    await fetchJson('/api/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(subscription),
    });

    notifyEl.textContent = '通知已開啟';
    banner('有新信時會通知你。', 'ok');
  } catch (error) {
    notifyEl.disabled = false;
    banner(`開啟通知失敗：${error.message}`, 'warn');
  }
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

/** applicationServerKey wants raw bytes, and the VAPID key is base64url text. */
function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
