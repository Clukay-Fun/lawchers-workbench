# 开发计划 19 · 页面渲染缓存 + 视口布局修复 / 当前任务取消持久化

> 定性（Karpathy）：仍是视觉页**收敛修复**，不是新功能。两切片独立，**别混着改**（渲染归渲染，取消归取消）。
> 前提：P9（docs/17）、docs/18 已落地。本档修 docs/18 暴露的渲染/视口/跨模式取消问题。

## 钉死的根因（必须从根上修，不修表层）
1. **并发 rm 渲染风暴（最致命）**：遮蔽模式每页两个 `<img>`（左 canvas + 右 preview），7 页 = **14 个并发 `/page-image` 请求**；page-image 与 session 在缺图时都执行 `fs.rm(pagesDir, recursive)` + `render-pages`。**并发请求各自 rm 掉彼此正在写的 pages 目录 → 图片残缺/忽有忽无**。
2. **session 阻塞全量渲染**：`GET /session` 里 `manifest.pages.some(p => !existsSync(p.imagePath))` 为真就 `await render-pages(整份PDF)` 才返回 → "恢复任务比重新识别还慢"。
3. **CSS 固定 1136px 裁切**：左右两页固定 560+16+560，`overflow-x:hidden`，窗口不够宽右页被裁。
4. **跨模式取消不同步**：文本两模式同步，遮蔽没同步——取消只 PATCH boxes，`textEntities/session.json` 没同步；旧 boxes 可能无 `entityId`。

## 渲染时机决策（已定 = A）
**A：上传 / analyze 后渲染一次，落盘缓存；之后 session 与 page-image 只读，永不重渲（除非文件真丢）。**
- render-pages 是**任务准备阶段产物**，不是 session/page-image 的主流程。
- session 不重渲、不 rm；page-image 只读 + 极端兜底（受锁）。
- 14 个并发 `<img>` 最多触发一次 render。

---

## Slice 1 · Render cache + viewport layout fix
**核心原则**：`render-pages 是准备阶段产物；session 不重渲；page-image 只读+极端兜底；并发请求绝不 rm pagesDir。`

1. **analyze 后主动 render-pages 一次**
   - `POST /api/tasks/:id/analyze` 完成 OCR/NER/session.json 后，渲染页面、写 `render-manifest.json`，保证 `session.json.manifest` / `render-manifest.json` 有完整 pages。

2. **session 秒开**
   - `GET /api/tasks/:id/session` 只读 `session.json / boxes.json / render-manifest.json`；**不执行 render-pages、不 rm pagesDir**。
   - 图片缺失 → 返回 manifest + `renderCacheStatus:"missing"`，前端显示页面恢复提示，**不阻塞整任务**。

3. **page-image 并发安全**
   - 每 task 一个 **render lock / in-flight Promise**；并发请求复用同一次渲染。
   - 极端缺图：复用同一 render promise；**不允许多个请求同时 rm pagesDir**；尽量不整目录 wipe，必须 wipe 则只在锁内做。
   - 14 个并发请求最多触发一次 render。

4. **前端图片加载体验**
   - 每页图片独立加载；单页失败/恢复显示「页面恢复中…」；不让整任务进全屏 loading。

5. **双栏自适应宽度**
   - 不再固定 560；按可用宽度算左右页宽，防 1136px 被 `overflow-x:hidden` 裁切；左右两页仍同尺寸。

6. **topbar 真居中**
   - `mask-topbar` 改 `grid-template-columns: 1fr auto 1fr`；模式按钮在中间列，不受文件名/导出按钮长度影响。

7. **页码跳转修复**
   - 不用 `scrollIntoView`；用 `container.scrollTo({ top: row.offsetTop - headerHeight, behavior:'smooth' })`；点击即设目标页；程序滚动期间短暂忽略 IntersectionObserver，避免页码被打回。

---

## Slice 2 · Current-task cancellation persistence
**核心原则**：`右键取消 = 当前任务复核决定，不写规则中心 / 保留词库。`

1. **新增 `work_dir/cancelled-entities.json`**，格式 `["ORG:120:138","PER:300:302"]`（entity_type:start:end，offset 在 session ocrText 空间，稳定）。
2. **右键取消实体/框**：加入 cancelled set；前端立即过滤 `textEntities` + `boxes`；同步保存 `boxes.json` + `cancelled-entities.json`。
3. **session 恢复**：读取 cancelled set → 过滤 `textEntities` → 过滤 `refinedBoxes` → 再合成 boxes → **三模式（含遮蔽）一致**。
4. **不碰规则中心**：不写保留词库、不写 rules；全局规则仍由规则页管理。

---

## 验收（写死，真机贴证据）
- 7 页 PDF 上传后，刷新恢复**不跑 OCR/NER、不全量阻塞 render**。
- 14 个并发 image 请求**不触发多次 render、不互相删 pages**。
- 删除 `pages/` 后刷新，**最多一次 render**，页面逐步恢复。
- 双栏**不横向裁切**。
- 页码前进/后退**每次点击都有效**。
- 右键取消后切换三模式**一致**，刷新后**仍取消**。
- 取消**不进入规则中心**。

## 执行约束
- 两切片独立提交、独立验证，别混改。
- 验证铁律：禁止只 build/lint；贴真实证据（恢复秒开日志无 render/analyze、并发请求只渲染一次的日志、删 pages 后逐步恢复截图、窄窗口不裁切、页码点击生效、三模式取消一致 + 刷新后仍在、规则中心无变化）。
- 不碰引擎模型/规则中心；Conventional Commits、原子提交、当前分支、不 push。
