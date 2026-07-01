# 25 · 上传缓冲页与材料侧栏收敛计划

## 目标

把当前：

```text
选择文件 → 上传接口内直接 prepare → 再 OCR/analyze → 编辑器
```

调整为：

```text
选择文件
  → 上传进度
  → 上传成功缓冲页
  → 用户确认“开始脱敏”
  → 识别进度页
  → 脱敏编辑器
```

核心不是增加一个视觉页面，而是把“上传”和“识别”从后端生命周期上真正拆开。上传成功只表示文件已经完成格式、签名、大小校验并安全落盘；OCR、规则识别、页面渲染和公章检测必须由用户点击“开始脱敏”后执行。

## 当前问题

1. `POST /api/tasks` 同时执行文件上传和 `legal-desens prepare`。大文件在上传完成后仍长时间不返回，用户只能看到模糊的服务错误。
2. 上传后直接进入识别，没有机会确认文件是否选对，也无法区分“上传失败”和“识别失败”。
3. 材料侧栏卡片为纵向布局，标题与绝对定位的删除按钮争抢空间；按钮继承了通用图标按钮的较大点击尺寸。
4. 材料侧栏长期占用 220px，无法收起。
5. 底部“追加上传本地材料”与空态、顶部操作重复。

## 产品决策

### 1. 上传成功缓冲页

上传完成后显示：

- 文件名（单行省略，悬浮显示完整名称）
- 文件类型与大小
- “上传成功”状态
- “查看原件”次级操作
- “更换文件”次级操作
- “开始脱敏”主操作

缓冲页不默认渲染 PDF，避免大文件刚上传后再次产生等待。“查看原件”按需打开只读预览。

### 2. 识别进度

点击“开始脱敏”后显示横向进度条和当前真实阶段：

```text
正在分析文档结构
正在识别文字与敏感信息
正在生成页面预览
正在识别公章候选
正在准备脱敏工作区
```

阶段来自后端任务状态；不伪造百分比。单个阶段使用横向 indeterminate 动画，文件上传阶段仍显示真实上传百分比。

### 3. 材料侧栏

展开状态：

```text
材料                         ＋  ‹
┌──────────────────────────────┐
│ 文件名很长时显示为…        × │
└──────────────────────────────┘
```

收起状态：

```text
›
```

- 展开宽度约 220–232px。
- 收起后仅保留 32–40px 展开控制条。
- 收起状态写入 `localStorage`。
- 文件卡片改为单行布局。
- 标题为 `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`。
- 标题右侧固定预留 24px，不能进入删除按钮区域。
- 删除按钮视觉尺寸 14–16px，点击热区不超过 24px；默认弱化，hover 后清晰。
- 侧栏标题区提供“上传”图标按钮。
- 删除底部“追加上传本地材料”。

### 4. 不改变脱敏编辑器

本计划不改：

- redactions 单一事实源
- 遮蔽 / 星号 / 占位三模式
- OCR、NER、规则、公章识别算法
- 导出与残留审计
- 历史任务迁移

## 任务状态

`task` 增加：

```text
status:
  uploaded
  preparing
  recognizing
  rendering
  detecting_seals
  ready
  failed

progress_step
error_message
file_size
updated_at
```

规则：

- `uploaded`：文件已落盘，尚未识别。
- 中间状态：识别请求正在执行。
- `ready`：`session.json`、页面清单和初始 redactions 均已生成。
- `failed`：保留原件和错误阶段，允许重试，不生成“看似可用”的编辑会话。
- 同一任务处理中再次点击“开始脱敏”返回 409，防止重复 OCR。
- 重试前只清理未完成分析产物，不删除原件。
- 对外错误信息不得包含正文或敏感原文。

## 后端调整

### `POST /api/tasks`

改为纯上传：

1. 校验扩展名、文件签名和动态大小上限。
2. 移动原件到任务目录。
3. 创建 `task(status=uploaded)`。
4. 返回：

```json
{
  "taskId": 1,
  "filename": "材料.pdf",
  "ext": ".pdf",
  "fileSize": 123456,
  "status": "uploaded"
}
```

不得在该接口调用 `prepare`、OCR、NER、页面渲染或公章检测。

### `POST /api/tasks/:id/analyze`

承接完整识别管线：

1. `preparing`：执行 prepare，生成 manifest/source-map。
2. `recognizing`：执行 OCR、规则与 NER。
3. `rendering`：生成页面缓存。
4. `detecting_seals`：识别公章候选。
5. 生成 `session.json` 与初始 `redactions.json`。
6. 原子更新为 `ready` 后返回完整会话。

任何阶段失败：

- 状态改为 `failed`。
- 记录安全错误摘要与失败阶段。
- 删除不完整临时产物。
- 原件保留，允许用户重试或删除。

### 状态与原件预览

新增：

```text
GET /api/tasks/:id/status
GET /api/tasks/:id/source
```

- `status` 仅返回状态、阶段和安全错误信息。
- `source` 只读、同源、本地使用，使用 `Content-Disposition: inline`。
- 不把文件正文写入日志。

## 前端页面状态

`VisualMaskPage` 收敛为：

```text
empty
uploading
staged
analyzing
ready
failed
```

行为：

- 上传完成进入 `staged`，不自动调用 analyze。
- 点击“开始脱敏”才调用 analyze，并轮询 status 展示真实阶段。
- 识别失败停留在缓冲页，显示“重新识别 / 更换文件 / 删除”。
- 点击侧栏任务：
  - `uploaded` → 上传成功缓冲页
  - 处理中 → 识别进度页
  - `ready` → 直接恢复编辑器，不重跑 OCR
  - `failed` → 错误与重试页
- 页面刷新后根据任务状态恢复正确页面。

## 实施切片

### S1 · 后端任务生命周期

- task 增量迁移。
- 上传接口改为纯上传。
- analyze 接管 prepare + OCR + render + seal。
- 状态接口、失败补偿、重复执行门控。

验收：

- 大文件上传完成后立即进入 `uploaded`。
- 上传失败和识别失败能明确区分。
- 未点击开始时没有 legal-desens 进程。

### S2 · 上传缓冲页与识别进度页

- 上传成功文件卡。
- 按需查看原件。
- “开始脱敏”明确触发分析。
- 横向上传进度和真实识别阶段。
- 失败重试。

验收：

- 上传后不会自动 OCR。
- 刷新 staged/analyzing/failed 页面状态不丢。
- 完成后才进入编辑器。

### S3 · 可折叠材料侧栏

- 单行文件项、可靠省略、缩小删除按钮。
- 标题区上传与收起按钮。
- 收起状态持久化。
- 删除底部追加按钮。

验收：

- 长文件名不会压住删除按钮。
- 侧栏可展开/收起，编辑器宽度自动填满。
- 删除后活动任务选择逻辑不回退到已删除任务。

### S4 · 回归与收口

- staged → analyze → ready → 三模式 → 导出。
- failed → retry → ready。
- ready 历史任务继续编辑不重跑识别。
- 旧任务没有 status 时按已有产物推断为 `ready`，不强制重新分析。

## 必过测试

1. 小文件上传成功但不自动识别。
2. 大文件真实上传进度完成后进入 staged。
3. 非法格式、伪扩展名、超限文件分别给出明确错误。
4. 点击开始后阶段依次更新，完成才进入编辑器。
5. 识别失败可重试，原件不丢失。
6. 重复点击开始不会启动两个任务。
7. staged、analyzing、ready、failed 刷新恢复正确。
8. 长文件名省略且删除按钮不重叠。
9. 侧栏收起/展开与窗口缩放正常。
10. 删除当前任务后选择下一任务；全部删除后回到上传空态。
11. 已完成任务继续编辑不重跑 OCR。
12. 三模式新增/取消、导出和 redactions 持久化无回归。

## 补充（Claude 审阅，2026-07-01）

> 已核代码:`POST /tasks` 现同步跑 prepare(问题①属实);`analyze` 现为**同步阻塞**、末尾一次性返回完整 session。基线分支 `feature/redactions-single-source`(S5 bf1e65c 已在)。

### C1 · [关键] 异步 analyze + 轮询，否则“真实阶段”立不住

现状 analyze 是一个 await 到底、末尾才返回的请求。**这样前端根本看不到中间阶段**,也无法满足“刷新 analyzing 恢复”。必须改成:

- `POST /tasks/:id/analyze` **立即返回 202**,识别工作 **detached** 执行。
- 工作在**每个可观测边界**(prepare 开始 / render 开始 / seal 开始 / 完成)把 `status + progress_step` **原子写入 DB**。
- 前端 `POST analyze` 后轮询 `GET /status`(间隔 800ms–1s,不要 <500ms),到 `ready|failed` 停止;到 `ready` 再 `GET /session`。
- 刷新/离开再回来只需读 status 续上,天然满足恢复;也避免 95 页 200s+ 长挂 HTTP。
- **诚实边界**:prepare/OCR 是单个 legal-desens 进程内部多步,后端只能在进程边界更新 status,OCR 内部无法细分——只在能观测到的边界更新,**不用定时器伪造推进**。
- **409 门控复用现成 `_renderLocks`/`getOrCreateRender`**(routes.js:3015),同一任务在飞则拒绝重复启动。

### C2 · fail-closed 产物写入顺序（防“看似可用”）

- `session.json` 与 `redactions.json` **必须最后一步、原子写入**;任何中途失败**绝不留部分** session/redactions,否则 status 推断会打开半成品。
- `failed` 清理清单(明确):`analyze.json`、`render-manifest.json`、`pages/`、`session.json`、`redactions.json` 全清;**只留原件**。

### C3 · 基线分支

- 本计划基于 `feature/redactions-single-source`(S5 已在),**不要基于 dev**,否则 `VisualMaskPage` 与 redactions 收敛大冲突。理清 docs/24 合入 dev 与本计划的先后。

### C4 · GET /source 安全边界

- 服务的是**未脱敏原件**,**仅缓冲页只读预览用**;绝不进 history/download 当“脱敏产物”;`inline`、同源、本地、不写日志正文。
- 大文件预览按需加载(计划已定不默认渲染),可后续加 range/分块,本轮至少不阻塞。

### C5 · 旧任务状态推断（确定、不误重跑）

- 无 `status` 列的旧任务:有 `session.json`+`redactions.json` → `ready`;有原件无分析产物 → `uploaded`;推断**确定**,**不因缺 status 就重跑 OCR**。

## 非目标

- 不实现后台任务队列或多用户并发调度。
- 不伪造识别百分比。
- 不默认加载完整 PDF 预览。
- 不修改脱敏识别算法和规则。
- 不恢复底部“追加材料”按钮。
