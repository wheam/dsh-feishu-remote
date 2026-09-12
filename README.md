# dsh-feishu-remote

[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.1.5--rc.1-4f46e5)](https://github.com/deepseek-ai/deepseek-harness)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522-339933)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

把飞书或 Lark 变成 Mac 上 **DeepSeek Harness（DSH）Web 服务的远程控制端**。

你可以在手机上给本机 Agent 发任务、查看流式进度、批准或拒绝工具调用、切换 Workspace，
并继续使用 Web GUI 中的同一批 Session、模型、凭据和工具。

```text
手机飞书 / Lark
       ⇅
飞书云端（官方长连接，无需公网回调）
       ⇅
dsh-feishu-remote（运行在 dsh web 进程内）
       ⇅
DSH Agent · Session · Workspace · Web GUI
```

## 它解决什么问题

DSH 原本主要通过本机 Web GUI 使用。这个插件为**已经运行的 `dsh web`**增加一个飞书入口，
适合在离开电脑后继续处理任务：

- 在飞书里发消息，任务直接进入本机 DSH；
- Agent 请求敏感工具操作时，在飞书审批卡片中批准或拒绝；
- 飞书创建的 Session 同时出现在 Web GUI，不会另起一套 Agent 服务或会话数据库；
- 私聊、普通群和话题群按稳定规则隔离 Session；
- 每个聊天来源可以选择自己的 DSH Workspace；
- 一台 Mac 上可以同时运行多个、配置彼此隔离的飞书机器人。

它**不是**云端托管服务，也不会让关机或休眠的 Mac 继续工作。Mac、`dsh web` 和网络连接都必须
保持可用。插件代码与 DSH 运行在同一进程、拥有同一系统用户的权限，安装前应像审查其他本机
Agent 插件一样审查源码。

## 当前状态

本项目目前是**源码安装的开发者预览版**：

- 精确兼容 DSH `0.1.5-rc.1`，其他版本默认视为不兼容；
- 核心链路已经通过自动化测试、真实 `dsh web` 加载和企业自建飞书应用初验；
- PersonalAgent 扫码开通、多机器人、Workspace 与 Markdown Profile 已实现并通过自动化测试；
- PersonalAgent 的真实 Feishu/Lark 租户全矩阵验收、双真实 App 并发验收仍待完成；
- 尚未提供公开 npm 包或本项目的预构建 Release，当前需要克隆源码后本地构建。

DSH 仍处于 RC 阶段，相邻 RC 版本可能包含破坏性变化。安装、更新或启用前都必须先运行仓库内的
兼容性检查。

## 主要能力

### 会话与群聊路由

| 飞书场景 | 触发规则 | DSH Session |
| --- | --- | --- |
| 私聊 | 任意用户直接发消息 | 每个私聊来源独立 |
| 普通群 | 每一轮都必须由任意用户明确 `@机器人` | 整个群共用一个 |
| 话题群 | 每个话题第一次必须 `@机器人` 激活；之后该话题可免 `@` | 每个话题独立 |

普通群里未 `@` 的聊天不会单独启动 Agent，但在下次明确 `@` 时可以作为有界历史上下文注入。
未激活的话题保持静默。机器人不设个人操作者白名单：任何能联系到它的用户都可以激活话题、
执行命令或驱动 Agent。

### 远程任务体验

- 一张极简进度卡从“正在处理”更新到最终结果；完整过程仍保存在 DSH Session 中；
- 工具审批卡支持按钮操作，并保留 `/approve`、`/reject` 文字兜底；
- `/stop` 或给运行中任务卡添加 ❌ reaction 可停止当前回合；
- 任务开始时可添加“敲键盘”reaction，结束后自动移除；
- 支持飞书图片和文件入站，超长输出会保存到 Workspace 并作为 Markdown 文件发回飞书；
- 出站请求具备并发限制、卡片更新合并、限流退避、终态优先和失败兜底。

### Workspace、上下文与多机器人

- 首次使用可从 DSH Workspace Registry 选择 Workspace、创建一个末级目录，或输入绝对路径；
- Workspace 绑定跨重启保存；`/new` 保留当前 Workspace，切换 Workspace 会开启新 Session；
- 每轮都会告诉模型当前群名/群类型、发言人、消息/话题标识、@对象和附件元数据；
- 回复群消息时按 `replyToMessageId` 精确读取被回复内容，保留其中的文档标题与链接；
- 可选读取最近的私聊、群聊或话题历史，作为不可信上下文发送给当前模型；
- 一个插件实例可管理多个飞书 App，每个机器人独立配置凭据、可选群范围、Workspace、模型和并发；
- 每个机器人可加载一份本机 Markdown Profile，作为稳定的角色和工作方式说明；
- 可选配合 [`dsh-session-groups`](https://github.com/wheam/dsh-session-groups) 在 Web 左栏按飞书来源分组。

## 安装

### 1. 准备环境

当前安装流程面向 macOS 上的 DSH Web/Mac App 环境，需要：

- DeepSeek Harness `0.1.5-rc.1`；
- Node.js 22 或更高版本；
- pnpm `11.22.0`（`dsh plugin` 本身也会调用 pnpm）；
- 能访问飞书/Lark 的网络。

克隆本仓库：

```bash
mkdir -p ~/Developer/dsh-plugins
cd ~/Developer/dsh-plugins

git clone https://github.com/wheam/dsh-feishu-remote.git
cd dsh-feishu-remote
```

如果仓库尚未公开，请使用你获授权的 SSH 地址克隆。

确认工具版本：

```bash
node --version
corepack enable
corepack prepare pnpm@11.22.0 --activate
pnpm --version
```

### 2. 检查 DSH 兼容性

```bash
./scripts/check-dsh-compat.sh
```

只有输出 `GO` 才继续。脚本会同时检查终端 PATH 和 Mac App 实际使用的
`/opt/homebrew/bin/dsh`；两者不一致时，以 Mac App 使用的版本为准。

### 3. 安装依赖并构建

```bash
pnpm install --frozen-lockfile
pnpm run check
```

`pnpm run check` 会依次执行 TypeScript 检查、契约测试和 bundle 构建，并生成未提交到 Git 的
`lib/index.js`、`lib/client.js`、类型声明与第三方许可文件。

### 4. 链接到 Web profile

仍在 `dsh-feishu-remote` 仓库目录中执行：

```bash
DSH_FEISHU_PLUGIN_DIR="$PWD"
dsh plugin --profile web add "link:$DSH_FEISHU_PLUGIN_DIR"
```

然后完整重启 DSH Web 服务：

- 使用 DeepSeek Harness Mac App：退出并重新打开 App；
- 从终端运行：停止旧进程后重新执行 `dsh web`。

不要同时启动两个占用同一端口的 `dsh web` 进程。

### 5. 选择已有机器人或创建新机器人

在 **Host 本机**打开 Web GUI：

1. 进入设置中的「飞书遥控（dsh-feishu-remote）」；
2. 已经创建过 PersonalAgent 时，点击「选择并绑定已有机器人」；首次使用也可以点击「创建并绑定新机器人」；
3. 用手机飞书或 Lark 扫码；
4. 选择已有机器人或确认创建新机器人，并核对权限、事件和卡片回调；
5. 等待页面显示「已连接」。

扫码入口只允许从 Host 本机的 `localhost` 页面调用。通过 LAN 或 Tailscale 打开的设置页可以查看
状态，但不能发起创建或补权，这是防止远端页面接触短期二维码和本机凭据写入能力的安全边界。

选择已有机器人时不会重复创建应用；创建新机器人会生成归扫码者所有的 PersonalAgent。两种流程都会将 App Secret 写入 DSH 管理的
`~/.dsh/.credentials.yaml`，操作者无需登记 open_id 且固定对所有人开放。Secret 不会返回浏览器，
也不会写入 `cordis.patch.yml`。

卸载插件不会删除飞书侧应用、`~/.dsh/.credentials.yaml` 中的凭据或插件状态。重新安装后，如果
原设置仍在，插件会直接重连原机器人；如果设置已被清空，可再次扫码并选择原来的机器人，无需
再创建一个。

> PersonalAgent 扫码链路已完成自动化验证，但真实租户全矩阵仍在验收中。如果租户不支持所需
> 能力、扫码失败，或你已经有企业自建应用，请使用下面的[手工配置](#手工配置已有飞书应用)。

### 6. 验证安装

完成下面所有检查后，才能认为安装成功：

1. `dsh --profile web --dump-config` 能看到启用的 `dsh-feishu-remote`；
2. Web GUI 能正常打开，浏览器控制台没有 `Failed to load plugins` 或 slot/key 错误；
3. 「飞书遥控」设置页能显示、保存并热重载；
4. 在飞书私聊机器人发送 `/help`，能收到命令说明；
5. 发送一个普通任务，结果出现在飞书，同时 Session 出现在 Web GUI；
6. 再执行一个需要工具审批的任务，验证批准和拒绝按钮。

完整验收红线见 [docs/12-plugin-install-checklist.md](docs/12-plugin-install-checklist.md)。仅有
`--dump-config` 成功或 Web 页面返回 HTTP 200，都不足以证明前端插件契约已经正确加载。

## 手工配置已有飞书应用

扫码不可用时，可以绑定现有的企业自建应用或 PersonalAgent。

### 飞书开放平台配置

在飞书开放平台为应用启用机器人，并配置：

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| 权限 | `im:message.p2p_msg:readonly` | 接收私聊 |
| 权限 | `im:message.group_at_msg:readonly` | 接收群内 `@机器人` |
| 权限 | `im:message:send_as_bot` | 发送消息和卡片 |
| 权限 | `im:message:readonly` | 读取私聊历史和显式回复目标 |
| 权限 | `im:message.group_msg` | 接收普通群消息，并读取群/话题历史及群内回复目标 |
| 权限 | `im:message.reactions:write_only` | 添加和删除工作状态 reaction |
| 事件 | `im.message.receive_v1` | 接收消息事件 |
| 回调 | `card.action.trigger` | 处理审批与 Workspace 卡片 |

事件和卡片回调使用**长连接**，无需公网 URL。企业自建应用需要创建并发布新版本，权限和订阅才会
真正生效。更细的控制台步骤见 [docs/09-onboarding.md](docs/09-onboarding.md)。

### 保存 Secret

把 Secret 写入 DSH 管理的凭据文件，而不是仓库或普通配置文件：

```yaml
# ~/.dsh/.credentials.yaml
version: 1
refs:
  DSH_FEISHU_APP_SECRET: "替换为真实 App Secret"
```

```bash
chmod 600 ~/.dsh/.credentials.yaml
```

如果文件已有其他凭据，请保留现有的 `version`、`refs` 和 `records` 内容，只增加对应引用；不要
覆盖整个文件。也可以让启动 `dsh web` 的进程继承同名环境变量，但环境变量优先级更高且在 GUI
中只读，不适合作为长期管理方式。

### 配置插件

在 `~/.dsh/profiles/web/cordis.patch.yml` 中覆盖插件配置，或在 Web GUI 的高级设置中填写同样字段：

```yaml
- id: dsh-feishu-remote
  disabled: false
  config:
    appId: cli_xxxxxxxxxxxxx
    appSecretRef: DSH_FEISHU_APP_SECRET
    brand: feishu
    allowedChatIds: []
    requireMention: true
```

操作者默认且固定对所有人开放，不需要填写用户 `open_id`。`allowedChatIds` 为空表示不额外限制
群范围；非空时只限制机器人在哪些群接受任务，不影响私聊。保存后重启或等待设置热重载，再发送
`/help` 验证。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `/help` | 显示远程控制说明 |
| `/status` | 查看连接、模型、Workspace 和 Session 状态 |
| `/workspace` | 查看、选择或创建 Workspace |
| `/workspace current` | 查看当前绑定 |
| `/workspace use <路径或名称>` | 使用已有目录或已登记 Workspace，并开启新 Session |
| `/workspace create <完整路径>` | 创建一个末级目录、绑定并开启新 Session |
| `/new` | 下一条普通消息开启全新 Session，保留当前 Workspace |
| `/sessions` | 列出当前飞书来源、当前 Workspace 内的历史 Session |
| `/resume <session-id>` | 恢复当前范围内的历史 Session |
| `/steer <内容>` | 给正在运行的 Agent 补充或纠正信息 |
| `/stop` | 停止当前回合，保留已确认的后续消息 |
| `/approve` / `/reject` | 处理当前一次工具审批的文字兜底 |
| `/commands` | 查看允许透传的 Harness 原生命令 |

未知斜杠命令默认拒绝。只有出现在 `commandAllowlist` 中的 Harness 原生命令才会透传。

## Workspace 使用方式

插件不会把自身安装目录当作新会话的默认工作目录。每个私聊、普通群或话题会独立绑定 DSH
Workspace：

1. 若配置了可用的 `defaultWorkspace`，首次任务优先绑定它；
2. 否则当 Registry 只有一个可用 Workspace 时自动绑定；
3. 有多个 Workspace 时发送选择卡片，并暂存当前任务；
4. 也可发送 `/workspace use ~/Projects/demo` 或 `/workspace create ~/Projects/demo`；
5. 绑定完成后，暂存的第一条任务会自动继续。

`/workspace create` 只创建最后一级目录，父目录必须已经存在。用户主目录、磁盘根目录等过宽路径
不能直接绑定。`workspacePolicy: locked` 会强制所有来源使用 `defaultWorkspace`，并统一拒绝切换。

## 多机器人与 Markdown Profile

单机器人工作正常后，在 Host 本机 Web GUI 点击「添加机器人」即可继续新增。界面会在后台自动
迁移旧配置，原机器人继续使用 legacy Session 命名空间；新机器人使用包含 App 身份的隔离命名空间，
不会替换或重复显示原机器人。

添加时可以选择自己已有的 PersonalAgent，也可以扫码创建一个新的。
插件会自动保存 App Secret、生成独立凭据引用、开放所有操作者并建立长连接；不需要
手抄 App ID 或 Secret。只有凭据已由外部单独管理的自建应用，才使用「手动配置（高级）」。

多机器人模式中：

- `bot.id`、`appId`、状态文件、附件目录、Session、审批和限流彼此隔离；
- 每个机器人使用独立 `appSecretRef`；
- 每个机器人可以指定 `defaultWorkspace`、`workspacePolicy`、`provider`、`model` 和 `agentPreset`；
- `profileFile` 是本机管理员维护的 UTF-8 Markdown 文件，建议 2–8 KiB，硬上限 32 KiB；
- 多机器人上下文后端固定为 `sdk`，不能配置共享的 `lark-cli` profile；
- `maxTotalLiveAgents` 控制所有机器人合计并发，`maxLiveAgents` 控制单机器人并发；`0` 表示不限。

Profile 会作为 system prompt 的一部分发送给所配置的模型提供商。不要在其中放 App Secret、
API key、密码或不希望发送给模型的内容。

手工配置示例：

```yaml
- id: dsh-feishu-remote
  disabled: false
  config:
    maxTotalLiveAgents: 12
    bots:
      - id: project-bot
        enabled: true
        appId: cli_xxxxxxxxxxxxx
        appSecretRef: DSH_FEISHU_PROJECT_SECRET
        defaultWorkspace: /Users/me/Projects/example
        workspacePolicy: locked
        profileFile: /Users/me/.dsh/bot-profiles/project-bot.md
        agentPreset: standard
        contextBackend: sdk
        maxLiveAgents: 4
      - id: general-bot
        enabled: true
        appId: cli_yyyyyyyyyyyyy
        appSecretRef: DSH_FEISHU_GENERAL_SECRET
        defaultWorkspace: /Users/me/Projects
        workspacePolicy: default
        contextBackend: sdk
```

多机器人迁移、身份隔离、回滚与验收矩阵见
[docs/17-multi-bot-workspace-profile.md](docs/17-multi-bot-workspace-profile.md)。

## 常用配置参考

以下字段均可用于单机器人；除 `bots`、`maxTotalLiveAgents` 外，大部分也可放在 `bots[]` 的每个
机器人中。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `appId` | `DSH_FEISHU_APP_ID` 环境变量 | 飞书 App ID |
| `appSecretRef` | `DSH_FEISHU_APP_SECRET` | DSH 凭据引用名，不是 Secret 本身 |
| `brand` | `feishu` | `feishu`、`lark` 或兼容别名 `larkoffice` |
| `allowedChatIds` | `[]` | 可选群白名单；空列表不限制已加入的群 |
| `requireMention` | `true` | 话题首次是否需要 `@`；普通群始终每轮需要 `@` |
| `defaultWorkspace` | 空 | 首次绑定使用的 Workspace 路径、ID 或名称 |
| `workspacePolicy` | `default` | `default` 允许切换；`locked` 强制默认 Workspace |
| `provider` / `model` | DSH 当前默认 | 覆盖机器人使用的模型选择 |
| `agentPreset` | DSH 当前默认 | 覆盖 Agent preset |
| `profileFile` | 空 | 本机 Markdown Profile 路径 |
| `maxLiveAgents` | `0` | 单机器人最大 live/provisional Agent 数，`0` 不限 |
| `commandAllowlist` | `[]` | 可透传的 Harness 原生命令名，不带 `/` |
| `enableApprovals` | `true` | 启用飞书工具审批闭环 |
| `interactiveTimeoutMs` | `600000` | 审批等待时间 |
| `progressCards` | `true` | 启用可更新的任务进度卡 |
| `progressUpdateMs` | `600` | 普通进度更新合并窗口，最小 250 ms |
| `workingReaction` | `true` | 任务运行时添加“敲键盘”reaction |
| `maxInboundFileBytes` | `20971520` | 入站文件上限，默认 20 MiB |
| `maxOutboundFileBytes` | `31457280` | 出站文件上限，默认 30 MiB |
| `cardBodyMaxChars` | `12000` | 单卡正文预算 |
| `contextMode` | `auto` | `auto` 开启最近聊天历史回填；`off` 关闭该历史窗口（不关闭当前会话元数据和明确回复对象） |
| `contextBackend` | `auto` | 单机器人可用 `auto`、`cli`、`sdk`；多机器人必须 `sdk` |
| `contextMaxMessages` | `150` | 群聊/话题历史消息总上限 |
| `contextMaxChars` | `100000` | 群聊/话题历史字符总上限 |
| `contextP2pMaxMessages` | `80` | 私聊额外消息上限 |
| `contextP2pMaxChars` | `50000` | 私聊额外字符上限 |
| `contextTimeoutMs` | `10000` | 单次上下文读取超时 |
| `contextIncludeBot` | `true` | 上下文中是否包含机器人历史回复 |
| `statePath` | `~/.dsh/feishu-remote/<appId>.json` | 路由、Workspace 绑定和水位状态 |
| `inboundDir` | `~/.dsh/feishu-remote/inbox` | 入站附件目录；多机器人默认再按 App ID 隔离 |

旧版 `cwd` 与 `workspaceRoot` 只为已有部署保留，必须成对出现。新部署应使用 DSH Workspace，
不要再用这两个字段固定工作目录。

单机器人还支持以下环境变量：

- `DSH_FEISHU_APP_ID`
- `DSH_FEISHU_APP_SECRET`
- `DSH_FEISHU_ALLOWED_CHAT_IDS`（逗号分隔）
- `DSH_FEISHU_CLI_PATH`

多机器人应使用各自的 `appSecretRef`，不要依赖共享的 legacy 环境变量。

## 隐私与安全边界

- **操作者固定开放。** 插件不按用户 `open_id` 做白名单判断；任何能联系到机器人的用户都可以
  发起任务。旧配置中的 `allowedOpenIds`、`allowAllUsers` 以及同名环境变量只为升级兼容而接受，
  运行时会忽略。
- **群范围可选收窄。** `allowedChatIds: []` 表示不限制机器人已加入的群；非空列表只接受指定群。
- **审批只授权一次。** 审批卡与操作者、聊天、Session 和截止时间绑定，重复或越权操作被拒绝。
- **聊天历史会发给模型。** 开启 `contextMode: auto` 后，被读取的群聊、话题和私聊历史会注入
  DSH durable history，并发送给当前模型提供商。它们被标记为不可信上下文，但插件只做密钥
  形态脱敏，不承诺清理个人信息或业务敏感内容。
- **当前飞书场景会发给模型。** 每个普通任务都会携带群名/ID、会话类型、发言人、消息/话题
  标识、@和资源元数据；用户使用飞书“回复”时，还会按 ID 读取并携带被明确选择的那一条消息。
  原始事件、tenant key、完整成员列表和无关身份字段不会进入模型。字段清单与降级规则见
  [docs/19-feishu-runtime-context.md](docs/19-feishu-runtime-context.md)。
- **Profile 会发给模型。** `profileFile` 正文进入 system prompt；状态页只显示路径、大小和 digest。
- **Secret 不进普通设置。** 扫码写入 DSH credential provider；手工配置也应只写
  `~/.dsh/.credentials.yaml`，并保持 `0600` 权限。
- **配置路径等同本机权限。** `feishuCliPath` 可以指定任意可执行文件，只应由受信任的本机管理员
  修改，Web GUI 不开放该字段。
- **本机插件不是安全沙箱。** DSH Agent 工具与插件进程使用同一 OS 用户；高隔离需求应在操作系统
  或独立主机层实现。

如需关闭未被当前消息明确选择的最近聊天历史窗口，设置 `contextMode: off`。当前会话元数据和用户
主动回复的目标消息仍属于当前输入，会继续注入。敏感部署建议同时配置非空 `allowedChatIds`，只允许
指定群使用。

## 更新、卸载与数据保留

本地 `link:` 安装的更新流程：

```bash
git pull --ff-only
pnpm install --frozen-lockfile
pnpm run check
```

然后完整重启 `dsh web`。链接安装直接使用当前仓库中的 `lib/`，不需要再次执行 `dsh plugin add`。
如果 `./scripts/check-dsh-compat.sh` 输出 `NO-GO`，不要继续启用更新后的插件。

卸载插件：

```bash
dsh plugin --profile web remove dsh-feishu-remote
```

卸载后重启 `dsh web`。卸载不会自动删除以下数据：

- `~/.dsh/feishu-remote/` 中的状态和附件；
- 已创建的 DSH Session 与 Workspace；
- `~/.dsh/.credentials.yaml` 中的凭据；
- 飞书侧已经创建的应用；
- Markdown Profile 文件。

这些数据需要由管理员单独确认后再清理，插件不会执行不可逆删除。

## 故障排查

### 设置页没有出现

```bash
test -f lib/index.js && echo "bundle exists"
dsh --profile web --dump-config
```

确认已经运行 `pnpm run check`、插件行未被禁用，并在浏览器 DevTools 控制台检查
`Failed to load plugins` 或 slot/key 错误。RC 版本不一致时先停止操作，不要只改
`peerDependencies` 绕过兼容闸。

### 机器人没有响应

依次检查：

1. 设置页是否显示已连接；
2. 非空 `allowedChatIds` 是否包含当前群；
3. 普通群本轮是否明确 `@机器人`，话题是否已由任意用户激活；
4. 飞书应用版本是否已经发布并包含消息事件；
5. Host 日志是否出现凭据、权限、长连接或限流错误。

### 卡片按钮没有反应

确认应用已订阅 `card.action.trigger` 并发布新版本。临时使用 `/approve` 或 `/reject` 处理当前
审批。重复点击、其他用户点击、跨 Session 点击和过期卡片都会被安全拒绝。

### 上下文或 reaction 不工作

上下文回填需要历史消息权限，普通群完整上下文需要 `im:message.group_msg`；工作状态 reaction
需要 `im:message.reactions:write_only`。这些增强权限缺失时核心消息链路仍可工作，日志会说明降级。

更完整的故障与验收步骤见 [docs/09-onboarding.md](docs/09-onboarding.md) 和
[docs/12-plugin-install-checklist.md](docs/12-plugin-install-checklist.md)。

## 开发

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run check
```

| 命令 | 内容 |
| --- | --- |
| `pnpm run typecheck` | `tsc --noEmit` |
| `pnpm run test` | Vitest 契约测试，不需要真实飞书凭据 |
| `pnpm run build` | esbuild Host bundle、复制 Web client、生成类型与第三方许可 |
| `pnpm run check` | 依次执行 typecheck、test、build |

无真实凭据的文本链路冒烟可使用 `config.appId: mock`。真实审批按钮、飞书租户权限、普通群历史
和多 App 隔离仍应按部署验收矩阵测试。

## 进一步阅读

| 文档 | 内容 |
| --- | --- |
| [docs/03-architecture.md](docs/03-architecture.md) | 总体架构与关键设计决策 |
| [docs/09-onboarding.md](docs/09-onboarding.md) | 手工创建飞书应用、权限与真实租户验收 |
| [docs/12-plugin-install-checklist.md](docs/12-plugin-install-checklist.md) | 安装、更新和 DSH 升级的强制检查清单 |
| [docs/13-feishu-context.md](docs/13-feishu-context.md) | 历史上下文回填、安全边界与数据流 |
| [docs/16-personal-agent-qr-onboarding.md](docs/16-personal-agent-qr-onboarding.md) | PersonalAgent 扫码开通设计与验收矩阵 |
| [docs/17-multi-bot-workspace-profile.md](docs/17-multi-bot-workspace-profile.md) | 多机器人、Workspace、Profile、迁移与回滚 |
| [docs/11-incident-rc7-keyed-slot.md](docs/11-incident-rc7-keyed-slot.md) | DSH RC 前端契约事故记录与永久防线 |

其余 `docs/` 文件记录需求、调研、实现计划和多轮 review，主要面向维护者。

## 许可证

[MIT](LICENSE)。项目保留参考实现的版权声明；bundle 的第三方依赖许可在构建生成的
`lib/THIRD_PARTY_NOTICES.txt` 中。
