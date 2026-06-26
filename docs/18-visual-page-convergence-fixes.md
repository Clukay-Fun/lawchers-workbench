# 开发计划 18 · 视觉脱敏页收敛修复（P9 落地后的外科修复）

> 定性（Karpathy）：**这轮不是新功能，是对已落地 P9（docs/17）的视觉页收敛修复**。只做 5 个外科切片，不扩大、不引新架构、不碰引擎/规则中心。
> 前提：P9-1~P9-5 已落地（session 端点、session.json、诊断、map.json、同步滚动/高亮、NER_MISC 过滤均在）。本档在其之上修。

## 钉死的边界
- 不动引擎（legal-desens）、不动规则中心 / 保留词库。
- 不造新 id 体系——右键取消复用 P9-3 已有的稳定 id（`entity.id` / `box.entityId`）。
- 诊断：**主 UI 删，后端保留**——后端仍计算并返回 `diagnostics`，`session.json` 仍含 diagnostics，仅前端不渲染。
- 每切片可独立验证（goal-driven），按顺序做，不一起乱改。

---

## S1 · 页面图片缺失自动重渲染
**根因（已核，`routes.js:2764` page-image 路由）**：只在 `render-manifest.json` **缺失**时才重渲染；当 **manifest 还在但图片文件没了**，走到 `if (!imagePath || !existsSync(imagePath)) return 404` → 直接 404、不重渲染 → "有些页显示不出来"。

**修法**：`page-image` 发现目标 `imagePath` 不存在时，触发与 manifest 缺失时**同一套** render-pages（清 pagesDir → 重渲 → 重读 manifest → sendFile），而非只看 manifest 在不在。重渲染有界（同一请求重渲一次，失败才 404）。

**verify**：手动删掉某任务 work_dir/pages 下的图片但保留 manifest → 打开该页 → 自动重渲染并正常显示，不再 404。

## S2 · 刷新后自动恢复当前任务
**根因**：前端没把当前 `taskId` 放进 URL/localStorage，刷新后 React state 清空；session 端点已存在但没人在启动时调。

**修法（纯前端接线）**：
- 上传/恢复任务后把 `taskId` 存 `localStorage.activeTaskId`。
- 页面加载时若有 `activeTaskId`，自动 `GET /api/tasks/:id/session` hydrate；失败则清掉 `activeTaskId`。
- 确认 session 只读 `session.json`（降级 analyze.json），**不重跑 analyze/OCR**；恢复时文案显示「恢复页面预览…」而非「OCR 识别…」，避免误导。

**verify**：上传→改框→刷新浏览器→自动回到同一任务编辑态、框还在；session 不触发 OCR（看后端日志无 analyze 调用）。

## S3 · 删除诊断 / 说明文案（仅前端）
从主 UI 移除：
- 「X 个遮蔽区域」计数。
- 「已识别公章候选，可手动补充或调整」。
- 整个诊断折叠面板（OCR 行数 / textEntities / refinedBoxes / sealBoxes / NER 状态 / entity_type 统计 / filtered 数）。

**保留**：后端 `diagnostics` 计算与返回、`session.json` 里的 diagnostics 不动（供日后隐藏 debug 用）。

**verify**：主界面看不到上述任何诊断/说明；后端 analyze/session 响应里 diagnostics 字段仍在。

## S4 · 顶部布局与左右栏 header 收敛
**顶部 `mask-topbar`**：左=文件名；中=`遮蔽 / 星号 / 占位` 模式切换；右=`上传` + `导出`。把原「换文件」改名为「上传」并挪到导出旁。

**遮蔽模式页面区**：左右两栏各加固定 header（仿 `text-panel-header` 同高）：
- 左栏 header：居中页码导航 `← 1/7 →`。
- 右栏 header：同高，显示「脱敏预览」或居中留空对齐。
- header 之下才是 PDF 页面内容。把原先散在文档区上方的工具条收进 header。

**verify**：模式切换居中、上传/导出在右上；遮蔽左右栏各有等高 header、左 header 是页码导航；整体比现状干净。纯重排，数据流不变。

## S5 · 当前任务内右键取消脱敏（三模式同步，task-local）
**边界写死**：
```
只影响当前任务。
只修改 boxes / textEntities / session.json(boxes)。
不写规则中心。不写保留词库。
```
- **遮蔽模式**：右键左侧蓝框 → 删除该遮蔽框；若该框来自实体（有 `entityId`）→ 同时取消对应实体；右键右侧黑框 → 取消对应框。
- **星号/占位模式**：右键左侧高亮原文 或 右侧替换高亮 → 取消该实体脱敏 → 星号/占位预览该处恢复原文、遮蔽模式里对应自动框消失；**手动框不受影响**。
- 实现复用 P9-3 已有稳定 id（`entity.id` / `box.entityId`）关联三模式，不新造 id；取消后 `PATCH /tasks/:id/boxes` 持久化到 work_dir。

**verify**：三模式各右键取消一处 → 该处不再脱敏且跨模式一致；刷新后取消仍在（已持久化）；规则中心/保留词库无任何变化。

---

## 切片顺序
S1（页面图片恢复）→ S2（刷新恢复）→ S3（删诊断）→ S4（布局收敛）→ S5（右键取消）。
前两个是可信度，S3/S4 是干净度，S5 最重最后做。

## 执行约束
- 不碰引擎/规则中心；不删后端 diagnostics 计算；不造新 id 体系。
- 验证铁律：禁止只 build/lint；贴真实证据（缺图重渲染、刷新后恢复截图、主 UI 无诊断、布局截图、三模式右键取消前后 + 刷新后仍在 + 规则中心无变化）。
- Conventional Commits、原子提交、当前分支、不 push。
