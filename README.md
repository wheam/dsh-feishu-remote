# dsh-feishu-remote

用飞书远程操控 Mac 上**正在运行**的 DeepSeek Harness 服务——把飞书机器人变成当前 dsh 会话的遥控器。

```
手机飞书 ⇄ 插件（内嵌 dsh web 进程）⇄ 与 Web GUI 同一批会话
```

在飞书里发消息 = 给 Mac 上当前 Harness 服务发消息；agent 要审批 → 飞书卡片点批准/拒绝（`/approve` `/reject` 文字兜底）。一个飞书话题 = 一个并行 session；普通群按群共用一个 session，只有明确 @DSH 才执行；飞书创建的会话与 Web GUI 会话列表同一批共享。

## 状态

**Phase 1（docs/05 步骤 0-6 + P1 设置卡片 + P1 进度卡片）已实现，经 Codex 十一轮 review 终审 APPROVE，进度更新链路经 Round 12 独立 review 修复后关闭**：
核心链路（通道层 / 调度器 / 回合归属账本 / 审批闭环 / 话题映射 / 可变进度卡片）全部落地，
契约测试与构建检查全绿，构建产物约 2.4MB（SDK 构建期 bundle，external 仅 `@deepseek-ai/*`），
mock 冒烟（真实 dsh web 进程内加载）通过。
**真实飞书租户端到端初验已通过（2026-08-19）**：私聊 `/help` 回命令卡，白名单/长连接/
事件订阅全链路正常（见 docs/09 §7 验收记录）。

## 已实现的功能

- **内嵌 web profile**：`apply()` 只做同步注册、**永不 reject**；飞书长连接放后台 effect，断网重连 / 通道终态失效（SDK 停止重连）→ 结算全部待审批为 `unavailable`、`/status` 标红、退避重建 channel。
- **飞书长连接**：官方 `@larksuiteoapi/node-sdk` websocket transport，`safety.chatQueue` 关闭（修复同群两话题合并串线缺陷），SDK 版本锁死 `1.73.0`。
- **飞书来源 ↔ Workspace ↔ session**：官方 `chat_mode` 区分普通群与话题群；p2p 按聊天、普通群按 chatId、话题群按 threadId 建立确定性 originKey。首次使用可从 DSH Workspace Registry 选择，或在 Documents/Desktop/Downloads/Developer/Projects 等常用父目录中新建；也可直接指定绝对路径。绑定跨重启持久化，旧会话按其已落盘 cwd 自动迁移。每个来源在选定 Workspace 内维持自己的 session，`/new` 不换 Workspace，`/workspace` 切换时开启全新 session。
- **可选 Session 分组**：安装通用 `dsh-session-groups` 插件后，本 provider 通过 `ctx.sessionGroups.assign()` 发布分组；私聊显示为“与某人的私聊”，普通群和话题群均按群名称归组。该依赖为 optional，未安装或元数据查询失败都不影响飞书会话主链路。
- **审批闭环**：answerer 以 `{ prepend: true }` 注册 + **回合归属账本**（飞书回合才认领、GUI 回合放行）；六条结算路径（按钮 / 文字 / abort / 超时 / 停机 / 通道终态失效）均有测试；终态显式 `updateCard`；卡片 pending 绑定操作者/会话/截止时间。
- **即时反馈**：飞书回合认领时给触发消息加「敲键盘」reaction、`turn/end` 移除（装饰性、失败静默，同参考实现的 working reaction；`workingReaction: false` 可关，需 `im:message.reactions:write_only` 权限）。
- **交互隔离**：飞书会话 setup 内先 `presets.mount` 再 `tools.restrict({deny:['ask_user_question','exit_plan_mode']})`——飞书会话不存在通往浏览器的提问路径。
- **极简进度卡片**：运行中只显示「正在处理」与最新一段 assistant 进展，约 600ms 普通 patch 同一张无标题栏卡片；turn 结束后，同一张卡清掉过程，只保留最后一个非空、未请求工具的 assistant 总结。因为正文会由长变短，普通任务卡不启用飞书 append-oriented `streaming_mode`，避免打字机拼接残影。普通回合卡不再显示目录、模型、session、工具轨迹、token、上下文统计或操作按钮；私聊也不再带原消息引用横幅，群话题仍保持原位回复。完整过程继续保存在 DSH 会话历史/Web GUI；审批卡保留批准/拒绝按钮作为安全边界。完整 `assistant/message` **替换**该 step 的 chunk 缓冲（helhello 缺陷修复）+ seq 水位去重；终态优先与失败兜底不变。
- **出站调度器**：应用级全局并发上限 + 卡片更新合并（同 messageId 只发最新）+ 终态优先 + 429/`400+99991400`/`230020` 限流识别（`x-ogw-ratelimit-reset` aware 退避 + 抖动）+ 永久错误（230001/230002/230025/230031/230010/230011/230110/230013/230027/232009/404/99991400）改发新卡；30KB/14 天边界兜底 + 超长全文落工作区文件并回显 session id。
- **安全、普通群触发与话题激活**：发送者白名单 fail-closed（空 `allowedOpenIds` 拒绝一切，`allowAllUsers: true` 才开放）；群范围默认开放，非空 `allowedChatIds` 可选收窄。普通群的所有成员消息可进入历史窗口，但每一轮都必须由白名单用户明确 @机器人；未 @时不创建 Session、不执行命令、不调用 Agent。话题群中每个话题首次需 @激活，首次 @ 回填前文，之后同话题可免 @；其他话题保持静默。白名单外消息不能激活或驱动 Agent。
- **命令集**：`/workspace` `/new` `/status` `/stop`（`cancel({kind:'user'}, {keepInbox:true})`）`/sessions` `/resume` `/approve` `/reject` `/steer` `/help` `/commands`；旧 `/view` 与旧卡片动作仅返回停用提示。Harness 原生命令透传走 **allowlist**（未知命令默认拒绝）。
- **P1**：Web GUI 设置卡片（`dsh-settings` 平铺 schema + 手写 client 模块，保存后热重载）；`maxLiveAgents` 硬上限；mock 通道（stdin→stdout 文本链路，`appId: 'mock'` 启用）。
- **飞书上下文回填（docs/13 v1.3）**：触发普通消息时注入上下文——普通群/话题读取最近 150 条/100,000 字符，长期私聊另受更紧的 80 条/50,000 字符上限约束（均可配置）。普通群未 @消息不会单独触发读取或 Agent，但下次 @时会通过全群 chat history 进入增量窗口。官方 `lark-cli` 主路径（`@larksuite/cli@1.0.88` optional 依赖 + postinstall 自动装二进制，`pnpm-workspace.yaml allowBuilds` 放行；CLI 缺失自动降级已 bundle 的 SDK 直连，`contextBackend: auto|cli|sdk`）；增量水位窗口 + 因果 cutoff + JSON 帧防注入 + system prompt 不可信边界规则；全局并发 2 + 熔断；控制命令零拉取。群历史需 `im:message.group_msg` 权限（docs/09 §3）。

## Workspace 工作区

插件不会再把自己的安装目录当作新飞书会话的默认工作目录。每个飞书来源（私聊、普通群或
话题）会单独绑定一个 DSH Workspace，绑定关系跨重启保留：

1. 第一次发任务时，如果 DSH 里有多个 Workspace，机器人会先发送选择卡片，并暂存这条任务；
2. 可以选择已有 Workspace，也可以从 Documents、Desktop、Downloads、Developer、Projects
   等 Mac 常用目录开始新建，或直接发送 `~/Projects/my-project` 这样的自定义路径；
3. 绑定完成后，第一条任务自动继续执行。若 Registry 里只有一个可用 Workspace，则直接绑定；
4. 已有飞书会话升级后，会按照原 Session 已记录的工作目录迁移，不会突然切到其他项目。

常用命令：

```text
/workspace                         查看或选择 Workspace
/workspace current                 查看当前绑定
/workspace use ~/Projects/demo     绑定已有目录并开启新 Session
/workspace create ~/Projects/demo  创建末级目录、绑定并开启新 Session
/new                               在当前 Workspace 内开启新 Session
/sessions                          只列出当前 Workspace 的 Session
/resume <session-id>               只恢复当前 Workspace 的 Session
```

`/workspace create` 只创建一个末级目录，父目录必须已经存在；为避免误操作，用户主目录、磁盘根目录
等过宽路径不能直接绑定。普通群仍需由获准用户明确 @机器人后才会执行任务。

## 安装

> ⚠️ **安装/更新/升级前必读 [docs/12-plugin-install-checklist.md](docs/12-plugin-install-checklist.md)**：
> 兼容性基准 = Mac App 实际使用的 dsh（`/opt/homebrew/bin/dsh`），不是终端 PATH；
> `--dump-config` / HTTP 200 不能单独当作安装成功，必须完成浏览器控制台 +
> 插件 UI 的端到端验收（事故背景见 docs/11）。

前置：Node ≥ 22、pnpm（`dsh plugin` 依赖 pnpm）。本插件**锁死 dsh `0.1.1-rc.2`**（peerDependencies 精确版本）。

```bash
# 1. 安装到 web profile（本仓路径）
dsh plugin --profile web add link:/path/to/dsh-feishu-remote

# 可选：让飞书 Session 在左栏按私聊/普通群/话题群分组
dsh plugin --profile web add link:/path/to/dsh-session-groups/packages/dsh-session-groups

# 2. 在 ~/.dsh/profiles/web/cordis.patch.yml 启用并配置（配置也可在 Web GUI 设置卡片里做）
# - id: dsh-feishu-remote
#   disabled: false
#   config:
#     appId: 'cli_xxx'            # 或环境变量 DSH_FEISHU_APP_ID
#     allowedOpenIds: ['ou_...']  # 你的 open_id（fail-closed，必填）
#     allowedChatIds: []          # 可选群限制；空 = 机器人加入的任意群都可用
#     requireMention: true        # 话题首次需 @；普通群无论此项为何值都每轮必须 @
#     # cwd/workspaceRoot 仅为旧版固定工作区部署的可选兼容项；新部署请省略。

# 3. 凭据：DSH_FEISHU_APP_SECRET 环境变量，或写入 ~/.dsh 的 .credentials.yaml
#    （GUI 设置卡片只存 credential ref，凭据唯一来源是 .credentials.yaml）

# 4. 重启 web 进程（改码后重跑 build + 重启）
```

改码后：`pnpm run check`（typecheck + 契约测试 + bundle 构建），然后重启 web 进程验证。

## 开发

```bash
pnpm install
pnpm run typecheck   # tsc --noEmit
pnpm run test        # vitest 契约测试（无真实凭据）
pnpm run build       # esbuild bundle → lib/index.js（~2.4MB）+ lib/client.js + THIRD_PARTY_NOTICES
```

Mock 冒烟（无真实凭据，仅文本链路）：`config.appId: 'mock'` 后启动 profile，
stdin 逐行输入消息、stdout 打印回复。审批闭环的按钮路径依赖真实凭据，由单测 + 真实租户验收双跑覆盖。

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/01-requirements.md](docs/01-requirements.md) | 需求清单（P0/P1/P2 与非目标） |
| [docs/02-research.md](docs/02-research.md) | 调研报告（dsh 内部能力 + 社区项目对比） |
| [docs/03-architecture.md](docs/03-architecture.md) | 架构决策记录（D1-D8） |
| [docs/04-roadmap.md](docs/04-roadmap.md) | 路线图与工作量 |
| [docs/05-implementation-plan.md](docs/05-implementation-plan.md) | 实现方案（单一事实源） |
| [docs/06-codex-review.md](docs/06-codex-review.md) | Codex（gpt-5.6-sol）独立 review 报告 |
| [docs/07-ecosystem-research.md](docs/07-ecosystem-research.md) | 生态调研：Claude Tag 类项目与远程桥（30+ 仓库） |
| [docs/08-triple-review.md](docs/08-triple-review.md) | 三方复审（DeepSeek/Claude Opus 5/Codex）共识与修订对照 |
| [docs/09-onboarding.md](docs/09-onboarding.md) | 飞书开放平台开通清单（Phase 0 验收用） |
| [docs/10-implementation-reviews.md](docs/10-implementation-reviews.md) | 实现阶段十一轮 Codex review 记录（47 项 findings 修复对照，终审 APPROVE） |
| [docs/11-incident-rc7-keyed-slot.md](docs/11-incident-rc7-keyed-slot.md) | 事故记录：rc.7 keyed slot 契约导致 Mac App 无法进入界面（已修复勿回退） |
| [docs/12-plugin-install-checklist.md](docs/12-plugin-install-checklist.md) | 插件安装/更新/升级固定检查规则（强制流程，端到端验收才算成功） |
| [docs/13-feishu-context.md](docs/13-feishu-context.md) | 飞书上下文回填设计规格（普通群/话题 + 有界私聊回溯，官方 lark-cli + SDK 兜底；**v1.3 已实现，普通群真实租户验收待跑**） |
| [docs/14-context-codex-review.md](docs/14-context-codex-review.md) | docs/13 的 Codex 独立 review 记录（15 项 findings 处置对照，修订已并入规格） |
| [docs/15-context-impl-review.md](docs/15-context-impl-review.md) | 飞书上下文回填实现阶段 Codex review（14 项 findings 处置对照，修订已并入实现） |

## 隐私与数据流（飞书上下文回填）

启用上下文回填（默认 `contextMode: auto`）后，每条进入 Agent 的普通飞书消息都会把所在
话题/聊天的历史消息（含未 @ 机器人的其他群成员发言）注入到当前回合；普通群未 @消息本身
不会触发 Agent，只会在下次明确 @时作为历史进入：

- 注入内容会进入 dsh 会话的 durable history（**本地持久化**），并在 Web GUI 会话记录中显示为
  独立、默认折叠的「上下文注入」行；蓝色用户气泡只显示当前飞书提问。修复前已经落盘的复合消息
  由浏览器兼容投影隐藏 JSON 前缀，不改写原始历史；这些数据仍随会话归档、导出、删除一同流转；
- 注入内容会**发送给你所配置的模型提供商**（DeepSeek 或其他 provider/model）；
- 本插件只做密钥形态脱敏（`redactSecrets`），**不承诺**对群讨论中的个人信息/业务敏感内容做清洗；
  默认情况下，白名单内用户可在机器人加入的任意群触发上下文读取；敏感部署请用非空
  `allowedChatIds` 将范围收窄到指定群；
- 逃生门：`contextMode: off` 完全关闭该功能；`contextIncludeBot: false` 不注入机器人自己的历史回复。
- 每次 bridge 启动后的首次读取前都会刷新本地 CLI profile（可覆盖同 App ID 下的 Secret 轮换）；
  并发首条消息共享一次初始化。secret 只经该次初始化的 stdin 传递，不会进入后续历史读取
  子进程的 argv 或环境变量。
- 另注意：`feishuCliPath`（任意可执行路径）仅作为受信任管理员配置（cordis.patch.yml / 环境变量），
  Web GUI 设置卡不可修改——它等价于本机代码执行权限。

## 许可

MIT。继承两个参考项目的版权声明（见 [LICENSE](LICENSE)）与 lark-bridge 的 `THIRD_PARTY_NOTICES.txt`（SDK 打包）。
