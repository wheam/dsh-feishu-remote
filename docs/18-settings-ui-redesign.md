# 18 · 设置页重设计方案（草案）

状态：已实施（分支 settings-ui-redesign，2026-08-24）。经 Codex 六轮 review/verify，结论可合入 main。配套设计稿：Claude Design 画布（4 张 artboard）。P1/P2 未做项见 §3.2 与 §5。

## 0. 问题定义

现状（`src/client.js`，1468 行）的核心问题不是样式，而是**信息结构**：

1. **两个入口同一份内容**：`settings.plugin.item`（插件配置里的折叠卡）和 `settings.section`（左栏独立分区）都注册了完整 UI，状态同源、外观不同，且后者在真机上未必渲染（截图里左栏无「飞书遥控」）。
2. **4 层折叠**：宿主手风琴 → 插件卡 → `<details>` BotEditor → `<details>` BotDisclosure；legacy 路径再并列一个「手动配置与高级设置」`<details>` 套 6 组 27 字段。
3. **三套保存模型并存**：扁平字段逐项 `scope.set`（非事务，失败继续写）/ bots 一次 CAS RPC / `convertLegacy`、扫码**即时写配置无保存按钮**。两个 `dirty` 互相把按钮灰掉且不解释。
4. **实现概念泄漏到文案**：「主机器人」（= `sessionNamespace==='legacy'`）、「legacy 字段」、「机器人内部标识」（主键可编辑）、「App Secret 凭据引用」、布尔/枚举下拉直接显示 `true/false/sdk/locked`。
5. **暴露过多**：`contextBackend`、`contextP2pMaxMessages/Chars`、`contextMaxMessages/Chars`、`contextTimeoutMs`、`contextIncludeBot`、`progressUpdateMs`、`cwd`、`workspaceRoot`、`id` 都在 GUI 里；而 Day-1 最关键的「谁能用」却折进二级 disclosure，且没有 fail-closed 提示。
6. **状态信息不到位**：`lastConnectedAt`、`missingCore[]`/`missingEnhanced[]`、`providerStatus(domain_switched)` 都有数据不上屏；「已连接」绿徽章可与「尚未授权用户」并存；「凭据已安全保存」是常量文案；删除无确认、错误只有一句通用话、后端异常原文上屏。

## 0.1 真机实测（2026-08-23，DSH rc.2）

- 设置是**固定 800×800 的弹窗**，左栏约 150px，插件内容列约 **560px 宽、内部滚动**。设计稿已按此尺寸重排；不能按 760px 整页设计。
- 左栏**确实渲染**了 `settings.section` 分区，但标签被截成「飞书遥控（dsh-…」→ `settings.title` 的 nav label 应只用「飞书遥控」。
- legacy 单机器人首屏其实不差（一张状态卡 + 「添加机器人」），问题从「更换或修复」展开的 4 按钮面板、以及「手动配置与高级设置」展开后连续三屏 27 字段开始。
- 「插件 → 插件配置」里同时还有一张完整的飞书遥控折叠卡（双入口实证）。
- 另一个宿主脆弱点：插件 bundle 404（仓库搬家后 link 失效）会让**整个 GUI** 显示 Failed to load plugins，与 docs/11 的 slot 事故是独立路径。

## 1. 设计原则

- **一个心智模型**：「机器人列表 → 机器人详情」。单机器人就是列表里只有一行；不存在 legacy / 多机器人两种 UI。
- **一个入口**：左栏「飞书遥控」整页。插件配置页里的卡只做**摘要 + 跳转**（三个状态点 + 「管理机器人 →」）。
- **一个保存模型**：详情页底部粘性保存条（`● N 处修改未保存 · 放弃 / 保存`），bots 与全局字段一起走一次 CAS RPC。扫码、补权限、移除是**带确认的即时动作**，UI 上明确区分。
- **先说人话，再说字段**：每个设置一行「标题 + 一句说明 + 控件」（宿主「通用设置」页的 setting-row 模式）；布尔用开关，枚举用中文下拉，列表用 chips。
- **默认收起、按需暴露**：固定 4 组——工作区 / 谁能使用 / 角色与模型 / 高级。调优字段不进 GUI。
- **状态要能行动**：每个非正常状态配一个指向下一步的按钮（补开权限 / 重试 / 重新扫码），不只给徽章。

## 2. 信息架构

```
左栏「飞书遥控」
├─ 空态（无机器人）：扫码卡（二维码 + 一句话 + 倒计时 + 取消）+ 底部「手动填写」链接
├─ 列表页
│   ├─ 标题 + 「添加机器人」（主按钮，唯一）
│   ├─ 机器人行 ×N：头像(首字) · 名称 · 平台 pill · 一行摘要(工作区 · 谁能用 · 运行中任务) · 状态点+文字 · ›
│   └─ 「全部机器人」组：合计任务上限（远程只读提示只在页面顶部出现一次）
└─ 详情页（/bot/:id）
    ├─ 面包屑 · 头像 · 名称 · 平台 · App 尾号 · 上次连接时间 · 启用开关
    ├─ [条件] 注意横幅：缺少 N 项权限 / 连接失败 / 尚未授权用户 → 配动作按钮
    ├─ 工作区：默认工作区(目录选择器) · 允许聊天切换(开关=workspacePolicy)
    ├─ 谁能使用：允许的用户(chips, 扫码者自动加入) · 限定群聊 · 群里需要 @ · [红]对所有人开放
    ├─ 角色与模型：Profile(文件选择, 显示 basename+大小) · 模型(provider/model 合一下拉) · Agent 预设 · 读取聊天记录(开关=contextMode)
    ├─ 高级(可折叠)：连接信息(只读摘要 + 重新扫码绑定…) · 本机器人任务上限 · 移除机器人…
    └─ 粘性保存条
```

### 2.1 字段映射（GUI 可见 ↔ config）

| 组 | 控件 | 字段 | 备注 |
|---|---|---|---|
| 头部 | 开关 | `enabled` | |
| 工作区 | 目录输入+选择器 | `defaultWorkspace` | 复用宿主 directory-picker |
| 工作区 | 开关「允许在聊天里切换」 | `workspacePolicy` | on=default, off=locked；off 且 defaultWorkspace 空 → 行内红字 |
| 谁能使用 | chips（粘贴完整 `ou_…`，仅视觉脱敏） | `allowedOpenIds` | 扫码者自动注入；无人员目录，不假装有「选人」 |
| 谁能使用 | chips | `allowedChatIds` | 空=「不额外限制群，但仍受用户名单限制」 |
| 谁能使用 | 开关「话题首次使用需要 @机器人」 | `requireMention` | 固定说明「普通群每轮始终需要 @」——开关不影响普通群 |
| 谁能使用 | 开关(红) | `allowAllUsers` | 开启需确认 |
| 角色与模型 | 路径输入（显示 basename+大小） | `profileFile` | 只选路径不编辑正文（docs/17 §10.2）；宿主无 `pickFile` API，文件选择器留到有 Host 能力后 |
| 角色与模型 | 下拉 | `provider`+`model` | 从宿主模型列表取；留空=跟随默认 |
| 角色与模型 | 下拉 | `agentPreset` | 从宿主 preset 列表取 |
| 角色与模型 | 开关 | `contextMode` | on=auto, off=off；说明「历史会注入模型请求、发给提供商」 |
| 高级 | 只读摘要 | `brand`/`appId`/`appSecretRef` | 不可直接编辑；改用「重新扫码绑定」或「手动填写」对话框 |
| 高级 | 数字 | `maxLiveAgents` | |
| 全局 | 数字 | `maxTotalLiveAgents` | |

**从 GUI 移除**（仅 `cordis.patch.yml`）：`id`（自动生成）、`contextBackend`（多机器人固定 sdk）、`context*` 六个上限/超时、`progressUpdateMs`、`interactiveTimeoutMs`、`commandAllowlist`、`cwd`、`workspaceRoot`、`feishuCliPath`。

### 2.2 状态模型（每个机器人一个）

优先级：已停用 → 配置不完整(appId/secretRef 缺) → 连接失败(带错误与「重试」) → 缺少权限(列出缺哪几项，「扫码补开」) → 已连接但无人可用(「添加用户」) → 已连接(运行 N 个任务 · 上次连接时间) → 连接中。

列表行只显示一个状态；详情页用横幅展开原因 + 动作。

### 2.3 动作与确认

| 动作 | 形式 | 确认 |
|---|---|---|
| 添加机器人 | 列表页主按钮 → 扫码卡（选择已有 / 创建新；两按钮并列，非破坏） | 无 |
| 扫码补开权限 | 详情横幅按钮 | 无（非破坏） |
| 重新扫码绑定 | 高级 → 次按钮，文案明确「会替换当前 App」 | 是 |
| 移除机器人 | 高级 → 红色次按钮 | 是（说明不删飞书侧应用与凭据） |
| 对所有人开放 | 开关 | 是 |
| 保存 / 放弃 | 粘性条 | 无；宿主无离页守卫契约，改为 controller 保留 draft、返回时继续显示未保存 |

### 2.4 文案规则

- 不出现：legacy、主机器人、namespace、凭据引用、wire、revision、loopback。
- 远程页面只有一种说法：「此页面不是在 Host 本机打开，无法管理机器人」（P0 没有远程只读数据通路，不承诺「只能查看」）。
- 错误必须指向下一步（docs/16 §5）；后端错误码映射为中文，原文进「详情」折叠。

## 3. 技术落地

### 3.1 前端（`src/client.js`）
- 主入口为 `settings.section`（也可评估 `settings.plugins.tab`——作为「插件」分区里的一个 tab）。`settings.plugin.item` 改为**无按钮的纯摘要卡**（三个状态点 + 「请在左栏「飞书遥控」中管理」文字）：宿主 `openSection()` 只提供给 onboarding step，普通 section/tab 没有导航 API，因此不做跳转按钮、也不做卡内路由 fallback。两处注册改为各自独立 try/catch（docs/11 防线）。
- `settings.section` 已在 rc.2 真机验证可渲染（见 §0.1），入口风险解除；nav label 改为「飞书遥控」。
- 删除 `LegacyAdvancedSettings` / `FIELD_GROUPS` / `CardForm` 三件套；legacy 配置在 UI 层**一律投影成一行 bot**，但普通编辑走新的单次 CAS `settings/save-legacy`（保持根配置形状，**不转换**）；只有「添加机器人」才触发现有原子 `convert-legacy`（docs/17 §10.3）。legacy 行隐藏没有真实映射的控件（启用开关、移除、全局合计上限）。
- 列表/详情视图用 `useState` 路由（无 URL），保持 jsx-runtime 手写风格。
- 统一 `invalid()` 为字段级错误数组 `{botId, field, message}`，渲染到对应行。

### 3.2 后端（`src/admin.ts` 等）
- 禁止删除最后一个 bot（只允许停用）：删到 0 会让 `bots.length>0` 判定回落 legacy，patch.yml 里的旧根字段会复活（`admin.ts:143-155`、`bots.ts:90-108`）。
- `bots/status` 已有 `lastConnectedAt`（仅本次运行，文案用「本次运行最近连接」）、`profile{bytes}`。权限缺项/`providerStatus` 目前只存在于单例 `OnboardingStatus`（`onboarding.ts:94-119`），**不能**归属到某一行：P0 只在扫码卡内显示；P1 增加带 `appId/botId` 归属的只读 per-bot probe 后再上横幅。
- 详情页「补开权限 / 重新扫码绑定 / 重试」需要新的带 `targetBotId` 的 RPC（现有 `update`/`retry` 只认 pending App 或 legacy 根 `appId`，`onboarding.ts:526-545, 595-603`）。
- 新增 client DTO，从 `settings/editor-snapshot` 中剔除 `feishuCliPath/statePath/inboundDir`（当前 `BOT_WIRE_KEYS` 会把它们原样发给浏览器，`admin.ts:24-31`）；Host 保存时从现有配置合并保留；加「snapshot JSON 不得含这些键」的测试。
- `settings.plugin.item` 与 `settings.section` 两个注册改为**各自独立**的 try/catch（当前前者在外层 try，失败会跳过后者，`client.js:1418-1458`）；plugin item 固定传 `key`。
- 错误码：`onboarding.handleRpc` 把 `read_only/busy/duplicate_app/...` 原样透传，不再统一成 `internal`。
- `LEGACY_ROOT_FIELDS` 去掉 `appSecret`（审计 M3）。
- 模型/预设下拉直接用宿主 `connection.api.llm.models()` / `agentPresets.list()`，不新增插件 RPC；目录中缺失的当前值要保留显示，`broken` 的 preset 不可选。
- 远程（非 loopback）页面：所有 Admin/Onboarding RPC 都是 loopback-only（`index.ts:188-196`），目前**没有**远程只读数据通路。P0 明确远程页面为「不可用，请在 Host 本机管理」；若要「只读查看」，需新增脱敏的远程可读状态 endpoint，扫码 endpoint 绝不放宽。

### 3.3 测试
- `tests/client-context-display.spec.ts` 里的源码字符串断言需整体重写为对 `botPresentation`/状态模型纯函数的行为断言。

## 4. 分期

1. **P0（结构）**：单入口 + 列表/详情 + 粘性保存 + 字段瘦身 + 文案清理。
2. **P1（状态）**：横幅与动作、缺权限明细、lastConnectedAt、字段级错误。
3. **P2（体验）**：目录选择器、模型/预设下拉、chips 编辑、离页拦截。

## 5. Codex review 结论（2026-08-23）

Codex（gpt-5.6-sol, xhigh）对本稿给出 8 blocker / 8 major / 5 minor，核心结论：**视觉与 IA 方向对，但数据模型、迁移与宿主契约未闭合，不能直接进 P0**。已据此修订 §2.1 / §2.3 / §3。要点：

1. legacy 普通保存不得隐式转换（两次 RPC 非原子，且违反 docs/17 §10.3）→ 新增 `save-legacy`。
2. 禁止删到 0 个 bot（会回落 legacy 并复活旧根字段）。
3. per-bot 补权/重绑/重试缺后端（onboarding 单例、无 `targetBotId`）。
4. 权限缺项只在单次扫码状态里，不能当长期 per-bot 状态。
5. 远程只读没有数据通路，P0 明确为「不可用」。
6. 摘要卡「管理机器人 →」无宿主导航 API（`openSection` 只给 onboarding step）；**先排查分区为何没显示**，不做卡内路由 fallback。
7. `feishuCliPath` 等 host-only 键仍随 snapshot 下发浏览器 → 独立 client DTO。
8. 两个 slot 注册共用外层 try，需各自隔离。

推荐顺序：① 冻结红线（legacy 保存、最后 bot、DTO、slot 隔离）→ ② 远程边界 + `targetBotId` RPC + 结构化 `checks[]`/`reasonCode` 状态 → ③ 本机最小列表/详情（legacy 只投影）→ ④ 完整扫码状态机（过期刷新 / Lark 域切换 / failed）、字段级 `issues[]`、安全文案 → ⑤ 宿主模型/预设 API、目录选择器、file-picker 最后。

设计稿中「详情页横幅 + 补权按钮」「摘要卡跳转」属于 ②/③ 之后才能实现的交互。
