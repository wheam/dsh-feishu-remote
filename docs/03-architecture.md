# 架构决策

## 总体结构

```
飞书 App ⇄ 飞书服务器 ⇄（官方长连接）插件[内嵌 dsh web 进程] ⇄ 与 Web GUI 同一批 sessions
                                            ↑
                    Mac 壳 App（deepseek-harness-mac-app）零改动
```

## 决策记录

- **D1 内嵌 vs 独立进程 → 内嵌。**
  理由：会话与 GUI 互通（= 控制当前服务，而不是另起 agent 农场）；模型/凭据配置只有一份；壳 App 零改动。
  代价：插件故障可能影响 web 进程 → 两条硬底线：(a) `apply()` 只做同步注册、**永不 reject**，
  channel 连接放后台 effect 自带重试（飞书连不上不得拖垮 profile 启动）；
  (b) 关键路径 try/catch + 每聊天串行队列兜底。残余风险：未捕获异步异常仍可能带崩进程，
  须在验收中覆盖崩溃恢复路径。

- **D2 路由映射 → 私聊/普通群/话题 ↔ Workspace ↔ session。**
  私聊各一个 session；普通群按 chatId 共用一个 session；话题群内每个话题 = 一个独立 session；`/new` 显式开新；`/resume <id>` 恢复。
  群类型由官方 `chat_mode`（`group` / `topic`）判定。`originKey`：p2p → `p2p:<chatId>`；
  普通群 → `group:<chatId>:chat`；群话题 → `group:<chatId>:thread:<thread_id>`；话题群中不属于
  任何话题的消息仍提示进话题。SHA-256 前 24 位 hex 为 session 前缀
  （`feishu-<24hex>-<base36 ts>`）。Workspace 来自 DSH Workspace Registry；状态文件只持久化
  `originKey → workspaceId` 这一层用户选择以及轻量元数据，Session 身份仍以
  `sessionPersistence` 为唯一事实源。首次未绑定时弹出选择/新建卡片，Registry 仅一个 Workspace
  时自动绑定；旧飞书会话按持久化 header.cwd 自动迁移。`/new` 保留 Workspace，`/workspace`
  切换 Workspace 时开启全新 Session；`/resume` 只接受当前 Workspace 内、同来源前缀的 Session。
  状态文件 owner-only + 原子写。

- **D3 审批 → 进程内 `approval/request` 服务。**
  answerer 以 `{ prepend: true }` 注册（cordis.patch.yml 无排序能力），按**回合归属**认领：
  飞书发起的回合才认领、其余 next() 放行（GUI 对飞书会话发言的审批仍回 GUI）。
  卡片按钮（批准/拒绝）回调 respond；终态显式 `updateCard`（SDK 丢弃 handler 返回值）；
  文字兜底 `/approve` `/reject` 为必需路径；按钮只授权**当前一次**操作。

- **D4 事件 → 消息 → 监听 `session/event`，按回合聚合。**
  约 1 秒批量更新一张卡片（节流 + 全局出站调度器）；完整 message 到达替换 chunk 缓冲
  （去重）；卡片体积预算超限截断/折叠/新卡，全文落工作区文件并回显 session id
  （手机打不开 loopback Web UI）；输出脱敏。

- **D5 边界 → 操作者开放 + 不绕过护栏。**
  IM 消息以普通用户输入注入会话（受部署审批策略约束）；不按用户 open_id 做白名单判断；
  群范围默认不限，非空 `allowedChatIds` 才收窄；每个话题首次由任意用户 @后持久化激活，
  首次 @ 回填前文，后续同话题免 @，其他话题静默；普通群则每一轮都必须 @，未 @消息只进入
  下一轮有界历史上下文。@ 是触发信号，不是用户授权；卡片 pending 仍绑定发起操作者、会话与截止时间，防止其他人接管正在进行的交互；
  凭据写本地私密文件（唯一来源 `.credentials.yaml`）；入站附件净化。

- **D6 配置 → 首版 cordis.patch.yml（仅做配置覆盖）；P1 加 Web GUI 设置卡片（借 im-hub 的 client 注入）。**

- **D7 出站调度 → 应用级全局调度器。** 全局并发上限 + 卡片更新合并 + 429/误分类限流码
  （400+99991400、230020）aware backoff + 抖动 + 终态优先；patch 永久失败改发新卡。

- **D8 交互所有权 → 按回合路由。** preset 挂载按三条契约（`meta.agentPreset` +（rc.6 核实，rc.7 下经 103 测试复验）
  setup 内 mount + `resolveSessionPreset({header, events})` 恢复）；飞书会话 restrict 屏蔽
  `ask_user_question`/`exit_plan_mode`（防提问打进无超时的浏览器通道导致远端挂起）。

- **D9 首次开通 → PersonalAgent Device Flow，一次扫码创建并绑定。** Web GUI 通过 Host
  调用官方 SDK `registerApp()`；浏览器只显示短期二维码，App Secret 只进入 DSH credential
  provider，操作者访问固定对所有人开放，不依赖扫码用户 open_id。首次创建用 `createOnly: true`，
  权限/事件/回调经 addons 在确认页明示；不采用聊天配对码、共享商店应用或云端消息中继。
  详细状态机、补偿式提交、权限降级与发布前置见 docs/16。

## 借鉴清单

| 来源 | 借走 | 丢弃 |
| --- | --- | --- |
| dsh-im-hub | web profile 插件形态、Web GUI 设置卡片（dsh-settings + client 注入）、mock 适配器、手写 protobuf 帧层（备选通道方案） | 无审批、无话题级会话的简陋功能集 |
| dsh-lark-bridge | 审批卡片闭环、话题↔session 映射、消息节流与脱敏、安全模型、命令集、官方 SDK 通道包装（LarkChannelLike） | 独立 profile 架构、上游项目/配对体系、CLI 向导 |

## 风险

- dsh rc 期内部服务接口变动 → 当前锁 `0.1.1-rc.2`（曾锁 rc.6/rc.7；rc.6→rc.7 曾破坏前端 slot 契约，见 docs/11），升级自适配。
- 飞书限流 / 卡片长度限制 → 节流 + 全局调度器 + 体积预算 + 分片 + 全文落工作区文件回显 session id。
- PersonalAgent addons 在不同租户/灰度下可能忽略增强权限 → 连接后探测实际授权，核心权限
  缺失则 fail-closed，历史/全群消息/reaction 缺失则明确降级；保留 docs/09 手工配置兜底。
- 合规：MIT 协议，保留两个参考项目的版权声明。

## 可验证的里程碑

Phase 1 验收 = 人在外面，用飞书指挥 Mac 完成一次**需要审批**的真实任务，该会话同步出现在 Web GUI 会话列表。
