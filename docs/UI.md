# AIControl 控制台设计规范

## 设计方向

企业级 SaaS 控制台：深色品牌侧边栏 + 浅色/深色双主题内容区，强调清晰的信息层级、低噪音表格与可快速扫读的指标。

## 设计令牌

| 项目               | 值                                                         |
| ------------------ | ---------------------------------------------------------- |
| 主色               | `#5b6cff`（Indigo）                                        |
| 辅色               | `#0ea5a4`（Teal）                                          |
| 成功 / 警告 / 错误 | `#10b981` / `#f59e0b` / `#ef4444`                          |
| 浅色背景           | `#f4f6fb` + 顶部右侧 Indigo、底部左侧 Teal 径向光晕        |
| 深色背景           | `#070b14` + 低饱和品牌光晕                                 |
| 侧边栏             | `#0a1120 → #0d1730 → #0a1222` 渐变                         |
| 卡片圆角           | 18px；按钮 10px；输入框 10px；Chip 8px                     |
| 卡片阴影           | 浅色 `0 16px 40px rgba(15,23,42,.055)`；深色更深的柔和阴影 |
| 字体               | Inter / Plus Jakarta Sans / PingFang SC / Microsoft YaHei  |
| 标题层级           | h1 29.6px/750、h3 18.9px/700、正文 13.5px                  |

## 布局

- 侧边栏 268px，分组标题 + 图标导航 + 激活渐变胶囊 + 左侧 3px 高亮条。
- 侧边栏底部用户卡片显示头像、姓名、角色与退出按钮。
- 顶栏 70px：面包屑、Demo 环境状态、主题切换、用户菜单。
- 内容区最大宽度 1560px，桌面 28px 内边距，移动端 16px。
- 页面标题统一使用 `PageHeader`：品牌短线 + Overline + H1 + 描述 + 操作区。

## 关键页面

### 概览
- 渐变 Hero：总 Token 大字 + 输入/输出/缓存明细 + 错误率/策略拒绝/统计时间。
- 右侧四项指标：请求、活跃用户、批准率、工具调用。
- 二级图表：Token 趋势（2/3）+ 模型分布（1/3）。
- 三级卡片：请求与活跃用户、项目 Top 10、用户 Top 10。
- 底部：最近异常 + 数据口径说明。

### 用量分析
- 筛选条件卡片：标题栏放“应用筛选”主按钮，避免表单区按钮错位。
- 六列筛选网格 + 快捷时间范围 Chip（今日/7 天/30 天高亮）。
- 三张摘要卡：请求数、总 Token、分组行数。
- 表格列随分组维度动态生成，避免固定 16 列造成拥挤；导出仍包含完整字段。

### 项目用量
- 三张摘要卡：项目数、成员关系、近 7 天 Token。
- 项目卡片网格：项目标识、Token、请求、成员/仓库 Chip、相对进度条、最近上报、查看详情。
- 额外卡片：未归因请求 + 自动归因说明，避免单项目数据时页面空洞。

### 供应商与模型
- 供应商卡片网格：协议、Base URL、模型数量、添加模型/编辑连接。
- models.dev 添加抽屉：搜索供应商 → 自动填充协议/Base URL → 勾选模型 → 一次添加。
- 模型表格：模型、供应商、上游模型/连接、协议、上下文、推理、状态。

### 审批治理
- 六项摘要卡、按天决策趋势、按用户批准率表格（含 P95）、按工具、按风险类别。
- 用户筛选与项目筛选并列。

### 其他
- 会话明细：三张摘要卡 + 精简表格，仓库/结束时间收纳为次级信息。
- 用户与设备、策略与配额、审计、设置、个人中心统一卡片与表格规范。

## 响应式

- `lg` 以下侧边栏切换为临时抽屉；顶栏保留菜单按钮。
- 数据卡片网格按 `auto-fit/minmax` 或断点从 6 → 3 → 2 → 1 列。
- 表格在容器内横向滚动，页面本身不产生横向溢出（1440px 巡检 `scrollWidth ≤ innerWidth`）。
- 图表容器宽度 100%，高度固定 260–310px。

## 验证

- `npm run build` / `npm run build:server`：1491 modules transformed，构建通过。
- 生产 SPA 与资源均 HTTP 200。
- 桌面 1440px 下逐页检查 `scrollWidth`，全部页面无横向溢出；移动端 390px 同样无页面级横向溢出。
- `/`、`/usage`、`/approvals`、`/sessions`、`/projects`、`/users`、`/models`、`/policies`、`/audit`、`/settings`、`/me` 浏览器控制台无错误。
- 深色/浅色主题均已人工截图检查。

## 验收截图

- `docs/screenshots/dashboard-light.png`
- `docs/screenshots/dashboard-dark.png`
- `docs/screenshots/usage-light.png`
- `docs/screenshots/projects-light.png`
- `docs/screenshots/models-light.png`
- `docs/screenshots/approvals-light.png`
- `docs/screenshots/sessions-light.png`
- `docs/screenshots/settings-light.png`