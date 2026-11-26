# Google Drive 同步：Chrome / Edge / Firefox

代码已实现跨浏览器授权、首次合并预览、后台同步和离线重试。**仓库不包含公共授权服务或 Google 凭据；请部署下述 Worker 并配置自己的 OAuth 客户端。** 已完成个人部署，Edge 连接已由使用者验证；Firefox 真实登录及完整跨浏览器同步场景仍需按文末清单验证。

## 1. 同步范围与行为

- 同步分类、书签（含标签、备注、自定义图标/缩略图）和样式偏好白名单。
- 不同步 AI 配置/API Key、浏览历史/最近使用、抓取正文、本机浏览器书签 ID、壁纸、侧栏宽度、自定义样式预设和本地备份。
- 本地优先。首次连接只读取云端并显示合并前后数量，确认后才上传、修改本地及开启自动同步。已有同 ID 条目按逻辑版本合并；不同 ID 的同 URL 书签不会擅自去重。
- 选择 Drive 会暂停浏览器账号的 `storage.sync`。原生书签镜像仍是独立的本机选项。要换回浏览器账号同步，先暂停 Drive。
- 后台在本地更改后约 1.5 秒同步，并每 2 分钟检查远端。浏览器关闭/断网时保留待上传版本；恢复运行/网络后重试。受浏览器休眠和后台调度影响，间隔不是实时保证。
- 每次应用远端变化前保存本地备份（最近 10 份）。同一条目的并发修改会确定一个结果，不逐字段拼接；需要恢复另一版本时可从「数据管理 → 本地备份」恢复。
- 单个完整同步快照上限 4 MiB（含删除标记）；本地仍受浏览器存储配额限制。大量 base64 缩略图建议改用图片 URL。超限或读到未知版本时停止同步，不覆盖数据。

## 2. 创建 Google OAuth 客户端

所有浏览器必须使用**同一个 Google Cloud 项目、同一个 Web 应用 OAuth 客户端、同一个授权服务地址**，以访问同一个 Drive 应用目录。

1. 在 [Google Cloud Console](https://console.cloud.google.com/) 创建或选择项目，启用 **Google Drive API**。
2. 配置 Google Auth Platform 的品牌、受众和数据访问。只添加范围 `https://www.googleapis.com/auth/drive.appdata`。
3. 如应用处于 Testing 状态，将你要登录的 Google 账号加入测试用户。Google 测试模式的离线凭据可能在 7 天后过期，届时需重新登录；长期使用按 Google 要求发布应用。
4. 创建 **Web application / Web 应用** OAuth 客户端（不是 Chrome 扩展程序类型）。
5. 添加一个授权重定向 URI：`https://你的-worker.workers.dev/oauth/callback`。自定义域名同理，必须与 Worker 的 `PUBLIC_ORIGIN` 完全对应。
6. 保存公开 Client ID。Client Secret 只放入 Worker Secret，不放进扩展、Git、聊天或前端环境变量。

Chrome / Edge / Firefox 的扩展回调地址配置在 **Worker 白名单**；Google 控制台只配置 Worker 回调。

## 3. 部署 Cloudflare Worker

Worker 不需要 KV、D1、R2 或其它数据库。授权状态、续期凭据使用 AES-256-GCM 加密封装；续期凭据封装只保存在当前浏览器的 `storage.local`。Worker 在请求时解密并向 Google 换取短期访问令牌，不接收书签文件。

在仓库根目录安装项目依赖（Node 22、pnpm 10），然后执行：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm build:firefox
```

分别在 Chrome、Edge 加载 `.output/chrome-mv3`，在 Firefox 调试页面加载 `.output/firefox-mv2/manifest.json`。打开「数据管理 → Google Drive → 部署与授权配置」，复制**每个浏览器显示的完整回调地址**。Chrome 和 Edge 的扩展 ID 可能不同，不要猜测；Firefox 构建已声明固定 Gecko ID。

编辑 `oauth-worker/wrangler.toml` 的非秘密配置：

```toml
[vars]
PUBLIC_ORIGIN = "https://curio-drive-oauth.YOUR-SUBDOMAIN.workers.dev"
GOOGLE_CLIENT_ID = "YOUR-CLIENT-ID.apps.googleusercontent.com"
ALLOWED_REDIRECT_URIS = "完整Chrome回调,完整Edge回调,完整Firefox回调"
```

白名单逐项精确匹配，逗号分隔，不支持通配符。包含 URI 末尾的 `/`；开发版和商店版扩展 ID 可能不同，发布后需补充白名单。不要把 Google 的 `/oauth/callback` 放入扩展回调白名单。

登录 Cloudflare 并设置 Secrets（命令会交互式读取，避免密钥进入 shell 历史）：

```sh
cd oauth-worker
npx wrangler@4 login
npx wrangler@4 secret put GOOGLE_CLIENT_SECRET
npx wrangler@4 secret put SESSION_ENCRYPTION_KEY
npx wrangler@4 deploy
```

`SESSION_ENCRYPTION_KEY` 使用 32 字节安全随机值的 base64url 编码，可在本机生成后粘贴到 Secret 输入提示：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Worker 名称首次部署时可能由 Wrangler 提示创建；也可以先 `deploy` 创建未配置完成的服务再设置 Secrets。密钥轮换会使旧登录失效，重新连接即可。不要开启记录请求 URL、请求体或 Authorization 头的自定义日志；OAuth 回调 URL 含短期授权码。仓库的 Worker Observability 默认关闭。

部署后访问 `https://你的-worker.workers.dev/health`，应返回 `{"ok":true,"service":"curio-drive-oauth","version":1}`。健康检查只证明服务配置存在；不验证 Client Secret 或 Google 重定向设置。

若当前网络无法访问 `workers.dev`，可在 Cloudflare 为 Worker 绑定已有域名下的独立子域名。将 `PUBLIC_ORIGIN`、Google 控制台中的 `/oauth/callback` 和扩展中的授权服务地址一并切换到该自定义域名，再验证 HTTPS 健康检查。个人部署配置可以放在已被 Git 忽略的 `.wrangler/deploy.toml` 中，并通过 `wrangler deploy --config .wrangler/deploy.toml` 部署，避免覆盖仓库中的配置模板。

## 4. 连接和使用

1. 在扩展的 Google Drive 卡片填写 Worker **HTTPS 根地址**，点击「连接 Google Drive」。只使用自己部署或信任的服务。
2. 同意访问授权服务与 Google Drive 的网站权限，在 Google 窗口中选择账号并授权。
3. 检查云端、本机和合并后的分类/书签数量，确认合并；成功后显示账号和上次同步时间。
4. 在另一浏览器使用同一 Worker 和 Google 账号重复操作，即可跨浏览器同步。

可在构建前通过 `.env.local` 设置默认地址（公开地址，无密钥）：

```dotenv
VITE_GOOGLE_DRIVE_AUTH_URL=https://你的-worker.workers.dev
```

「暂停同步」保留登录和待同步修改；恢复需再次预览。「断开连接」删除本机登录凭据，保留本地数据、版本及云端数据。重新连接同账号保留离线修改和删除标记。**切换 Google 账号时，本机现有数据会在预览确认后合并到新账号**；想保持两份独立书签库，请使用不同浏览器配置文件。

断开不会撤销其它设备的 Google 授权。要撤销整个应用的权限，在 [Google 账号连接管理](https://myaccount.google.com/connections) 中移除应用。云端文件位于不可直接浏览的应用专属目录；需要彻底删除时，先暂停所有设备，再使用 Google Drive 的「设置 → 管理应用 → 删除隐藏应用数据」。启用的设备仍持有本地数据，后续编辑可能再次上传。

## 5. 同步协议与恢复

- 每台设备使用独立随机 ID，上传不可变的完整版本文件。预生成文件 ID 和上传内容先写入本地，再发网络请求；超时重试使用同一个 ID，遇到 `409` 会核对已上传内容。
- 每条书签、分类及偏好都有逻辑时钟与设备 ID；合并独立条目，保留永久删除标记。并发同条目以逻辑计数器、设备 ID 确定结果。首次导入的旧条目以 `updatedAt` 和内容确定结果。
- 只读取各设备最新完整版本，分页全部读完才应用；任一最新版本读取失败、格式损坏或版本不支持都会停止。后续定时同步重新读取，不把错误当成空库。
- 每台设备清理自己旧快照，保留至少 3 份；不会删除其它设备文件。最新版本始终携带已经见过的删除标记，离线设备回来不会仅因时间久而复活旧书签。
- 上传中发生的本地编辑保留待同步状态。Web Locks 在本机多个新标签页、popup、后台间串行提交；本地数据和 Drive 版本信息一次写入。
- 并发删除父分类与修改子书签时，保留下来的书签移动到「同步恢复的书签」，避免变成不可见数据。并发移动造成的分类环会被打断。
- Drive 不是端到端加密保险库：书签 JSON 通过 HTTPS 传输，由 Google Drive 存储。授权服务虽不接收书签，但处理的令牌具备应用目录访问权，因此必须信任服务运营者。任何拥有浏览器配置文件访问权的人也可能读取本地凭据。

## 6. 验证与排障

开发检查：

```sh
pnpm compile
pnpm lint
pnpm test:ci
pnpm build:all
# 可选：仅打包检查 Worker，不部署
cd oauth-worker
npx wrangler@4 deploy --dry-run
```

每次部署后应使用测试账号在目标浏览器验证：首次授权/拒绝授权、两端新建/编辑/删除、离线后重连、令牌续期/撤销、切换账号、Worker 不可达及浏览器重启。自动化测试使用模拟 Google/Drive 服务；已验证的 Edge 连接不代表这些场景在全部浏览器中均已完成验证。

- `redirect_uri_mismatch`：检查 Google 的回调是 Worker `/oauth/callback`，且与 `PUBLIC_ORIGIN` 一致。
- `invalid_authorization_request`：扩展回调未完整加入 `ALLOWED_REDIRECT_URIS`；重新复制当前浏览器显示的地址。
- 登录后无法读取账号：检查 Google Drive API 是否启用、是否授予 appdata 权限、网络是否可访问 Google。
- 授权过期/撤销：点击「重新登录」，再预览恢复同步。Testing 模式、用户撤销和密钥轮换都可能使登录失效。
- 本地/云端数据已变化：点击「刷新预览」重新确认，旧预览不会直接覆盖新数据。
- 超额、磁盘写入/备份失败：保留本地数据并停止本次同步，解决空间问题后点击「立即同步」。

官方参考：[Google Web OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)、[Drive appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata)、[预生成 Drive 文件 ID](https://developers.google.com/workspace/drive/api/guides/create-file)、[跨浏览器授权窗口](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/identity/launchWebAuthFlow)、[Cloudflare Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)。
