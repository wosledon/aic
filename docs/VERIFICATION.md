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
