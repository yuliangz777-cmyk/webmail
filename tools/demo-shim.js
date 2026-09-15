// The demo is the real interface with no server behind it: fetch is answered
// from an in-memory copy of the sample mail, using the same response shapes the
// Node server returns, so public/app.js runs unmodified.
(() => {
  const messages = [...window.DEMO_MAIL].sort((a, b) => a.date.localeCompare(b.date));
  let delivered = false;

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });

  const matches = (message, query) =>
    [message.subject, message.snippet, message.from?.name, message.from?.address, message.text]
      .some((value) => value?.toLowerCase().includes(query));

  window.fetch = async (input, options = {}) => {
    const url = new URL(input, location.href);
    const method = options.method ?? 'GET';

    // Let anything that is not the app's own API through untouched.
    if (!url.pathname.includes('/api/')) return Response.error();

    const route = url.pathname.slice(url.pathname.indexOf('/api/'));
    await new Promise((resolve) => setTimeout(resolve, 140)); // a plausible LAN round trip

    if (route === '/api/sync' && method === 'POST') {
      if (delivered) return json({ saved: 0, summary: [] });
      delivered = true;
      messages.push(window.DEMO_INCOMING);
      return json({ saved: 1, summary: [{ folder: 'INBOX', saved: 1, skipped: 0 }] });
    }

    if (route === '/api/messages') {
      const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
      const folder = url.searchParams.get('folder') ?? '';

      let hits = messages;
      if (folder) hits = hits.filter((message) => message.folder === folder);
      if (query) hits = hits.filter((message) => matches(message, query));

      return json({
        folders: [...new Set(messages.map((message) => message.folder))].sort(),
        state: {},
        total: hits.length,
        messages: hits
          .slice()
          .reverse()
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

    if (route.startsWith('/api/messages/')) {
      const id = decodeURIComponent(route.slice('/api/messages/'.length));
      const message = messages.find((entry) => entry.id === id);
      return message ? json(message) : json({ error: '找不到這封信' }, 404);
    }

    if (route.startsWith('/api/attachments/')) {
      return json({ error: '展示版沒有真的附件檔案。' }, 404);
    }

    return json({ error: 'not found' }, 404);
  };
})();
