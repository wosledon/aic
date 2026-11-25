# 验证记录

日期：2026-11-25  
环境：Windows / .NET SDK 11.0.100（目标 net10.0）/ Node.js 26 / SQLite

## 构建与单元测试

| 命令                                   | 结果                                                        |
| -------------------------------------- | ----------------------------------------------------------- |
| `dotnet build AIControl.slnx`          | 通过                                                        |
| `dotnet test AIControl.slnx`           | 10 个测试全部通过                                           |
| `npm run build`（frontend）            | TypeScript + Vite 构建通过                                  |
| `npm run build:server`（frontend）     | 构建到 `src/AIControl.Server/wwwroot`，后端静态托管验证通过 |
| `npm run build`（plugins/aic-gateway） | TypeScript 构建通过                                         |

单元测试覆盖：

- Git remote 规范化（SSH/HTTPS、凭证剥离、`.git`、大小写、端口）
- Anthropic / OpenAI Chat / Google 的 usage 归一化
- 默认审批策略与模型白名单

## 插件端到端（隔离实例 `http://localhost:5081`）

`node plugins/aic-gateway/scripts/smoke.mjs`：

- 设备码登录 → 浏览器授权 → 刷新令牌 → bootstrap：通过
- 网关推理请求：HTTP 200，返回 `X-AIC-Request-Id`
- Claude `PreToolUse` 钩子：无 TTY 时 fail-closed，返回 deny
- 遥测上报：session_started / tool_decision 成功入库
- 审批统计：`users` 按用户聚合；`user_id` 过滤后仅返回 1 行
- 项目自动建档：遥测创建项目「自动上报项目」，成员 1 人、仓库 1 个
- 网关自动建档：未知 `X-AIC-Project` 首次请求后自动创建项目

## 三类 CLI 适配器

`node plugins/aic-gateway/scripts/adapter-smoke.mjs`：

- Claude：`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_CUSTOM_HEADERS` 注入通过
- Codex：生成 `[profiles.aic]`、`env_key=AIC_GATEWAY_TOKEN`、项目请求头，并以 `--profile aic` 启动通过
- Copilot：`COPILOT_PROVIDER_TYPE/BASE_URL/API_KEY/MODEL` 注入通过

## Pi 扩展宿主模拟

`node plugins/aic-gateway/scripts/pi-host-smoke.mjs`：

- 注册 Provider `aic-gateway`，加载 6 个公共模型
- 仅对 `aic-gateway` 注入 `X-AIC-Client/Project/Session/Device`
- `tool_call` 无 UI 时阻断
- 遥测上传 `accepted=2`
- `/aic-status` 命令返回登录状态

## 浏览器验证（生产构建）

- 「供应商与模型」：搜索 models.dev → 选择供应商 → 自动填充协议/Base URL → 勾选模型；已存在连接自动复用；无任何路由配置
- 「项目用量」：只读展示自动上报的项目、成员、仓库与 Token
- 「审批治理」：用户筛选、按用户批准率、拒绝、P95 统计正常
- 深色/浅色主题、管理端/普通用户导航均正常

## UI 优化复核

- 全新主题与品牌色，侧边栏分组、激活态、用户卡片、顶栏面包屑与账号菜单统一
- 概览页改为渐变 Hero 指标区 + 趋势/模型分布 + 项目/用户 Top + 异常说明
- 用量页筛选卡重构，表格列随分组维度动态变化，减少横向拥挤
- 项目页改为卡片网格，并补充未归因与归因说明卡片
- 供应商页为卡片网格，models.dev 一步接入抽屉保留
- 审批页保留按用户聚合与筛选
- 生产构建下巡检 `/`、`/usage`、`/approvals`、`/sessions`、`/projects`、`/users`、`/models`、`/policies`、`/audit`、`/settings`、`/me`，浏览器控制台无错误
- 深色与浅色主题均已人工检查
- 桌面 1440px 与移动端 390px 均无页面级横向溢出
- 验收截图见 `docs/screenshots/`（dashboard-light/dark、usage、projects、models、approvals、sessions、settings）

## 本机 Pi 插件安装与 Step 3.7 Flash 验证

- Pi 版本：1.6.0
- 安装命令：`pi install E:\repos\aic\plugins\aic-gateway`
- `pi list`：已显示该本地包
- `pi --list-models`：`aic-gateway` Provider 注册 6 个基础模型；恢复 Step 后增加到 11 个可用模型
- 本机设备码登录：`pi-local`，账号 AIC 管理员，凭据位于 `C:\Users\Administrator\.aic`
- 插件通过 `!node .../bin-aic.js print-token` 自动解析短期令牌，无需手工粘贴 Key

Step 3.7 Flash 测试：

```powershell
pi -p --model aic-gateway/step-3.7-flash --thinking off --no-tools --no-session "只回复：OK"
# 输出：OK
```

网关计量记录：

- 状态：200，无错误
- usage_source=upstream
- input=132，output=22，total=474
- latency=977ms，TTFT=620ms
- streaming=true

同时修复了两处影响 Step/Pi 的问题：

1. 连接测试 URL 会拼成 `/step_plan/v1/v1/chat/completions`，已改为识别已有 `/v1`；
2. Pi 收到结束事件后提前断开导致成功请求计量为 0，网关现会在客户端断开后继续读完上游流并记录 usage。

Step 连接已从备份恢复为 `阶跃`（provider `stepfun`，Base URL `https://api.stepfun.com/step_plan/v1`），导入 6 个 Step Plan 模型并启用；不支持的 `step-1o-turbo-vision` 已停用。

## 构建残留错误复核（2026-11-25 22:33）

重构期间旧 Vite 进程曾记录过过期错误；已使用全新进程复核：

| 检查                                               | 结果                             |
| -------------------------------------------------- | -------------------------------- |
| `tsconfig.json` JSON 解析                          | 通过                             |
| 清除 `node_modules/.tmp` 后 `tsc -b && vite build` | 通过，1491 modules transformed   |
| `npm run build:server`                             | 通过，index 与 asset 均 HTTP 200 |
| Vite 转译 `ApprovalsPage.tsx`                      | HTTP 200，54 KB                  |
| Vite 转译 `ChannelsPage.tsx`                       | HTTP 200，83 KB                  |
| Vite 转译 `theme.tsx`                              | HTTP 200，28 KB                  |
| 重启后的 Vite 日志                                 | 无语法错误                       |

当前生产 SPA：`http://localhost:5080`，资源 `/assets/index-ex_Q8PoT.js` 可正常加载。

## 当前主实例

- 地址：`http://localhost:5080`
- `/healthz`：`ok`
- 公共目录：6 个模型
- 数据库：`src/AIControl.Server/aicontrol.db`（已按无路由结构重建）
## 飞书登录根因定位（2026-11-25 23:25）

授权页即使不带 `scope` 仍提示「无法授予的权限 / 获取用户身份标识」。新增 `GET /api/v1/admin/settings/feishu/diagnostics`（设置页「权限自检」）直接调用飞书：

| 检查                                                   | 实际结果                                                                                     |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `POST /open-apis/auth/v3/tenant_access_token/internal` | HTTP 200，body `code=21001`                                                                  |
| 飞书返回信息                                           | `Access denied due to platform policy`                                                       |
| 结论                                                   | 应用建在个人版（豆包）租户下；个人版租户不支持企业自建应用的 tenant/user token 与 OAuth 授权 |

处理方式：改用真实企业飞书租户的管理员账号在 open.feishu.cn/app 新建「企业自建应用」，回填 App ID / App Secret，再按「权限管理 → API 权限 → 获取用户身份标识」开通并发布版本。代码侧已将 21001 映射为明确提示，并在登录页/README 同步说明。

## 项目归因修复（2026-11-25 23:34）

现象：Pi 的真实请求进入「未归因」（48 次 / 37.9 万 Token），项目页只有演示项目。

根因：插件 `resolveProject` 只在服务端已有仓库映射时返回项目 key；`github.com/wosledon/aic` 首次上报前没有映射，因此所有请求都不带 `X-AIC-Project`。

修复：

- 仓库有 remote 但无映射时，用仓库名作为 key（`aic`），并上报 repo hash / display，服务端记录映射；
- 非 Git 目录回退到目录名；
- 用户主目录等通用目录仍保持未归因。

验证：

| 检查                              | 结果                                                             |
| --------------------------------- | ---------------------------------------------------------------- |
| `npm run test:project`            | 5 个场景通过（cwd / explicit / project_config / repo / generic） |
| 真实网关请求 `X-AIC-Project: aic` | HTTP 200，Step 3.7 Flash                                         |
| 项目接口                          | 新增 `aic`（1 位成员），项目页显示 1 次请求 / 21 Token           |

历史未归因数据不会重新分摊；重启 Pi 后新会话即按新规则上报。

## 敏感文件忽略检查（2026-11-25 23:32）

- `git ls-files` 中无 `*.db`、`appsettings.Development.json`、`wwwroot/`、`.verify-screens/`；
- `git check-ignore -v` 命中 `.gitignore` 对应规则；
- `appsettings.json` 已移除演示加密 / JWT 密钥，Development 密钥放入被忽略的 `appsettings.Development.json`；
- 非 Development 环境缺少 `AIC_ENCRYPTION_KEY` / `AIC_TOKEN_SIGNING_KEY` 时启动失败。
## GitHub Copilot CLI 接入验证（2026-11-25 23:52）

环境：Copilot CLI `1.0.114`，插件全局安装到 `%APPDATA%\npm`（`aic` / `aic-copilot` / `aic-codex` / `aic-claude`）。

修复：

- Copilot CLI 的 `openai` Provider 会忽略静态 `COPILOT_PROVIDER_API_KEY` 并带上自己的 GitHub 凭据，导致网关 401；改为 `COPILOT_PROVIDER_API_KEY_COMMAND=aic print-token`，每条请求自动刷新令牌；
- Windows 下 `spawn(..., { shell: true })` 不转义参数，带空格的 `-p "..."` 会被拆成多个参数；改为 `cmd /d /s /c` + `windowsVerbatimArguments` 并自行加引号；
- Copilot 不转发进程环境变量，改用 `COPILOT_PROVIDER_HEADERS` 注入 `X-AIC-Project / Session / Device / Client`，否则用量会进入未归因；
- 新增 `aic model set <alias>` 记住默认模型、未登录时自动发起设备码登录；`providers.json` 不支持 `apiKeyCommand`，静态令牌会 15 分钟过期，因此不作为默认方案。

验证：

| 检查                                                | 结果                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------- |
| `aic-copilot --version`                             | 启动 Copilot CLI 1.0.114，提示注入 BYOK 变量                            |
| 默认模型（mock DeepSeek）                           | 返回内置模拟上游回复                                                    |
| `aic model set step-3.7-flash` 后直接 `aic-copilot` | 返回「成功」，无需 `--model`                                            |
| 用量归因                                            | 项目 `aic` 下 `step-3.7-flash` 累计 6 次 / 97,012 Token                 |
| 会话                                                | `client=copilot-cli`、`project_key=aic`、`repo=github.com/wosledon/aic` |
## 双语 README 与 GitHub Pages（2026-11-26 00:06）

- 截图：dashboard / usage / projects / approvals / models / sessions / settings / login，另含深浅色概览；移动端 390px 无横向溢出。
- README：`README.md` 英文默认，`README.zh-CN.md` 中文，顶部互相切换，包含截图、架构、快速开始、客户端、配置与 Star 引导。
- GitHub Pages：`docs/index.html` 单页站点，默认英文，右上角切换中文（`?lang=zh` 可直达），含截图壁纸、架构、快速开始与 Star CTA；`docs/zh/index.html` 提供中文跳转，`docs/.nojekyll` 关闭 Jekyll。

## SEO 与 Pages 入口（2026-11-26 00:20）

- `docs/index.html`：description / keywords / robots / canonical / hreflang / OG / Twitter Card / JSON-LD（SoftwareApplication）；切换语言时同步 title / description / og:locale。
- 根目录 `robots.txt` 与 `sitemap.xml`：收录 `/aic/`、`/aic/docs/`、`/aic/docs/zh/`，并声明中英文 hreflang。
- 根目录 `index.html` 将 `/aic/` 转到 `/aic/docs/`，避免 Jekyll 把 README 当作首页。
- 已验证：sitemap 可解析（3 个 URL）、robots 指向 sitemap、meta 标签与 JSON-LD 可被浏览器读取。

## GitHub Pages 上线与 SEO 验收（2026-11-26 00:32）

- `https://wosledon.github.io/aic/` → `/aic/docs/` 跳转正常（200）。
- `/aic/docs/` 已上线 Why / FAQ / JSON-LD；默认英文，`?lang=zh` 切换中文，标题、描述与 canonical 同步。
- `robots.txt`、`sitemap.xml`、`404.html` 均返回 200；sitemap 含中英文 hreflang。
- GitHub About：description、homepage、12 个 topics 已配置。
- 期间 GitHub 出现 Partial System Outage（Pages / Git Operations），恢复后构建完成。
