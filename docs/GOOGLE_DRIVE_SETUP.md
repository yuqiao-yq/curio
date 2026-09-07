# Google Drive 同步配置与接入边界

更新：2026-09-07。已选择 Google Drive；当前交付配置入口与构建配置，尚未交付真实授权、自动上传或跨浏览器同步。现有浏览器账号同步仍使用 `storage.sync`。

## 开发者准备

1. 在你控制的 Google Cloud 项目中启用 Google Drive API。
2. 配置 Google Auth Platform 的品牌信息、受众与测试用户；仅申请 `https://www.googleapis.com/auth/drive.appdata`。
3. Chrome 首期使用 OAuth 客户端类型「Chrome 扩展程序」，填写 `chrome://extensions` 展示的 Curio 扩展 ID。发布前固定扩展 ID，开发包与商店包的 ID 可能不同。
4. 取得公开客户端 ID，格式为 `…apps.googleusercontent.com`。**扩展中不配置客户端密钥。**
5. 在 Curio「数据管理 → Google Drive 同步准备 → 开发者配置」粘贴客户端 ID，可复制构建命令：

   ```sh
   GOOGLE_DRIVE_CLIENT_ID=你的公开客户端ID pnpm build
   ```

   此时 Chrome manifest 会包含 `oauth2` 配置、appdata scope 和 `identity` 权限。没有该环境变量时不加入这些配置；Firefox 构建也不会注入 Chrome 专用客户端。重新加载扩展后入口会显示已配置，但仍不会发起数据上传。

## 后续实现必须满足

- Chrome 使用 `chrome.identity.getAuthToken`，由浏览器管理令牌；不把令牌写入书签导出、备份、日志或云同步。
- Firefox 没有完全相同的 Google 原生令牌机制，需要独立验证授权码 + PKCE 及回调部署方案。不能把 Chrome 客户端 ID 当作跨浏览器通用 Web 客户端使用，也不能把 Web 客户端密钥放进扩展。
- Google 当前不建议新应用直接实现隐式令牌流程；不因它容易实现而采用。
- 只使用 `appDataFolder`，不申请整个 Drive 的读写权限。
- 首次同步先读取与预览远端，再合并；空本地不得自动覆盖已有云端。
- 同步协议使用实体 ID、修订版本和删除标记；文件写入需要冲突检测，失败保留本地队列与备份。
- UI 必须区分未配置、未授权、待同步、失败及成功；上传请求成功不能表述为所有设备已同步。
- 测试须包含两台设备同时编辑、离线删除、令牌过期、撤销授权、网络失败与旧数据迁移。

## 真实联调清单

- [ ] 开发者提供公开客户端 ID 并完成 Google Cloud 配置。
- [ ] Chrome 授权和 appdata 文件读写通过。
- [ ] Firefox 授权与回调方案通过。
- [ ] 两端逐条合并、删除传播、断网重试与恢复通过。
- [ ] 更新 README / 隐私政策后才把功能标记可用。

## 官方资料

- [Drive 应用专用目录及权限](https://developers.google.com/workspace/drive/api/guides/appdata)
- [Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)
- [Google 客户端授权说明及隐式流程限制](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow)

应用专用目录隐藏于普通 Drive 文件列表，只能由对应应用访问，不能直接共享其中的文件。用户可在 Drive 中删除应用数据，因此它也不能替代独立备份。
