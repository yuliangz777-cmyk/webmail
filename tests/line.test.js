import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessage, isConfigured, notifyNewMail } from '../src/line.js';

const config = (overrides = {}) => ({
  line: { token: 'test-token', to: 'Uabc123', includeSnippet: false, openUrl: null, ...overrides },
});

const mail = (subject, name, date = '2025-09-12T01:00:00.000Z') => ({
  date,
  subject,
  from: { name, address: `${name}@ntu.edu.tw` },
  snippet: `${subject} 的內文摘要`,
});

function capture(status = 200) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return new Response(status === 200 ? '{}' : 'error body', { status });
  };
  return { calls, fetchImpl };
}

test('isConfigured needs both a token and a recipient', () => {
  assert.equal(isConfigured(config()), true);
  assert.equal(isConfigured(config({ token: '' })), false);
  assert.equal(isConfigured(config({ to: '' })), false);
  assert.equal(isConfigured({}), false);
});

test('a batch of new mail becomes exactly one push', async () => {
  const { calls, fetchImpl } = capture();
  const records = Array.from({ length: 24 }, (_, i) => mail(`第 ${i} 封`, `sender${i}`));

  const result = await notifyNewMail(config(), records, { fetchImpl });

  assert.equal(calls.length, 1, 'LINE 是按則計費的，一次同步只能推一則');
  assert.equal(result.count, 24);
  assert.equal(calls[0].body.messages.length, 1);
  assert.equal(calls[0].body.to, 'Uabc123');
  assert.match(calls[0].options.headers.authorization, /^Bearer test-token$/);
});

test('nothing is pushed when no mail arrived or LINE is unconfigured', async () => {
  const { calls, fetchImpl } = capture();

  await notifyNewMail(config(), [], { fetchImpl });
  await notifyNewMail(config({ token: '' }), [mail('x', 'y')], { fetchImpl });

  assert.equal(calls.length, 0);
});

test('the card lists the newest mail first and counts the overflow', () => {
  const records = [
    mail('最舊', '甲', '2025-09-01T00:00:00.000Z'),
    mail('最新', '乙', '2025-09-20T00:00:00.000Z'),
    ...Array.from({ length: 12 }, (_, i) => mail(`中間 ${i}`, `丙${i}`, '2025-09-10T00:00:00.000Z')),
  ];

  const message = buildMessage(config(), records);
  const rows = message.contents.body.contents;
  const footer = JSON.stringify(message.contents.footer);

  assert.equal(rows.length, 10, '超過上限的信不塞進卡片');
  assert.match(JSON.stringify(rows[0]), /最新/);
  assert.match(footer, /另有 4 封未列出/);
  assert.match(message.contents.header.contents[0].text, /^14 封新信$/);
});

test('the body of a message stays out of LINE unless explicitly enabled', () => {
  const records = [mail('主旨', '寄件者')];

  const quiet = JSON.stringify(buildMessage(config(), records));
  assert.match(quiet, /主旨/);
  assert.doesNotMatch(quiet, /內文摘要/, '預設不能把內文送出去');

  const verbose = JSON.stringify(buildMessage(config({ includeSnippet: true }), records));
  assert.match(verbose, /內文摘要/);
});

test('the lock-screen preview names the senders', () => {
  const message = buildMessage(config(), [mail('a', '教務處'), mail('b', '圖書館')]);

  assert.match(message.altText, /2 封新信/);
  assert.match(message.altText, /教務處/);
  assert.match(message.altText, /圖書館/);
  assert.ok(message.altText.length <= 180, 'altText 有長度上限');
});

test('an open-inbox button appears only when a URL is configured', () => {
  assert.equal(buildMessage(config(), [mail('a', 'b')]).contents.footer, undefined);

  const withUrl = buildMessage(config({ openUrl: 'https://mac.tailnet.ts.net/' }), [mail('a', 'b')]);
  assert.match(JSON.stringify(withUrl.contents.footer), /mac\.tailnet\.ts\.net/);
});

test('mail with no subject or sender still produces a valid card', () => {
  const message = buildMessage(config(), [{ date: '2025-09-12T01:00:00.000Z', subject: '', from: null }]);

  // LINE rejects a text component whose text is empty.
  for (const text of JSON.stringify(message).matchAll(/"type":"text","text":"([^"]*)"/g)) {
    assert.notEqual(text[1], '', '卡片裡不能有空字串');
  }
  assert.match(JSON.stringify(message), /無主旨/);
});

test('LINE errors are reported in terms of what to fix', async () => {
  for (const [status, expected] of [
    [401, /TOKEN 不正確/],
    [429, /額度上限/],
    [400, /user ID/],
    [500, /HTTP 500/],
  ]) {
    const { fetchImpl } = capture(status);
    await assert.rejects(() => notifyNewMail(config(), [mail('a', 'b')], { fetchImpl }), expected);
  }
});

test('only the header, which sets its own background, hardcodes text colors', () => {
  const message = buildMessage(config({ includeSnippet: true }), [mail('主旨', '寄件者')]);
  const { header, ...rest } = message.contents;

  // LINE recolors the bubble for the viewer's theme, so a fixed near-black or
  // near-white outside the header would disappear in one of the two.
  for (const [, color] of JSON.stringify(rest).matchAll(/"color":"(#[0-9A-Fa-f]{6})"/g)) {
    assert.equal(color, '#9A9A9A', `${color} 在 LINE 深色模式下會看不見`);
  }
  assert.equal(header.contents[0].color, '#FFFFFF');
});
