# dsh-feishu-remote

用飞书远程操控 Mac 上**正在运行**的 DeepSeek Harness 服务——把飞书机器人变成当前 dsh 会话的遥控器。

一句话定位：

```
手机飞书 ⇄ 插件（内嵌 dsh web 进程）⇄ 与 Web GUI 同一批会话
```

在飞书里发消息 = 给 Mac 上当前 Harness 服务发消息；agent 要审批 → 飞书卡片点批准/拒绝；一个飞书话题 = 一个并行 session。

**状态：方案已定案并通过 Codex（gpt-5.6-sol）独立 review，尚未开始编码。**

与姊妹项目 `deepseek-harness-mac-app`（Mac 壳 App）完全独立，互不混淆。

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/01-requirements.md](docs/01-requirements.md) | 需求清单（P0/P1/P2 与非目标） |
| [docs/02-research.md](docs/02-research.md) | 调研报告（dsh 内部能力 + 社区项目对比） |
| [docs/03-architecture.md](docs/03-architecture.md) | 架构决策记录（D1-D6） |
| [docs/04-roadmap.md](docs/04-roadmap.md) | 路线图与工作量 |
| [docs/05-implementation-plan.md](docs/05-implementation-plan.md) | 实现方案（当前方案单一事实源） |
| [docs/06-codex-review.md](docs/06-codex-review.md) | Codex（gpt-5.6-sol）独立 review 报告 |
| [docs/07-ecosystem-research.md](docs/07-ecosystem-research.md) | 生态调研：Claude Tag 类项目与远程桥（30+ 仓库） |

## 关键决策速览

- **插件内嵌 `dsh web` profile**（会话与 GUI 互通），而非独立进程
- 飞书**长连接模式**，无需公网服务器
- **话题 ↔ session** 多会话映射
- **审批卡片 + 文字兜底**（/approve /reject）
- 白名单只认本人 open_id
- **锁死 dsh 0.1.0-rc.6**（本机当前版本）
- 借鉴两个 MIT 项目：[dsh-im-hub](https://github.com/ThreeBody6666/dsh-im-hub)（形态）+ [dsh-lark-bridge](https://github.com/imetn/dsh-lark-bridge)（功能）
