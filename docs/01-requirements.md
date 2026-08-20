# 需求文档

## 背景

- 已有原生 Mac 壳 App `deepseek-harness-mac-app`（Swift + WKWebView）：管理 `dsh web` 服务生命周期，展示 Web GUI（`127.0.0.1:3080`）。
- 原始诉求：在手机上远程操控 Mac 上**当前正在运行**的 Harness 服务。
- 会话范围（已定案）：飞书创建的会话与 Web GUI 会话列表同批共享；首版**不接管** GUI 已有会话。
- 方案演进：独立移动端 UI → 聊天工具桥接（飞书机器人）→ **自建飞书插件**（本项目）。
- 网络前提：飞书方案走飞书官方长连接，不依赖 Tailscale、不需要公网 IP；用户机器常年在线（MacBook / Mac mini）。

## 目标

飞书机器人 = 当前 Mac 服务的遥控器：发消息、开新会话、多会话并行、审批、停止/恢复。人在外面时，Mac 上的 Web GUI 与手机飞书是同一批会话的两个入口（同一人双端操作，双写按回合排队）。

## 需求清单

### P0（MVP 必须有）

1. **内嵌当前服务**：插件运行在 `dsh web` profile 进程内；飞书创建的会话与 Web GUI 会话列表是同一批（共享存储）。
2. **飞书长连接**：官方 WebSocket 长连接模式，无公网回调地址；国际版 Lark 通过品牌参数支持（后置）。
3. **白名单**：仅允许本人 open_id 驱动 agent；**fail-closed**——空配置 = 拒绝一切，仅显式 `allowAllUsers: true` 才全开放（mock/echo 环境除外）。群聊另受 `allowedChatIds` fail-closed 约束（空 = 仅私聊可用）；白名单外消息在日志回显发送者 open_id 供自举。
4. **多会话**：飞书话题/线程 ↔ dsh session 一一映射；群内多话题并行互不干扰；`/new` 显式开新会话；群内非话题消息拒绝并提示"请在话题内 @我"。
5. **审批闭环**：agent 请求审批 → 飞书卡片（批准/拒绝按钮）→ 回调 respond；文字兜底 `/approve` `/reject`（按钮重复点击被 SDK 去重，文字兜底是必需路径）。结构化提问移 P1（飞书会话屏蔽 ask-user 类工具，避免问题打进浏览器导致远端挂起）。
6. **基本会话操作**：`/status` `/stop` `/resume` `/sessions` `/new` `/approve` `/reject` `/steer` `/help`。
7. **流式节流**：agent 输出按约 1 秒批量更新卡片（遵守飞书限流），绝不逐 token 发消息。

### P1（体验层）

- Web GUI 设置卡片（借鉴 im-hub）
- 话题内免 @（更高权限档位；P0 每条群消息必须 @机器人）
- 结构化提问恢复（userQuestions multiplexer 或 agent-scoped 覆盖方案验证后）
- 超长消息分片 / 截断，全文落工作区文件并回显 session id（手机打不开 loopback Web UI）
- mock 适配器（无真实凭据可测试，仅覆盖文本链路）
- **飞书上下文回填**（话题全量 + 私聊回溯；官方 lark-cli 主路径 + SDK 兜底；**v1 已实现（2026-08-20），规格见 docs/13**）

### P2（按需）

- 文件/图片双向（入站附件、出站工作区文件）
- 会话空闲自动回收
- 多平台（Telegram 等）
- 推送增强

## 非目标（明确不做）

- 团队多用户 / 权限体系（配对码、多人绑定；`allowedChatIds` 群 allowlist 属单用户安全边界，不在其列）
- 多项目（目录）绑定
- 企业微信 / Telegram（首版不做）
- 独立移动端 UI（已另议，不混入本项目）

## 约束

- **锁死 dsh 版本 `0.1.0-rc.7`**（本机当前安装版本），dsh 升级需自行适配后再解锁；飞书 SDK 精确版本一并锁死。
- **环境前置**：Node ≥22、pnpm（`dsh plugin` 依赖 pnpm）；SDK 构建期 bundle（external 仅 `@deepseek-ai/*`）。
- 不绕过部署已有的审批/护栏策略：IM 消息视同普通用户输入。
- 凭据不进仓库；参考 lark-bridge 写入本地私密文件。
- MIT 归属：继承两个参考项目的版权声明。
