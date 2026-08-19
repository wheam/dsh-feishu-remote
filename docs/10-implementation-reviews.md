# 实现阶段 Codex Review 记录（十一轮）

> 方法：每个实现模块完成后，用 Codex CLI（gpt-5.6-sol，xhigh）对仓库做**只读**
> 独立 review（对照 docs/05 单一事实源 + 本机 dsh rc.6 源码 + 两个参考项目）。
> 十一轮共 47 项 findings（P0/P1/P2）全部修复并有回归测试；Round 11 终审
> **APPROVE**（无 P0/P1 残留，仅剩真实租户端到端验收的外部依赖）。
> 本文件记录结论与修复落点，与 docs/06（方案期 review）互补。

## Round 1（2026-08-18，步骤 0-6 + P1 卡片首版完成后）

结论：**REJECT** —— 回合归属启发式在 GUI/飞书消息交错时会把审批路由到错误入口，
另有 11 项生命周期/调度/安全问题。

| # | 级别 | 问题 | 修复落点 |
| --- | --- | --- | --- |
| 1 | P0 | 计数器式回合归属与真实认领消息不相关（rc.6 先发 `turn/start` 后 `Inbox.claim`） | 改为**精确关联**：`pendingClaims`（按 `createUserMessage` id）+ 监听 `agent/inbox/claimed` 映射确切回合；进度卡改在首个事件/终态发送 |
| 2 | P1 | 已有 live 会话时 `/new` 标记不生效 | `handleMessage` 先查标记；`rotateToFresh()` 探测-交换-清理 |
| 3 | P1 | 调度器合并会改写执行中任务；close 后重试被搁置 | dispatch 前移出合并索引；closed 时结算 'closed' |
| 4 | P1 | 首卡与终态竞争产生两张卡；回复上下文可变 | `progress.sendChain` 每回合串行 + `progress.reply` 不可变快照 |
| 5 | P1 | 重连退避被错误取消；通道生命周期无 effect 归属 | 每连接/终身两个 AbortController；退役通道 finally disconnect；index.ts 生命周期 effect |
| 6 | P1 | 审批回调未绑定卡片消息/不可变会话 | pending 快照（openId/chatId/sessionId/messageId）全量校验 |
| 7 | P1 | 设置热重载竞态，旧配置可能赢 | watcher 回调返回 sync 的 Promise + 代际计数 |
| 8 | P1 | 路径包含性只做词法检查；恢复无策略指纹 | cwd/workspaceRoot realpath 规范化；落盘目录按规范根复核；恢复按规范 cwd 比对 |
| 9 | P1 | `maxLiveAgents` 跨 origin 竞态 | `admit()` 预约计数包住所有 create/resume |
| 10 | P1 | 设置卡直写 secret，违背 `.credentials.yaml` 单一来源 | 平铺 schema 只暴露 `appSecretRef`，值永不进 settings |
| 11 | P2 | `./client` 声明目标缺失；SDK 仅 devDep | build 产出 `lib/types/client.d.ts`；SDK 转 optional peer |
| 12 | P2 | 体积预算循环无后置条件 | 缩小后仍超限 → `buildOversizeCard()` 恒定尺寸兜底卡 |

## Round 2（2026-08-18，修复验证轮）

结论：**REJECT（7 项 P1 残留）** —— 修复方向全部正确，但每项都有残余竞态。

| # | 级别 | 问题 | 修复落点 |
| --- | --- | --- | --- |
| 1 | P1 | 失败的旧 patch 重试可覆盖更新的终态卡 | 按 messageId 的单调 generation，重试前校验（过期→superseded）；同 messageId patch 不同时执行 |
| 2 | P1 | `/resume`/`/new` 切换会丢弃已入队消息、孤儿运行中卡片 | `assertSwitchable()`：运行中或 pendingClaims 非空即拒绝切换；切换时结算旧会话审批 |
| 3 | P1 | `/new` 标记消费与创建/交换不原子 | 探测创建 → 持久化消费标记（失败则处置探测、旧会话不动）→ 内存交换 → 旧句柄清理为事后清理 |
| 4 | P1 | 代际检查不阻止过期重载停掉当前桥 | index.ts 单一互斥锁串行全部 commit；成功/失败路径都在触碰当前桥前复查代际；disposer 返回 stop Promise；start() 在 await 后复查 stopped |
| 5 | P1 | 达到上限时替换被误拒 | `admit(work, replacing)` 对已有 live 的 origin 扣减一位 |
| 6 | P1 | 审批快照执行不完整 | 卡片回调强制 `messageId` 严格相等；文字兜底校验当前 live sessionId；切换结算旧会话审批 |
| 7 | P1 | GUI 把布尔写成字符串（渲染空白、保存被拒） | `booleanField` spec：String 格式化、解析回真布尔 |
| 8 | P2 | 兜底卡仍无尺寸后置条件 | `buildOversizeCard()`：仅有限标题 + 一行静态文本，恒定远低于 28KB |

## Round 3（2026-08-18，第二轮修复验证）

结论：**APPROVE-WITH-FIXES** —— 无 P0，3 项 P1 生命周期/并发 + 3 项 P2 残留。

| # | 级别 | 问题 | 修复落点 |
| --- | --- | --- | --- |
| 1 | P1 | 切换守卫不权威（只查本插件账本、且检查过早） | `assertSwitchable` 增查 `agent.inbox.hasPending`（rc.6 Inbox）；监听 `agent/inbox/discarded` 清理账本；探测 await 之后、同步交换之前**重验**守卫 |
| 2 | P1 | `stop()` 不排空进行中的创建/控制队列 → 热重载泄漏 live agent | `onMessage` 以 `stopped` 关门；`stop()` 先 await 全部 originQueues/creating 再处置句柄；三条创建路径在 await 后复查 `stopped` 并自处置探测句柄 |
| 3 | P1 | `maxLiveAgents` 预约-所有权间隙（预约释放早于 agents.set） | `acquireReservation()` 返回**租约**，持有到同步所有权提交之后才释放；任何提交前失败都处置探测句柄 |
| 4 | P2 | 调度器：被阻塞的终端队头把后续终端工作降级到普通队列之后；忙等；generation 表不清理 | 终端队列**整体**扫描优先于普通队列；全部就绪工作被阻塞时等待完成信号（50ms 兜底）；无引用即剪除 generation |
| 5 | P2 | 重载代际分配在 commit 内，慢 commit 不会被新变更失效；卸载不排空 commitTail | 代际在 `sync()` 进入互斥锁**之前**分配并传入 `commit(gen)`；卸载 disposer 返回 `commitTail.then(() => bridge?.stop())` |
| 6 | P2 | 兜底卡可能虚称"全文已保存" | 措辞改为指向 Web GUI 会话记录（真实、无条件成立） |

## Round 4（2026-08-18，第三轮修复验证）

结论：**APPROVE-WITH-FIXES** —— 无 P0，2 项 P1 + 2 项 P2 残留。

| # | 级别 | 问题 | 修复落点 |
| --- | --- | --- | --- |
| 1 | P1 | 旧回合收尾工作可跨越会话切换（sendChain 尾任务读取被换掉的 session） | `pendingFinalize` 记录每回合终态链；`awaitQuiescent()` 在同步交换前排空；stop() 一并 await |
| 2 | P1 | `stop()` 不排空脱离的出口工作 | 调度器异步 `shutdown()`（关闸+结算+等 active）；stop 记忆化（并发共用同一 teardown） |
| 3 | P2 | 并发 `drain()` 突破并发上限 | drain 单飞（`drainPromise` 共享同一循环）；throttle 后复查 closed/容量 |
| 4 | P2 | `next.start()` 期间的代际变更未复查 | start() 之后复查 `closed || gen !== generation`，过期即停并清空 |

## Round 5（2026-08-18，第四轮修复验证）

结论：**APPROVE-WITH-FIXES** —— 2 项 P1 + 1 项 P2 残留。

| # | 级别 | 问题 | 修复落点 |
| --- | --- | --- | --- |
| 1 | P1 | 终结器是"单槽可替换"而非"全部未决"；十轮后放行不安全；检查-交换间仍有异步续段 | 终结器**链式**累积（`pendingFinalize = prev.then(finalize)`，交换时清空）；`awaitQuiescent` 用**同一性比较**探测新增终结器、耗尽即**拒绝** |
| 2 | P1 | teardown 可能在到达 shutdown 前死等（生产者在等调度结果）；grace 到期带着 active>0 返回 | 先关调度闸再等生产者；生产者等待**10s 竞速封顶**；`disconnect()` 中止挂起调用后再做末次 shutdown；grace 可配（`shutdownGraceMs`） |
| 3 | P2 | 持久送达审计缺失（§6.4） | `deliveryFailures` 入状态文件（上限 50，解析校验）；`enqueueOutbound` 统一包装 onPermanent 落账；`/status` 展示每会话失败数 |

## Round 6（2026-08-18，第五轮修复验证）

结论：**APPROVE-WITH-FIXES** —— 3 项 P1 + 1 项 P2 残留。

| # | 级别 | 问题 | 修复落点 |
| --- | --- | --- | --- |
| 1 | P1 | 静默检查与交换不在同一微任务（异步续段可塞入工作） | `awaitQuiescent(entry, what, commit)`：最终检查后**同步调用 commit 回调**执行整个交换 |
| 2 | P1 | shutdown 仍可能带 active 出口工作返回；SDK send/updateCard 无 abort；disconnect/dispose 无界 | 通道包装器把 send/updateCard 与 bridge 生命周期信号**竞速**（teardown 中止挂起调用）；shutdown **记忆化**（同一 deadline）；disconnect/dispose 5s 竞速封顶 |
| 3 | P1 | 审计详情未脱敏（原始 error.message 持久化） | 落账前 `redactSecrets(error.message)` |
| 4 | P2 | 审计解析不完整（枚举/长度/保留策略） | 语义枚举校验、字段长度封顶、严格校验全部保留记录、保留最新 50 条（`.slice(-50)`） |

## Round 7（2026-08-18，第六轮修复验证）

结论：**APPROVE-WITH-FIXES** —— 2 项 P1 残留。

| # | 级别 | 问题 | 修复落点 |
| --- | --- | --- | --- |
| 1 | P1 | 生产者等待超时后，终结器稍后释放会把探测句柄提交进已停机的桥（会话复活） | `awaitQuiescent` 在 commit 前同步校验 `!stopped && sessions.get(key) === entry`，不满足即抛（catch 处置探测句柄） |
| 2 | P1 | race 不取消底层 HTTP；abort 监听器不清理；connectLoop 的 disconnect 无界；退役句柄不在 teardown 快照内 | raced() 在 finally 移除监听器；统一有界 `disconnectBounded()`；`retiringHandles` 集合由 teardown 再排空 |

## Round 8（2026-08-18，第七轮修复验证）

结论：**APPROVE-WITH-FIXES** —— 2 项 P1 + 1 项 P2 残留。

| # | 级别 | 问题 | 修复落点 |
| --- | --- | --- | --- |
| 1 | P1 | 探测句柄未登记进任何 teardown 所属集合（终结器永不释放时泄漏） | `provisionalHandles` 集合：获取后立即登记、提交时移除、失败路径条件处置、teardown 排空 |
| 2 | P1 | `retireHandle` 在 5s 定时器胜出时删除句柄，底层 dispose 仍挂起 → teardown 无法二次排空 | 追踪**原始** dispose Promise（Map<handle, raw>），仅在 raw 落定后删除；teardown 对同一 raw 竞速 |
| 3 | P2 | 同步抛错发生在 finally 安装前 → 监听器泄漏 | `Promise.resolve().then(operation)` 规范化调用 |

## Round 9（2026-08-18，第八轮修复验证）

结论：**APPROVE-WITH-FIXES** —— 1 项 P1 + 2 项 P2 残留。

| # | 级别 | 问题 | 修复落点 |
| --- | --- | --- | --- |
| 1 | P1 | 冷 `/new` 在标记写盘后才登记探测句柄；迟到失败可能双重 dispose | 三个获取点**立即登记**；失败路径仅在 `provisionalHandles.delete(handle)` 为真时 dispose（恰好一次） |
| 2 | P2 | 微任务前入队的 abort 仍会执行原始 SDK 操作（停机后副作用） | 规范化操作内部**复查** `signal.aborted` 再调用 operation() |
| 3 | P2 | 已中止的审批信号不会再发 abort 事件 → 白等到超时 | `askApproval` 开头 `request.signal?.aborted === true` 立即返回 `cancelled`（不发卡） |

## Round 10（2026-08-18，第九轮修复验证）

结论：**APPROVE-WITH-FIXES** —— 1 项 P1 + 1 项 P2 残留。

| # | 级别 | 问题 | 修复落点 |
| --- | --- | --- | --- |
| 1 | P1 | 冷 `/new` 分支重复登记探测句柄（teardown 处置后再次 add 复活已处置句柄） | 每个获取点**恰好一次**登记（wantFresh 分支在标记写盘前，其余分支紧随获取）；删除多余的无条件 add |
| 2 | P2 | 文档计数过期（99 vs 102；review 历史只到 3 轮） | README/docs 计数与 review 历史同步至 Round 10 |

## Round 11（2026-08-18，终审）

结论：**APPROVE** —— 无 P0/P1 残留。仅一条 P2 文档口径（本文件轮次/计数同步，
已修）与真实租户端到端验收（docs/09-onboarding.md）作为唯一外部依赖。
Phase 1 按 docs/05 §6 验收口径**实现可接受**。

## 事实核查说明

三轮 review 独立复验通过的关键事实（对照 rc.6 源码）：

- `agent/inbox/claimed`（`{agent, message, turn}`）声明在全局 cordis Events，顶层监听可见全部会话；rc.6 loop 先发 `turn/start` 后认领。
- `SessionId` 编译期品牌无需运行时转换；`agents.resume` 自带 persistence prepare；`resolveSessionPreset({header, events})` 从日志解析。
- `approval/request` waterfall + `{prepend:true}` unshift 语义；`tools.restrict({deny})` 覆盖 preset 层；`agent.cancel({kind:'user'}, {keepInbox:true})`。
- SDK 1.73.0：`classifyError` 误分类 230020/99991400；`patchCard` 无重试；`getConnectionStatus().state==='failed'` 为通道终态信号；关 `chatQueue` 即关批处理。
- `session/event` 按会话有序派发 → seq 水位去重成立；`turn/end.reason.kind` 六枚举。

## 残余风险（如实记录）

- 真实飞书租户验收（echo spike、审批卡片按钮、断网重连、限流恢复）待
  docs/09-onboarding.md 凭据执行；mock 只覆盖文本链路。
- `agent/inbox/claimed` 精确关联依赖 rc.6 行为，dsh 升级需按 docs/05 §7 重新适配。
- 注入/服务名（`agentPresets`/`workspaceRegistry` 等）以 rc.6 web profile 实测为准。
