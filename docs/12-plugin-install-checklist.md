# 插件安装/更新/启用检查清单（固定规则）

> 本清单为**强制流程**：任何 DSH 插件的安装、更新、启用、或 dsh 版本升级，
> 都必须逐条执行；只有第 5 节的端到端检查**全部通过**，才能报告"安装/升级成功"。
> 背景事故见 docs/11-incident-rc7-keyed-slot.md。

## 1. 枚举所有 dsh 可执行文件与版本（必做，先做）

```bash
command -v dsh && command -v dsh | xargs -I{} {} --version
~/.local/bin/dsh --version     2>/dev/null || echo "~/.local/bin/dsh 不存在"
/opt/homebrew/bin/dsh --version 2>/dev/null || echo "/opt/homebrew/bin/dsh 不存在"
ls /Applications | grep -i "deepseek\|harness"   # Mac App 本体
grep -m1 '"version"' /opt/homebrew/lib/node_modules/@deepseek-ai/dsh/package.json
```

- **以 Mac App 实际使用的版本为兼容性基准**（Mac App 固定优先
  `/opt/homebrew/bin/dsh`），不能只看终端 PATH。
- 若存在多个 DSH 版本或 profile 依赖混用 → **先明确报告，暂停安装/升级**。

## 2. 安装前：插件与目标版本契约核对

1. 插件 `package.json` 的 `peerDependencies`（必须精确版本，不用 `^`）。
2. 插件锁定的 DSH rc 版本 vs 目标环境的实际版本，必须一致。
3. 前端契约：插件 client 模块用到的 slot/API（如 `settings.plugin.item`
   的 **list slot（id/order）vs keyed slot（key）** 形态）在目标版本下的定义，
   必须逐项对照目标版本源码（`dsh-client-*` 包）核实。
4. dsh 升级前：检查**所有已启用插件**是否兼容目标版本；不兼容 → **停止升级
   并报告具体插件名与不兼容点**。

## 3. 安装操作

- 用与 Mac App **同一个** dsh 二进制执行 `dsh plugin --profile <name> add`。
- 修改 profile 前记录现状（`cordis.patch.yml`、package.json、凭据文件），
  保证可一步回滚。
- 凭据只写本机私密文件（`~/.dsh/.credentials.yaml`），不进仓库。

## 4. 失败处置

- 若新插件导致失败：**优先回滚本次新增**（禁用/移除插件行），不得破坏原有
  profile、凭据或其他插件。
- 前端报错（如 `Failed to load plugins`、`keyed slot … requires options.key`）
  属于插件前端契约问题，先禁行后修复，不要在后端"正常"的表象下继续。

## 5. 安装后端到端验收（全部通过才算成功）

| # | 检查 | 方式 |
| --- | --- | --- |
| 1 | profile 组合正确 | `dsh --profile web --dump-config` 确认插件行与 config |
| 2 | `dsh web` 成功启动 | 后端日志无 ERROR、监听端口正常 |
| 3 | **实际加载 Web 页面** | 打开 Mac App / 浏览器访问 `http://127.0.0.1:<port>` |
| 4 | **浏览器控制台无插件报错** | DevTools 控制台检查：无 `Failed to load plugins`、无 slot/key 报错 |
| 5 | **打开插件对应设置页/主要 UI** | 如「Feishu Remote」设置卡片能渲染、能编辑保存 |
| 6 | 前端注册成功 | 卡片出现在插件设置列表，保存后 host 热重载正常 |
| 6a | 多机器人管理面板 | 点击「添加机器人」时在后台将 legacy 配置原子迁移；扫码新增自动生成 bot/凭据引用/owner 白名单；默认只显示机器人列表与运行状态，高级字段保持折叠 |
| 6b | 双 App 身份隔离 | 两 App 同群/同话题分别 @，Session ID、分组、回复和审批卡互不串线 |

> 红线：**"dump-config 通过"或"HTTP 200"单独都不能作为安装成功的依据**——
> 两者只证明后端组合与静态资源，证明不了前端 slot/API 契约成立。

## 5.5 三道永久防线（仓库内建，防升级后再挂界面）

1. **自动兼容闸**：`tests/dsh-version-compat.spec.ts` 已纳入 `pnpm run check`——
   插件锁定版本与 Mac App 实际 dsh 不一致时，检查**直接失败**（不再可能"全绿"）。
2. **一键诊断脚本**：`scripts/check-dsh-compat.sh`——任何插件操作前先跑，输出
   GO / NO-GO 与原因（含所有 dsh 二进制版本枚举）。
3. **前端优雅降级**：`src/client.js` 的 apply 整体 try/catch——未来 slot/API
   契约再变，插件卡片最多不显示（控制台报错），**不会拖垮宿主界面**。

## 6. 版本升级专用条款

- 对 rc 版本升级一律按**可能存在破坏性变化**处理，禁止假设 rc.N → rc.N+1 兼容。
- 升级后必须重跑第 1、2、5 节全部检查（包括浏览器控制台与插件 UI 实测）。
- 升级导致的插件适配（peerDependencies、slot 形态等）不得在未经验收前回退修复。
