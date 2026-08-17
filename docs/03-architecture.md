# 架构决策

## 总体结构

```
飞书 App ⇄ 飞书服务器 ⇄（官方长连接）插件[内嵌 dsh web 进程] ⇄ 与 Web GUI 同一批 sessions
                                            ↑
                    Mac 壳 App（deepseek-harness-mac-app）零改动
```

## 决策记录

- **D1 内嵌 vs 独立进程 → 内嵌。**
  理由：会话与 GUI 互通（= 控制当前服务，而不是另起 agent 农场）；模型/凭据配置只有一份；壳 App 零改动。
  代价：插件故障可能影响 web 进程 → 插件内部 try/catch + 每聊天串行队列兜底。

- **D2 会话映射 → 话题/线程 ↔ session（确定性前缀 + persistence 事实源）。**
  群内每个话题 = 一个独立 session；私聊各一个 session；`/new` 显式开新；`/resume <id>` 恢复。
  `originKey(chatId, rootId)` 哈希为 session 前缀，`sessionPersistence` 为唯一事实源
  （不建显式映射表，避免双事实源漂移）；状态文件仅存轻量元数据，owner-only + 原子写。

- **D3 审批 → 进程内 `approval/request` 服务。**
  卡片按钮（批准/拒绝/结构化回答）回调 respond；文字兜底 `/approve` `/reject`；
  按钮只授权**当前一次**操作。

- **D4 事件 → 消息 → 监听 `session/event`，按回合聚合。**
  约 1 秒批量更新一张卡片（节流）；超长内容分片/截断 + 附 Web UI 链接；输出脱敏。

- **D5 安全 → 白名单 fail-closed + 不绕过护栏。**
  IM 消息以普通用户输入注入会话（受部署审批策略约束）；空白名单拒绝一切；
  群聊 P0 每条消息需 @机器人；卡片 pending 记录绑定操作者/会话/截止时间；
  凭据写本地私密文件；入站附件净化。

- **D6 配置 → 首版 cordis.patch.yml；P1 加 Web GUI 设置卡片（借 im-hub 的 client 注入）。**

## 借鉴清单

| 来源 | 借走 | 丢弃 |
| --- | --- | --- |
| dsh-im-hub | web profile 插件形态、Web GUI 设置卡片（dsh-settings + client 注入）、mock 适配器、手写 protobuf 帧层（备选通道方案） | 无审批、无话题级会话的简陋功能集 |
| dsh-lark-bridge | 审批卡片闭环、话题↔session 映射、消息节流与脱敏、安全模型、命令集、官方 SDK 通道包装（LarkChannelLike） | 独立 profile 架构、多项目绑定、多人配对体系、CLI 向导 |

## 风险

- dsh rc 期内部服务接口变动 → 锁 rc.6，升级自适配。
- 飞书限流 / 卡片长度限制 → 节流 + 分片 + 链接回 GUI。
- 飞书开放平台权限配置繁琐 → 一次性成本，写文档固化步骤。
- 合规：MIT 协议，保留两个参考项目的版权声明。

## 可验证的里程碑

Phase 1 验收 = 人在外面，用飞书指挥 Mac 完成一次**需要审批**的真实任务，该会话同步出现在 Web GUI 会话列表。
