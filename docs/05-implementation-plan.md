# 实现方案（Phase 1 落地方案）

> 状态：方案已定案，待开工。本文档是本仓库的"当前方案"单一事实源；
> 若与 01-04 冲突，以本文为准。已通过 Codex（gpt-5.6-sol）独立 review，
> 报告见 06-codex-review.md；本版已吸收其 P0 结论与 2026-08-16 用户定案。

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
| `src/state.ts` | **借 + 砍** | 保留原子写+0600+串行变更队列骨架；删 pairing/token 逻辑。注意：**不做** threadKey→sessionId 显式映射表（见 §2.5，事实源=确定性前缀+session persistence） |
| `src/cards.ts` | **借 + 改** | 卡片模板全套保留；删 project 字段显示，精简为单会话语境 |
| `src/bridge.ts` | **借 + 砍** | 保留：消息路由、answerer、流式节流、会话生命周期、命令集。砍：projects 多项目、claim/bind/unbind、群绑定、`lark_deliver`（P2 文件能力再议）。**改**：userQuestions 不直接注册单例 provider（§2.3）、SDK 批处理关闭（§2.4）、命令透传改 allowlist（§2.6） |
| `src/config.ts` | **改** | 单项目化：projects 降为固定 default；保留 credentialRef/env/ctx.credentials 三级凭据解析；白名单 fail-closed（§2.7）；**workspaceRoot/cwd 必填** |
| `src/index.ts` | **改** | inject 核对 web profile 服务；去掉独立 profile 假设 |
| `src/cli.ts` | **砍** | CLI 向导/配对全部删除，配置走 cordis.patch.yml + Web GUI 设置卡片 |
| `src/identity.ts` | **借 + 砍** | session 前缀/`/sessions` 枚举保留；删 project 维度 |

### 1.2 补件：dsh-im-hub

- **Web GUI 设置卡片机制**：host 侧 `ctx.settings.register(namespace, flatSchema, {base})` + 浏览器侧 `window.__ModuleLoader__.load()` 手写模块（`dsh.client.inject` + `platform: 'web'`，无构建步骤）。
- **mock adapter**（stdin→stdout，88 行）：开发期测试基础设施，提前到开发期启用。
- `splitText` 超长分片工具。
- 语义修正（Codex F9）：`role('secret')` 的保证是"值不出进程、浏览器不可读"，**不是不落盘**——本地以 0600 写入 settings 文件。文档按此口径描述。

### 1.3 通道层：官方 SDK + 接口隔离 + 禁用批处理

- 长连接用官方 `@larksuiteoapi/node-sdk` 的 `createLarkChannel({ transport: 'websocket' })`，照抄 lark-bridge 的 `LarkChannelLike` 包装。
- **必须关闭 `safety.chatQueue`**（Codex F4 + SDK 1.73.0 bundle 复核确认未修复）：
  `pushMessage` 以 `chatId` 为队列 key、`mergeBatch` 继承最后一条消息的
  `rootId/threadId` → 同群两话题在合并窗口（默认 600ms/2000ms）内并发会串线。
  关 `chatQueue.enabled: false` 即同时禁用 batching（batch.text 变 inert），
  dedup/stale/policy 仍生效；代价是 cardAction 队列同被旁路 → 按钮处理自串行化。
  入站 FIFO 由本插件按 `originKey = chatId + (thread_id ?? root_id)` 自行实现
  （thread_id 优先，缺失=非话题消息）。
- **限流不在 SDK 侧**（Codex F5 + SDK 1.73.0 核实）：普通发送仅有限重试、patchCard
  无重试、无全局 token bucket。需要本插件应用级出站调度器：全局并发上限 + 卡片更新
  合并 + 429 `x-ogw-ratelimit-reset` aware backoff + 抖动 + 终态更新优先。
  **补充（SDK classifyError 误分类）**：`400+99991400`（部分旧版 API 的限流码）被误
  分 permission_denied、`230020` 被误分 target_revoked，均不会重试——调度器必须自行
  识别这两个码为限流信号。限额锚点：create/reply 每接收者约 5 QPS（群内机器人共享）、
  patch 单条消息 5 QPS（仅 14 天内、≤30KB）。验收标准从"绝无 429"改为"429/限流码可
  恢复且终态最终送达"。
- SDK 版本锁死（package.json 精确版本），随 rc.6 一起冻结。
- 备选通道：im-hub 手写 protobuf 帧层（约 200 行零依赖），接口隔离保证可替换。

## 2. 关键机制设计

1. **会话创建与消息注入**：`ctx.agents.create/resume` + `agent.followup(createUserMessage({ content, source: { kind: 'user' } }))`。
   IM 消息视同普通用户输入（D5），不绕过任何审批/护栏策略。模型选择回退
   `agentDefaultModel`。
2. **preset 挂载（Codex F1，硬缺口）**：web profile 禁用了全局 bash/fs/skill 等工具，
   每个 session 必须挂载 agent preset（apiproxy 的 `resolveAgentPreset` +
   `presets.mount(agentCtx, id)` 语义）。本插件创建时解析并记录默认 preset（跟随
   web 部署默认，通常 `standard`），恢复时严格挂载 session 已记录的 preset；照抄
   lark-bridge 的 setup 会导致"能聊天但没工具"的 agent。列为 spike 验证项。
3. **审批 answerer**（灵魂功能）：
   ```ts
   ctx.on('approval/request', async (req, next) => {
     const entry = agents.get(String(req.agent.id))
     if (entry === undefined) return next()   // 非飞书会话 → 让给 GUI answerer
     return askApproval(entry, req)
   })
   ```
   认领 → 发审批卡（按钮带一次性 token）→ Promise 挂起。
   卡片按钮 value 一次性（借鉴 cc-connect：回调内原地回填"已批准/已拒绝"状态，省一次
   API）；pending 记录绑定 appId/chatId/messageId/operatorOpenId/sessionId/callId/deadline。
   **注册顺序是正确性依赖（Codex F2，已实证）**：GUI 的 apiproxy answerer 不看归属、
   只要 session 里有未决 `approval/asked` 就抢。本插件 answerer 必须通过
   cordis.patch.yml 稳定排在 api-gateway 之前，并加"飞书 agent + GUI agent 同时审批"
   双向隔离测试；无法保证顺序则引入单一 approval router。
   五条结算路径：卡片按钮 / `/approve` `/reject` 文字 / `req.signal` abort→`cancelled`
   / 超时 `interactiveTimeoutMs`（默认 10 分钟）→`unavailable` / 停摆清理。
   **断线/崩溃状态机（Codex R6）**：SDK 重连全自动（30s 抖动 + 120s 无限重试，
   事件 `reconnecting/reconnected` 驱动状态机）；短暂断线=保留 pending、deadline 不
   延长；发卡失败=立即 `unavailable`；超时=`unavailable`；正常停机=`unavailable`；
   进程崩溃重启=session 按 interrupted 恢复、旧卡片按钮返回"已失效"、不得重新授权。
   （状态机落地模板参考 feishu-bridge 的 bg_supervisor：cancel/timeout/reap、Cancel
   SLO≤10s、崩溃续跑。）
4. **结构化提问（Codex F3，不能直接照抄）**：`userQuestions.registerProvider` 是
   单例，web profile 的 apiproxy 已注册全局 provider，直接注册抛
   `DUPLICATE_PROVIDER`（已实证）。开工前先做 provider 复用/路由 spike：
   与 GUI 共享 multiplexer，或证明 agent-scoped 提问可稳定覆盖；未验证前不把
   结构化提问列为可直接移植能力（降为 P1）。
5. **流式节流**：监听 `session/event`，按回合聚合 `TurnProgress`（`assistant/chunk`
   text-delta + `assistant/message` 兜底 + `tool/call`/`tool/result` 轨迹 + usage）；
   `scheduleProgress` 节流默认 **1000ms**；首条发卡、之后 `updateCard` 更新同一
   messageId；`turn/end` 终态卡（`turn/end.reason.kind` 为 completed/aborted/blocked/
   error/max-tokens/interrupted，需二次映射，不是直接 cancelled）。出站走 §1.3 的
   应用级调度器 + 每会话串行队列。
   **卡片约束（SDK 实测）**：patch 前后 config 均需 `update_multi: true`（群聊共享
   更新）；patch 单条消息 5 QPS、仅 14 天内、≤30KB（我们 1Hz/会话远低于限额）。
   卡片结构借鉴 cv-cat：streaming_mode + reasoning 面板 + 工具调用分组折叠 + footer
   终态映射（done/interrupted/idle_timeout/error）；**P1 升级**：cardkit 流式
   （SDK 已封装 `channel.stream()`，默认 100ms/50 字符节流，需 sequence/uuid 幂等
   与收尾 summary）。
6. **话题↔session 映射（Codex F7，改事实源）**：**不建显式映射表**。沿用
   lark-bridge 的确定性做法：`originKey = chatId + (thread_id ?? root_id)`（thread_id
   缺失=非话题消息）→ SHA-256 → session 前缀，`sessionPersistence.list()` 按前缀找
   最新会话，持久化本身即事实源（OpenClaw/cc-connect 等 30+ 仓库同款结论）。入站
   去重 key=message_id（官方明示勿用 event_id）；话题群判定用 thread_id 缺失与否，
   不做 API 查询缓存（cv-cat 的 ChatModeCache 仅在需要提前知道群类型时参考）。
   重启后自动对账；避免"session 创建成功、映射写入前崩溃"的双事实源漂移。
   `/resume` 预检借鉴 feishu-bridge sentinel probe（探测会话可续性，不可续明示）；
   cwd 恢复校验借鉴 cv-cat policyFingerprint（cwd+access+attachments 摘要，防运行期
   漂移）。状态文件仅存轻量元数据（如卡片视图偏好），损坏时隔离为 `.corrupt-<ts>`、
   告警、从空状态重建，禁止静默覆盖。
7. **命令集**：`/new` `/status` `/stop`（`agent.cancel({kind:'user'})`）`/sessions`
   `/resume <id>` `/approve` `/reject` `/steer` `/help`。
   **原生命令透传改 allowlist（Codex R8）**：未知命令默认拒绝，仅放行显式审计
   过的 Harness 命令，避免未来新增命令自动成为远程 API。
8. **并发模型（Codex R4）**：每个 originKey 一条控制队列——普通消息 FIFO 独立
   followup；`/steer` 才进当前 step；`/new` `/resume` `/stop` 与消息同锁；
   每个 turn 保存不可变 reply 上下文（不复用共享 mutable route）。
9. **安全（Codex R1/R2/R3）**：
   - 白名单 **fail-closed**：`allowedOpenIds` 为空时拒绝一切；仅显式
     `allowAllUsers: true` 且带启动警告时才开放（mock/echo 环境可开）。
   - P0 群聊范围：私聊 + 群聊话题，每条消息必须 @机器人（最小权限
     `group_at_msg:readonly`）；话题内免 @ 留 P1（更高权限）。
   - 卡片 pending 记录绑定 appId/chatId/messageId/operatorOpenId/sessionId/callId/
     deadline，处理即原子删除；错误操作者/跨群/过期/重复点击留审计日志。
   - 群聊输出视为公开：卡片不展示完整工具参数与结果，只展示摘要。
   - 凭据不进仓库；出站 `redactSecrets`。

## 3. web profile 内嵌专项

- **inject 核对**：`agents / agentDefaultModel / credentials / tools / systemPrompt`
  均为 web profile 已有服务（已查本机 `~/.dsh/profiles/web` 与 dsh 包清单），无独立
  profile 专属依赖。
- **preset / answerer / userQuestions 三项共存**是 web profile 内嵌的真正难点
  （§2.2/2.3/2.4），全部进 spike。
- **安装/联调**：`dsh plugin --profile web add link:<本仓路径>`（pnpm link 到
  `~/.dsh/profiles/web`）+ `cordis.patch.yml` 开启行；改码后重启 web 进程验证。
- **设置卡片（P1）**：CLI 向导删除后，配置编辑 = cordis.patch.yml + GUI 卡片双通道，
  `role('secret')` 保证 app_secret 不出进程（本地明文落盘为 0600，写入文档口径）。

## 4. 开发顺序（替代原 Phase 0）

| 步骤 | 内容 | 验收 |
| --- | --- | --- |
| 0 | 仓库骨架 + `security/state/cards` 移植 + lark-bridge 测试搬来跑绿 | vitest 全绿 |
| 1 | **echo spike**：空壳 cordis 插件 + SDK 通道（batch/chatQueue 关闭）+ fail-closed 白名单 → 飞书发什么回什么 | 手机发消息，Mac 回显；断网重连可用 |
| 2 | **共存 spike**：web profile 内创建带 preset 的飞书 session（有工具）；approval 双向隔离（飞书/GUI 各答各的）；userQuestions 复用方案验证 | 三项都有可复现证据 |
| 3 | 单会话对话：create/resume + followup + whenIdle + 全文回复（暂不流式） | 飞书会话出现在 Web GUI 列表 |
| 4 | **审批闭环**：answerer + 卡片 + 五条结算路径 + 断线状态机 + 注册顺序实测 | 飞书完成一次需审批的真实任务 |
| 5 | 话题映射（确定性前缀）+ 全套命令 + 每话题控制队列 | 群内多话题并行互不干扰；`/resume` 可用 |
| 6 | 流式节流 + 进度/终态卡片 + 应用级出站调度器 + 超长分片 | 1s 级卡片更新；429 可恢复 |

原 Phase 0（装原版 im-hub 隔离验证）**跳过**：步骤 1 的 echo spike 用自有代码验证
相同链路，且代码是最终交付物的一部分。

## 5. 已定决策（2026-08-16 用户定案）

1. **会话范围**：飞书只管理自己创建的会话，与 GUI 同列表共享；不接管 GUI 已有会话。
2. **白名单默认**：fail-closed；显式 `allowAllUsers: true` 才开放。
3. **群聊范围**：P0 = 私聊 + 群聊话题，每条消息需 @机器人；免 @ 留 P1。
4. **工作目录**：`workspaceRoot/cwd` 配置必填；创建时持久化、恢复时校验一致、
   `/status` 展示。
5. **代码基形态**：新仓选择性移植（默认，非 fork；如无异议按此执行），CI/测试
   一并搬来做回归基线。
6. **状态文件路径**：`~/.dsh/feishu-remote/<appId>.json`（避免与上游 lark-bridge
   混淆；仅存轻量元数据，session 事实源在 persistence）。

## 6. 验收标准（Phase 1）

1. 人在外面，用飞书指挥 Mac 完成一次**需要审批**的真实任务，会话同步出现在 Web GUI
   会话列表（架构文档里程碑不变）。
2. 断网重连后长连接恢复；未结审批按 §2.3 状态机结算（五条路径各有测试）。
3. 白名单外的 open_id 无法驱动任何操作；空配置=拒绝一切。
4. 卡片更新频率 ≤1Hz/会话；429 可恢复且终态最终送达。
5. 飞书 agent 具备部署 preset 的工具能力（bash/fs/skill 等按 preset 挂载）。

## 7. 风险

- dsh rc 期内部接口变动 → 锁死 rc.6（peerDependencies 精确版本，不用 `^`），升级自适配后再解锁。
- SDK 大依赖 → 接口隔离 + 版本锁死；断网期间审批走超时 fail-closed。
- web profile 三项共存（preset/answerer/userQuestions）→ spike 先行，不过不写主线代码。
- 合规：继承两个参考项目 MIT 声明 + lark-bridge 的 THIRD_PARTY_NOTICES（SDK 打包）。
- 飞书开放平台配置繁琐 → 一次性成本，文档固化最小权限清单
  （`im:message.p2p_msg:readonly` / `im:message.group_at_msg:readonly` /
  `im:message:send_as_bot`；事件 `im.message.receive_v1` + 卡片回调
  `card.action.trigger`；回调 3 秒内只做鉴权+入队）。
