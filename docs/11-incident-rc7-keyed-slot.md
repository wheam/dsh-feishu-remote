# 事故记录：rc.7 前端 keyed slot 契约导致 Mac App 无法进入界面（2026-08-18）

> 状态：**已修复，勿回退**。插件已适配 rc.7（`settings.plugin.item` 改为 keyed
> slot 注册），103 个测试全绿，并通过 Mac App 实际界面验证。
> 本文只做事实记录与根因沉淀；后续所有插件操作按 docs/12-plugin-install-checklist.md 执行。

## 一、现象

安装 `dsh-feishu-remote` 进真实 web profile 后，DeepSeek Harness Mac App 一度
无法正常进入界面：

- `dsh web` 后端正常启动；HTTP 与插件资源均返回 200；
- 浏览器前端报错：`keyed slot "settings.plugin.item" requires options.key`。

## 二、根因

| 环节 | 事实 |
| --- | --- |
| 终端默认 dsh | `~/.local/bin/dsh` = **0.1.0-rc.6**（PATH 里排前） |
| Mac App 实际 dsh | `/opt/homebrew/bin/dsh` = 自动升级到 **0.1.0-rc.7** |
| 插件当时锁定版本 | rc.6（peerDependencies 精确 `0.1.0-rc.6`） |
| 前端契约差异 | rc.6 的 `settings.plugin.item` 是 **list slot**（`id`/`order` 注册）；rc.7 改为 **keyed slot**（必须传 `key`） |
| 后果 | 后端/profile 组合一切正常（dump-config、服务 ready、HTTP 200 全过），但浏览器端插件 slot 注册失败 → 界面加载失败 |

**漏检点**：当时的验收只覆盖了后端信号——`--dump-config`（profile 组合）、
后端启动、HTTP 200、以及在一个 **rc.6 沙箱**（DSH_HOME=/tmp/dsh-smoke）里的
mock 冒烟。没有做两件事：

1. **枚举所有 dsh 可执行文件并以其实际被使用的版本为基准**——PATH 上的
   `~/.local/bin/dsh`（rc.6）与 Mac App 固定使用的 `/opt/homebrew/bin/dsh`
   （rc.7）不一致，而验证用错了基准。
2. **真实前端验收**——没有在 Mac App 实际加载的 Web 页面里检查浏览器控制台
   （`Failed to load plugins` / keyed slot 报错），也没有打开插件设置页确认
   前端注册成功。dump-config/HTTP 200 只能证明后端组合与静态资源可用，不能
   证明前端 slot 契约在新版本下成立。

## 三、修复（勿回退）

- `src/client.js` 的 slot 注册从 rc.6 的 list-slot 形态
  （`{ name, id, order, locale, inject }`）改为 rc.7 的 keyed-slot 形态
  （`{ name, key: SETTINGS_NAMESPACE, locale, inject }`）。
- `package.json` peerDependencies / devDependencies 全部升级并精确锁定
  `0.1.0-rc.7`；文档锁定口径同步 rc.7。
- 103 个测试全绿；Mac App 实际界面验证通过。

## 四、教训

1. **兼容性基准 = 实际被使用的 dsh 二进制，不是终端 PATH 上的第一个 dsh。**
   多二进制并存时（`~/.local/bin` vs `/opt/homebrew/bin` vs npx），必须先
   全部枚举并报告，以 Mac App 实际选用的那个为准。
2. **rc 版本之间按破坏性变化处理**（rc.6 → rc.7 已实证破坏 slot 契约）；
   升级前必须检查所有已启用插件的 peerDependencies 与前端 slot/API 契约。
3. **后端健康 ≠ 插件安装成功**。`--dump-config`、服务 ready、HTTP 200 都只是
   后端信号；前端验收必须实际加载页面、看浏览器控制台、打开插件对应 UI。
4. 出问题先回滚本次新增（禁用插件行），不得破坏原有 profile/凭据/其他插件。
