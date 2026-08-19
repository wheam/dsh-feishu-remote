# 调研报告

调研时间：2026-08-16。方法：通读两个社区项目源码、检查本机 dsh 安装包源码（`host-apiproxy`、`client-connection` 等）、GitHub API 元数据、npm registry 查询。

## 结论

用聊天工具（飞书）做 dsh 的前端**完全成立**，社区已有可借鉴实现。最优路径：**自建一个内嵌 `dsh web` 的飞书插件**，取两个社区项目之长。

## 一、dsh 内部可复用能力（已从源码验证）

- **类型化 RPC（Typert）**：`POST /api/<域>.<方法>`（如 `session.list`），带 rpcId 关联；每个域有 `.d.ts` + `.schema.js` 契约。
- **事件流**：SSE `/api/events.mux` + `/api/events.host`；断线重连 + 指数退避已实现。
- **插件机制**：cordis bundle；`dsh plugin --profile <name> add <pkg>`；本机已有 `web` / `headless` 两个 profile；插件可跑进 `web` profile（im-hub 的设置卡片即证明）。
- **进程内服务**：`agents.create/resume`、`session/event`、`approval/request`、`userQuestions`——两个桥项目都直接使用，无需走 HTTP。
- **版本**：调研时本机 dsh = `0.1.0-rc.6`；随后 Mac App 自动升级到 `0.1.0-rc.7`，
  插件已随 rc.7 适配（事故与规则见 docs/11 / docs/12）。

## 二、社区项目对比

| | [dsh-im-hub](https://github.com/ThreeBody6666/dsh-im-hub) | [dsh-lark-bridge](https://github.com/imetn/dsh-lark-bridge) |
| --- | --- | --- |
| 定位 | 多平台 IM 网关插件（飞书/企微/TG） | 飞书双向控制桥 |
| 架构 | 内嵌 dsh（可进 web profile），**会话与 GUI 互通** ✅ | 独立 profile 进程，会话与 GUI 分离 ❌ |
| 多会话 | 每聊天一个 session（群内无话题隔离）⚠️ | **话题/线程级隔离** + `/new` `/resume` ✅ |
| 审批 | **无** ❌ | 卡片按钮 + 文字兜底 ✅ |
| 文件/图片 | 无 | 双向 ✅ |
| 安全 | 白名单（留空=全开放，文档有警告） | 白名单 + 配对码 + 文件沙箱 + 逐操作复核 ✅ |
| 配置体验 | **Web GUI 设置卡片** ✅ | 命令行向导（可自动建飞书应用） |
| 平台 | 飞书/企微/TG ✅ | 仅飞书 |
| 分发 | npm `0.2.0` ✅ | 仅 GitHub；Node 22+ + pnpm |
| 工程质量 | mock 适配器 | CI + 测试 + SECURITY.md |
| 状态 | 8/14 创建，2★，8/15 有提交 | 8/13 创建，7★，8/14 有提交；声明验证过 rc.6 |
| 协议 | MIT | MIT |

## 三、两个项目各自的问题

### dsh-lark-bridge（功能最全，但定位错位）

1. **独立进程**（`dsh --profile lark`）→ 会话与 Web GUI 不互通，对"控制当前服务"是硬伤。
2. 不在 npm，无 semver；要求 Node 22+ 与 pnpm。
3. 按团队多人设计：多项目绑定、配对码、三档卡片视图——单人使用一大半是负担。
4. 出生 2 天、单作者，rc 期验证范围有限。
5. 自带 `cordis.patch.yml` 可能与其他插件/皮肤冲突。

### dsh-im-hub（定位正好，但功能薄）

1. **无审批交互**——远程操控场景的硬伤（agent 卡审批时手机干瞪眼）。
2. 群内无话题级多会话。
3. 纯文本，无文件能力。
4. 白名单留空 = 全开放（文档有警告但默认危险）。
5. 同样出生 2 天、单作者。

## 四、其他 npm 包（仅记录，未深究）

`dsh-feishu-bot`、`dsh-feishu-connect`（plutokeating）、`harness-lark`、`dsh-feishucard`——一次性尝试居多，质量参差，仅作参考。

## 五（补）源码复核补遗（2026-08-16，逐行通读两个项目源码后）

修正前三节基于 README/元数据的判断：

1. **飞书层归属搞反了**：手写 protobuf 帧层（`feishu-ws-frame.js`，约 200 行零依赖，带测试）是 **im-hub** 的；**lark-bridge 用的是官方 `@larksuiteoapi/node-sdk` 的 websocket transport**，并围绕它搭了消息去重（24h TTL）、串行队列、分批发送、附件下载、断线重连。卡片回调/附件/限流策略全在 SDK 侧。修正"借鉴清单"中"im-hub：飞书长连接 protobuf 帧"的表述。
2. **lark-bridge 覆盖了我们 P0+P1 的九成**：`groupSessionScope: 'thread'`（默认）即话题↔session；审批 answerer 与 `/approve` `/reject`、超时/abort 五条结算路径齐全；`userQuestions` 选项卡片闭环；`progressUpdateMs` 默认 1000ms 节流 + send-then-update 同一卡片；`/steer`（`agent.steer`）、`/stop`（`agent.cancel({kind:'user'})`）、原生命令透传（`ctx.commands.execute`）均为白送能力；安全层（`redactSecrets`/`bounded`/`isInside`/文件限幅/原子状态文件 0600）完整。
3. **web profile 兼容性比预估更顺**：lark-bridge inject 的 `agents/agentDefaultModel/credentials/tools/systemPrompt` 全是 web profile 已有核心服务，未依赖独立 profile 专属设施。真正的移植工作 = 删（多项目/配对码/CLI 向导，约一半代码）+ 验（answerer 与 GUI apiproxy 注册顺序）+ 换（CLI 向导 → im-hub settings 卡片机制）。
4. **answerer 协作模式实证**：`ctx.on('approval/request', (req, next) => agents.get(agent.id) 未命中即 return next())`——按 agent 所有权分流、非己即放行，GUI 与飞书插件共存仅剩注册顺序一个验证点。
5. **结论更新**：底本策略 = lark-bridge 裁剪为主干（通道层用官方 SDK + `LarkChannelLike` 接口隔离），im-hub 补 settings 卡片机制与 mock adapter。审批超时默认 10 分钟 fail-closed 至 `unavailable`（`interactiveTimeoutMs`）；映射表位置默认 `~/.dsh/lark-bridge/<appId>.json`。版权保留两项目 MIT 声明 + lark-bridge 的 `THIRD_PARTY_NOTICES.txt`。

## 六、派生的关键认知

- dsh 的契约层（RPC + SSE 事件）是官方为"独立客户端"预留的，自建客户端/插件是一等公民用法。
- 当前安全边界 = loopback 绑定，HTTP 层无鉴权；任何远程化方案都必须自带白名单/令牌。
- dsh 处于 rc 预览期，内部服务接口变动风险高 → 版本锁死是纪律，不是建议。
