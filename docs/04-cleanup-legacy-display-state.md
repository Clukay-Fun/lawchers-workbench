# 开发计划 04 · 清理弃用前时代的死状态（displayMode / DocEditor）

> 小修项，收口级。背景：复核流改为 `ReviewPanel` 后，预览/复核完全由 `documentKind`（来自 prepare/review 数据）驱动；上传时代的 `displayMode` 等已无人消费，是误导性死代码。

## 根因
- 上传 `POST /upload` 用 `pdf-parse` 的启发式给 `display_mode` 赋值（pdf 有文本→`text`，否则→`image`）。`pdf-parse` 对部分 PDF 解析失败 → 文本 PDF 也被误判 `image`。
- 但**前端没有任何组件读取 `displayMode`**：`Workspace` 恒渲染 `ReviewPanel`，`ReviewPanel` 只用 `documentKind`。所以该误判**不影响实际渲染/导出**，只是遗留死状态，容易误导后续开发。

## 已确认的死代码（前端 grep 零引用）
- `frontend/src/components/workspace/DocEditor.jsx`：无任何 import/引用。
- `material.displayMode`：除 `App.jsx` 赋值外无人读取。
- `frontend/src/api.js` 的 `redactFile` / `redactScanFile`：前端无调用（旧 `/redact` 流已被 prepare/review 取代）。

## 修复范围（只删确认死的，单一来源 = `documentKind`）
1. **前端**
   - 删除 `DocEditor.jsx`（确认无引用后）。
   - `App.jsx` 不再映射/下传 `displayMode`（保留以 `documentKind` 为唯一来源）。
   - 删除 `api.js` 中确认无引用的 `redactFile` / `redactScanFile`（及仅供其使用的辅助）。
2. **后端**（保守）
   - `upload` 不再计算误导性的 `display_mode`（图片格式可仍标记，PDF/文档一律交给 prepare 的 `documentKind` 判定）。
   - `display_mode` 数据库列：**先不删列**（避免迁移churn），仅停止依赖；在注释/本文件标注为 deprecated。
   - **删除前必须 grep 确认后端无其它消费**（review/export/prepare 等）；有消费则停手并报告，不强删。

## 验收（收口）
- `grep -rn "displayMode\|display_mode\|DocEditor\|redactFile\|redactScanFile" frontend/src backend/src` 仅剩允许的残留（如 deprecated 注释），无活引用。
- 前端 `build` + `lint` 通过。
- **手动回归（贴证据）**：上传文本 PDF → 仍正确进入 `pdf-text` 复核（documentKind 驱动，不受影响）；DOCX 复核/导出闭环仍正常。
- 不改产品行为，只删死码；DOCX 闭环与文本 PDF 导出（切片 2）不受影响、不回退。

## 约束
- 只动确认死的代码；后端列删除/迁移不在本项（保守）。
- Conventional Commits、原子提交、当前分支、不 push。
