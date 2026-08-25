# 生态调研：Claude Tag 类项目与远程 coding agent 桥接（2026-08-16）

> 方法：三个并行研究 agent，web_search + shallow clone（共 30+ 仓库，产物在
> `/tmp/{tag-research,cc-research,lark-research}/`），飞书 SDK 结论对 npm 1.73.0
> 发布 bundle 逐行核实。本文档是 05-implementation-plan.md 的"借鉴来源"附录，
> 与 02-research.md 互补（02 讲 dsh 生态，本文讲外部生态）。

## 一、Claude Tag 及其开源同类

| 项目 | 形态 | 与我们相关的结论 |
| --- | --- | --- |
| [Claude Tag](https://claude.com/docs/claude-tag)（官方，闭源） | 云端沙箱 + Slack | thread=session+sandbox、quiet-period 惰性重建、checklist 原地更新进度卡、agent identity 服务账户。**可借理念**：惰性重建=我们的 persistence+resume；进度卡=节流卡；团队级安全模型单用户不适用 |
| [open-claude-tag](https://github.com/Anil-matcha/open-claude-tag)（MIT） | Python + Slack | channel=单 session（话题不隔离，反例）；MEMORY.md 自 curation 是 P2+ 范畴 |
| [Zilliz MFS + Open Tag](https://github.com/zilliztech/mfs)（Apache-2.0） | 检索 harness + 极薄 glue | MFS（多源文件式检索，server+600MB 嵌入模型）对 P0/P1 过重；P2 做飞书文档/消息索引时再评估 |
| [lark-coding-agent-bridge](https://github.com/zarazhangrui/lark-coding-agent-bridge)（MIT）★ | Node + 官方 SDK | **架构与我们最像**：`chatId:threadId` 话题 scope + ChatModeCache、流式卡（streaming_mode+reasoning 面板+工具折叠+footer 终态）、PendingQueue 600ms 合并、owner/admin/allowedChats 分层、policyFingerprint（cwd+access+attachments 摘要） |
| [feishu-bridge](https://github.com/feir/feishu-bridge)（MIT）★ | Python 多后端 | **唯一有真审批闭环的开源实现**：agent 输出内嵌 confirm/ask/choices marker → 卡片按钮；bg_supervisor cancel/timeout 状态机（Cancel SLO≤10s、崩溃续跑）；sentinel probe 探测 `/resume` 可续性；CardKit 100ms 级 patch 证明卡片可承受高频更新 |
| [devbot](https://github.com/pangbit/devbot)（无 LICENSE） | Go | 必填白名单 fail-closed（本项目 2026-08-25 起不再采用）；每 chat 队列；目录↔会话关联 |
| [agent-bridge](https://github.com/Ken-Chy129/agent-bridge)（MIT） | Node 守护 | SessionStart hook **接管全部本地会话**——与我们"不接管 GUI 会话"相反（反例）；JSONL→卡片渲染管线可参考 |
| [cc-connect](https://github.com/ChanningYul/cc-connect)（MIT） | Go 多平台 | `thread_isolation=true` 与我们 P0 完全一致；auto-compress、/mode 权限模式 |

## 二、Claude Code 远程桥接生态（20 仓库）

**注入方式四流派**（与我们无关但定位了生态）：

1. **stdio stream-json 双工子进程**（[cc-connect](https://github.com/jiangkuo888/cc-connect)，最完整）：常驻 `claude --output-format stream-json --input-format stream-json --permission-prompt-tool stdio`；`control_request/control_response` 双工协议 = 我们 approval waterfall 的 Promise 挂起同构；飞书审批卡按钮 value 约定 `perm:allow/deny/allow_all`；`Im.Message.Patch` 每 1500ms/30 字符原地流式 + freeze/detach 终态；工具参数卡片摘要展示。
2. **官方 Hooks 回调式**（[ccgram](https://github.com/jsayubi/ccgram)、[afk](https://github.com/probelabs/afk)、[teleclaude](https://github.com/kokhp/claude-tg)，均 MIT）：PermissionRequest hook 阻塞 + stdout `decision` 回写；AskUserQuestion → `updatedInput`。证明"事件回调式审批 + 本地桥"模式成熟。
3. **Agent SDK 会话共享**（[open-im](https://github.com/wu529778790/open-im)，MIT）：`query()+resumeSessionId/forkSession` 与 CLI 共享 session 存储——**反面教材**：审批未转发会无人应答卡死（README 自认），印证我们 answerer 必须闭环。
4. **PTY/tmux 按键注入**（teleclaude、[ccremote](https://github.com/generativereality/ccremote) 已弃用、[claude-telegram-remote](https://github.com/oscarsterling/claude-telegram-remote)）：hack 性质，不采用；但 telegram-remote 的安全文档警示"单因子白名单=全部信任边界"值得记住。

**会话模型一致结论**：四家（cc-connect/open-im/ccc/a5c）全部把 session 文件（jsonl/transcript）当唯一事实源、重启从文件重建——**佐证我们 docs/05 §2.6"确定性前缀 + session persistence、不建显式映射表"**。

## 三、AI 网关框架 + 飞书 SDK 细节（1.73.0 bundle 逐行核实）

### OpenClaw（前身 Clawdbot/Moltbot）
单常驻 Gateway + 每渠道 adapter；session=磁盘 JSONL 实体、确定性 key（`/group/<id>`、`/thread/<threadId>`）；lane FIFO 防并发乱序；审批 UUID+命令快照+同时仅一待审；入站先落 durable queue、event ID 去重。与我们 §2.6/§2.3 设计同构，是第二佐证。

### SDK 核实结论（对 docs/05 的修正）

1. **关 `safety.chatQueue.enabled:false` 即同时禁用 batching**（batch.text 变 inert）——比方案写的"关两个"更简单。代价：cardAction 队列同被旁路，按钮处理需自己串行化。
2. **限流错误码补齐**：429 之外，SDK `classifyError` 把 `400+99991400` 误分类为 permission_denied、`230020` 误分类为 target_revoked（均不可重试）——应用级调度器必须自行把这两个码当限流处理（x-ogw-ratelimit-reset 语义）。create/reply 每接收者软限约 5 QPS（群内机器人共享）。
3. **话题键**：`thread_id`（omt_ 前缀）比 root_id 更可靠（thread_id 缺失=非话题群）；`originKey = chatId + (thread_id ?? root_id)`。
4. **去重**：官方明示用 `message_id` 去重，勿用 event_id。
5. **卡片 patch**：patch 前后 config 均需 `update_multi:true`（群聊共享更新必须）；单条消息 patch 限 5 QPS、有效期 14 天、30KB；cardkit 流式（SDK 已封装 `channel.stream()`）是 P1 更优流式方案。
6. **免 @**：不是话题特权而是权限档位（需敏感权限 `im:message.group_msg`，审核后话题群全部消息免 @ 推送）。2026-08-22 已在 Bridge 层加话题 gate：首次 @前静默并在首次 @回填前文，之后仅该话题免 @，避免其他话题被自动触发。
7. **握手**：`bot/v3/info` → `POST /callback/ws/endpoint` → WS；pong 动态更新 pingInterval（服务端权威）；autoReconnect 硬编码 30s 抖动/120s 无限重试；非法 appId 静默 15s 超时。

## 四、合并借鉴清单（按优先级）

| 借鉴点 | 来源 | 落到 docs/05 |
| --- | --- | --- |
| 审批状态机骨架（cancel/timeout/reap、Cancel SLO、崩溃续跑） | feishu-bridge bg_supervisor | §2.3 五条结算路径的落地模板 |
| `/resume` 预检（sentinel probe 探测会话可续性） | feishu-bridge | §2.6/命令集 |
| cwd 恢复校验（policyFingerprint：cwd+access 摘要） | zarazhangrui/lark-coding-agent-bridge | §2.6 cwd 校验强化 |
| 话题群判定缓存（ChatModeCache） | zarazhangrui/lark-coding-agent-bridge | §2.6 实现细节 |
| 流式卡结构（streaming_mode+reasoning 面板+工具折叠+footer 终态） | zarazhangrui/lark-coding-agent-bridge / jiangkuo888/cc-connect | §2.5 卡片模板 |
| 卡片按钮一次性 value 约定（perm:allow/deny） | jiangkuo888/cc-connect | §2.3 |
| 工具参数卡片摘要（不展全量） | cc-connect | §2.9 群聊公开假设 |
| 入站 durable queue + 每话题 lane FIFO | OpenClaw | §2.8 控制队列 |
| 白名单 fail-closed 必填 | devbot | 历史借鉴；2026-08-25 产品决策已明确不采用，操作者固定开放 |

**不引入**：MFS（过重，P2 再议）、PTY/tmux 注入、SessionStart hook 接管、显式 SessionCatalog、多后端支持。

## 五、一句话结论

30+ 仓库里**没有一个**做"内嵌 dsh web profile 进程内对接"（全是外部 CLI 桥/云端沙箱）——这正是我们的差异点；但其周边模式（审批闭环状态机、流式卡、话题键、持久化事实源）全有成熟实现可抄，模板首选 **zarazhangrui/lark-coding-agent-bridge + jiangkuo888/cc-connect + feishu-bridge** 三家 MIT 项目。
