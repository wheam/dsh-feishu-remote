# 实现方案独立 Review

结论：整体方向成立，但当前方案应判定为 **No-Go，需先补齐 P0 设计**。主要问题不是飞书长连接或 dsh 基础 API 不可用，而是 Web profile 的 agent preset 组合、两个交互 provider 的所有权、SDK 跨话题批处理，以及安全/断线语义尚未形成可实现的契约。

## 1. 事实核查

### F1 — [P0] `agents.create/resume` 可用，但方案遗漏了 Web profile 的 agent preset 组合

`agent.followup()`、`ctx.agents.create()`、`ctx.agents.resume()` 的接口断言成立：`followup` 会把每条消息排成独立回合，[Agent runtime 声明](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts:99)；`create/resume` 返回带 `dispose()` 的 owner handle，[AgentRegistry 声明](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent/lib/types/index.d.ts:280)。

但 [05 §2.1](<repo>/docs/05-implementation-plan.md:42) 仅使用 `agentDefaultModel`，没有处理 `agentPresets`。这在 Web profile 下是硬缺口：

- Web profile 明确禁用了全局 `bash/fs/skill` 等工具，要求每个 session 挂载 preset，[web profile patch](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml:276)。
- 默认 preset 是 `standard`，[preset 配置](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml:410)。
- apiproxy 在创建和恢复 session 时会 `resolve`、记录 `agentPreset` 并 `presets.mount(agentCtx, id)`，[composeAgent](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js:975)。
- 参考 lark-bridge 的 setup 只安装 `toolAskUser` 和 `lark_deliver`，[setupAgent](/tmp/dsh-refs/dsh-lark-bridge/src/bridge.ts:860)；方案还准备删除 `lark_deliver`。

因此照方案创建的飞书 agent 可能能聊天，却没有 Web 标准 preset 中的文件、Shell、技能等能力，无法完成“真实任务”。

可执行建议：把 `agentPresets` 加入依赖核验；创建时解析并记录默认 preset，恢复时严格挂载 session 已记录的 preset，复用 apiproxy 的 `composeAgent` 语义做集成测试。

---

### F2 — [P0] `approval/request` 是 waterfall，但“双方按所有权互不抢答”不成立

dsh 的确把 `approval/request` 定义为 waterfall：answerer 返回 outcome 即认领，只有调用 `next()` 才继续，[审批接口](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-user-approval/lib/types/index.d.ts:17)。

问题在于 [05 §3](<repo>/docs/05-implementation-plan.md:78) 对 apiproxy 的描述错误。apiproxy 并不先判断“是否为 GUI agent”；它检查 session 中尚未认领的 `approval/asked` 记录，找到后就创建 pending Promise 并终止 waterfall，[apiproxy answerer](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js:1165)。所以：

- apiproxy 先注册：会抢走飞书 agent 的审批。
- 飞书 answerer 先注册：可按 `agents` map 处理己方、`next()` 放行其他 agent。

注册顺序是正确性依赖，不是“理论无冲突、第一天实测一下”。

可执行建议：在 `cordis.patch.yml` 中明确飞书 answerer 必须稳定排在 `api-gateway` 前，并增加“飞书 agent + Web agent 同时审批”的双向隔离测试；若无法保证顺序，则必须引入单一 approval router。

---

### F3 — [P0] `userQuestions.registerProvider()` 在 Web profile 中不能直接使用

[05 §2.3](<repo>/docs/05-implementation-plan.md:56) 计划直接注册 provider，但该服务只允许一个 active provider，[接口声明](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-user-questions/lib/types/index.d.ts:36)；第二次注册会抛 `DUPLICATE_PROVIDER`，[实现](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-user-questions/lib/index.js:31)。

Web apiproxy 已经无条件注册全局 provider，[apiproxy provider](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js:1114)。参考 lark-bridge 遇到重复注册只会记录警告并放弃飞书提问能力，[参考实现](/tmp/dsh-refs/dsh-lark-bridge/src/bridge.ts:436)。

改变插件注册顺序也不能解决：若飞书先注册，反而可能令 apiproxy 初始化失败。

可执行建议：开工前完成一个 provider 复用/路由 spike。可选方案是让 Web 和飞书共享单一 multiplexer，或证明 agent-scoped `userQuestions` + agent-scoped ask-user tool 可以稳定覆盖全局 provider；未经验证不能把结构化提问列为可直接移植能力。

---

### F4 — [P0] SDK 的 chatQueue/批处理存在跨话题串线风险

官方 Channel 确实支持 WebSocket、消息归一化、去重、stale 检查、chatQueue、卡片动作和重连，[官方 Channel 文档](https://github.com/larksuite/node-sdk/blob/main/docs/channel.zh.md)。参考项目也确实启用了 24 小时去重、chatQueue 和 350ms 文本批处理，[通道配置](/tmp/dsh-refs/dsh-lark-bridge/src/bridge.ts:130)。

但精确到参考项目锁定的 SDK 1.73.0，其 bundled 实现存在两个与需求冲突的事实：

- `pushMessage()` 使用 `msg.chatId` 作为队列 key；
- `mergeBatch()` 合并同一 chat 的正文，却继承最后一条消息的 `rootId/threadId/messageId` 元数据。

可在打包源码的 `SafetyPipeline.pushMessage` 和 `mergeBatch` 查看，[SDK bundle](/tmp/dsh-refs/dsh-lark-bridge/lib/index.js:28)。

结果是：同一群两个话题在 350ms 内各发一条消息时，可能被合并后路由到最后一个话题，直接违反 P0“群内多话题互不干扰”。

可执行建议：首版关闭 SDK 文本 batch/chatQueue，自己实现以 `originKey = chatId + rootId` 为 key 的入站 FIFO；至少覆盖“同群两个话题同时发消息”和“同话题连续两条消息”的测试。

---

### F5 — [P0] “限流策略都在 SDK 侧”不成立

[05 §1.3](<repo>/docs/05-implementation-plan.md:34) 把限流列为采用 SDK 的理由，但 1.73.0 中：

- 普通发送只有有限次数的固定指数重试；
- `patchCard()` 直接调用 `im.v1.message.patch`，没有重试；
- 没有跨 session 的全局 token bucket；
- 方案中的 1Hz 是“每 session 1Hz”，N 个并行 session 仍可能产生 N 次/秒更新。

飞书官方要求按 API、应用、租户的频控处理 429，并依据 `x-ogw-ratelimit-reset` 等待后重试，[官方频控策略](https://open.feishu.cn/document/server-docs/api-call-guide/frequency-control?lang=zh-CN)。

可执行建议：增加应用级出站调度器，支持全局并发上限、卡片更新合并、429 reset-aware backoff、抖动和终态更新优先级；把验收标准从“绝无 429”改为“429 可恢复且终态最终送达”。

---

### F6 — [P1] session 事件名正确，但聚合边界需要补测试

`session/event` 事件存在且参数是 `(session, event)`，[Session 接口](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts:55)。方案列出的：

- `turn/start` / `turn/end`
- `assistant/chunk`
- `assistant/message`
- `tool/call`
- `tool/result`

均与 rc.6 一致，[事件声明](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/types/types.d.ts:223)。

需要注意原始 `turn/end.reason.kind` 是 `completed / aborted / blocked / error / max-tokens / interrupted`，而不是直接的 `cancelled`；参考项目做了二次映射。其 chunk/final 兜底算法在流缺片时也可能产生“部分 chunk + 完整 final”的重复文本，[聚合实现](/tmp/dsh-refs/dsh-lark-bridge/src/bridge.ts:985)。

可执行建议：明确输出状态映射表，并测试多 step、chunk 缺失、max-token、进程中断和重复事件。

---

### F7 — [P1] lark-bridge 没有持久化 `threadKey → sessionId`

[03 D2](<repo>/docs/03-architecture.md:17) 和 [05 §1.1](<repo>/docs/05-implementation-plan.md:19) 都把映射文件称为“参考 lark-bridge”，事实不符：

- 参考 state 只存 owners、群到 project 的绑定和配对状态，[BridgeState](/tmp/dsh-refs/dsh-lark-bridge/src/state.ts:14)。
- 话题 key 经过 SHA-256 形成确定性 session 前缀，[identity.ts](/tmp/dsh-refs/dsh-lark-bridge/src/identity.ts:7)。
- 重启后通过 `sessionPersistence.list()` 找该前缀的最新 session，[createSession](/tmp/dsh-refs/dsh-lark-bridge/src/bridge.ts:811)。

因此显式映射表是本项目新增设计，不是有现成实现背书。

可执行建议：优先沿用“确定性前缀 + session persistence 为事实源”；若必须保存显式映射，要定义 session 创建与映射写入之间的崩溃对账和孤儿 session 回收。

---

### F8 — [P1] 飞书开通清单不完整，且回调有 3 秒处理约束

[05 §5.6](<repo>/docs/05-implementation-plan.md:112) 笼统写 `im:message` 不够精确。最小文本闭环应明确：

- `im:message.p2p_msg:readonly`
- `im:message.group_at_msg:readonly`
- `im:message:send_as_bot`
- 事件 `im.message.receive_v1`
- 长连接回调 `card.action.trigger`

这也与参考项目清单一致，[README](/tmp/dsh-refs/dsh-lark-bridge/README.zh.md:67)，并得到飞书[权限列表](https://open.feishu.cn/document/server-docs/application-scope/scope-list?lang=zh-CN)及[官方卡片机器人教程](https://open.feishu.cn/document/develop-a-card-interactive-bot/introduction?lang=zh-CN)支持。

此外，长连接消息和卡片回调都要求约 3 秒内处理完成；官方 SDK 支持通过 `WSClient/EventDispatcher` 接收 `card.action.trigger`，[官方长连接说明](https://open.feishu.cn/document/server-side-sdk/nodejs-sdk/handling-callbacks)。

可执行建议：固定最小权限清单，并让回调只做鉴权、入队和快速确认，耗时的 state I/O、agent 创建和卡片更新异步执行。

---

### F9 — [P1/P2] 参考项目的几个次要归属描述需修正

- **[P1] secret 语义不准确。** `role('secret')` 的保证是“不跨 wire 下发浏览器”，[settings redaction](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-settings/lib/invariant.js:3)，不是“不落盘”。默认会保存到 owner-only、原子写的 `settings.yaml`，[settings-file](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-settings-file/README.zh.md:20)。  
  建议：文档改为“浏览器不可读、宿主进程可读、明文以 0600 本地保存”。

- **[P1] 参考 peerDependencies 并未精确锁定。** lark-bridge 使用 `^0.1.0-rc.6`，[package.json](/tmp/dsh-refs/dsh-lark-bridge/package.json:62)，与本项目“精确锁死”约束不同。  
  建议：本项目不要原样复制 range，直接使用 `0.1.0-rc.6`。

- **[P2] “两项目同款 create/resume”不准确。** im-hub 只调用 `agents.create()`，[im-hub create](/tmp/dsh-refs/dsh-im-hub/lib/bridge.js:209)，没有恢复逻辑；其入站 source 还是 `kind:'plugin'`，[runTurn](/tmp/dsh-refs/dsh-im-hub/lib/bridge.js:240)。  
  建议：改成“两个项目均使用 registry create；resume 和普通 user source 仅由 lark 方案提供”。

## 2. 风险与遗漏

### R1 — [P0] 白名单默认 fail-open 不适合远程执行器

需求和方案都定义“空白名单 = 全开放”，[01 P0.3](<repo>/docs/01-requirements.md:20)。这不是普通聊天机器人，而是能调用本机文件和 Shell 的远程执行入口；仅写一句“禁止上生产”无法形成安全边界。

可执行建议：默认 fail-closed；只有显式 `allowAllUsers: true` 且带明显启动警告时才开放。echo/mock 环境可以开启，真实 Web profile 不允许隐式开放。

---

### R2 — [P0] 删除群绑定后，群范围和 @ 语义未定义

方案拟删除群绑定并只保留 `allowedOpenIds`，[05 §1.1](<repo>/docs/05-implementation-plan.md:22)。这样虽然只有 owner 能驱动 agent，但 owner 可在机器人加入的任意群执行，输出会暴露给该群所有成员。

同时，若只申请 `group_at_msg:readonly`，群内每条后续消息都必须再次 @机器人才能被飞书推送；若想“根消息 @，同话题后续免 @”，就需要更高权限并自行判断所属线程。当前文档没有定义。

可执行建议：保留 `allowedChatIds` 或明确首版仅允许指定群；采用最小权限时，规定群内每条输入都必须 @机器人，并写进验收用例。

> **后续产品决策（2026-08-22）**：接受 owner 在机器人所在任意群执行并向该群公开输出；
> 当前默认由 `allowedOpenIds` 限制操作者，空 `allowedChatIds` 表示不限群，非空列表作为
> 可选部署范围限制。2026-08-22 进一步实现话题首次 @后持久化激活：首次 @回填前文，
> 后续同话题免 @，其他话题静默；需 `im:message.group_msg`。本节保留为历史审查记录。

---

### R3 — [P1] 一次性 token 不是完整的卡片授权协议

参考实现的基础安全性较好：使用 `randomUUID()`，并同时校验 pending token、操作者 open_id、chatId 和会话 owner，[审批卡处理](/tmp/dsh-refs/dsh-lark-bridge/src/bridge.ts:1294)。方案只记录了“一次性 token”，容易在裁剪时丢掉其余绑定。

可执行建议：pending 记录至少绑定 `appId/chatId/messageId/operatorOpenId/sessionId/callId/deadline`；处理后原子删除，并记录错误操作者、跨群、过期和重复点击审计日志。

---

### R4 — [P0] 同话题连续消息、命令和 `/new` 没有统一并发模型

dsh 的 `followup` 会把每条输入排成独立回合，这是合理基础；但参考 bridge 会在每次消息到达时改写共享的 `entry.route.replyTo` 和 `entry.pendingPrompt`，[onMessage](/tmp/dsh-refs/dsh-lark-bridge/src/bridge.ts:494)。两条快速消息可能导致第一回合的卡片回复到第二条消息，或显示错误 prompt。

`/new`、`/resume` 的 card action 又以 fire-and-forget 启动，[onCardAction](/tmp/dsh-refs/dsh-lark-bridge/src/bridge.ts:1312)，可能与消息、另一个 `/new` 同时 dispose/create。

可执行建议：每个 `originKey` 建立统一控制队列；普通消息按 FIFO 独立 turn，`/steer` 才进入当前 step，`/new`、`/resume`、`/stop` 与消息走同一把锁；每个 turn 保存不可变 reply context。

---

### R5 — [P1] agent 释放主路径存在，但缺少资源上限与竞态约束

参考实现 stop 时会结算 pending、断开通道并 dispose 所有 handle，[stop](/tmp/dsh-refs/dsh-lark-bridge/src/bridge.ts:415)；`AgentHandle.dispose()` 也会停止 loop、注销 agent 和移除 live session，[接口语义](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent/lib/types/index.d.ts:142)。

遗漏的是：

- 多话题长期累积导致 live agent 数无限增长；
- dispose 与运行中的 followup/approval/rotate 竞态；
- `cancel()` 默认清除 inbox，可能丢掉已确认接收的后续消息。

可执行建议：P1 加 `maxLiveAgents` 和 LRU/idle dispose；dispose 前关闭该 thread 的入口队列，等待当前控制操作收敛，并区分“停止当前 turn”与“销毁 session owner”。

---

### R6 — [P0] “断网重连后未结审批按策略结算”没有定义策略

[验收标准](<repo>/docs/05-implementation-plan.md:118) 没说明结果应是什么。参考实现重连时只改变 `connected` 标志，不结算 pending，[reconnecting](/tmp/dsh-refs/dsh-lark-bridge/src/bridge.ts:376)；只有正常 stop 才统一 `unavailable`。硬崩溃后内存 token 消失，旧飞书卡片仍可能保持可点击。

可执行建议：明确状态机：

- 短暂断线：pending 保留，原 deadline 不延长；
- 发卡失败：立即 `unavailable`；
- 超时：`unavailable`；
- 正常停机：`unavailable`；
- 进程崩溃/重启：session 按 interrupted 恢复，旧按钮返回“已失效”，不得重新授权。

验收必须分别覆盖上述路径。

---

### R7 — [P0/P1] 显式映射会产生双事实源，损坏文件会直接阻断启动

参考状态文件虽原子写和 0600，但非法 JSON、未知版本或错误权限都会抛错，[parseState](/tmp/dsh-refs/dsh-lark-bridge/src/state.ts:44)、[refresh](/tmp/dsh-refs/dsh-lark-bridge/src/state.ts:126)。当前没有备份、隔离损坏文件或从 session persistence 重建的逻辑。

若状态再保存 `threadKey → sessionId`，还会出现 session 创建成功、映射写入前崩溃的漂移。

可执行建议：

- **[P0]** 先决定唯一事实源；推荐 session persistence + 确定性前缀。
- **[P1]** 状态加 schema version、`.bak`/`.corrupt-<timestamp>` 隔离、启动重建和明确告警，禁止静默覆盖损坏文件。

---

### R8 — [P1] 原生命令透传扩大了远程攻击面

[05 §2.6](<repo>/docs/05-implementation-plan.md:67) 将未知命令交给 `ctx.commands.execute()`。这意味着以后 dsh 或其他插件新增任何命令，都会自动成为远程 API，不再受本方案列出的命令集约束。

可执行建议：未知命令默认拒绝；只允许显式审计过的 allowlist，新增 Harness 命令不能自动暴露到飞书。

---

### R9 — [P1] 脱敏不能被当成群聊输出的保密保证

`redactSecrets` 是正则/结构性兜底，不可能识别所有业务密钥、文件内容、终端输出和用户数据。群聊卡片对所有成员可见，即使只有 owner 能点击按钮。

可执行建议：默认卡片不展示完整工具参数和结果；群聊仅展示摘要，敏感全文只允许私聊或明确下载动作，并记录“群聊输出视为公开”的安全假设。

## 3. 需求清晰度

### C1 — [P0] “控制当前会话”与“创建的会话出现在同一列表”是两种不同需求

[01 背景与目标](<repo>/docs/01-requirements.md:3) 使用了“当前正在运行的服务/会话”和“遥控器”表述；但方案实际上只创建带 bridge 前缀的 session，`/sessions` 和 `/resume` 也只处理本桥 session，[05 §2.5](<repo>/docs/05-implementation-plan.md:63)。

这保证“飞书 session 在 Web GUI 可见”，但不保证“接管用户已在 Web GUI 打开的 session”。

可执行建议：现在明确二选一：

1. 首版仅管理飞书创建的 session，共享 GUI 列表；或
2. 允许选择/接管 GUI-origin session，并设计 live agent owner 冲突和交接协议。

建议 MVP 选 1，并修改“当前会话”措辞。

---

### C2 — [P0] 单项目不等于已定义工作目录

方案把 projects 数组降为 fixed default，却没定义这个 default 的 `cwd` 从哪里来。Web apiproxy 的 session 创建会把选定 workspace 或 `defaults.cwd` 写入 session meta，并在恢复时验证 cwd 一致，[ensureSession](/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js:1355)。

如果省略，远程 agent 可能操作启动 dsh 时的偶然工作目录。

可执行建议：把绝对 `workspaceRoot/cwd` 设为必填或明确继承 Web host default；创建时持久化，恢复时拒绝 cwd 冲突，并在 `/status` 中显示。

---

### C3 — [P0] 同话题运行中再次发消息的语义未定义

需求只定义“跨话题并行”，没有定义同话题内：

- 新消息排下一独立回合；
- 合并进当前 prompt；
- 使用 `steer`；
- 收到 `/stop` 后是否保留后续消息。

可执行建议：明确普通消息永远 FIFO `followup`，`/steer` 才影响当前 step，`/stop` 只取消当前活动但不吞掉取消后新到达的消息。

---

### C4 — [P1] 01/03/04 与 05 仍有实际冲突

虽然 05 声明自己优先，但以下冲突会直接影响排期和验收：

- 01 将话题多会话和流式节流列为 P0，[01 P0](<repo>/docs/01-requirements.md:16)；04 却放在 Phase 2，[路线图](<repo>/docs/04-roadmap.md:20)。05 已移回 Phase 1，应同步修正 04。
- 01 把私聊 + 群聊列为 P1，[01 P1](<repo>/docs/01-requirements.md:26)；05 又询问私聊是否进入 P0。当前 Phase 1 验收可只规定群聊，但不要把 p2p 当未定义功能。
- 01/03 要求“附 Web UI 链接”，但 loopback 链接手机无法打开；05 改为文件 + session ID，[开放点 3](<repo>/docs/05-implementation-plan.md:105)。应正式修改旧需求，而不只是注明冲突。
- 03 称映射文件“参考 lark-bridge”，事实如 F7 所述不成立。

可执行建议：在开工基线中同步更新 01/03/04；“05 优先”不能代替需求和路线图的一致性。

---

### C5 — [P0] 第 5 节开放决策点没有切中主要阻塞项

当前列出的“fork 还是选择性移植”“状态目录叫什么”主要是工程偏好；真正必须现在决定、否则无法可靠实现的项目没有进入开放清单：

1. Web agent preset 的挂载和恢复规则；
2. approval answerer 的确定性注册顺序；
3. `userQuestions` 单例 provider 的共享方式；
4. SDK chat batching 是否关闭，以及 per-thread FIFO 规则；
5. 固定 workspace/cwd 的来源；
6. 是否允许接管 GUI-origin session；
7. 空白名单、允许群范围及群聊 @ 语义；
8. transient disconnect、stop、crash 下的审批状态机；
9. session persistence 与映射文件谁是事实源；
10. 应用级限流、429 和终态卡重试策略；
11. 原生命令是否默认透传。

可执行建议：把以上项目提升为 ADR/开工门槛；代码基形态、目录命名可以后置，不应占据主要决策篇幅。

## 4. 优先级建议

### P0：开工前必须形成设计和 spike 证据

1. **运行时组合 spike**：在真实 `dsh web` 中创建带 `standard` preset 的飞书 session，验证文件/Shell 工具、Web 列表、重启恢复。
2. **交互所有权 spike**：同时运行 Web 和飞书 session，分别触发 approval 与 userQuestions，证明请求只到正确 UI。
3. **话题隔离 spike**：关闭 SDK chat 级批处理，同群两个话题在 350ms 内并发发消息不得串线；同话题连续消息保持 FIFO。
4. **安全契约**：白名单默认关闭、群 allowlist、每条群消息是否必须 @、卡片 action 完整身份绑定。
5. **会话契约**：固定 cwd、preset、是否接管 GUI-origin session、映射事实源。
6. **可靠性契约**：断线/重启审批状态机、全局限流和 429 恢复。

### P1：开发中必须补齐

- 状态文件损坏恢复和 session 对账；
- `/new`、`/resume`、消息和 card action 的单线程控制队列；
- live agent 上限及 LRU/idle dispose；
- 3 秒回调预算；
- 原生命令 allowlist；
- 多 step/chunk/terminal 事件聚合测试；
- 精确飞书权限、事件与回调开通文档；
- secret 落盘语义和权限说明；
- 精确锁定 dsh 依赖版本。

### P2：可后续完善

- 自动空闲回收策略优化；
- 入出站附件和全文文件体验；
- Lark 国际版专项验收；
- 更完整的审计、指标和管理员诊断界面。

## 最值得现在修的三件事

1. **先解决 preset、approval 和 userQuestions 的 Web profile 共存问题**——否则插件即使成功收消息，也可能没有工具，审批/提问还会被 GUI 抢走或直接注册失败。
2. **关闭 chat 级批处理并定义 per-thread FIFO**——当前 SDK 配置会把同群不同话题合并，这是对 P0 多会话隔离的直接破坏。
3. **把安全与失败语义写成明确契约**——白名单 fail-open、群范围、429、断线审批和状态损坏目前都只有原则，没有可验收行为。

本次仅进行了只读审查，未修改仓库或参考源码。
