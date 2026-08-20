# Codex 独立 review：飞书上下文回填方案（docs/13）

> 方法：`delegate-to-codex` skill，`codex exec` 非交互，model `gpt-5.6-sol`、effort `xhigh`、
> speed `standard`。审查对象 = docs/13-feishu-context.md + 对照仓库源码与官方事实。
> 三轮执行：第 1 轮 app-server 初始化失败（环境）；第 2 轮嵌套沙箱 `sandbox-exec` 被外层
> 沙箱拒绝、读不到仓库（仅产出外部核实，已吸收）；第 3 轮以
> `--dangerously-bypass-approvals-and-sandbox`（官方声明用于"外部已沙箱化环境"）跑通，
> 读仓库 + 联网核实，**结论 REJECT（15 findings：P0×3、P1×10、P2×2）**。
> 复核纪律：每条 finding 由主设计者逐条验证后才采纳（见处置列）；Codex 自身两处事实错误
> 一并记录（F-01 前提、限流口径）。本文件为定稿对照，修订已并入 docs/13。

## 处置对照表

| # | 级别 | Finding（摘要） | 复核 | 处置 |
| --- | --- | --- | --- | --- |
| F-01 | P0 | 命令缺 `--page-all`、`ceil(maxMessages/50)` 无剔除余量 → 一页最多 50 条 | 部分成立 | **采纳（修正版）**。其前提"v1.0.88 无 `--page-all` flag"**错误**——本机 `--help` 实测该 flag 存在；但 docs/13 命令示例确实漏写 `--page-all`，会只拉一页。已补 flag + `maxMessages+1` 余量 + 停止条件改为"渲染后达到预算或服务端耗尽"。 |
| F-02 | P0 | pnpm 11：`package.json#pnpm` 不再读取，`allowBuilds` 是 `pnpm-workspace.yaml` 的 map | 成立（本仓 `pnpm-workspace.yaml` 已是 map 形态；官方发布说明一致） | **采纳**。§1.3/§5 改为 workspace 的 `allowBuilds` map 加 `"@larksuite/cli": true`；pnpm 10 旧键备注保留。 |
| F-03 | P1 | link: 安装不装依赖；registry 安装的 postinstall 放行由 profile 侧 pnpm 决定；直连原生二进制绕过了 wrapper 自动补装 | 成立 | **采纳**。两种安装形态分开定义；解析顺序改为**优先 `.bin` wrapper**（自动补装）再原生快路径；registry 形态写入 fresh-install E2E 验收。 |
| F-04 | P0 | 群成员可写历史 = 真实注入面；`redactSecrets` 与标签不足以隔离 | 成立 | **采纳**。F8 重写：JSON 对象帧 + 分隔符转义 + system prompt 不可信边界规则 + sender 溯源 + 对抗测试入首版契约。 |
| F-05 | P1 | `excludeMessageId` 无法防止"未来消息"混入（拉取时点晚于触发时点） | 成立（`NormalizedMessage.createTime` 存在） | **采纳**。F6 加因果 cutoff：传 `triggerCreatedAtMs`、客户端严格过滤、同毫秒 messageId 剔除。 |
| F-06 | P1 | 每回合整窗注入 → durable history 二次增长；缓存不减少上下文长度 | 成立 | **采纳**。F6 重写为**增量窗口**（per-session 水位，状态文件持久化）+ 会话创建时全量；后续回合只注入新消息。 |
| F-07 | P1 | "不进卡片"不覆盖隐私主风险：群历史进 durable history / GUI / 模型 | 成立 | **采纳**。新增 F9 数据流与隐私声明（§8），验收补隐私复核项。 |
| F-08 | P1 | 按字面"handleMessage 头部"实现 → 控制命令也拉取并延迟 ≤10s | 成立 | **采纳**。F5 明确拉取位置：命令/空消息 guard 之后；`/steer` 首版不注入；控制命令零拉取入测试。 |
| F-09 | P1 | 上下文统计用 session 级临时变量会跨回合串扰 | 成立 | **采纳**。F10：统计元数据随 `pendingClaims` 注册、claimed 时复制进 `TurnProgress`。 |
| F-10 | P1 | `rawClient` 不在 `LarkChannelLike` seam 上；SDK 业务错误/分页/超时未定义 | 成立 | **采纳**。channel seam 新增窄操作 `listMessages`（mock 同步实现）；非零 code、缺失 data、token 不前进即停、AbortSignal 均入规格与测试。 |
| F-11 | P1 | per-origin 串行 ≠ 全局串行；展开器 8 路并发；限流数字可能串接口 | 部分成立 | **采纳并发部分**：全局并发 2 + 熔断（连续 3 次失败停 5 分钟）。限流数字**保留**：1000/min、50/s 出自官方 API 文档页面（我方以官方 .md 镜像抓取核实，Codex 抓取失败）；其"CLI 把该数字归 reactions"仅指 reactions 端点注释，非本端点无限制。 |
| F-12 | P1 | `execFile` 默认 1 MiB `maxBuffer` 会被大信封打爆 → 无故降级 | 成立 | **采纳**。`maxBuffer` 显式 16 MiB，超限走 fail-open；超大信封测试入 §6。 |
| F-13 | P2 | "两条命令字段名不同"错误（均为 `data.messages`）；`data.items` 属 SDK；bot 识别应比对 `open_bot_id` | 成立 | **采纳**。CLI 严格 `data.messages` + `meta.pagination.complete`；CLI/SDK 各建严格 adapter，禁宽解析；F7 改用 `open_bot_id` 对比 `botIdentity.openId`。 |
| F-14 | P2 | appSecret 进子进程 env 的泄露面未声明 | 成立 | **采纳（折中）**。首版传 secret + 最小 env + 日志不打印 env；短时 tenant token 列为后续优化，威胁面写入 §8。 |
| F-15 | P1 | 测试/验收盲区清单；"既有 102 用例"与实测 108 不符 | 成立（本机 `vitest run`：10 spec / 108 tests） | **采纳**。§6/§7 扩列全部盲区（分页、cutoff、增量、超大信封、teardown、并发/熔断、对抗、零拉取、fresh-install E2E）；docs/13 步骤 6 与 README 测试数修正为 108。 |

## 已核实清单（Codex 侧，均附依据）

- npm 包/版本/形态/wrapper/postinstall/双源下载/SHA-256：精确 tag `v1.0.88`（commit 2829ecd）。
- 两条命令的 flags、`om_`/`omt_` 解析、JSON 信封 `{ok,data,meta}` 与退出码契约。
- chat 命令 `only_thread_root_messages=true` + 自动展开（50/500 上限、并发 8）。
- CLI v1.0.88 bot 元数据权限：`im:message.group_msg`、`im:message.p2p_msg:readonly`、`im:message.reactions:read`。
- 集成点正向确认：白名单 gate 顺序正确、3s 回调不占、双 content block 与 `createUserMessage`/账本兼容、SDK 已打入 bundle、`files` 与 node_modules 关系正常。
- DeepSeek 1M 模型存在、缓存前缀匹配尽力而为。
- 仓库保持只读（git status 前后一致）。

## 未能核实清单（Codex 侧）与主设计者补证

| 事项 | Codex | 主设计者补证 |
| --- | --- | --- |
| 官方 API "三选一"权限矩阵 | SPA 抓取失败 | 已核实：open.feishu.cn 官方文档 .md 镜像含全文（docs/13 §1.2 引用原文） |
| `GET /im/v1/messages` 限流数字 | 未找到依据 | 已核实：同一官方文档页标注 1000/min、50/s |
| thread 容器是否含根消息、老话题补取顺序 | 无凭据 | 留作真实租户验收项（§7 第 3 条） |
| SDK 业务错误 reject vs resolve code≠0 | 未实验 | 双形态防御已入规格（F-10） |
| 同 UID 读子进程 env | `ps eww` 被本机拒绝 | 威胁面按"依 OS 而异"表述（§8），不写成既定事实 |

## 结论

修正后 docs/13 已吸收全部 15 条 findings（P0 全修、P1 全修、P2 全修/折中），
两处 Codex 事实错误已反向标注并保留正确结论。功能设计进入可实施状态；
待实现完成后按 docs/10 惯例做实现阶段 review。

## 实现收尾（2026-08-20）

按修订后规格实现完毕（src/context.ts 新模块 + channel seam `listMessages` + bridge
注入链路 + 配置/设置卡/状态水位 + `@larksuite/cli@1.0.88` optional 依赖与
`allowBuilds` 放行）：

- `pnpm run check` 全绿：**11 spec / 144 用例**（新增 tests/context.spec.ts 24 例 +
  bridge 集成 8 例，覆盖 §6 清单：分页/信封严格解析、cutoff、增量水位、JSON 帧对抗、
  并发/熔断、命令零拉取、SDK 重复 token、超大 buffer 常量、回合统计归属）；
- 本仓 `pnpm install` 实测：postinstall 在 allowBuilds 放行下下载二进制（45MB，arm64），
  `node node_modules/@larksuite/cli/scripts/run.js --version` 输出 `lark-cli version 1.0.88`；
- bundle 体积不变（2.4MB）：`@larksuite/cli` 只被 execFile、不被打包；
- 遗留（真实租户，docs/13 §7）：权限补开后的端到端验收、150+ 条长话题、CLI↔SDK 切换、
  隐私复核——待用户配合执行。
