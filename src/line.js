/**
 * Push new-mail notices to LINE.
 *
 * Push-only: this calls api.line.me outbound and never receives anything, so
 * there is no webhook and no public URL to expose. One push per sync run
 * regardless of how many messages arrived — LINE bills per push, and a message
 * per mail would burn a free-tier quota in days.
 */
const PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';

const MAX_ROWS = 10; // a bubble has a size limit; the rest are counted in a footer line
const SUBJECT_LIMIT = 90;
const SENDER_LIMIT = 40;

export function isConfigured(config) {
  return Boolean(config.line?.token && config.line?.to);
}

export async function notifyNewMail(config, records, { fetchImpl = fetch } = {}) {
  if (!records.length || !isConfigured(config)) return { pushed: false, reason: 'skipped' };

  const response = await fetchImpl(PUSH_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.line.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ to: config.line.to, messages: [buildMessage(config, records)] }),
  });

  if (response.ok) return { pushed: true, count: records.length };

  const body = await response.text().catch(() => '');
  throw new Error(describePushError(response.status, body));
}

export function buildMessage(config, records) {
  const newest = [...records].sort((a, b) => b.date.localeCompare(a.date));
  const shown = newest.slice(0, MAX_ROWS);
  const hidden = newest.length - shown.length;

  return {
    type: 'flex',
    altText: altText(newest),
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        backgroundColor: '#8A5A2B',
        contents: [
          { type: 'text', text: `${newest.length} 封新信`, color: '#FFFFFF', weight: 'bold', size: 'lg' },
          { type: 'text', text: stamp(), color: '#F0E3D4', size: 'xs', margin: 'xs' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '16px',
        contents: shown.map((record) => row(config, record)),
      },
      ...(hidden > 0 || config.line.openUrl
        ? {
            footer: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              paddingAll: '12px',
              contents: [
                ...(hidden > 0
                  ? [{ type: 'text', text: `另有 ${hidden} 封未列出`, size: 'xs', color: MUTED, align: 'center' }]
                  : []),
                ...(config.line.openUrl
                  ? [
                      {
                        type: 'button',
                        style: 'link',
                        height: 'sm',
                        action: { type: 'uri', label: '開啟收件匣', uri: config.line.openUrl },
                      },
                    ]
                  : []),
              ],
            },
          }
        : {}),
    },
  };
}

// Only the header sets its own background, so only its text can safely carry a
// fixed color. Everywhere else LINE recolors the bubble for the viewer's theme:
// the subject is left uncolored so it follows, and secondary text uses a grey
// that stays legible on both the light and dark bubble.
const MUTED = '#9A9A9A';

function row(config, record) {
  const contents = [
    {
      type: 'text',
      text: clip(sender(record), SENDER_LIMIT),
      size: 'xs',
      color: MUTED,
    },
    {
      type: 'text',
      text: clip(record.subject || '(無主旨)', SUBJECT_LIMIT),
      size: 'sm',
      weight: 'bold',
      wrap: true,
    },
  ];

  // Off by default: the body of a message would otherwise travel through LINE's
  // servers, which is exactly what keeping the mailbox local avoids.
  if (config.line.includeSnippet && record.snippet) {
    contents.push({
      type: 'text',
      text: clip(record.snippet, 120),
      size: 'xs',
      color: MUTED,
      wrap: true,
      margin: 'xs',
    });
  }

  return { type: 'box', layout: 'vertical', contents };
}

/** What shows on the lock screen, so it has to carry the gist by itself. */
function altText(records) {
  const names = [...new Set(records.map(sender))].slice(0, 3).join('、');
  return clip(`${records.length} 封新信：${names}`, 180);
}

function sender(record) {
  return record.from?.name || record.from?.address || '未知寄件者';
}

function clip(value, limit) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text || '—';
}

function stamp() {
  return new Date().toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function describePushError(status, body) {
  const detail = body ? ` — ${clip(body, 200)}` : '';

  if (status === 401) {
    return 'LINE 拒絕了憑證：LINE_CHANNEL_ACCESS_TOKEN 不正確或已過期。';
  }
  if (status === 403) {
    return 'LINE 拒絕了這次推播：請確認這個 channel 是 Messaging API 類型，且方案允許推播。';
  }
  if (status === 429) {
    return '已達 LINE 的訊息額度上限，這次沒有推播（信件已經抓下來了）。';
  }
  if (status === 400) {
    return `LINE 說請求有問題${detail}\n最常見的原因是 LINE_TO 不是有效的 user ID（要 U 開頭那一長串，不是你的 LINE ID）。`;
  }
  return `推播到 LINE 失敗（HTTP ${status}）${detail}`;
}
