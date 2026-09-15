#!/usr/bin/env node
import { loadConfig, requireImapCredentials } from './config.js';
import { connect, listFolders } from './imap.js';
import { syncFolders } from './sync.js';
import { Mailbox } from './store.js';
import { serve } from './server.js';
import { tailscaleAddress } from './network.js';
import { notify } from './server.js';
import { generateKeys, isConfigured as pushConfigured, loadSubscriptions } from './push.js';

const COMMANDS = {
  sync: cmdSync,
  folders: cmdFolders,
  list: cmdList,
  serve: cmdServe,
  'push:keys': cmdPushKeys,
  'notify:test': cmdNotifyTest,
  help: cmdHelp,
};

const [command = 'help'] = process.argv.slice(2);
const run = COMMANDS[command];

if (!run) {
  console.error(`未知的指令：${command}\n`);
  cmdHelp();
  process.exit(1);
}

try {
  await run(loadConfig());
} catch (error) {
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
}

async function cmdSync(config) {
  requireImapCredentials(config);
  console.log(`連線 ${config.imap.user} @ ${config.imap.host}:${config.imap.port} …`);

  const arrived = [];
  const { mailbox } = await syncFolders(config, {
    onEvent(event) {
      if (event.type === 'message') arrived.push(event.record);
      if (event.type === 'folder-open') {
        const from = event.cursor.reset ? '1（UIDVALIDITY 已變更，重新同步）' : event.cursor.startUid;
        console.log(`\n▸ ${event.folder}（伺服器共 ${event.total} 封）從 UID ${from} 開始`);
      }
      if (event.type === 'folder-missing') {
        console.log(`\n▸ ${event.folder}：伺服器上沒有這個資料夾，略過（用 npm run folders 查看正確名稱）`);
      }
      if (event.type === 'message') {
        const { date, from, subject } = event.record;
        console.log(`  + ${date.slice(0, 10)}  ${(from?.address ?? '未知').padEnd(32)}  ${subject}`);
      }
      if (event.type === 'folder-done') {
        console.log(`  ${event.folder}：新增 ${event.saved} 封，略過 ${event.skipped} 封`);
      }
    },
  });

  const saved = arrived.length;
  console.log(`\n✓ 完成：新增 ${saved} 封，本機收件匣共 ${mailbox.messages.length} 封`);
  console.log(`  位置：${config.mailboxDir}`);
  console.log('  用 `npm run serve` 開啟瀏覽介面');

  for (const result of await notify(config, arrived)) {
    if (result.error) continue; // notify() already reported it
    console.log(`  ${result.channel}：已送出`);
  }
}

function cmdPushKeys() {
  const { publicKey, privateKey } = generateKeys();

  console.log('把下面兩行貼進 .env：\n');
  console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
  console.log('\n私鑰不要 commit 進 git（.env 已經在 .gitignore 裡）。');
  console.log('換過金鑰之後，每台手機都要重新開啟一次通知。');
}

async function cmdNotifyTest(config) {
  const devices = pushConfigured(config) ? (await loadSubscriptions(config)).length : 0;

  const sample = [
    {
      id: 'test',
      date: new Date().toISOString(),
      subject: '[測試] webmail 通知設定成功',
      from: { name: '你的本機收件匣', address: 'webmail@localhost' },
      snippet: '看到這則就代表設定完成了。',
    },
  ];

  const results = await notify(config, sample);
  if (!results.length) {
    throw new Error(
      '還沒設定任何通知管道。\n' +
        'Web Push：跑 npm run push:keys，把金鑰貼進 .env，再到 App 裡按「開啟通知」。\n' +
        'LINE：見 .env.example 的「LINE 通知」段落。',
    );
  }

  for (const result of results) {
    if (result.error) continue;
    if (result.reason === 'no-subscriptions') {
      console.log(`⚠ ${result.channel}：金鑰設好了，但還沒有裝置訂閱。`);
      console.log('  用手機開啟加到主畫面的 App，按「開啟通知」。');
      continue;
    }
    console.log(`✓ ${result.channel}：已送出${devices ? `（${devices} 台裝置）` : ''}`);
  }
}

async function cmdFolders(config) {
  requireImapCredentials(config);
  const client = await connect(config);
  try {
    console.log('伺服器上的資料夾（把要同步的填進 .env 的 SYNC_FOLDERS）：\n');
    for (const folder of await listFolders(client)) {
      const tags = [folder.specialUse, folder.selectable ? null : '不可選取'].filter(Boolean);
      console.log(`  ${folder.path}${tags.length ? `  [${tags.join(' ')}]` : ''}`);
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

async function cmdList(config) {
  const mailbox = await new Mailbox(config.mailboxDir).open();
  if (!mailbox.messages.length) {
    console.log('本機收件匣還是空的，先跑 `npm run sync`。');
    return;
  }

  for (const message of mailbox.messages.slice(-50)) {
    const clip = message.attachments.length ? ` 📎${message.attachments.length}` : '';
    console.log(
      `${message.date.slice(0, 16).replace('T', ' ')}  ` +
        `${(message.from?.address ?? '未知').slice(0, 34).padEnd(34)}  ` +
        `${message.subject}${clip}`,
    );
  }
  console.log(`\n共 ${mailbox.messages.length} 封（顯示最新 50 封）`);
}

async function cmdServe(config) {
  const mailbox = await new Mailbox(config.mailboxDir).open();
  const server = await serve(config);
  const { address, port } = server.address();

  console.log(`本機收件匣：${config.mailboxDir}（${mailbox.messages.length} 封）`);
  console.log(`瀏覽介面：http://${address}:${port}`);

  if (address === '127.0.0.1') {
    const tailnet = tailscaleAddress();
    console.log(
      tailnet
        ? `\n手機要連的話，另開一個終端機跑：tailscale serve --bg ${port}\n` +
            '然後用 `tailscale serve status` 印出來的 https 網址加到主畫面。'
        : '\n只有這台電腦連得到。要讓手機也能用，請看 README 的「裝到手機主畫面」。',
    );
  }
  console.log('\n按 Ctrl+C 結束。');
}

function cmdHelp() {
  console.log(`
webmail — 把 NTU webmail 的信抓進本機自建的收件匣

  npm run folders   列出伺服器上所有資料夾（第一次用先跑這個）
  npm run sync      增量抓取新信件，存成 .eml + 附件
  npm run list      在終端機列出本機收件匣
  npm run serve     開啟本機瀏覽介面
  npm run push:keys   產生 Web Push 金鑰（第一次設定通知時跑）
  npm run notify:test 送一則測試通知，確認設定

設定寫在 .env（可從 .env.example 複製）。
`);
}
