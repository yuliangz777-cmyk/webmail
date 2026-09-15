// Sample mail for the public demo. Nothing here is real; the addresses point at
// ntu.edu.tw only so the interface is shown with the content it was built for.
window.DEMO_MAIL = [
  {
    id: 'INBOX:318',
    folder: 'INBOX',
    uid: 318,
    date: '2025-09-12T01:20:00.000Z',
    subject: '[教務處] 114-1 加退選作業即將截止',
    from: { name: '教務處課務組', address: 'curriculum@ntu.edu.tw' },
    to: [{ name: null, address: 'b12901234@ntu.edu.tw' }],
    seen: false,
    snippet: '加退選將於 9/19 (五) 23:59 關閉，逾期系統不再開放，請務必確認課表。',
    attachments: [
      { index: 0, filename: '114-1加退選時程.pdf', contentType: 'application/pdf', size: 184320 },
    ],
    html: null,
    text: `同學好：

114-1 學期加退選作業將於 9/19 (五) 23:59 關閉，逾期系統不再開放。

請於期限前確認：
  1. 必修課程是否全數選上
  2. 總學分是否符合 9～25 學分的規定
  3. 有衝堂的課程是否已處理

加退選結果將於 9/22 (一) 公告於課程網。

教務處課務組 敬上`,
  },
  {
    id: 'INBOX:317',
    folder: 'INBOX',
    uid: 317,
    date: '2025-09-11T06:45:00.000Z',
    subject: '[資工系] 專題演講：大型語言模型的推理能力與極限',
    from: { name: '資訊工程學系', address: 'csie@ntu.edu.tw' },
    to: [{ name: null, address: 'b12901234@ntu.edu.tw' }],
    seen: false,
    snippet: '時間：9/18 (四) 14:20–16:10　地點：德田館 103　講者：陳彥宏 教授',
    attachments: [],
    html: `<div style="font-family:sans-serif;line-height:1.7;color:#222">
      <h2 style="margin:0 0 4px">大型語言模型的推理能力與極限</h2>
      <p style="margin:0 0 16px;color:#666">資訊工程學系 專題演講系列</p>
      <table style="border-collapse:collapse">
        <tr><td style="padding:4px 16px 4px 0;color:#666">時間</td><td>9/18 (四) 14:20–16:10</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#666">地點</td><td>德田館 103</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#666">講者</td><td>陳彥宏 教授</td></tr>
      </table>
      <p>本次演講將討論目前大型語言模型在多步推理任務上的表現，
      以及 chain-of-thought 在哪些情況下會失效。歡迎全校師生參加，無需報名。</p>
    </div>`,
    text: '時間：9/18 (四) 14:20–16:10　地點：德田館 103　講者：陳彥宏 教授',
  },
  {
    id: 'INBOX:316',
    folder: 'INBOX',
    uid: 316,
    date: '2025-09-10T09:05:00.000Z',
    subject: '圖書館借閱到期通知',
    from: { name: '臺大圖書館', address: 'tulib@ntu.edu.tw' },
    to: [{ name: null, address: 'b12901234@ntu.edu.tw' }],
    seen: true,
    snippet: '您借閱的 2 冊圖書將於 9/20 到期，可於個人借閱紀錄辦理續借。',
    attachments: [],
    html: null,
    text: `您借閱的下列圖書即將到期：

  《計算機程式設計》            應還日期 2025/09/20
  《線性代數及其應用》          應還日期 2025/09/20

可於「個人借閱紀錄」線上續借一次。逾期每冊每日收取滯還金 5 元。

臺大圖書館 流通組`,
  },
  {
    id: 'INBOX:314',
    folder: 'INBOX',
    uid: 314,
    date: '2025-09-08T02:10:00.000Z',
    subject: '[計中] 校外連線 VPN 服務維護公告',
    from: { name: '計算機及資訊網路中心', address: 'cc@ntu.edu.tw' },
    to: [{ name: null, address: 'b12901234@ntu.edu.tw' }],
    seen: true,
    snippet: '9/14 (日) 02:00–06:00 進行 VPN 主機韌體更新，期間校外連線服務將中斷。',
    attachments: [],
    html: null,
    text: `9/14 (日) 02:00–06:00 將進行 VPN 主機韌體更新。

維護期間下列服務將無法從校外存取：
  · SSL VPN
  · 圖書館電子資源
  · 部分系所信箱的 IMAP／SMTP 連線

校內網路不受影響。造成不便敬請見諒。

計算機及資訊網路中心`,
  },
  {
    id: '課程.機器學習:52',
    folder: '課程/機器學習',
    uid: 52,
    date: '2025-09-09T13:30:00.000Z',
    subject: 'HW1 作業說明與繳交方式',
    from: { name: '機器學習 教學團隊', address: 'ml-ta@csie.ntu.edu.tw' },
    to: [{ name: null, address: 'b12901234@ntu.edu.tw' }],
    seen: true,
    snippet: 'HW1 已上線，截止時間 9/26 (五) 23:59，請透過 Gradescope 繳交。',
    attachments: [
      { index: 0, filename: 'hw1_spec.pdf', contentType: 'application/pdf', size: 402944 },
      { index: 1, filename: 'hw1_data.zip', contentType: 'application/zip', size: 8912896 },
    ],
    html: null,
    text: `各位同學好：

HW1 已上線，截止時間 9/26 (五) 23:59。

繳交方式：Gradescope（課程代碼見 NTU COOL 公告）
遲交規則：每遲交 24 小時扣總分 20%，超過 72 小時不予計分

附件為作業說明與資料集。有問題請至 NTU COOL 討論區發問，
或於 office hour（週三 15:00–17:00，德田館 501）詢問。

教學團隊`,
  },
  {
    id: '課程.機器學習:51',
    folder: '課程/機器學習',
    uid: 51,
    date: '2025-09-05T08:00:00.000Z',
    subject: '第一週課程投影片與加簽說明',
    from: { name: '機器學習 教學團隊', address: 'ml-ta@csie.ntu.edu.tw' },
    to: [{ name: null, address: 'b12901234@ntu.edu.tw' }],
    seen: true,
    snippet: '投影片已上傳 NTU COOL。加簽名單將於 9/15 公告，請勿重複來信詢問。',
    attachments: [],
    html: null,
    text: `投影片已上傳至 NTU COOL。

關於加簽：本學期共收到 187 份加簽申請，名額 40 名。
名單將於 9/15 (一) 中午公告於課程網與 NTU COOL，請勿個別來信詢問順位。

教學團隊`,
  },
];

// Arrives when you press 收信, so the demo shows what fetching new mail does.
window.DEMO_INCOMING = {
  id: 'INBOX:319',
  folder: 'INBOX',
  uid: 319,
  date: new Date().toISOString(),
  subject: '[學務處] 宿舍網路報修系統更新',
  from: { name: '學生事務處住宿服務組', address: 'housing@ntu.edu.tw' },
  to: [{ name: null, address: 'b12901234@ntu.edu.tw' }],
  seen: false,
  snippet: '報修系統已改版，請改用新網址提交申請，舊系統將於月底關閉。',
  attachments: [],
  html: null,
  text: `宿舍網路報修系統已於今日改版。

舊系統將於 9/30 關閉，屆時未處理完畢的案件會自動轉移至新系統，
不需要重新提交。

學生事務處住宿服務組`,
};
