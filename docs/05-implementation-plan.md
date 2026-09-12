# 实现方案（Phase 1 落地方案）

> 状态：**步骤 0-6 与 P1 设置卡片 + P1 进度卡片已实现，Codex 十一轮 review 终审 APPROVE；
> 进度更新链路经 Round 12 独立 review（2 P1 / 4 P2 / 1 NIT，修复对照见 docs/10）**
> （2026-08-18：仓库骨架、通道层、出站调度器、回合归属账本、审批闭环、话题映射、
> 流式节流全部落地，104 个契约测试全绿，构建产物约 2.4MB，mock 冒烟通过；
> 47 项 review findings 修复对照见 docs/10；真实租户验收待 docs/09-onboarding.md
> 凭据执行）。
> 2026-08-19：进度卡升级为飞书流式更新卡片（运行期 `streaming_mode: true` +
> `streaming_config`，节流默认 600ms，终态显式关闭流式模式，见 §2.5）；
> 2026-08-22：极简卡改为「最新进展 → 最终总结」，正文会缩短，因此普通任务卡停用
> append-oriented `streaming_mode`，继续用约 600ms 的整卡 patch。
> 2026-08-23：工作目录改为 DSH Workspace Registry 驱动；新增首次选择/新建、
> `originKey → workspaceId` 持久绑定、旧会话 cwd 自动迁移和 `/workspace` 切换。
> 2026-08-23：首次开通目标改为官方 `registerApp()` PersonalAgent Device Flow；一次扫码
> 创建/授权应用并保存凭据；owner 身份不再用于操作者授权。实现与自动化测试已完成，真实租户验收及包发布
> 前置见 docs/16。
> Round 12 修复后相关契约测试全绿；当前总数以 `pnpm run test` 输出为准。
> 本文档是本仓库的"当前方案"单一事实源；
> 若与 01-04 冲突，以本文为准。已通过三轮独立 review——第一轮 Codex
> （gpt-5.6-sol）报告见 06-codex-review.md；第二轮 DeepSeek / Claude Opus 5 /
> Codex gpt-5.6-sol 三方复审的共识与修订对照见 08-triple-review.md。
> 标注"待验证"的 spike 项通过前不写主线代码。

## 0. 方案一句话

**以 dsh-lark-bridge 裁剪为主干（飞书通道用官方 SDK + 接口隔离），dsh-im-hub 补
设置卡片机制与 mock adapter；跑在 web profile 进程内，与会话层（agentLoop/approval/
session 事件）直接进程内对接。会话由飞书创建、与 Web GUI 同列表共享，不接管 GUI
已有会话。**

## 1. 底本与裁剪策略

### 1.1 主干：dsh-lark-bridge（按文件取舍）

| 文件 | 处置 | 说明 |
| --- | --- | --- |
| `src/security.ts` | **借**（几乎原样） | redactSecrets / bounded / isInside / 文件限幅 |
| `src/state.ts` | **借 + 砍** | 保留原子写+0600+串行变更队列骨架；删 pairing/token 逻辑。不保存 threadKey→sessionId；只保存用户明确选择的 originKey→workspaceId（见 §2.6），session 事实源仍是 persistence。 |
| `src/cards.ts` | **借 + 改** | 卡片模板全套保留；删 project 字段显示，精简为单会话语境 |
| `src/bridge.ts` | **借 + 砍** | 保留：消息路由、answerer、流式节流、会话生命周期、命令集。砍：上游 project ACL、claim/bind/unbind、群绑定、`lark_deliver`（P2 文件能力再议）。**改**：接入 DSH Workspace Registry；userQuestions 不直接注册单例 provider，飞书会话 setup 内 restrict 屏蔽 ask-user 类工具（§2.4）、SDK 批处理关闭（§1.3）、命令透传改 allowlist（§2.7） |
| `src/config.ts` | **改** | Workspace 由 DSH Registry 选择；旧 `workspaceRoot/cwd` 仅成对保留为升级兼容项。保留 credentialRef/env/ctx.credentials 三级凭据解析；操作者固定开放，旧用户白名单字段仅兼容读取（§2.9）。 |
| `src/index.ts` | **改** | inject 核对 web profile 服务；去掉独立 profile 假设 |
| `src/cli.ts` | **砍** | 不恢复独立 CLI 配对；首次开通由 Web GUI → Host 的 PersonalAgent 扫码服务承担（docs/16），手工配置保留为兜底 |
| `src/identity.ts` | **借 + 砍** | session 前缀/`/sessions` 枚举保留；删 project 维度 |

### 1.2 补件：dsh-im-hub

- **Web GUI 设置卡片机制**：host 侧 `ctx.settings.register(namespace, flatSchema, {base})` + 浏览器侧 `window.__ModuleLoader__.load()` 手写模块（`dsh.client.inject` + `platform: 'web'`，无构建步骤）。
- **mock adapter**（stdin→stdout，88 行）：开发期测试基础设施，提前到开发期启用。
- `splitText` 超长分片工具。
- 语义修正：`role('secret')` 的保证是**已保存的 secret 不向浏览器回显**（首次设置值会经 browser→host wire 传输一次），宿主进程可读、本地 0600 明文落盘；凭据唯一来源定为 `.credentials.yaml`（GUI 只存 credentialRef），不与 settings.yaml 双写，避免两份凭据漂移。文档按此口径描述。

### 1.3 通道层：官方 SDK + 接口隔离 + 禁用批处理

- 长连接用官方 `@larksuiteoapi/node-sdk` 的 `createLarkChannel({ transport: 'websocket' })`，照抄 lark-bridge 的 `LarkChannelLike` 包装。
- **必须关闭 `safety.chatQueue`**（Codex F4 + SDK 1.73.0 bundle 复核确认未修复）：
  `pushMessage` 以 `chatId` 为队列 key、`mergeBatch` 继承最后一条消息的
  `rootId/threadId` → 同群两话题在合并窗口（默认 600ms/2000ms）内并发会串线。
  关 `chatQueue.enabled: false` 即同时禁用 batching（batch.text 变 inert），
  dedup/stale/policy 仍生效；代价是 cardAction 队列同被旁路 → 按钮处理自串行化。
  入站 FIFO 由本插件按 §2.6 的私聊/普通群/话题 `originKey` 自行实现（chatQueue 关闭后 handler
  内联执行，必须遵守 §1.3 的 3 秒回调预算）。
- **限流不在 SDK 侧**（Codex F5 + SDK 1.73.0 核实）：普通发送仅有限重试、patchCard
  无重试、无全局 token bucket。需要本插件应用级出站调度器：全局并发上限 + 卡片更新
  合并 + 429 `x-ogw-ratelimit-reset` aware backoff + 抖动 + 终态更新优先。
  **补充（SDK classifyError 误分类）**：`400+99991400`（部分旧版 API 的限流码）被误
  分 permission_denied、`230020` 被误分 target_revoked，均不会重试——调度器必须自行
  识别这两个码为限流信号。限额锚点：create/reply 每接收者约 5 QPS（群内机器人共享）、
  patch 单条消息 5 QPS（仅 14 天内、≤30KB）。验收标准从"绝无 429"改为"429/限流码可
  恢复且终态最终送达"。
- **永久错误兜底**：230025（超长）/230031（超 14 天）/消息撤回/目标失效归类为 permanent，patch 失败改发新终态卡；`patchCard` 是裸调用（无重试、无 classifyError 包装），必须走本插件出站调度器。
- **3 秒回调预算**：入站回调 handler 只做鉴权+入队即返回（chatQueue 关闭后 handler 内联执行，长任务会拖垮 SDK 事件循环）；耗时的 state I/O、agent 创建、卡片更新全部异步。
- SDK 版本锁死（package.json 精确版本），当前与 dsh `0.1.5-rc.1` 一起冻结。
- 备选通道：im-hub 手写 protobuf 帧层（约 200 行零依赖），接口隔离保证可替换。

## 2. 关键机制设计

1. **会话创建与消息注入**：`ctx.agents.create/resume` + `agent.followup(createUserMessage({ content, source: { kind: 'user' } }))`。
   IM 消息视同普通用户输入（D5），不绕过任何审批/护栏策略。模型选择回退
   `agentDefaultModel`。**回合归属账本**：本插件每次 followup 记录"该回合由飞书发起"
   （turn/end 清除），供 approval answerer 与输出路由使用——GUI 打开飞书会话是默认可行的
   （apiproxy 直接复用 live agent），必须按**回合**而非按 agent 归属交互（§2.3）。
   **实现说明（2026-08-18，Codex P0-1 修正）**：rc.6 的 loop 在 `Inbox.claim` 之前就发
   `turn/start`，计数器启发式在 GUI/飞书消息交错时会把回合错配给错误入口；落地实现改为
   **精确关联**——记录每条 `createUserMessage` 的 id，监听全局 `agent/inbox/claimed`
   （`{ agent, message, turn }`）把已认领消息映射到确切回合与回复上下文；`turn/start`
   默认按 gui 记录、认领事件到达后升级为 feishu（审批与输出均发生在认领之后，时序安全）。
2. **preset 挂载（硬缺口，三条契约）**：web profile 宿主平面禁用了全局 bash/fs/skill 等工具，
   每个 session 必须挂 agent preset。契约（rc.6 源码核实；rc.7 适配后经 103 测试复验）：
   (a) 创建时 preset id 写入 `CreateAgentOptions.meta.agentPreset`（header 在 setup 之前快照）；
   (b) mount 只能在 `setup(agentCtx)` 内做（`presets.mount` 唯一受支持的调用点）；
   (c) 恢复时用公开 API `resolveSessionPreset({ header, events })` 从日志解析，绝不只读 header（空会话切过 preset 时两者不同）。
   创建用公开 API `agentPresets.resolve(id)`，默认 preset 跟随 web 部署（通常 `standard`）；
   不得表述为复用 apiproxy 内部函数 `composeAgent`（非公开 API，rc.6 中 `resolveAgentPreset` 不存在）。
   照抄 lark-bridge 的 setup 会导致"能聊天但没工具"的 agent。列为 spike 验证项。
3. **审批 answerer**（灵魂功能）：
   ```ts
   ctx.on('approval/request', async (req, next) => {
     const entry = agents.get(String(req.agent.id))
     if (entry === undefined || !entry.isFeishuTurn(req)) return next()  // 非飞书回合 → 让给 GUI answerer
     return askApproval(entry, req)
   }, { prepend: true })
   ```
   **注册机制（三方 review 修正）**：cordis.patch.yml 无排序能力（insert 只能 append）且
   loader 并发启动条目，注册顺序不可依赖；正确做法是 `{ prepend: true }` 使本 answerer
   恒居 waterfall 首位（已对照 cordis 源码核实：dispatch 按插入序执行、prepend 即 unshift；
   apiproxy 用默认 push，无冲突）。按**回合归属**认领：本插件 followup 发起的回合才认领，
   其余一律 next()——GUI 打开飞书会话并发言是默认可行的（apiproxy 直接复用 live agent），
   其回合的审批必须回 GUI，反之飞书回合的审批只到飞书卡。
   fallback（仅当 spike 证伪 prepend 时启用）：发布 `feishuApprovalReady` 服务并让
   api-gateway inject 该服务作为启动屏障（改注入清单有覆盖风险，列为次选）。
   认领 → 发审批卡（按钮带一次性 token）→ Promise 挂起。
   卡片按钮 value 一次性（借鉴 jiangkuo888/cc-connect 的 perm:allow/deny 约定）；
   **终态必须显式 updateCard**（SDK 的 cardAction handler 返回值被丢弃，无法"回调内原地
   回填"省一次 API）；按钮重复点击被 SDK 确定性去重（24h TTL）静默丢弃 → `/approve`
   `/reject` 文字兜底是**必需路径**而非可选；handler 内部 try/catch，失败结算为 `unavailable`。
   pending 记录绑定 appId/chatId/messageId/operatorOpenId/sessionId/callId/deadline。
   五条结算路径：卡片按钮 / `/approve` `/reject` 文字 / `req.signal` abort→`cancelled`
   / 超时 `interactiveTimeoutMs`（默认 10 分钟）→`unavailable` / 停摆清理。
   **断线/崩溃状态机（Codex R6 + 第六条）**：SDK 重连全自动（30s 抖动 + 120s 无限重试，
   事件 `reconnecting/reconnected` 驱动状态机）；短暂断线=保留 pending、deadline 不
   延长；发卡失败=立即 `unavailable`；超时=`unavailable`；正常停机=`unavailable`；
   进程崩溃重启=session 按 interrupted 恢复、旧卡片按钮返回"已失效"、不得重新授权；
   **通道终态失效**（WSClient terminalError：重试耗尽/凭据失效，此后不再重连）=结算
   全部 pending 为 `unavailable`、`/status` 标红、应用层按退避重建 channel。
   （状态机落地模板参考 feishu-bridge 的 bg_supervisor：cancel/timeout/reap、Cancel
   SLO≤10s、崩溃续跑。）
4. **结构化提问（P0 屏蔽，P1 multiplexer）**：`userQuestions.registerProvider` 是
   单例且非 scope-aware，web profile 的 apiproxy 已注册全局 provider，直接注册抛
   `DUPLICATE_PROVIDER`（已实证）。更危险的是**不实现也会发生**：standard preset 自带
   `tool-ask-user`、plan mode 的 `exit_plan_mode` 也走该服务；apiproxy 的全局 provider
   无超时，问题会被推进没人看的浏览器、飞书侧无任何提示，turn 无限挂起只能 /stop。
   P0 方案：飞书会话 setup 内先 `presets.mount` 再 `agentCtx.tools.restrict({ deny: ['ask_user_question', 'exit_plan_mode'] })`
   （restrict 校验集包含 preset 层工具，顺序必须 mount 在前；spike 验证）；
   备选：`$DSH_HOME/.agent-presets` 放 `feishu` preset = standard 去掉 ask-user
   （GUI 打开该 session 时同样无提问，因为恢复按记录的 preset 组合）。
   P1：provider multiplexer 或 agent-scoped 覆盖方案验证后恢复原生结构化提问。
5. **可变进度卡片**：监听 `session/event`，
   按回合聚合 `TurnProgress`（进程内 `agent/assistant-stream` text-delta + 持久化 `assistant/message` 兜底；
   `tool/call` 只标记该 assistant step 属于临时过程）；`scheduleProgress` 节流默认 **600ms**
   （单消息 patch 5 QPS 内留裕量）；首条发卡、之后 `updateCard` 更新同一 messageId；
   `turn/end` 终态卡（`turn/end.reason.kind` 为 completed/aborted/blocked/error/
   max-tokens/interrupted，需二次映射，不是直接 cancelled）。出站走 §1.3 的应用级
   调度器 + 每会话串行队列。
   **极简渲染**：约 600ms 全量 patch 刷新同一张无标题栏卡；运行期只展示最新 assistant
   进展。终态把同一张卡替换为最后一个非空、未请求工具的 assistant 总结；此前的过程
   文字和工具轨迹不再回显，但仍完整保留在 DSH 会话历史。因为 step 切换与终态总结都会
   让正文变短，普通任务卡不携带 append-oriented `streaming_mode`，避免客户端将新正文
   追加到旧正文后形成残影。
   普通回合卡不显示目录、模型、session、token、上下文统计或操作按钮；审批卡的批准/
   拒绝按钮作为安全边界保留。审批/状态卡同样不携带 streaming 字段。
   **终态优先（Round 12 F2 + 复核）**：turn/end 后，链上排队的非终态进度更新
   一律跳过（终态卡是完整快照）；终态 patch **绕过**每回合 sendChain 直接入调度器
   （同 messageId 的 patch 由调度器按代际串行/合并，终态必胜过仍排队的陈旧
   patch）；历史 `/view` 动作仍兼容解析，并明确回复该功能已停用；普通回合卡统一使用极简视图。
   **working reaction（敲键盘，Round 13）**：飞书回合被认领（`agent/inbox/claimed`
   命中 pendingClaims）时给触发消息加 `Typing` reaction、`turn/end` 移除；装饰性、
   best-effort（标记在 await 前同步写入以防 turn/end 微任务竞态；失败静默、残留
   无害）；不经出站调度器以免给纯装饰动作记送达失败审计；`workingReaction: false`
   关闭；权限 `im:message.reactions:write_only`（docs/09 §3）。
   **去重规则（三方 review 修正）**：同一 messageId 的完整 `assistant/message` 到达即
   **替换**该 (turn,step) 的 chunk 缓冲而非追加（修复 lark-bridge 的 chunks=hel +
   final=hello → helhello 缺陷），按事件 seq 去重；输出状态映射表与多 step/chunk 缺片/
   max-tokens/中断/重复事件测试进步骤 6 验收。
   **卡片约束（SDK 实测）**：patch 前后 config 均需 `update_multi: true`（群聊共享
   更新）；patch 单条消息 5 QPS、仅 14 天内、≤30KB。**体积预算**：发送前按完整 JSON
   UTF-8 字节预检，正文上限沿用 lark-bridge 的 `cardBodyMaxChars`（默认 12000、
   上限 28000），超限截断+折叠+必要时另发新卡；超长最终回复落工作区文件并回显
   session id（手机打不开 loopback Web UI，替代"附 Web UI 链接"）。
   **patch 永久失败兜底**：230001/230002（格式/参数错误）/230025（超长）/230031（超 14 天）/230010/230011/230110
   （不存在/撤回/删除）/230013（机器人对用户不可用）/230027（无权限）/232009（群
   解散）/404/99991400 → 改发新终态卡；群解散/机器人失去权限 → 记录审计 + 显式失败
   状态（验收承诺收窄为"目标仍可写时终态最终送达"）。
   卡片结构保留终态映射（done/interrupted/idle_timeout/error），显示层采用
   「最新进展 → 最终总结」的单正文结构。
   **可选后续升级**：cardkit 元素级文本流式（SDK 已封装 `channel.stream()` 的
   markdown 模式 = cardkit 实体 + `cardElement.content`，100ms/50 字符节流 +
   sequence/uuid 幂等 + 收尾 summary），token 级打字机更细腻，但会绕过本插件
   出站调度器（无限流退避/合并/终态优先），需评估后再引入。
6. **私聊/普通群/话题↔Workspace↔session 映射（三方 review 修订 + 2026-08-23 Workspace 扩展）**：
   不建 originKey→sessionId 显式映射表，session persistence 仍是会话身份事实源；状态只保存
   用户选择的 originKey→workspaceId，Workspace 本身以 DSH Workspace Registry 为事实源。
   群模式先通过官方 `getChatMode(chatId)` 读取
   `chat_mode` 并按 bridge 生命周期缓存，避免把普通群的 reply/root 字段误判为话题。
   `originKey`：p2p → `p2p:<chatId>`；普通群 → `group:<chatId>:chat`；群话题 →
   `group:<chatId>:thread:<thread_id>`（thread_id 优先，缺失回退 root_id）；话题群中不属于任何
   thread 的消息仅在明确 @时提示"请在话题内 @我"。普通群的未 @消息静默，不创建/恢复
   session、不执行命令；任意用户每次 @后才进入该群唯一 session。
   首次未绑定来源：Registry 为空或有多个 Workspace 时发选择卡，只有一个时自动绑定；选择卡可
   选 Registry 现有项、在常用 Mac 父目录下新建一个末级目录，或由用户提供绝对/`~/` 路径。
   新建目录严格限于一个末级目录，拒绝文件系统根、用户 Home 和系统目录等过宽范围；群卡不显示
   本机绝对路径。首次原消息在内存中等待，绑定成功后自动重放。旧部署若已存在同来源 Session，
   则按 header.cwd 反查 Registry 并写入绑定。`/workspace` 可查询、选择、创建或切换；切换开启
   全新 Session，失败时保留原 Workspace/Session；`/new` 仅新建当前 Workspace 内的 Session。
   SHA-256 前 24 位 hex 为 session 前缀。`sessionPersistence.list()` 按前缀和当前 Workspace cwd 找最新会话
   （OpenClaw/cc-connect 等 30+ 仓库同款结论）。
   **fresh list()**：`/sessions`、自动恢复、`/resume` 每次都现查 list()（不搬参考项目的
   启动缓存），并过滤 `workspaceRegistry.archivedSessionIds`（GUI 归档的会话不得自动续上）。
   入站去重 key=message_id（官方明示勿用 event_id）；普通群/话题群判定以官方 `chat_mode` 为准，
   `thread_id/root_id` 只用于话题内 origin 定位；API 失败时仅明确的 `thread_id` 保留话题判定，
   只有 `root_id` 的歧义场景回退为更安全的普通群“每轮必须 @”策略。
   **`/new` pending 协议**：状态文件写 originKey→pending-new 标记，下一条普通消息才创建
   （sessionPersistence lazy materialization：从未 append 的 session 不在 list()）；
   标记跨重启保留，且只在 fresh Session 探测成功后原子消费；普通 Workspace 绑定不会误消费，
   Workspace 切换已经创建 fresh Session 时则与新绑定在同一次状态写入中消费。
   **`/resume` 原子切换**：只接受同前缀且 cwd 属于当前 Workspace 的 session；先验证并创建/恢复目标 handle，成功后再
   原子替换 route/map、最后 dispose 旧 handle，失败保留旧 session（参考实现的先拆后建
   不具备回滚）。Workspace 绑定跨重启持久化；Session resume 绑定仍仅进程内有效，重启时在
   当前 Workspace 中回落前缀最新。预检借鉴 feishu-bridge sentinel probe；cwd 恢复校验借鉴
   zarazhangrui policyFingerprint（cwd+access+attachments 摘要，防运行期漂移）。状态文件仅存
   Workspace 绑定与轻量元数据（pending-new 标记，以及为旧版本兼容保留的卡片视图值），
   损坏时隔离为 `.corrupt-<ts>`、告警、从空状态重建，禁止静默覆盖。
7. **命令集**：`/workspace` `/new` `/status` `/stop`（`agent.cancel({kind:'user'}, { keepInbox: true })`
   ——默认会清空排队消息，必须 keepInbox；语义=只取消当前 turn，后续消息照常进入下一回合）
   `/sessions` `/resume <id>`（仅同前缀）`/approve` `/reject` `/steer` `/help`。
   **原生命令透传改 allowlist（Codex R8）**：未知命令默认拒绝，仅放行显式审计
   过的 Harness 命令，避免未来新增命令自动成为远程 API。
8. **并发模型（Codex R4 + 补充）**：每个 originKey 一条控制队列——普通消息 FIFO 独立
   followup；`/steer` 才进当前 step；`/new` `/resume` `/stop` 与消息同锁；
   每个 turn 保存不可变 reply 上下文（不复用共享 mutable route）。
   审批挂起期间：普通消息排入**下一回合**、`/steer` 不解审批——审批卡正文明示
   "只有按钮与 `/approve` `/reject` 生效"。
   **maxLiveAgents**：live agent 硬上限（P1 起），超限拒绝新 origin 并给可操作提示；
   idle/LRU dispose 前先关闭该 origin 入口队列（dispose 与 followup/approval 竞态收敛）。
9. **边界（2026-08-25 产品决策覆盖 Codex R1）**：
   - 操作者固定开放：不按用户 open_id 做白名单判断；旧 `allowedOpenIds` / `allowAllUsers`
     配置及环境变量仅作升级兼容并在运行时忽略。
   - 群聊范围：私聊 + 普通群 + 群聊话题；群范围默认不限，非空 `allowedChatIds` 可选收窄。
     默认每个话题首次由任意用户 @机器人后持久化激活：首次 @ 回填此前有界话题历史，
     后续同话题免 @自动进入同一 session，其他话题静默。`im:message.group_msg` 用于接收
     未 @后续及上下文读取。普通群接收所有成员消息但每轮必须由任意用户明确 @；未 @消息
     只在下一次触发时作为有界增量历史注入。@ 只是触发信号；
     输出会向所在群公开。
   - 卡片 pending 记录绑定 appId/chatId/messageId/operatorOpenId/sessionId/callId/
     deadline，处理即原子删除；错误操作者/跨群/过期留审计日志（重复点击被 SDK 去重，
     到不了插件，由文字兜底覆盖）。
   - 交互所有权：任何用户都可发起任务；Workspace/审批卡和停止 reaction 只接受该回合或
     待处理流程的发起者，防止另一名群成员接管已有交互。
   - 群聊输出视为公开：卡片不展示完整工具参数与结果，只展示摘要。
   - 凭据不进仓库；出站 `redactSecrets`。

## 3. web profile 内嵌专项

- **inject 核对（补全）**：`agents / agentDefaultModel / credentials / tools / systemPrompt`
  均为 web profile 已有服务（已查本机 profile dump 与 dsh 包清单）；此外
  `agentPresets / connection / webServer / sessionPersistence / approval / userQuestions / workspaceRegistry / settings`
  亦为必填注入（§2 直接依赖）。DSH `0.1.5-rc.1` 的 `connection.rpc.handle()` 会把
  路由注册为调用方 effect，因此调用方还必须显式注入 `webServer`；同时它的嵌套 `rpc`
  getter 会保留 provider shadow，注册前须用 Cordis `Service.extend` 把原始 connection
  service 重新绑定到当前插件上下文。缺失任一步时均 fail-closed 禁用管理 RPC 与通道。
- **preset / answerer / userQuestions 三项共存**是 web profile 内嵌的真正难点
  （§2.2/2.3/2.4），全部进 spike。
- **故障隔离底线**：`apply()` 只做同步注册与服务注入、**永不 reject**；channel 连接放
  `ctx.effect` 后台任务自带重试——参考实现 await connect 会把飞书连不上放大成整个
  web profile 启动失败（loader 将 apply 异常放大为整树回滚），D1 的代价必须以此封顶。
- **安装/联调**：环境前置 Node ≥22 与 pnpm（`dsh plugin` 依赖 pnpm）；SDK 精确版本 +
  构建期 bundle（external 仅 `@deepseek-ai/*`，参考产物约 2.4MB）；
  `dsh plugin --profile web add link:<本仓路径>` + `cordis.patch.yml` 仅做配置覆盖；
  改码后重启 web 进程验证。
- **设置卡片（P1）**：CLI 向导删除后，配置编辑 = cordis.patch.yml + GUI 卡片双通道；
  `role('secret')` 的保证是已保存值不回显浏览器（首次设置经 browser→host wire），
  宿主可读、0600 明文落盘（写入文档口径）。
- **扫码开通（P1，已实现，真实租户待验收）**：默认加载空配置以注册 onboarding RPC 和设置页；Host 调用
  `registerApp()`，浏览器只持有短期二维码 URL；返回 Secret 写入按 App ID 派生的独立
  credential ref，App ID/ref/开放操作者/可选群范围通过一次 settings `update()` 原子切换，随后沿
  现有 watcher 热启动 bridge。跨 credentials/settings 采用补偿式提交，完整方案见 docs/16。

## 4. 开发顺序（替代原 Phase 0）

| 步骤 | 内容 | 验收 |
| --- | --- | --- |
| 0 | 环境前置（Node ≥22 / pnpm）+ 仓库骨架 + `security/state/cards` 移植 + lark-bridge 测试搬来跑绿 | vitest 全绿 + 裁剪后契约测试（队列/provider/映射/权限语义已变，不能只跑上游测试） |
| 1 | **echo spike**：空壳 cordis 插件 + SDK 通道（batch/chatQueue 关闭）+ 开放操作者（`allowedChatIds` 可选收窄群范围）→ 飞书发什么回什么 | 手机发消息，Mac 回显；断网重连可用；普通群/话题群/p2p 三态行为正确；应用形态（个人应用 vs 企业自建）定案并文档固化 |
| 2 | **共存 spike**：web profile 内创建带 preset 的飞书 session（有工具）；answerer `prepend` 生效且双向隔离（飞书回合审批只到飞书卡、GUI 回合审批只回 GUI）；飞书会话无通往浏览器的提问路径（ask-user 被拒） | 三项都有可复现证据 |
| 3 | 单会话对话：create/resume + followup + whenIdle + 全文回复（暂不流式） | 飞书会话出现在 Web GUI 列表；GUI 对飞书会话发言=双写回合（输出按 session 流、审批回 GUI） |
| 4 | **审批闭环**：answerer（prepend）+ 卡片 + 五条结算路径 + 断线/崩溃/通道终态失效状态机 + 终态 updateCard | 飞书完成一次需审批的真实任务；按钮重复点击被去重但文字兜底可用 |
| 5 | 私聊/普通群/话题映射 + 全套命令 + 每 origin 控制队列 + `/new` pending 协议 + `/resume` 原子切换 | 普通群仅 @触发且读取全群有界历史；群内多话题并行互不干扰；`/resume` 失败保留旧会话；重启回落规则符合文档 |
| 6 | 流式节流 + 进度/终态卡片 + 应用级出站调度器 + 体积预算与永久错误兜底 + 超长分片 | 1s 级卡片更新；429/限流码可恢复；chunk+final 去重与状态映射表测试全绿；30KB/14 天边界兜底生效 |
| 7 | **PersonalAgent 扫码开通**：RegistrationService + Host RPC + Web GUI 二维码 + credential/settings 补偿提交 + 开放操作者 + 权限探测 | 全新 profile 一条安装命令后扫码一次即可私聊并完成审批；Secret 不出 Host；失败不破坏旧配置；验收矩阵见 docs/16 §8 |

原 Phase 0（装原版 im-hub 隔离验证）**跳过**：步骤 1 的 echo spike 用自有代码验证
相同链路，且代码是最终交付物的一部分。

## 5. 已定决策（2026-08-16 用户定案）

1. **会话范围**：飞书只管理自己创建的会话，与 GUI 同列表共享；不接管 GUI 已有会话。
2. **操作者访问（2026-08-25 更新）**：固定对所有人开放，不提供个人白名单。
3. **群聊范围**：私聊 + 普通群 + 群聊话题；默认允许机器人加入的任意群，非空 `allowedChatIds`
   才限制到指定群；每个话题首次需 @，激活后同话题免 @并跨重启保留；普通群每轮必须 @，
   未 @消息仅作为下一轮有界上下文。
4. **工作目录（2026-08-23 更新）**：不把 bridge 进程 cwd 或插件仓库当默认目录；使用
   DSH Workspace Registry。首次选择/新建，按飞书来源持久绑定；Registry 仅一项时自动绑定；
   `/workspace` 可切换，`/status` 展示。旧 `workspaceRoot/cwd` 只作成对可选的升级兼容配置。
5. **代码基形态**：新仓选择性移植（默认，非 fork；如无异议按此执行），CI/测试
   一并搬来做回归基线。
6. **状态文件路径**：`~/.dsh/feishu-remote/<appId>.json`（避免与上游 lark-bridge
   混淆；仅存轻量元数据，session 事实源在 persistence）。
7. **session id 前缀**：`feishu-<24hex>-<base36 ts>`，同毫秒冲突 ++ 避让（避免与
   上游 lark-bridge 的 `lark-` 前缀在 GUI 列表混列）。
8. **首次开通（2026-08-25 更新）**：采用官方 SDK `registerApp()` 创建 PersonalAgent；
   首次 `createOnly: true`，无需解析或保存扫码者 open_id，手工 App ID/Secret 流程只作兜底；不建设
   共享商店应用或云端中继。

## 6. 验收标准（Phase 1）

1. 人在外面，用飞书指挥 Mac 完成一次**需要审批**的真实任务，会话同步出现在 Web GUI
   会话列表（架构文档里程碑不变）。
2. 断网重连后长连接恢复；未结审批按 §2.3 状态机结算（六条路径各有测试，含通道终态失效）。
3. 任意 open_id 都可驱动操作；即使旧配置仍带非空 `allowedOpenIds` 或 `allowAllUsers: false`
   也不得拦截；配置非空 `allowedChatIds` 时，列表外群仍被拒。
4. 全局出站速率受限（不随会话数线性放大）；429/限流码可恢复；目标仍可写时终态最终
   送达，否则有持久审计与显式失败状态；30KB/14 天边界有兜底。
5. 飞书 agent 具备部署 preset 的工具能力（bash/fs/skill 等按 preset 挂载）；飞书会话上
   不存在通往浏览器的提问路径。
6. 交互双向隔离：飞书回合审批只到飞书卡；GUI 对飞书会话发起的回合审批仍回 GUI。

## 7. 风险

- dsh rc 期内部接口变动 → 锁死 `0.1.5-rc.1`（peerDependencies 精确版本，不用 `^`），升级自适配后再解锁。
- SDK 大依赖 → 接口隔离 + 版本锁死 + 构建期 bundle；断网期间审批走超时 fail-closed。
- web profile 三项共存（preset/answerer/userQuestions）→ spike 先行，不过不写主线代码。
- live agent 无上限 → `maxLiveAgents` 硬上限（P1），超限拒绝新话题。
- 合规：继承两个参考项目 MIT 声明 + lark-bridge 的 THIRD_PARTY_NOTICES（SDK 打包）。
- PersonalAgent 一键注册的 addons 可能受租户/灰度/敏感权限策略影响 → docs/16 要求首次
  扫码声明完整权限并在连接后探测实际授权；核心消息/卡片能力缺失则 fail-closed，增强历史/
  全群消息/reaction 缺失则降级并提供 `registerApp({appId, addons})` 补权入口；docs/09 保留
  手工企业自建应用作为故障兜底。
- mock 适配器只覆盖文本链路（无卡片/审批概念，且 stdin 在壳 App 拉起的进程里未必可用）
  → 审批闭环靠真凭据 + 单测双跑，不依赖 mock。
