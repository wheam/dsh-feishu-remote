# 三方复审记录（DeepSeek + Claude Opus 5 + Codex gpt-5.6-sol）

> 复审时间：2026-08（第二轮独立 review）。第一轮 review 见 06-codex-review.md。
> 方法：三方并行独立审查同一组文档（01/03/04/05/06/07），其中 DeepSeek 与 Claude 侧重
> 架构/状态机/文档一致性并对照本机 dsh rc.6 源码实测，Codex 侧重逐条事实核查。
> 本文件记录**共识结论**与对应的文档修订；所有修改已落入 01/03/04/05/07 与 README。
> 结论：Conditional-Go —— 修订完成、P0 spike 项通过前不写主线代码。

## 一、共识 P0（已修）

| # | 问题 | 结论与修订 | 落在 |
| --- | --- | --- | --- |
| 1 | **answerer 顺序机制错误**：cordis.patch.yml 无排序能力（insert 只能 append），loader 并发启动条目，注册顺序不可依赖；照旧方案 apiproxy 会抢走飞书审批 | 改用 `ctx.on('approval/request', handler, {prepend:true})`（cordis dispatch 按插入序执行、prepend 即 unshift，已实测核实）；按**回合归属**认领、其余 next()；fallback=inject 屏障 | 05 §2.3、03 D3、README |
| 2 | **userQuestions 死锁**：standard preset 自带 `tool-ask-user`、plan mode 的 `exit_plan_mode` 同走该服务；全局 provider 无超时 → 问题打进没人看的浏览器、远端无限挂起（降 P1 关不掉这条路） | P0：setup 内先 mount 再 `tools.restrict({deny:['ask_user_question','exit_plan_mode']})`；备选专用 feishu preset；P1 再做 multiplexer | 05 §2.4、01 P0.5/P1、03 D8、步骤 2 |
| 3 | **GUI 反向接管未定义**：GUI 打开飞书会话默认可行（apiproxy 复用 live agent），其回合审批会被飞书 answerer 抢走 | 回合归属账本：本插件 followup 记录回合发起方；answerer 只认领飞书回合；GUI 回合输出按 session 流（同一人双端操作，文档化）；双向隔离验收 | 05 §2.1/§2.3/§6、01 目标、步骤 2/3 |
| 4 | **originKey 公式错误**：`chatId + (thread_id ?? root_id)` 无 chatType 分支、无 messageId 兜底；非话题群消息行为未定义（session 塌缩或爆炸） | 三支路：p2p→`p2p:<chatId>`；群话题→`group:<chatId>:thread:<thread_id>`；群非话题→P0 拒绝并提示"请在话题内 @我" | 05 §2.6、03 D2、01 P0.4、步骤 1/5 |
| 5 | **群范围 fail-open**：只有 open_id 白名单，owner 可在机器人所在任意群执行并向该群公开输出（@ 是投递条件不是授权条件） | `allowedChatIds` fail-closed（空=群聊全拒、仅私聊）；验收加"未授权群 @ 被拒" | 05 §2.9/§5.3/§6、01 P0.3、03 D5 |
| 6 | **apply() 拖崩 profile**：照抄参考实现 await connect，飞书连不上时 loader 将 apply 异常放大为整树回滚，web GUI 一起挂 | `apply()` 只做同步注册、永不 reject；channel 连接放 ctx.effect 后台任务自带重试 | 05 §3、03 D1 |

## 二、共识 P1（已修）

| # | 问题 | 结论与修订 | 落在 |
| --- | --- | --- | --- |
| 7 | `/stop` 默认清空 inbox（违背"不吞后续消息"定案） | `agent.cancel({kind:'user'}, {keepInbox:true})`；语义=只取消当前 turn | 05 §2.7 |
| 8 | chunk+final 重复文本（hel+hello→helhello） | 完整 assistant/message 到达即**替换**该 (turn,step) chunk 缓冲 + seq 去重 + 状态映射表测试 | 05 §2.5、步骤 6 |
| 9 | 30KB/14 天/永久错误无兜底，且 patchCard 无重试 | 体积预算（cardBodyMaxChars 12000/28000）、UTF-8 字节预检、截断+折叠+新卡；230025/230031/撤回→改发新终态卡；验收承诺收窄 | 05 §1.3/§2.5/§6 |
| 10 | 卡片"回调内原地回填省一次 API"不可实现（SDK 丢弃 handler 返回值）；按钮重复点击被 SDK 确定性去重静默丢弃 | 终态显式 updateCard；`/approve` `/reject` 文字兜底为**必需路径**；handler try/catch 失败结算 unavailable | 05 §2.3、03 D3 |
| 11 | preset 三契约未写实（`resolveAgentPreset` 不存在；mount 调用点；恢复只读 header 会错） | `meta.agentPreset` 入 header + 仅 setup 内 mount + `resolveSessionPreset({header,events})` 恢复；用公开 API `agentPresets.resolve` | 05 §2.2、03 D8 |
| 12 | inject 清单不全 | 补 `agentPresets/sessionPersistence/approval/userQuestions/workspaceRegistry` 必填注入 | 05 §3 |
| 13 | persistence 事实源边界（lazy materialization、GUI 归档、启动缓存失效、/new 空白、/resume 无回滚） | 每次 fresh list() + 过滤 archivedSessionIds；/new pending 标记协议；/resume 原子切换（先建后拆）；绑定仅进程内有效 | 05 §2.6、03 D2、步骤 5 |
| 14 | 断线状态机缺"通道终态失效"（WSClient terminalError 后不再重连） | 第六条路径：结算全部 pending unavailable、/status 标红、应用层退避重建 channel | 05 §2.3、步骤 4 |
| 15 | 验收"≤1Hz/会话"与全局调度器矛盾（N 会话=N Hz） | 改为全局出站速率受限 + 429 可恢复 + 目标可写时终态最终送达 | 05 §6.4 |
| 16 | live agent 无上限 | `maxLiveAgents` 硬上限（P1），超限拒绝新话题；idle/LRU dispose 前关入口队列 | 05 §2.8/§7、04 Phase 2 |
| 17 | secret 口径过度修正（"值不出进程"错；真实保证=已保存值不回显浏览器） | 修正口径 + 凭据唯一来源 `.credentials.yaml`（GUI 只存 credentialRef） | 05 §1.2/§3 |
| 18 | 环境前置缺失（本机无 pnpm，`dsh plugin` 不可用；Node/打包口径） | 步骤 0 加 Node ≥22 + pnpm 安装 + SDK bundle 验收 | 05 §3、步骤 0、01 约束、04 Phase 0 |
| 19 | 审批挂起期间消息语义未定义 | 普通消息排下一回合、/steer 不解审批；卡片正文明示 | 05 §2.8 |
| 20 | open_id 自举路径缺失（CLI 向导已删、设置卡片 P1） | 白名单外消息在宿主日志打印发送者 open_id | 05 §2.9 |
| 21 | 01/03/04 与 05 冲突未同步；"Web UI 链接"替代方案在重写中丢失 | 01/03/04 全面同步；超长全文→工作区文件+回显 session id | 01、03 D4、04 全文 |
| 22 | session id 前缀未定义（与上游 `lark-` 前缀在 GUI 混列风险） | `feishu-<24hex>-<base36 ts>`，同毫秒冲突 ++ | 05 §5.7、03 D2 |
| 23 | 飞书应用形态/开通清单缺失 | Phase 0 真实租户定案（个人应用 vs 企业自建）并固化开通清单 | 05 §7、步骤 1 |
| 24 | mock adapter 覆盖边界（无卡片/审批，stdin 在壳 App 进程未必可用） | 标注覆盖边界；审批闭环靠真凭据+单测 | 05 §7 |
| 25 | 借鉴来源代称混乱（cv-cat fork vs 原仓库；两个 cc-connect） | 统一 zarazhangrui/lark-coding-agent-bridge 与 jiangkuo888/cc-connect 代称 | 05、07 |

## 三、已核验为真的既有断言（三方交叉确认，无需改）

- web profile 宿主平面禁用全局 bash/fs/skill 工具、默认 preset `standard`；注入服务
  agents/agentDefaultModel/credentials/tools/systemPrompt 均存在。
- `agents.create/resume` + setup-before-publication + `followup` 独立回合语义。
- approval waterfall 语义、outcome 枚举、`scopeTarget` 分派、fallback=unavailable。
- userQuestions 单例 `DUPLICATE_PROVIDER`；apiproxy 无条件注册全局 provider 且无超时。
- `session/event` 事件名与 `turn/end.reason.kind` 六种枚举。
- SDK 1.73.0：关 `chatQueue` 即关 batching、cardAction 队列旁路；mergeBatch 串线缺陷；
  `patchCard` 无重试；400+99991400/230020 误分类不可重试；SDK 可 bundle（约 2.4MB）。
- SessionId 为编译期品牌（无格式校验）→ 确定性前缀可行；`sessionPersistence.list()` 存在。

## 四、残余未验证项（spike 前不得写主线代码）

1. `{prepend:true}` 在真实 web profile 双插件共存下的稳定性（fallback：inject 屏障）。
2. `tools.restrict({deny})` 对 preset 层工具的屏蔽是否生效（备选：专用 feishu preset）。
3. 群非话题消息的 `root_id`/`thread_id` 真实 payload（三支路公式按此定案）。
4. 飞书应用形态（个人应用 PersonalAgent / 企业自建应用）与长连接+卡片回调开通路径。
5. SDK 429 响应的 `x-ogw-ratelimit-reset` 在 websocket transport 下是否可读（影响 backoff 实现）。
