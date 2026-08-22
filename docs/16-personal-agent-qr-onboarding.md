# PersonalAgent 扫码创建与一键开通方案

> 状态：**实现与自动化测试已完成，真实 Feishu/Lark 租户验收待跑**（2026-08-23）。
>
> 目标：插件安装完成后，用户只需在 DSH 设置页点击一次并用手机飞书扫码，即可创建、
> 授权、绑定自己的机器人；不再要求用户手工进入飞书开放平台创建企业自建应用、复制
> App ID / App Secret、发布版本或从日志抄 `open_id`。

## 1. 结论

采用飞书官方 Node SDK `@larksuiteoapi/node-sdk@1.73.0` 的 `registerApp()`，复用
Lark Coding Agent Bridge 已验证的 OAuth 2.0 Device Authorization Grant（RFC 8628）
流程。扫码页创建的是归扫码者所有的 **PersonalAgent** 应用，不是共享商店应用，也不需要
本项目部署云端中继。

目标用户流程：

1. 安装并启用 `dsh-feishu-remote`；插件在缺少飞书凭据时保持加载、通道 fail-closed。
2. 打开 DSH「Feishu Remote」设置页，点击「创建并绑定飞书机器人」。
3. 本机后端调用 `registerApp()`，浏览器只收到短期二维码 URL 和过期时间。
4. 用户用飞书 App 扫码，在飞书确认页查看应用名称、权限、事件与回调并确认创建。
5. SDK 在本机返回 `client_id`、`client_secret` 与扫码用户 `open_id`。
6. 插件原子保存 App ID、App Secret 与 owner，热启动长连接并完成健康检查。
7. 页面显示机器人名称与「已连接」；用户可直接私聊机器人，不再执行第二次 `/pair`。

扫码并没有跳过应用安全模型：飞书仍会为用户创建一套独立应用，只是把原来开发者后台的
多步操作收敛到一次有权限明细的确认页。

## 2. 已核实的技术基础

### 2.1 官方 SDK 能力

本仓已经精确锁定 `@larksuiteoapi/node-sdk@1.73.0`。该版本导出：

- `registerApp(options): Promise<{ client_id, client_secret, user_info? }>`；
- `appPreset`：预填应用头像、名称、描述，名称/描述支持 `{user}`；
- `addons`：增量声明应用/用户权限、事件订阅和卡片回调；
- `createOnly`：明确创建新应用时隐藏「选择已有应用」；省略时可在飞书确认页选择已有应用；
- `appId`：对已绑定的 PersonalAgent 做增量授权，用于「补开权限」。

设置页把三种意图分开：`select` 省略 `createOnly` 和 `appId`，让用户选择自己已有的
PersonalAgent；`create` 使用 `createOnly: true`，保证新建；`update` 携带当前 `appId`，只给
当前机器人补权。

SDK 的 `addons` 仅接受五类公开配置：应用/用户身份权限、应用/用户身份事件、回调。
事件订阅方式、回调 URL、`security.*` 和加密 key 不能放入二维码。PersonalAgent 模板负责
机器人与长连接基座，本插件只增量声明业务所需权限、事件和回调。

### 2.2 2026-08-23 本仓探针

已使用本仓实际安装的 1.73.0 SDK 发起一次无副作用探针：传入应用名称/描述、六项现有权限、
`im.message.receive_v1`、`card.action.trigger` 和 `createOnly: true`。飞书成功返回：

- host：`open.feishu.cn`；
- path：`/page/launcher`；
- 参数包含 `user_code`、`name`、`desc`、`addons`、`createOnly`；
- 有效期：3600 秒。

探针在 URL 验证后主动 abort，没有创建应用。它证明当前锁定 SDK、网络入口和完整 addons
编码链路可用；**不等于**六项权限已在真实 PersonalAgent 租户全部授权成功，后者必须列入
真实扫码验收。

### 2.3 参考实现

Lark Coding Agent Bridge 的首次向导调用 `registerApp()`，终端显示二维码，扫码后把返回的
App ID / Secret 写入本地 profile。扫码者天然成为应用 owner；参考实现优先使用
`result.user_info.open_id`，启动后还可用 `application/v6` 查询当前 owner，避免人工白名单。

参考：

- [Lark Coding Agent Bridge 中文 README](https://github.com/zarazhangrui/lark-coding-agent-bridge/blob/main/README.zh.md)
- [首次扫码向导实现](https://github.com/zarazhangrui/lark-coding-agent-bridge/blob/main/src/bot/wizard.ts)
- [飞书 Node SDK 的 registerApp 文档](https://www.npmjs.com/package/@larksuiteoapi/node-sdk)

## 3. 注册请求

首版目标请求：

```ts
registerApp({
  source: 'dsh-feishu-remote',
  createOnly: true,
  appPreset: {
    name: 'DSH Remote · {user}',
    desc: '用飞书远程操控本机 DeepSeek Harness',
  },
  addons: {
    // 保留 PersonalAgent 平台模板，在其上叠加本插件能力。
    preset: true,
    scopes: {
      tenant: [
        'im:message.p2p_msg:readonly',
        'im:message.group_at_msg:readonly',
        'im:message:send_as_bot',
        'im:message:readonly',
        'im:message.group_msg',
        'im:message.reactions:write_only',
      ],
    },
    events: {
      items: { tenant: ['im.message.receive_v1'] },
    },
    callbacks: {
      items: ['card.action.trigger'],
    },
  },
  onQRCodeReady,
  onStatusChange,
})
```

当前实现暂用飞书平台默认头像；发布受控的公开 HTTPS 图标资产后再补 `appPreset.avatar`，避免
为了头像把注册二维码或用户信息发送给第三方服务。

选择 `preset: true` 的理由：先与已跑通的 PersonalAgent 默认模板保持一致，再增量申请本插件
能力，避免首版因误删模板内隐含基座配置导致机器人或长连接不可用。真实租户记录最终授权
scope 后，再评估是否能切到 `preset: false` 的最小权限模板。

### 3.1 权限降级

SDK 只校验 addons 的 JSON 形状，不校验权限名称；平台不认识或未向 PersonalAgent 开放的条目
可能被确认页忽略。因此连接成功后必须读取/探测实际授权能力，不能只凭 `registerApp()` resolve
就宣称全功能可用。

能力分两档：

| 档位 | 所需能力 | 缺失时行为 |
| --- | --- | --- |
| 核心遥控 | 私聊、群内 @、bot 发送、消息事件、卡片回调 | 任一缺失则开通失败，不保留新配置 |
| 增强体验 | 全群消息/历史、私聊历史、working reaction | 保持核心链路；设置页标为「增强权限未开通」，相关功能关闭或降级 |

若 `im:message.group_msg`、历史读取或 reaction 在某些租户需要额外确认，首个二维码仍负责创建
应用和核心链路；设置页提供「补开增强权限」按钮，通过
`registerApp({ appId, addons })` 再展示一次权限 diff。默认目标仍是把全部条目放在首次确认页，
力争一次扫码完成。

## 4. DSH 集成设计

### 4.1 加载与入口

bundle patch 已从 `disabled: true` 调整为默认启用空配置，使缺少凭据的新用户也能看到设置页：

- 插件条目默认启用、`config: {}`；
- `apply()` 先注册 settings 与 onboarding RPC；
- 缺少 App ID / Secret 时不创建 channel，只报告 `needs_setup`；
- 现有「配置无效 → 停止 bridge、Host 继续运行」语义保持不变。

这依赖现有 D1 故障隔离：飞书未配置或连接失败不能阻断 `dsh web` 和 Web GUI。

### 4.2 本机后端状态机

每个 web profile 同时只允许一个注册会话：

```text
idle
  └─ start → qr_ready → authorizing → committing → connecting → ready
                  ├─ cancel/expire → idle
                  └─ error         → failed → retry/idle
```

约束：

- 注册会话只驻留内存，最长不超过 SDK 返回的有效期；新建会话会 abort 旧会话。
- 开始前先检查 settings 与 credential provider 可写；只读部署不会先创建应用再报保存失败。
- RPC 只返回 QR URL、过期时间、阶段和脱敏错误；绝不返回 App Secret。
- RPC 只允许 Host loopback；LAN/Tailscale 页面明确提示回到 Host 本机，不循环显示原始 403。
- 页面离开不会自动取消已经扫码确认的提交；显式「取消」才 abort。
- 同一结果只能提交一次；重复轮询不得重复写凭据或重复重启 channel。
- 每轮扫码保存开始时核对配置仍与开始扫码时一致，避免覆盖期间发生的较新手工修改。
- Host 停止时 abort 注册并清空内存中的临时 Secret。

### 4.3 凭据与配置提交

`registerApp()` 成功后的提交顺序：

1. 校验 `client_id` 形状、`client_secret` 非空、`user_info.open_id`（若有）。
2. 用新凭据做短时、只读的应用身份探测，至少取得 bot identity；失败不触碰旧配置。
3. 从 App ID 派生新的、无 Secret 信息的独立引用，例如
   `DSH_FEISHU_APP_SECRET_<SHA256(client_id) 前 12 位>_<注册会话 hash 前 8 位>`。不要覆盖
   当前配置正在引用的凭据，也避免多个 web profile 或重复补权互相踩写。
4. `ctx.credentials.set(credentialRef(newRef), client_secret)` 写入 DSH provider 管理的
   `~/.dsh/.credentials.yaml`，不经过浏览器和 settings value。
5. 使用 settings namespace 的一次 `update(patch)` 原子写入 `appId`、`appSecretRef`、
   `allowedOpenIds` 与 `allowedChatIds`，让 watcher 只观察到一组一致的新配置。创建新应用时
   `allowedOpenIds` 替换为新 owner，`allowedChatIds` 清空；open_id 属于应用身份域，不能沿用
   旧应用白名单。对同一 app 的增量补权则不改白名单。
6. settings watcher 热重载 bridge，等待 channel 进入 connected 或明确失败。
7. 成功后清除内存 Secret；失败时显示可重试状态，按下述回滚规则处理。

不能把 App Secret 写入 `cordis.patch.yml`、URL、日志、浏览器 localStorage、前端状态持久层或
普通 settings 字段。设置页只能通过 `credentials.describe()` 显示「已配置/可写/来源」。

### 4.4 原子性与回滚

DSH settings 与 credentials 当前不是同一个跨文件事务，必须使用补偿式提交：

- 开始前快照旧 App ID、credential ref、owner 与群白名单；新凭据探测成功后才落盘；
- 新 Secret 总是写入独立 `newRef`，旧 Secret 和旧 settings 在切换前保持原样；
- credential 写成功但 settings `update()` 失败：`unset(newRef)`，旧配置无需重写即可继续工作；
- settings 更新成功后，若这是重新绑定或补权，则任意连接健康检查失败都用一次 `update()`
  恢复旧配置元组，再 `unset(newRef)`，避免把仍可用的旧机器人替换成坏配置；只有首次绑定因
  断网或飞书暂时不可达时保留新配置供重试，UI 显示「已创建、未连接」，不得谎报完成；
- 新 channel 确认 connected 后也不自动删除旧 credential ref，因为它可能仍被另一个 profile
  使用；设置页可在确认无引用后提供显式清理；
- 不自动删除已在飞书创建的 PersonalAgent。删除属于外部破坏性操作，只提供后台链接和说明；
- 对已有应用使用 `appId` 增量授权时，默认只更新权限状态；若 SDK 返回替换凭据，也必须沿用
  上述「新 ref → 原子切换 → 健康检查」流程。

### 4.5 owner 与访问控制

首次成功优先把 `result.user_info.open_id` 作为新应用唯一的 `allowedOpenIds`，从第一条消息开始
保持 fail-closed。重新创建应用时不合并旧 `allowedOpenIds`，因为旧 open_id 不能当作新应用下
的用户身份直接复用。若返回缺少 open_id：

1. 使用新应用身份调用 `application.v6.application.get` 查询 owner，`user_id_type=open_id`；
2. 查询仍失败则不切换本地配置，页面报告「无法确认 owner」；飞书侧已创建的应用保留并给出
   手工处理说明，但 channel 不接受任何新消息；
3. 不得临时设置 `allowAllUsers: true`，也不回退到“第一个发消息的人自动成为 owner”。

首版继续以配置中的 `allowedOpenIds` 为运行时事实源；后续可增加周期性 owner 刷新，使飞书后台
转移应用 owner 后自动跟随。扫码者/owner 天然免去人工抄 ID，不再需要聊天配对码。

## 5. Web GUI 体验

设置页顶部新增 onboarding 区，不把用户直接扔进二十多个高级字段：

### 未开通

- 主按钮：「创建并绑定飞书机器人」；
- 次入口：「我已有 App ID」保留现有手工配置；
- 说明：二维码将创建属于当前扫码者的 PersonalAgent，并列出申请权限。

### 扫码中

- 展示二维码、可点击链接、剩余有效时间；
- 状态：等待扫码 / 已扫码等待确认 / 正在保存 / 正在连接；
- 操作：刷新二维码、取消。

### 已连接

- 展示 bot 名称、租户品牌、连接状态、owner 已识别；仅当租户 API 返回完整投影时显示
  核心/增强权限状态，否则明确说明以真实连接健康状态为准；
- 操作：测试连接、补开权限、重新绑定；
- 不显示 Secret，不显示完整 open_id，默认只显示尾部四位用于排障。

### 错误文案

错误必须指向下一步：二维码过期→刷新；用户拒绝→重新开始；凭据存储只读→扫码前拦截并说明；
权限/owner 探测失败→对已创建 App 补权而不是再创建一个；首次长连接失败→保留并重试；重新
绑定失败→恢复旧 App；Lark 域识别→自动切换并展示。

## 6. 发布与安装前置

扫码只解决飞书应用 provisioning，不解决插件包分发。面向其他用户开放前必须：

1. 使用本项目可控的 scoped npm 包名，避免当前未 scoped 的 `dsh-feishu-remote@0.1.0`
   与外部已发布包混淆；
2. 递增版本并补 `repository`、发布来源与校验信息；
3. 确保 npm tarball 内含 `lib/`，或提供可靠的 `prepack/prepare`；不能依赖当前 GitHub
   checkout 中未跟踪的本地构建产物；
4. 安装器执行 docs/12 的 dsh 精确版本兼容闸；不兼容时停止，而不是继续启用；
5. 目标体验为“一条受控安装命令 + Web GUI 扫一次码”。

## 7. 实施拆分

| 步骤 | 内容 | 验收 |
| --- | --- | --- |
| A ✅ | 抽出 `PersonalAgentOnboardingService`，封装 `registerApp`、abort、脱敏状态 | 单元测试覆盖成功、取消、只读预检、迟到会话、凭据/设置与连接失败 |
| B ✅ | 注册 loopback-only Host RPC，设置页加入 onboarding 状态机与本地二维码 | Secret 不进入 RPC、DOM、日志快照；二维码不经过第三方服务 |
| C ✅ | 独立 credential ref + settings 原子 patch + 补偿回滚，owner 自动写入 | settings 失败删除新凭据；重新绑定任意连接失败恢复旧配置；首次超时保留重试 |
| D ✅ | v6 应用权限探测与核心/增强降级 | 已知缺核心权限时切换前 fail-closed；未知时以真实连接作最终健康闸 |
| E ✅ | channel 热启动与 UI 健康状态 | settings watcher 热重载；页面轮询展示 bot、brand、owner 尾号和 connected |
| F ⏳ | scoped npm 发布与 fresh profile 安装 | 新 Mac 一条命令安装，包内容和来源可验证 |
| G ⏳ | 真实 Feishu/Lark 租户验收 | 见 §8，全部通过才对外报告“一扫即用” |

## 8. 验收矩阵

### 8.1 必测主链路

1. 全新 web profile、无 App ID/Secret/open_id：安装 → 设置页 → 扫码 → 创建应用 → 自动连接。
2. 扫码确认页准确展示本插件声明的权限、消息事件与卡片回调。
3. 私聊 `/help` 成功；发送真实任务并完成一次审批卡按钮闭环。
4. 扫码用户自动成为唯一允许用户；另一用户私聊和群内 @均不能驱动 Agent。
5. 普通群 @、话题首次 @与后续消息、上下文回填、working reaction 按实际授权能力工作。
6. dsh 重启后凭据仍能解析，长连接自动恢复，不要求重新扫码。
7. 浏览器网络面板、控制台、Host 日志和配置文件中无明文 Secret（凭据文件本身除外）。

### 8.2 失败与兼容

- 二维码过期、用户拒绝、扫码后关闭页面、重复点击开始、注册中 Host 退出；
- `.credentials.yaml` 不可写、同名环境变量遮蔽、settings 写失败；
- 新凭据有效但长连接暂时失败、飞书断网后恢复；
- 已有手工 App 用户不被强制迁移；重新绑定失败保留旧 App；
- 扫码期间手工配置被修改、旧扫码迟到过期、连接重试与新扫码并发；
- localhost 正常开通、LAN/Tailscale 页面显示本机限定提示且不发起特权 RPC；
- 国内飞书与国际 Lark 域自动切换；
- PersonalAgent 忽略某项 addons、敏感权限需要额外审批时的降级；
- dsh 版本不匹配时安装闸拒绝启用。

## 9. 安全边界

- 二维码 URL 含短期 device/user code，按凭据处理：不进持久日志、不发遥测、不复制到第三方；
- App Secret 仅在 Host 内存短暂停留并写入 credential provider；浏览器永远不可见；
- owner 未确认前访问控制保持关闭，绝不采用 TOFU「首个消息发送者」；
- 选择或更新已有飞书应用会变更其权限，必须由用户在飞书确认页核对应用与权限差异并明确确认；
  只有明确点击「创建新机器人」时才传 `createOnly: true`；
- 不自动删除/转移飞书应用，不自动开放群或其他用户；
- 所有外部权限以扫码确认页和连接后实际探测为准，不能仅依赖本地期望清单。

## 10. 非目标

- 扫码自动安装 DSH 或 npm 包；插件分发由 §6 单独解决；
- 共享一个 App ID/Secret 给所有用户；
- 建设商店应用、云端 webhook 或消息中继；
- 团队多租户权限系统；扫码默认只授权应用 owner，其他人仍走显式邀请/白名单；
- 自动替用户绕过企业管理员或飞书权限审批。
