# webmail

把 NTU webmail 的信件透過 IMAP 抓下來，存進一個**本機自建的收件匣**——
`.eml` 原始檔放在你自己的硬碟上，附件另外拆出來，附一個可以裝到手機主畫面的
瀏覽介面。

抓下來之後就完全離線：讀信、搜尋都不需要再連線，也不會動到伺服器上的信件
（只讀不刪、不標記已讀）。

## 線上展示

介面的展示版（範例資料，沒有連到任何信箱）：
<https://yuliangz777-cmyk.github.io/webmail/>

本機預覽：`npm run demo`

> Pages 只跑得動展示版——真正的抓信需要一台跑 Node 的機器，靜態網站做不到。

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

## 裝到手機主畫面

瀏覽器不會講 IMAP，所以抓信這件事一定要有一台跑 Node 的機器。做法是：
**電腦上跑著 webmail，手機透過 Tailscale 連過去**，然後把網頁加到主畫面。
Tailscale 在你自己的裝置之間拉一個私有網路，不對外公開、不用開防火牆、
不用設密碼，而且你在校內、校外、用 4G 都連得到。

### 1. 兩台裝置都裝 Tailscale

<https://tailscale.com/download> ——電腦和手機都登入同一個帳號。
在 tailnet 後台開啟 **MagicDNS** 和 **HTTPS Certificates**（Settings → DNS）。

### 2. 電腦上讓 Tailscale 代理這個 app

```bash
npm run serve                       # 保持 HTTP_HOST=127.0.0.1
tailscale serve --bg 8025           # 另開一個終端機
tailscale serve status              # 印出你的網址
```

會得到一個像這樣的網址，只有你自己的裝置看得到：

```
https://你的電腦名稱.你的-tailnet.ts.net/
```

### 3. 手機加到主畫面

- **iPhone** — 用 **Safari** 開那個網址（Chrome 不行），底下「分享」→「加入主畫面」
- **Android** — Chrome 開，右上角選單 →「安裝應用程式」

裝好之後開起來沒有網址列，已經抓下來的信離線也能讀，右上角的「收信」按鈕
會叫電腦去 NTU 抓新信。

> **為什麼要用 `tailscale serve` 而不是直接連 IP？**
> Service worker（離線快取的關鍵）只在 HTTPS 或 localhost 底下才會啟動。
> `tailscale serve` 會給你一張真的憑證，所以是完整的 PWA。
> 你也可以設 `HTTP_HOST=tailscale` 直接綁 `100.x.x.x`，手機一樣連得到、
> 一樣能加到主畫面，只是沒有離線快取。

### 4.（選用）讓它自己跑

`deploy/` 裡有三個範本，路徑換成你自己的就能用：

| 檔案 | 用途 |
| --- | --- |
| `com.webmail.server.plist` | macOS launchd，登入後自動啟動 |
| `webmail.service` | Linux systemd，開機自動啟動 |
| `sync.cron` | 每 15 分鐘自動收信，手機打開就有新信 |

**電腦關機或睡著時手機就連不上**（已抓下來的信還是能離線讀，只是沒有新信）。
很在意的話就把這套丟到樹莓派或 NAS 上，一樣用 Tailscale 連。

## 指令

| 指令 | 作用 |
| --- | --- |
| `npm run folders` | 列出伺服器上所有資料夾，挑要同步的填進 `SYNC_FOLDERS` |
| `npm run sync` | 增量抓取新信件 |
| `npm run list` | 在終端機列出本機收件匣最新 50 封 |
| `npm run serve` | 開啟瀏覽介面（列表、讀信、搜尋、下載附件、手機按「收信」） |
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
- 走 Tailscale 時，信件只在你自己的裝置之間流動，不經過第三方伺服器
- 介面本身**沒有登入機制**，因為 tailnet 已經是私有網路了。
  如果你改用 `HTTP_HOST=0.0.0.0` 或 `tailscale funnel`（公開到整個網際網路），
  等於把信箱攤在網路上——別這樣做，除非你自己加上認證。
- 信件的 HTML 內容在 `sandbox` iframe 裡算圖，不會執行 script 或載入追蹤像素

## 圖示

`public/icons/` 是 `tools/make_icons.py` 產生的（純 Python，無相依套件）。
改了配色或圖形之後重跑一次就好：

```bash
python3 tools/make_icons.py
```

## 還沒做的

寄信、標記已讀、刪除——目前是純唯讀的擷取工具。
