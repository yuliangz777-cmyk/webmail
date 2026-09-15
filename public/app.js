const listEl = document.getElementById('messages');
const readerEl = document.getElementById('reader');
const searchEl = document.getElementById('search');
const folderEl = document.getElementById('folder');
const countEl = document.getElementById('count');

let selectedId = null;
let debounce;

searchEl.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(refresh, 180);
});
folderEl.addEventListener('change', refresh);

await refresh();

async function refresh() {
  const params = new URLSearchParams();
  if (searchEl.value.trim()) params.set('q', searchEl.value.trim());
  if (folderEl.value) params.set('folder', folderEl.value);

  const data = await fetchJson(`/api/messages?${params}`);
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

async function fetchJson(url) {
  const response = await fetch(url);
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
