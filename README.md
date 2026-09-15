# webmail

把 NTU webmail 的信件透過 IMAP 抓下來，存進一個**本機自建的收件匣**——
`.eml` 原始檔放在你自己的硬碟上，附件另外拆出來，附一個純本機的瀏覽介面。

抓下來之後就完全離線：讀信、搜尋都不需要再連線，也不會動到伺服器上的信件
（只讀不刪、不標記已讀）。

## 快速開始

```bash
npm install
cp .env.example .env     # 填入你的 NTU 帳號密碼

npm run folders          # 先看伺服器上的資料夾叫什麼名字
npm run sync             # 抓信進本機收件匣
npm run serve            # http://127.0.0.1:8025 開啟瀏覽介面
```

需要 Node.js 20 以上。

## 設定

全部設定都在 `.env`，說明寫在 `.env.example` 裡。最需要留意的是 `IMAP_HOST`，
因為台大的信箱有好幾種後端：

| 你的信箱 | `IMAP_HOST` |
| --- | --- |
| NTU Mail（`b12345678@ntu.edu.tw`） | `mail.ntu.edu.tw` |
| 系所自架信箱 | `mail.<系所>.ntu.edu.tw` |
| 掛在 Google Workspace 底下 | `imap.gmail.com`（密碼要用「應用程式密碼」） |

不確定的話，去 webmail 網頁介面的「設定 → 收信軟體 / IMAP」看一眼，
或直接跑 `npm run folders` 試連線——連不上時錯誤訊息會提示可能的原因。

兩件常見的卡關：部分系所信箱預設**關閉 IMAP**，要先到 webmail 設定頁開啟；
部分服務**限制校外連線**，人在校外要先連 NTU VPN。

## 指令

| 指令 | 作用 |
| --- | --- |
| `npm run folders` | 列出伺服器上所有資料夾，挑要同步的填進 `SYNC_FOLDERS` |
| `npm run sync` | 增量抓取新信件 |
| `npm run list` | 在終端機列出本機收件匣最新 50 封 |
| `npm run serve` | 開啟本機瀏覽介面（列表、讀信、搜尋、下載附件） |
| `npm test` | 跑測試 |

## 本機收件匣長什麼樣

```
data/mailbox/
  index.json                          所有信件的 metadata
  state.json                          每個資料夾的同步進度
  INBOX/
    messages/00000042.eml             原封不動的 RFC822 原始檔
    attachments/00000042/0-講義.pdf
```

`.eml` 是標準格式，Thunderbird、Apple Mail 之類的軟體都能直接開，
所以就算哪天不用這個工具了，信還是你的。

## 增量同步怎麼運作

每個資料夾記住兩個值：`uidValidity` 和 `lastUid`。下次同步只抓 UID 比
`lastUid` 大的信，不會重複下載。如果伺服器的 `uidValidity` 變了
（代表 UID 被重編號），就自動整個重抓一次，並用 `Message-ID` 過濾掉已經有的信。

中途 Ctrl+C 也沒關係——index 是先寫暫存檔再 rename，不會寫壞。

## 安全性

- `.env` 和 `data/` 都在 `.gitignore` 裡，密碼和信件不會被 commit 進去
- 瀏覽介面預設只綁 `127.0.0.1`，不對外開放
- 信件的 HTML 內容在 `sandbox` iframe 裡算圖，不會執行 script 或載入追蹤像素

## 還沒做的

寄信、標記已讀、刪除——目前是純唯讀的擷取工具。
