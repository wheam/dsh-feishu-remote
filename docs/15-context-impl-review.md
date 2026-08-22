# Codex 实现阶段 review：飞书上下文回填实现（docs/13 v1 → v1.1）

> 方法：`delegate-to-codex` skill，`codex exec` 非交互，model `gpt-5.6-sol`、effort `xhigh`、
> speed `standard`，`--dangerously-bypass-approvals-and-sandbox`（外层 DSH 沙箱环境，官方
> 声明场景）。审查对象 = docs/13 规格对照下的实现（src/context.ts、bridge/channel/types/
> config/settings/state/cards/client、package.json、pnpm-workspace.yaml、tests/*）。
> 审查方在 /tmp 副本实测了 `pnpm run check`、npm pack、fresh install（postinstall/allowBuilds）、
> pnpm 11 tarball consumer 布局、SDK 挂起超时复现等。
> **结论 REJECT（14 findings：P0×11、P1×3）→ 全部处置后修复（本表），v1.1 全绿
> （11 spec / 161 用例）。** 主设计者逐条复核过每一条 finding 后方采纳。

## 处置对照表

| # | 级别 | Finding（摘要） | 复核 | 处置 |
| --- | --- | --- | --- | --- |
| F-01 | P0 | CLI `create_time` 是**分钟精度**（`FormatTime` = `YYYY-MM-DD HH:mm`），时间比较破坏 cutoff/水位 | ✅ 官方源码核实（common.go:115-134） | **采纳**。窗口改为**位置切片**：desc 序按 trigger/watermark 的 messageId 位置切；trigger 不在已拉取页 → 时间兜底过滤；水位消息被撤回 → 分钟级时间兜底。fixture 改为分钟格式。 |
| F-02 | P0 | 条数预算先截断后过滤，system/deleted 挤占可注入历史 | ✅ 代码复核成立 | **采纳**。预算只数**可渲染消息**（deleted/system/空文本先剔除）。 |
| F-03 | P0 | 字符预算分支写反（`!fits \|\|` 使超限后更老消息继续入队）；超长单条水位推进导致内容永久丢失 | ✅ 代码复核成立（实测 chars=32 > 30） | **采纳**。分支修正；单条超预算**强制截断**而非丢弃（bounded），水位取自**实际进入帧**的最后一条 → 水位总能推进。 |
| F-04 | P0 | `meta.pagination.complete` 未解析/校验 | ✅ 成立 | **采纳**。strictEnvelope 要求 complete 为 boolean：缺失 = schema 漂移抛错；false = 告警（`page-limit 截断`）。 |
| F-05 | P0 | 话题根消息 mget 补取未实现 | ✅ 成立 | **采纳**。CLI 走 `+messages-mget --message-ids <rootId>`；SDK 走 seam `getMessage`（`im.v1.message.get`）；补取失败 fail-open 告警；root 追加到 desc 尾（最旧）。 |
| F-06 | P0 | CLI 解析硬编码路径，registry/pnpm 布局下失效；`auto` 运行期不降级 | ✅ 成立（tarball consumer 实测） | **采纳**。解析改 `createRequire(import.meta.url).resolve('@larksuite/cli/package.json')`（repo 与 profile 布局都成立）→ wrapper → 原生 → 直连 → PATH；`auto` 模式 CLI 运行期失败 → **taint + 降级 SDK 重试一次**，此后固定 SDK。 |
| F-07 | P0 | SDK 挂起调用不被 timeout 中止；CLI 无 teardown 中止 | ✅ SDK 挂起复现（timeoutMs=20 实测 100ms 仍 pending） | **采纳**。SDK 每页调用与超时/lifetime signal race；CLI 改 spawn 持 ChildProcess 句柄，超时/abort → `kill(SIGKILL)`；fetch 返回后复查 `this.stopped`。 |
| F-08 | P0 | `senderIsBot = isOwnBot \|\| sender_type='app'` 把其他机器人当本机器人 | ✅ 成立 | **采纳**。拆 `isOwnBot`（仅 open_bot_id 对齐）与 `isBotApp`；其他机器人保留真实名字/显示「机器人」，`contextIncludeBot:false` 只剔本机器人。 |
| F-09 | P0 | 子进程 env 整体透传 process.env；GUI 可配任意可执行路径 | ✅ 成立（fixture 继承 TEST_* 即证） | **采纳**。子进程 env 改为白名单最小集，`feishuCliPath` 移出 GUI 设置卡（仅 cordis.patch.yml / env），README 声明其等价本机代码执行。v1.2 真实联调后进一步移除 API 子进程的 App 凭据；secret 仅在一次性 `config init` 时走 stdin。 |
| F-10 | P0 | 熔断只在 gate 前检查，排队 waiter 在熔断打开后仍执行 | ✅ 成立 | **采纳**。run() 获得槽位后**复查**熔断；openCircuit 时 reject 全部排队 waiter；gate 时钟可注入（fake cooldown 测试）。 |
| F-11 | P0 | SDK post 解析不解 locale 包装（`{zh_cn:{...}}`）→ 空文本丢消息 | ✅ 成立（SDK 自身 convertPost 先 unwrapLocale） | **采纳**。extractPostText 增加 locale key 解包 + 单键对象兜底。 |
| F-12 | P1 | 水位写 fire-and-forget，teardown 不等；50 条淘汰未入规格 | ✅ 成立 | **采纳（折中）**。pendingStateWrites 追踪、teardown 有界 drain；淘汰语义写入 docs/13（淘汰 → 该会话回落全量窗口，无害）。 |
| F-13 | P1 | README 未明示数据流（durable history/GUI/模型提供商/不承诺脱敏） | ✅ 成立 | **采纳**。README 新增「隐私与数据流（飞书上下文回填）」章节。 |
| F-14 | P1 | 大量 §6 契约只有常量断言/未触发真实分支 | ✅ 成立（逐一对照 §6 清单） | **采纳**。测试重写：fixture 分钟精度、位置切片全套、字符预算真实触发、熔断准入/waiter 拒绝/恢复（注入时钟）、meta 严格校验、root mget 双后端、降级集成、SDK 挂起超时/abort、locale post、最小 env 泄漏断言、force-fit 水位。context.spec.ts 24→38 例，bridge 集成 8→9 例（降级），总量 145→161。 |

## 审查方已核实清单（摘）

- /tmp 副本 `pnpm run check`：typecheck + 11 spec + build 全绿；bundle 2,529,810 bytes，未含 CLI 包代码。
- CLI 参数含 `--page-all --page-limit 4 --no-reactions --as bot --format json`；`contextMode:off`
  与命令 guard 双短路；发送者白名单及可选的群范围限制均在拉取之前。
- semaphore 异常路径 finally 释放；F10 两条 claim 时序均可归属、GUI 回合不串。
- `@larksuite/cli@1.0.88` optional 依赖 + pnpm 11 `allowBuilds` map 配置正确（官方发布说明一致）。
- /tmp fresh install 实测 postinstall 产出 45MB 原生二进制、wrapper 输出版本号；npm pack tarball
  270KB/22 文件、不含 node_modules。
- JSON 帧无结构逃逸；execFile/spawn 参数数组无 shell 注入。
- （未能核实：真实租户权限矩阵/长话题行为、真实模型注入行为验收、真实 `dsh plugin add` 链路。）

## 结论与遗留

修正后实现与规格一致，测试覆盖 §6 清单的缺失项，进入可验收状态。真实租户验收（docs/13 §7）
仍依赖：① `im:message:readonly` + `im:message.group_msg` 权限配置（用户另派 Codex）；
② 真实长话题/CLI↔SDK 切换/隐私复核。实现阶段二轮 review 通过，后续如需可按 docs/10 惯例
做终审。

## 真实租户验证（2026-08-20）

权限已由用户侧配置完毕，本机实测（appId `cli_aa0f…`，bot 身份）：

- **私聊读取 ✅ 终验通过**：真实 p2p 会话（`oc_d9012ff70a41f4b24377ecc46680bafe`）历史
  读取成功——CLI `+chat-messages-list`（`ok:true`、`has_more` 分页正常、含用户消息与 bot
  卡片消息）与 SDK `im.v1.message.list/get`（code 0、`with_sender_name` 生效）双路径均通；
  真实数据印证 CLI `create_time` 为分钟精度（docs/15 F-01 结论成立）。
- **群/话题读取 ✅ 终验通过（同日晚些时候）**：用户把 bot 拉进测试群
  （`oc_2dd2e02d0c9305ddc2f9a72b2c36c63d`，普通群）后实测：
  - 群历史读取成功（CLI `ok:true` 返回含**从未 @ 机器人**的系统消息；SDK code 0），
    `im:message.group_msg` 生效；
  - 自建测试话题（根消息 `om_x100b676a913…`，话题 `omt_19e0653654cf1be9`）后，
    话题容器读取成功：CLI `+threads-messages-list` 返回 2 条、SDK code 0/2 items；
  - **实证发现：话题容器包含根消息**（Codex 未能核实项已解决；实现里的 root mget 补取
    为防御性兜底，正常路径不触发）。
- **新增集成缺口（已修复）**：实测发现 lark-cli v1.0.88 仅凭环境变量无法铸造 bot token
  （`config show` 未配置 → API 调用 `token_missing`），必须存在本地 config.json。
  → 插件新增**一次性配置引导**：`auto/cli` 后端首次拉取前探测 `config show`，未配置则自动
  执行 `config init --app-id … --app-secret-stdin`（secret 走 stdin），失败 taint → SDK。
  实现：`src/context.ts ensureCliConfigured` + bridge `ensureCliReady`；单测 5 例 +
  bridge 集成 1 例；全量 **167 用例**全绿。
- **v1.2 真实联调补充（2026-08-22）**：带 `LARKSUITE_CLI_APP_ID/SECRET` 执行
  `config show/init` 会被 CLI 判定为“外部凭据、不支持配置管理”，而 API 读取也不会使用本地
  profile 铸造的 token，最终报 `token_missing`。现已统一改为：secret 只经一次性 init 的
  stdin 传递；探测与历史读取子进程均使用最小环境并从本地 profile 取凭据。
  修复后以构建产物中的正式 `LarkCliProvider` 实测：测试话题拉取 2 条并完整生成
  `feishu-context` JSON 帧（2 条、建立水位）；真实私聊拉取 20 条，落在 80 条 / 50,000 字符
  的新预算内。CLI 本地配置权限为 `0600`。

## 遗留（用户侧）

1. ✅ 已把 bot 拉进测试群 → 群/话题读取终验通过（见上）。
2. ✅ 2026-08-22 已按 docs/12 流程重启 web 进程加载 v1.2：HTTP 200、设置卡四项预算值正确，
   页面就绪后无新增 console warn/error。
3. docs/13 §7 真实租户验收清单逐项跑（长话题、CLI↔SDK 切换、隐私复核）。
   测试群里留有 2 条【权限验证】消息与 1 个测试话题，可直接当验收素材或忽略。

## Claude Code 独立复核后的加固（2026-08-22）

Claude Code Opus 4.8（1M、xhigh、只读 plan 模式）对 v1.2 给出 **APPROVE，无 P0/P1**，并指出
两个 P2 鲁棒性缺口；Codex 复核成立后已修复：

1. 不同 origin 并发冷启动时，旧的 `cliBootstrapped` 布尔值可能让第二条消息在 `config init`
   完成前抢跑，误报 `token_missing` 并让本实例永久降级 SDK。现改为共享 `cliReadyPromise`，
   所有并发调用等待同一初始化结果。
2. 旧逻辑只比较 appId，同 appId 更换 appSecret 后会跳过 init。现每个 bridge 实例首次读取前
   都幂等执行一次 `config init --app-secret-stdin`，刷新当前 secret；后续 API 读取仍不携带 secret。

新增回归测试覆盖同 appId Secret 轮换，以及私聊/话题两个 origin 并发冷启动只 init 一次且
均走 CLI、不误降级 SDK。
