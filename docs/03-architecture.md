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

- **D2 会话映射 → 话题/线程 ↔ session（确定性前缀 + persistence 事实源）。**
  群内每个话题 = 一个独立 session；私聊各一个 session；`/new` 显式开新；`/resume <id>` 恢复。
  `originKey` 三支路：p2p → `p2p:<chatId>`；群话题 → `group:<chatId>:thread:<thread_id>`；
  群非话题 → 拒绝并提示进话题。SHA-256 前 24 位 hex 为 session 前缀
  （`feishu-<24hex>-<base36 ts>`）；`sessionPersistence` 为唯一事实源
  （不建显式映射表，避免双事实源漂移），每次操作 fresh `list()` 并过滤 GUI 归档；
  `/resume` 绑定仅进程内有效、重启回落前缀最新；状态文件仅存轻量元数据
  （含 `/new` pending 标记），owner-only + 原子写。

- **D3 审批 → 进程内 `approval/request` 服务。**
  answerer 以 `{ prepend: true }` 注册（cordis.patch.yml 无排序能力），按**回合归属**认领：
  飞书发起的回合才认领、其余 next() 放行（GUI 对飞书会话发言的审批仍回 GUI）。
  卡片按钮（批准/拒绝）回调 respond；终态显式 `updateCard`（SDK 丢弃 handler 返回值）；
  文字兜底 `/approve` `/reject` 为必需路径；按钮只授权**当前一次**操作。

- **D4 事件 → 消息 → 监听 `session/event`，按回合聚合。**
  约 1 秒批量更新一张卡片（节流 + 全局出站调度器）；完整 message 到达替换 chunk 缓冲
  （去重）；卡片体积预算超限截断/折叠/新卡，全文落工作区文件并回显 session id
  （手机打不开 loopback Web UI）；输出脱敏。

- **D5 安全 → 白名单 fail-closed + 不绕过护栏。**
  IM 消息以普通用户输入注入会话（受部署审批策略约束）；空白名单拒绝一切；
  群聊 P0 每条消息需 @机器人，且群范围 fail-closed（`allowedChatIds` 空 = 群聊全拒——
  @ 是投递条件不是授权条件）；卡片 pending 记录绑定操作者/会话/截止时间；
  凭据写本地私密文件（唯一来源 `.credentials.yaml`）；入站附件净化。

- **D6 配置 → 首版 cordis.patch.yml（仅做配置覆盖）；P1 加 Web GUI 设置卡片（借 im-hub 的 client 注入）。**

- **D7 出站调度 → 应用级全局调度器。** 全局并发上限 + 卡片更新合并 + 429/误分类限流码
  （400+99991400、230020）aware backoff + 抖动 + 终态优先；patch 永久失败改发新卡。

- **D8 交互所有权 → 按回合路由。** preset 挂载按三条契约（`meta.agentPreset` +（rc.6 核实，rc.7 下经 103 测试复验）
  setup 内 mount + `resolveSessionPreset({header, events})` 恢复）；飞书会话 restrict 屏蔽
  `ask_user_question`/`exit_plan_mode`（防提问打进无超时的浏览器通道导致远端挂起）。

## 借鉴清单

| 来源 | 借走 | 丢弃 |
| --- | --- | --- |
| dsh-im-hub | web profile 插件形态、Web GUI 设置卡片（dsh-settings + client 注入）、mock 适配器、手写 protobuf 帧层（备选通道方案） | 无审批、无话题级会话的简陋功能集 |
| dsh-lark-bridge | 审批卡片闭环、话题↔session 映射、消息节流与脱敏、安全模型、命令集、官方 SDK 通道包装（LarkChannelLike） | 独立 profile 架构、多项目绑定、多人配对体系、CLI 向导 |

## 风险

- dsh rc 期内部服务接口变动 → 锁 rc.7（曾锁 rc.6；rc.6→rc.7 曾破坏前端 slot 契约，见 docs/11），升级自适配。
- 飞书限流 / 卡片长度限制 → 节流 + 全局调度器 + 体积预算 + 分片 + 全文落工作区文件回显 session id。
- 飞书开放平台权限配置繁琐 → 一次性成本，写文档固化步骤。
- 合规：MIT 协议，保留两个参考项目的版权声明。

## 可验证的里程碑

Phase 1 验收 = 人在外面，用飞书指挥 Mac 完成一次**需要审批**的真实任务，该会话同步出现在 Web GUI 会话列表。
