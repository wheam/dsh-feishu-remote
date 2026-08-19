# dsh-feishu-remote

用飞书远程操控 Mac 上**正在运行**的 DeepSeek Harness 服务——把飞书机器人变成当前 dsh 会话的遥控器。

```
手机飞书 ⇄ 插件（内嵌 dsh web 进程）⇄ 与 Web GUI 同一批会话
```

在飞书里发消息 = 给 Mac 上当前 Harness 服务发消息；agent 要审批 → 飞书卡片点批准/拒绝（`/approve` `/reject` 文字兜底）；一个飞书话题 = 一个并行 session；飞书创建的会话与 Web GUI 会话列表同一批共享。

## 状态

**Phase 1（docs/05 步骤 0-6 + P1 设置卡片 + P1 流式卡片）已实现，经 Codex 十一轮 review 终审 APPROVE，流式卡片经 Round 12 独立 review 修复后关闭**：
核心链路（通道层 / 调度器 / 回合归属账本 / 审批闭环 / 话题映射 / 流式卡片）全部落地，
112 个契约测试全绿，构建产物约 2.4MB（SDK 构建期 bundle，external 仅 `@deepseek-ai/*`），
mock 冒烟（真实 dsh web 进程内加载）通过。
**真实飞书租户端到端初验已通过（2026-08-19）**：私聊 `/help` 回命令卡，白名单/长连接/
事件订阅全链路正常（见 docs/09 §7 验收记录）。

## 已实现的功能

- **内嵌 web profile**：`apply()` 只做同步注册、**永不 reject**；飞书长连接放后台 effect，断网重连 / 通道终态失效（SDK 停止重连）→ 结算全部待审批为 `unavailable`、`/status` 标红、退避重建 channel。
- **飞书长连接**：官方 `@larksuiteoapi/node-sdk` websocket transport，`safety.chatQueue` 关闭（修复同群两话题合并串线缺陷），SDK 版本锁死 `1.73.0`。
- **话题 ↔ session**：三支路 originKey（p2p / 群话题 thread_id / 群非话题拒绝），确定性前缀 `feishu-<24hex>-<base36ts>`，session persistence 为唯一事实源；`/new` pending 标记协议、`/resume` 原子切换（先探测后交换）、cwd 漂移防护、GUI 归档过滤。
- **审批闭环**：answerer 以 `{ prepend: true }` 注册 + **回合归属账本**（飞书回合才认领、GUI 回合放行）；六条结算路径（按钮 / 文字 / abort / 超时 / 停机 / 通道终态失效）均有测试；终态显式 `updateCard`；卡片 pending 绑定操作者/会话/截止时间。
- **即时反馈**：飞书回合认领时给触发消息加「敲键盘」reaction、`turn/end` 移除（装饰性、失败静默，同参考实现的 working reaction；`workingReaction: false` 可关，需 `im:message.reactions:write_only` 权限）。
- **交互隔离**：飞书会话 setup 内先 `presets.mount` 再 `tools.restrict({deny:['ask_user_question','exit_plan_mode']})`——飞书会话不存在通往浏览器的提问路径。
- **流式卡片**：进度卡运行期携带 `streaming_mode: true`（+`streaming_config` 打印参数），`session/event` 按回合聚合、约 600ms patch 同一张卡片（与 zarazhangrui/lark-coding-agent-bridge run 卡片的 `channel.stream({card})` 模式同路径：其内部即整卡 message.patch 刷新）；完整 `assistant/message` **替换**该 step 的 chunk 缓冲（helhello 缺陷修复）+ seq 水位去重；turn 结束后跳过排队的陈旧进度更新、终态 patch 绕过回合链直接入调度器（同 messageId 按代际合并，终态必胜，Round 12 F2）；终态卡显式 `streaming_mode: false` 关闭流式并切换标题/按钮；`turn/end.reason.kind` 六枚举二次映射。官方契约化的 token 级打字机需 cardkit 实体（`cardElement.content`），留作可选后续升级；客户端视觉行为以真实租户验收为准（docs/09 §7）。
- **出站调度器**：应用级全局并发上限 + 卡片更新合并（同 messageId 只发最新）+ 终态优先 + 429/`400+99991400`/`230020` 限流识别（`x-ogw-ratelimit-reset` aware 退避 + 抖动）+ 永久错误（230025/230031/230010/230011/230110/230013/230027/232009/404/99991400）改发新卡；30KB/14 天边界兜底 + 超长全文落工作区文件并回显 session id。
- **安全**：白名单 fail-closed（空 `allowedOpenIds` 拒绝一切，`allowAllUsers: true` 才开放）；群范围 fail-closed（`allowedChatIds` 空 = 群聊全拒）；白名单外消息在宿主日志回显发送者 open_id 自举；出站脱敏；状态文件 0600 原子写、损坏隔离为 `.corrupt-<ts>` 从空重建。
- **命令集**：`/new` `/status` `/stop`（`cancel({kind:'user'}, {keepInbox:true})`）`/sessions` `/resume` `/approve` `/reject` `/steer` `/view` `/help` `/commands`；Harness 原生命令透传走 **allowlist**（未知命令默认拒绝）。
- **P1**：Web GUI 设置卡片（`dsh-settings` 平铺 schema + 手写 client 模块，保存后热重载）；`maxLiveAgents` 硬上限；mock 通道（stdin→stdout 文本链路，`appId: 'mock'` 启用）。
- **飞书上下文回填（docs/13 v1，2026-08-20）**：每条普通消息注入上下文——话题内全部消息、私聊尽量回溯。官方 `lark-cli` 主路径（`@larksuite/cli@1.0.88` optional 依赖 + postinstall 自动装二进制，`pnpm-workspace.yaml allowBuilds` 放行；CLI 缺失自动降级已 bundle 的 SDK 直连，`contextBackend: auto|cli|sdk`）；增量水位窗口（新会话全量注入、后续回合只注入新消息，水位按 session 持久化）+ 因果 cutoff + JSON 帧防注入 + system prompt 不可信边界规则；全局并发 2 + 熔断；控制命令零拉取；回合卡脚注与 `/status` 显示上下文统计。群历史需 `im:message.group_msg` 权限（docs/09 §3）。

## 安装

> ⚠️ **安装/更新/升级前必读 [docs/12-plugin-install-checklist.md](docs/12-plugin-install-checklist.md)**：
> 兼容性基准 = Mac App 实际使用的 dsh（`/opt/homebrew/bin/dsh`），不是终端 PATH；
> `--dump-config` / HTTP 200 不能单独当作安装成功，必须完成浏览器控制台 +
> 插件 UI 的端到端验收（事故背景见 docs/11）。

前置：Node ≥ 22、pnpm（`dsh plugin` 依赖 pnpm）。本插件**锁死 dsh `0.1.0-rc.7`**（peerDependencies 精确版本）。

```bash
# 1. 安装到 web profile（本仓路径）
dsh plugin --profile web add link:/path/to/dsh-feishu-remote

# 2. 在 ~/.dsh/profiles/web/cordis.patch.yml 启用并配置（配置也可在 Web GUI 设置卡片里做）
# - id: dsh-feishu-remote
#   disabled: false
#   config:
#     appId: 'cli_xxx'            # 或环境变量 DSH_FEISHU_APP_ID
#     allowedOpenIds: ['ou_...']  # 你的 open_id（fail-closed，必填）
#     allowedChatIds: []          # 群聊白名单；空 = 仅私聊可用
#     cwd: '/Users/you/work'      # 必填
#     workspaceRoot: '/Users/you/work'  # 必填

# 3. 凭据：DSH_FEISHU_APP_SECRET 环境变量，或写入 ~/.dsh 的 .credentials.yaml
#    （GUI 设置卡片只存 credential ref，凭据唯一来源是 .credentials.yaml）

# 4. 重启 web 进程（改码后重跑 build + 重启）
```

改码后：`pnpm run check`（typecheck + 112 tests + bundle 构建），然后重启 web 进程验证。

## 开发

```bash
pnpm install
pnpm run typecheck   # tsc --noEmit
pnpm run test        # vitest：10 个 spec / 112 用例（契约测试，无真实凭据）
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
| [docs/13-feishu-context.md](docs/13-feishu-context.md) | 飞书上下文回填设计规格（话题全量 + 私聊回溯，官方 lark-cli + SDK 兜底；方案定案待实现） |
| [docs/14-context-codex-review.md](docs/14-context-codex-review.md) | docs/13 的 Codex 独立 review 记录（15 项 findings 处置对照，修订已并入规格） |

## 许可

MIT。继承两个参考项目的版权声明（见 [LICENSE](LICENSE)）与 lark-bridge 的 `THIRD_PARTY_NOTICES.txt`（SDK 打包）。
