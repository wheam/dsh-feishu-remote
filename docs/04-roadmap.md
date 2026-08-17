# 路线图

> 与 05-implementation-plan.md §4 的 0-6 步对齐；若与 05 冲突，以 05 为准。
> 工作量口径见下；P0 spike 项（answerer prepend、ask-user 屏蔽、preset 三契约）
> 通过前不写主线代码。

## Phase 0：环境与链路验证（1-2 天）

- 环境前置：Node ≥22、安装 pnpm（`dsh plugin` 依赖 pnpm）、飞书 SDK 精确版本 + 构建期 bundle。
- 步骤 0：仓库骨架 + `security/state/cards` 移植 + lark-bridge 测试搬来跑绿（+ 裁剪后契约测试）。
- 步骤 1（echo spike）：空壳 cordis 插件 + SDK 长连接 + fail-closed 白名单（含
  `allowedChatIds`），跑通"飞书 → Mac → 回显"链路；群话题/群非话题/p2p 三态行为验证；
  飞书应用形态（个人应用 vs 企业自建）定案并文档固化开通清单。

## Phase 1：MVP（3-5 周，单人）

- 步骤 2（共存 spike）：web profile 内挂 preset 创建有工具的飞书 session；
  answerer `prepend` 双向隔离；飞书会话无通往浏览器的提问路径。
- 步骤 3：单会话对话（create/resume + followup + 全文回复）；飞书会话出现在 Web GUI 列表。
- 步骤 4：**审批卡片闭环**（灵魂功能）+ 六条结算/断线路径 + 终态 updateCard。
- 步骤 5：话题映射（三支路 originKey）+ 全套命令 + 每话题控制队列 + `/new` pending 协议 +
  `/resume` 原子切换。
- 步骤 6：流式节流 + 进度/终态卡片 + 应用级出站调度器 + 体积预算与永久错误兜底 + 超长分片。

**验收**：人在外面用飞书完成一次需要审批的真实任务；会话同步出现在 Web GUI；断网重连可用；
双向交互隔离（飞书回合审批只到飞书卡、GUI 回合审批回 GUI）。

## Phase 2：体验完善（1-2 周）

- Web GUI 设置卡片
- 话题内免 @（更高权限档位）
- 结构化提问恢复（userQuestions multiplexer / agent-scoped 覆盖，验证后）
- `maxLiveAgents` 硬上限 + idle/LRU dispose
- cardkit 流式升级、审计与失败状态展示增强

## Phase 3：按需（视使用情况）

- 文件/图片双向
- 会话空闲自动回收策略优化
- 多平台适配（Telegram 等）
- Lark 国际版专项验收

## 工作量说明

参考项目覆盖约 70-80% 的零件（SDK 通道、卡片模板、安全工具、命令集），但**会话层交互所有权**
（answerer 顺序与回合归属、preset 三契约、ask-user 屏蔽、`/new` pending 协议、`/resume` 原子切换）
是新增设计，MVP 3-5 周的口径不变。

## 风险提示

两个参考项目均出生不足一周，dsh 为 rc 预览版——本项目自立版本、锁死依赖，不跟随上游节奏。
