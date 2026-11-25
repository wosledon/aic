# AIControl

企业级大模型网关 Demo：统一模型出口、飞书设备码登录、按项目的 Token 归因、工具审批治理与多维用量分析。

- **后端**：ASP.NET Core (.NET 10) + EF Core + SQLite
- **前端**：React + TypeScript + MUI (Material Design) + MUI X Charts
- **插件**：TypeScript CLI + Pi 扩展，支持 **Pi coding agent / Codex CLI / Claude Code CLI / GitHub Copilot CLI**

> 详细需求见 [`docs/PRD.md`](docs/PRD.md)，构建、插件端到端、适配器与页面验证结果见 [`docs/VERIFICATION.md`](docs/VERIFICATION.md)，视觉规范见 [`docs/UI.md`](docs/UI.md)。

---

## 功能概览

| 能力          | 说明                                                                                 |
| ------------- | ------------------------------------------------------------------------------------ |
| 唯一模型出口  | 客户端只拿短期网关令牌，上游 Base URL / Key 仅存服务端并加密                         |
| 飞书登录      | 控制台 SSO + 插件设备码授权；Demo 提供开发登录                                       |
| 供应商 + 模型 | 从 models.dev 搜索供应商、勾选模型、确认连接信息即可；模型直接绑定供应商，不维护路由 |
| 协议代理      | Anthropic Messages、OpenAI Responses / Chat Completions、Google Generative AI        |
| Token 计量    | 网关解析上游 usage，输入/输出/缓存 Token 异步落库                                    |
| 项目自动上报  | 插件会话与网关请求自动上报项目 key、项目名和仓库，平台自动建档，无需手工维护         |
| 审批治理      | 插件侧风险分类与审批门禁，按用户/项目/工具/风险统计批准、拒绝、策略拒绝与自动允许    |
| 多维分析      | 用户、项目、模型、协议、设备、日期；概览、用量、审批、会话、审计                     |
| 配额与策略    | 用户/项目日/月配额、模型白名单、审批策略、速率策略                                   |
| 密钥安全      | AES-GCM 加密存储，只写不读，列表仅返回掩码                                           |

---

## 目录结构

```text
AIControl.slnx
docs/PRD.md
src/
  AIControl.Domain/          领域实体与枚举
  AIControl.Infrastructure/  EF Core、SQLite、加解密、目录同步、计量、遥测
  AIControl.Server/          Minimal API、网关代理、管理 API、静态站点托管
frontend/                    管理控制台（Vite + React + MUI + TS）
plugins/aic-gateway/         AIControl CLI、Pi 扩展与三类 CLI 适配器
tests/AIControl.UnitTests/   单元测试
```

---

## 快速开始

### 1. 启动后端

```powershell
dotnet run --project src/AIControl.Server --urls http://localhost:5080
```

- 首次启动自动创建 SQLite 数据库、演示用户、演示项目、供应商连接与公共模型。
- 默认使用仓库根目录 `.modelsdev.json` fixture；联网时可执行管理端「同步 models.dev」或等待后台 Worker。
- 项目由插件与网关自动上报建档，不需要在后台创建或维护成员/仓库。
- 数据库文件默认位于 `src/AIControl.Server/aicontrol.db`。
- 模型采用「供应商连接 + 上游模型」直连，不存在路由表；从旧版本升级时请删除 `aicontrol.db` 让种子数据按新结构重建。

### 2. 启动前端

```powershell
cd frontend
npm install
npm run dev
```

访问 <http://127.0.0.1:5173>。Vite 已代理 `/api` 与 `/gw` 到 `http://localhost:5080`。

生产构建（由后端直接托管 SPA）：

```powershell
npm run build:server
# 输出到 src/AIControl.Server/wwwroot，然后访问 http://localhost:5080
```

### 3. 构建并安装插件

```powershell
cd plugins/aic-gateway
npm install
npm run build
npm link          # 可选：将 aic / aic-codex / aic-claude / aic-copilot 加入 PATH
```

未 `npm link` 时可直接使用：

```powershell
node dist/bin-aic.js login
node dist/bin-aic.js status
```

### 4. 演示账号

| 邮箱               | 角色     |
| ------------------ | -------- |
| `admin@aic.local`  | 管理员   |
| `dev@aic.local`    | 普通用户 |
| `lisi@aic.local`   | 普通用户 |
| `wangwu@aic.local` | 普通用户 |

开发登录默认开启，可用 `AIC_DEV_LOGIN_ENABLED=false` 关闭。飞书登录需在「系统设置 → 飞书登录」配置 App ID / Secret / 回调地址。

---

## 插件接入四类 CLI

```powershell
# 1) 设备码登录（浏览器输入终端展示的授权码）
aic login --gateway http://localhost:5080

# 2) 查看账号可用模型
aic models

# 3) 可选：记住默认模型（Copilot / Codex / Claude 都不再需要 --model）
aic model set step-3.7-flash

# 4) 选择项目（写入当前仓库 .pi/aic.json；--global 写入全局配置）
aic project set payments-api

# 5) 查看状态 / 用量 / 诊断
aic status
aic usage
aic doctor
```

| 客户端              | 启动方式                                                                          | 说明                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Pi coding agent** | `pi install npm:@aicontrol/cli` 后在 Pi 中 `/login` 选择 **AIC Gateway (Feishu)** | 原生 Provider、OAuth、请求头注入、工具审批、会话/轮次遥测                                                 |
| **Codex CLI**       | `aic-codex [args...]`                                                             | 自动写入 `~/.codex/config.toml` 的 `[profiles.aic]` 并注入短期令牌；工具审批沿用 Codex 原生机制           |
| **Claude Code**     | `aic-claude [args...]`，或 `aic install claude --write` 后直接 `claude`           | 注入 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / 自定义请求头；配置 `PreToolUse` / `PostToolUse` 钩子 |
| **Copilot CLI**     | `aic-copilot [args...]`                                                           | 通过 `COPILOT_PROVIDER_*` BYOK 环境变量接入；需较新版本 Copilot CLI 支持自定义 Provider                   |

插件详细说明见 [`plugins/aic-gateway/README.md`](plugins/aic-gateway/README.md)。

---

## 网关地址

| 协议                    | 路径                                                    |
| ----------------------- | ------------------------------------------------------- |
| Anthropic Messages      | `POST /gw/anthropic/v1/messages`                        |
| OpenAI Responses        | `POST /gw/openai/v1/responses`                          |
| OpenAI Chat Completions | `POST /gw/openai/v1/chat/completions`                   |
| Google Generative AI    | `POST /gw/google/v1beta/models/{model}:generateContent` |
| 模型列表（诊断）        | `GET /gw/v1/models`                                     |

鉴权支持 `Authorization: Bearer <token>`、`x-api-key`、`x-goog-api-key`，服务端统一识别。请求头 `X-AIC-Project / X-AIC-Session / X-AIC-Turn / X-AIC-Device / X-AIC-Client` 用于项目归因与遥测关联。

---

## 主要环境变量

| 变量                            | 说明                                                           |
| ------------------------------- | -------------------------------------------------------------- |
| `AIC_PUBLIC_BASE_URL`           | 网关对外地址（默认 `http://localhost:5080`）                   |
| `AIC_DB_CONNECTION`             | SQLite 连接串或数据库路径                                      |
| `AIC_DEV_LOGIN_ENABLED`         | 是否启用演示登录（默认 `false`，仅 Development 配置为 `true`） |
| `AIC_BOOTSTRAP_ADMIN_UNION_IDS` | 首个管理员 union_id                                            |
| `AIC_ENCRYPTION_KEY`            | 渠道密钥加密密钥（生产必须更换）                               |
| `AIC_TOKEN_SIGNING_KEY`         | 网关 JWT 签名密钥（生产必须更换）                              |
| `MODELS_DEV_API_URL`            | models.dev 数据源地址                                          |
| `AIC_SEED_DEMO`                 | 是否初始化演示数据                                             |
| `AIC_HOME`                      | 插件本地配置目录（默认 `~/.aic`）                              |
| `AIC_GATEWAY_URL`               | 插件覆盖网关地址                                               |

---

## 验证

```powershell
# 后端单元测试
dotnet test AIControl.slnx

# 插件 CLI 端到端：设备登录 → 网关推理 → 审批钩子 → 遥测分析
cd plugins/aic-gateway
node scripts/smoke.mjs

# 适配器环境注入（需要先跑一次 smoke 生成凭据）
node scripts/adapter-smoke.mjs

# 前端类型检查与生产构建
cd frontend
npm run build
```

---

## 故障排查

### 飞书提示“你没有 AIControl 的使用权限”

这是飞书开放平台的应用可用范围限制，不是 AIControl 内部账号未绑定。错误发生在飞书授权页，平台尚未收到登录回调，因此无法在后台预先绑定用户。

处理方式：

1. 使用应用所有者/管理员账号登录飞书开放平台，打开「AIControl」自建应用；
2. 「版本管理与发布 → 可用范围」把当前账号（或所在部门/全员）加入可用范围；
3. 授权页报「无法授予的权限」/ 20027，说明授权 URL 里的 `scope` 不在应用已开通的权限内。AIControl 默认把 Scope 留空（只取 `open_id`、姓名、头像，无需任何权限审核），在「系统设置 → 飞书登录」清空 Scope 即可登录；
4. 邮箱属于字段权限：`authen/v1/user_info` 只有在开通 `contact:user.email:readonly`（获取用户邮箱信息）并在**版本管理与发布**中发布后才返回 `email`。开通后把 Scope 填为 `contact:user.email:readonly` 再登录。**不需要** `contact:user.base:readonly`，也不需要 `auth:user_access_token:read`（后者只是应用级权限，不能出现在 `scope` 中）；
5. 「安全设置 → 重定向 URL」与后台配置完全一致：`http://localhost:5080/api/v1/auth/feishu/callback`；
6. 权限变更后必须创建版本并发布（草稿版本不生效），且「可用范围」包含当前账号；豆包个人账号若不在企业应用可用范围内，需要切换账号或由管理员添加。

本地体验可直接使用登录页的「开发登录」（如 `admin@aic.local`），Pi 插件也已在本机完成设备码登录，可直接使用。

### 飞书授权页提示「无法授予的权限 / 获取用户身份标识」

先到「系统设置 → 飞书登录 → 权限自检」看真实原因。常见为：

- **飞书返回 21001 `Access denied due to platform policy`**：应用建在了**个人版（豆包）租户**下。个人版账号不支持企业自建应用的 OAuth/tenant_access_token，需用真实企业飞书租户的管理员账号在 [open.feishu.cn/app](https://open.feishu.cn/app) 重新创建「企业自建应用」，再把新的 App ID / App Secret 填回本系统。
- **应用未启用 / 未发布**：在开发者后台创建版本并申请线上发布，管理员审核通过后才会生效。
- **权限未开通**：权限管理 → API 权限 搜索「获取用户身份标识」(`auth:user.id:read`) 并开通；需审核的权限还要随版本发布。
- **账号不在可用范围**：应用发布 → 可用范围 加入当前账号（仅限同企业成员）。

### Pi 插件已安装但不显示 AIC 模型

- 确认 `pi list` 能看到 `E:\repos\aic\plugins\aic-gateway`；
- 确认 `http://localhost:5080` 正在运行；
- 执行 `node plugins/aic-gateway/dist/bin-aic.js status`，必要时重新 `login`；
- 在 Pi 中 `/model` 选择 `aic-gateway/...`，或执行 `pi --model aic-gateway/openai-gpt-6.2-sol`。

---

## 敏感信息与本地配置

以下文件/目录默认不进入版本库（见 `.gitignore`）：

| 路径/模式                                                                                 | 内容                                             |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `.env`、`.env.*`（`.env.example` 除外）                                                   | 环境变量与密钥                                   |
| `appsettings.Development.json`、`appsettings.*.Local.json`、`appsettings.Production.json` | 本地/生产配置与密钥                              |
| `*.db`、`*.db-shm`、`*.db-wal`、`*.sqlite*`                                               | SQLite 数据库（含加密后的渠道密钥、飞书 Secret） |
| `.aic/`、`**/.aic/`                                                                       | 插件设备码与令牌缓存                             |
| `*.pfx`、`*.pem`、`*.key`、`*.crt`、`certs/`                                              | 证书与私钥                                       |
| `.backup/`、`.smoke-*`、`.verify-screens/`、`logs/`                                       | 本地备份、验证产物与日志                         |
| `**/bin`、`**/obj`、`src/AIControl.Server/wwwroot`、`**/dist`                             | 构建产物                                         |

实践建议：

1. 复制 `src/AIControl.Server/appsettings.Development.example.json` 为 `appsettings.Development.json`，再填本机密钥；
2. 生产环境通过 `AIC_ENCRYPTION_KEY` / `AIC_TOKEN_SIGNING_KEY` 注入；非 Development 环境若仍是演示默认值会**启动失败**；
3. 更换 `AIC_ENCRYPTION_KEY` 会导致数据库中已加密的渠道密钥 / 飞书 Secret 无法解密，需要重新录入；
4. 提交前可用 `git status --ignored` 确认敏感文件确实被忽略。

---

## 安全与 Demo 边界

- 上游供应商 Base URL、API Key、附加认证头仅服务端可见；接口不返回明文，日志脱敏。
- 网关令牌短期有效，refresh token 哈希存储、轮换、重用检测；停用用户/撤销设备立即生效。
- 默认不采集 Prompt、补全、代码、文件内容、命令原文；只采集模型、Token、项目、会话、工具名、风险类别与审批决策元数据。
- 审批是**治理与记录能力**，不是防篡改的强制安全边界；硬控制由网关模型白名单、用户配额、密钥保护和网络隔离执行。
- 项目由客户端上报，平台自动建档；项目配额为软治理，用户配额为硬限制。
- Demo 只做 Token 计量，不做费用、价格、币种与账单。
- 模型只做“供应商连接 + 上游模型”的一对一直连，不提供权重、优先级、熔断切换等路由能力。
- Codex / Copilot CLI 的工具审批由各自原生机制执行；AIC 记录会话/模型元数据，Claude Code 与 Pi 支持 AIC 审批钩子。