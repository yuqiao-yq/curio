## TODO

### 功能

#### 引导
- [x] 首次进入引导提示（v0.22.x：5 步 Spotlight 主 Tour + L1.5 渐进式提示）
  - L1 主 Tour：侧栏 → 搜索框 → 设置 → 帮助 → ✨ AI FAB
  - L1.5 渐进式：用户首次创建分类 / 首次出现卡片时单独 mini-spotlight 教操作
  - 「批量导入」场景（增量 ≥ 2）静默标记 done，不打扰
- [x] 样式管理里功能点按tab切换划分模块

#### 搜索框
- [x] 搜索框支持直接跳转url
- [x] 搜索框支持搜索历史

#### 浏览器书签同步
> MVP 已支持「同步到浏览器书签（单向镜像，写入指定根文件夹）」，以下为后续可继续打磨的方向
- [x] 数据变更后自动触发同步（v0.22.x：设置里加 browserSyncAuto 开关；
      在 scheduleBookmarksSyncPush 同一汇聚点追加 scheduleBrowserSyncExport，
      复用所有 21 处书签数据变更入口；3s debounce 合并连续操作；
      失败静默 log 不弹 toast；与 storage.sync push 双 timer 互不干扰）
- [ ] 同步进度条 / 节点级别的详细日志（当前只有 toast 汇总）

### 样式
#### 书签卡片列表
- [x]精简模式下的搜索页面间距需要调整

### 用户体验
- [ ] 成就系统（成就统计页面、成就完成弹窗）

