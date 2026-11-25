# @aicontrol/cli

AIControl 官方命令行与 coding-agent 适配器。一个 `aic login`，即可让 **Pi、Codex CLI、Claude Code、GitHub Copilot CLI** 统一走企业网关，上游密钥不下发。

## 安装与构建

```powershell
npm install
npm run build
npm link        # 可选
```

产物：

| 命令          | 说明                                              |
| ------------- | ------------------------------------------------- |
| `aic`         | 登录、状态、模型、项目、用量、诊断、安装、遥测    |
| `aic-codex`   | 启动 Codex CLI（自动刷新令牌 + 写入 AIC profile） |
| `aic-claude`  | 启动 Claude Code（注入网关地址与短期令牌）        |
| `aic-copilot` | 启动 Copilot CLI（BYOK 环境变量）                 |

本地配置默认在 `~/.aic`，可用 `AIC_HOME` 覆盖。`credentials.json` 仅当前用户可读，不写入日志或遥测。

## 常用命令

```text
aic login [--gateway URL] [--name DEVICE] [--no-browser]
aic logout
aic status
aic models [--json]
aic project show|list|set <key>|clear [--global]
aic usage [--json]
aic doctor [--json]
aic install <pi|codex|claude|copilot> [--write]
aic flush
aic print-token
aic hook claude|claude-post
aic launch <codex|claude|copilot> [args...]
```

### 登录流程

1. `aic login` 请求设备码并打印授权码，自动打开浏览器（`--no-browser` 可关闭）。
2. 浏览器登录飞书后打开设备授权页，确认授权码。
3. CLI 轮询获得 access token（15 分钟）与 refresh token（30 天，轮换）。
4. 自动拉取 bootstrap：可用模型、项目、仓库映射、审批策略与遥测配置。

刷新令牌失败时 CLI 会提示重新 `aic login`，不会清除项目配置。

### 项目归因

优先级：

1. `AIC_PROJECT` 环境变量；
2. 当前目录 `.pi/aic.json` 的 `projectKey`（`aic project set <key>` 默认写入这里）；
3. 全局 `aic project set <key> --global`；
4. Git `remote.origin.url` 规范化后与服务端仓库映射匹配；
5. Git `remote.origin.url` 的仓库名（首次上报，服务端自动建档并记录仓库映射）；
6. 当前工作目录名（非 Git 目录的兜底）；
7. 未归因（仅根目录、用户主目录等通用目录）。

仓库 URL 会先去凭证、统一协议与大小写、去掉 `.git`，再计算 SHA-256；不会上传完整 remote URL。

服务端会在收到会话/请求时自动创建项目并记录参与成员与仓库，不需要管理员预先维护项目；`aic project set` 只影响当前仓库后续请求的归因。

## Pi coding agent

包声明了 `pi.extensions`，安装后 Pi 会加载 `dist/pi-extension.js`：

```powershell
pi install npm:@aicontrol/cli
```

在 Pi 中：

```text
/login               选择 “AIC Gateway (Feishu)”
/aic-login           显式登录入口
/aic-status          登录用户、网关、项目、模型、遥测队列
/aic-project list    可加入项目
/aic-project set payments-api
/aic-usage           今日 / 7 天 / 30 天用量
/aic-doctor          连通性诊断
/aic-logout          吊销当前设备 refresh token
```

扩展行为：

- 注册 Provider `aic-gateway`，模型目录来自平台，`cost` 全部置零；
- 仅对 `aic-gateway` 注入 `X-AIC-Project / X-AIC-Session / X-AIC-Turn / X-AIC-Device / X-AIC-Client`；
- `tool_call` 按平台策略执行允许 / 询问 / 拒绝；无 UI 时 fail-closed；
- `session_start`、`turn_end`、`tool_execution_end`、`model_select`、`session_shutdown` 上报元数据；
- 启动时 2 秒超时拉取公共目录，失败使用缓存，不阻塞 Pi 启动。

## Codex CLI

```powershell
aic login
aic-codex
# 或
aic-codex --model gpt-5-codex
```

`aic-codex` 会：

1. 选择兼容 OpenAI 协议的公共模型；
2. 在 `~/.codex/config.toml` 写入受管的 `[profiles.aic]` 与 `[model_providers.aic]` 块；
3. 注入 `AIC_GATEWAY_TOKEN` 短期令牌；
4. 以 `codex --profile aic` 启动。

手动启动 `codex --profile aic` 时需自行设置 `AIC_GATEWAY_TOKEN`；推荐始终通过 `aic-codex` 以获得自动刷新。

**限制**：Codex 的 `notify` 只接收 turn 完成通知，不能拦截工具调用。工具审批由 Codex 原生 approval 机制执行；AIC 记录会话与模型元数据。

## Claude Code

```powershell
aic login
aic install claude --write
claude
```

`--write` 会合并 `~/.claude/settings.json`（保留既有配置）：

- `env.ANTHROPIC_BASE_URL = <gateway>/gw/anthropic`
- `env.ANTHROPIC_CUSTOM_HEADERS = X-AIC-Client: claude-code`
- `apiKeyHelper = aic print-token`（自动刷新短期令牌）
- `hooks.PreToolUse` → `aic hook claude`
- `hooks.PostToolUse` → `aic hook claude-post`

也可以直接使用 `aic-claude`，额外注入项目、会话、设备请求头：

```powershell
aic-claude
aic-claude --model claude-sonnet-5-5
```

审批钩子：

- `read` 默认允许；`write / exec / network / destructive` 默认询问；`unknown` 默认拒绝；
- 无 TTY 时按 `no_ui=deny` 记录 `policy_no_ui`；
- 仅在本地展示脱敏命令摘要，不上报命令原文；
- 决策立即上报，失败不影响工具执行。

## GitHub Copilot CLI

```powershell
aic login
aic-copilot
```

注入：

```text
COPILOT_PROVIDER_TYPE=openai
COPILOT_PROVIDER_BASE_URL=<gateway>/gw/openai/v1
COPILOT_PROVIDER_API_KEY=<短期网关令牌>
COPILOT_MODEL=<公共模型别名>
```

需要 Copilot CLI 支持 BYOK 自定义 Provider；老版本不支持时会回退到 GitHub 托管模型。令牌 15 分钟过期，推荐始终通过 `aic-copilot` 启动。

## 遥测与隐私

- 本地队列 `~/.aic/queue/events.jsonl`，批量最大 100 条 / 256 KB；
- 失败指数退避，队列超过 10 MB 时丢弃最旧数据；
- 事件包含 `event_id`，服务端按事件幂等去重；
- 只上报：模型、Token、项目、会话、轮次、工具名、风险类别、审批动作/耗时、插件版本；
- **不上报**：Prompt、代码、文件内容、命令原文、工具参数/输出、上游密钥。

## 故障排查

| 现象                                 | 处理                                                              |
| ------------------------------------ | ----------------------------------------------------------------- |
| `尚未登录`                           | `aic login`                                                       |
| `refresh_expired` / `device_revoked` | 重新 `aic login`；设备可在「用户与设备」撤销                      |
| `无法连接网关`                       | 检查 `AIC_GATEWAY_URL` / `--gateway`、代理与证书                  |
| Claude 仍走官方 API                  | 确认 `aic install claude --write` 已写入，或使用 `aic-claude`     |
| Codex 认证失败                       | 使用 `aic-codex` 启动；`aic doctor` 检查令牌                      |
| 审批不弹窗                           | 确认 Claude 设置中含 `PreToolUse` 钩子；无 TTY 环境会 fail-closed |
| Pi 看不到模型                        | 管理端发布公共模型；`aic doctor` 检查 bootstrap                   |

`aic doctor` 输出不含任何密钥，只显示令牌长度与请求状态。