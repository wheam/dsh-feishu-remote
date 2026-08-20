# 飞书开放平台开通清单（Phase 0 验收）

> 目标：拿到一套可跑通"飞书 → Mac 回显 + 审批卡片"的凭据。
> 应用形态（个人应用 PersonalAgent vs 企业自建应用）在真实租户下二选一定案：
> 有企业管理员权限选**企业自建应用**（推荐，卡片/长连接能力最完整）；
> 个人开发者无法创建企业应用时，尝试**个人应用**（部分老账号可用，能力子集）。
> 国际版 Lark 另需 open.larksuite.com 单独凭据（后置）。

## 1. 创建应用

1. 打开 [飞书开放平台](https://open.feishu.cn/) → 开发者后台 → 创建应用。
2. 记录 **App ID**（`cli_…`）与 **App Secret**（凭据只进本机 `.credentials.yaml`，不进仓库）。

## 2. 添加机器人能力

1. 应用能力 → 机器人 → 启用。
2. 发布后，在飞书里搜索机器人名称，私聊它（p2p 链路的最小前提）。

## 3. 权限（最小清单）

| 权限 | 用途 |
| --- | --- |
| `im:message.p2p_msg:readonly` | 接收私聊消息 |
| `im:message.group_at_msg:readonly` | 接收群内 @机器人 消息（P0 每条群消息必须 @） |
| `im:message:send_as_bot` | 以机器人身份发消息 / 更新卡片 |
| `im:message:readonly` | 上下文回填：读取私聊历史（`im:message`/`im:message:readonly`/`im:message.history:readonly` 三选一，规格见 docs/13 §1.2） |
| `im:message.group_msg` | 上下文回填：读取群/话题全部消息（需随新版本发布；由用户另派 Codex 在开发者后台配置） |
| `im:message.reactions:write_only` | 发送、删除消息表情回复（「敲键盘」working reaction；`im:message` 与本品二选一即可；需随新版本发布） |

## 4. 事件订阅 = 长连接

1. 事件与回调 → 订阅方式选 **使用长连接接收事件**（无需公网回调地址）。
2. 订阅事件：`im.message.receive_v1`（接收消息）。
3. 卡片回调：`card.action.trigger`（审批按钮），同样走长连接。

## 5. 版本发布 / 审核

- 企业自建应用：创建应用版本 → 申请发布（审核通过后事件/权限才生效）。
- 个人应用：按平台流程启用。

## 6. 配置插件

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: dsh-feishu-remote
  disabled: false
  config:
    appId: 'cli_xxxx'
    allowedOpenIds: ['ou_xxxx']   # 白名单外消息会在宿主日志回显 open_id 供自举
    allowedChatIds: []            # 空 = 群聊全拒；把机器人拉进群后填 oc_xxxx 开启
    cwd: '/Users/you/work'
    workspaceRoot: '/Users/you/work'
```

- 凭据：环境变量 `DSH_FEISHU_APP_SECRET`，或 `~/.dsh` 的 `.credentials.yaml`。
- 重启 web 进程；私聊机器人发 `help` 验证回显；发一条需要审批的任务验证卡片按钮；
  按钮不可用时用 `/approve` `/reject` 文字兜底（SDK 会去重重复点击）。

## 7. 验收对照（docs/05 §6）

> ✅ 2026-08-19 真实租户初验通过：应用「DSH MBP · 通用」（企业自建，
> （App ID 略），版本 1.0.1，订阅 im.message.receive_v1 +
> card.action.trigger）→ 飞书私聊 `/help` → 插件回命令卡（见飞书聊天截图）。
> 白名单 = 应用创建者 open_id。经验：事件订阅必须随**新版本发布**才生效，
> 且 app 详情的 `subscribed_callbacks` 只显示卡片回调，完整事件清单在
> **版本详情**的 `event_infos` 里（勿被该字段误导）。

1. 飞书完成一次需审批的真实任务，会话出现在 Web GUI 列表。
2. 断网重连后长连接恢复；未结审批按状态机结算（六条路径均有单测，租户内抽查按钮/文字两条）。
3. 白名单外 open_id 无法驱动任何操作；空配置拒绝一切；未授权群 @机器人被拒。
4. 连续发消息观察卡片更新频率（约 600ms 一次，全局限速）；断网期间发消息 → 重连后终态送达。
5. 飞书会话具备 preset 工具能力（让 agent 执行一个 bash/fs 任务验证）。
6. Web GUI 打开飞书会话发言 → 其审批回 GUI；飞书回合审批只到飞书卡（双向隔离）。
7. **流式卡片视觉（Round 12 F1/F3）**：运行期卡片是否呈增量上屏/生成中状态、终态是否
   平滑切换标题与按钮；**流式中点击「停止任务」**能否在可接受延迟内收到终态卡
   （流式模式回调窗口限制，现有 transient 重试 + 新卡兜底应覆盖）；若客户端对
   `message.patch` 路径完全不呈现增量效果，评估升级 cardkit 元素级流式（docs/05 §2.5）。
8. **「敲键盘」working reaction**：发消息后触发消息上出现 ✍️/敲键盘表情、回合结束
   （含 /stop、reaction 取消、出错）后消失；权限缺失时仅日志告警、不影响回合
   （`workingReaction: false` 可关闭）。
