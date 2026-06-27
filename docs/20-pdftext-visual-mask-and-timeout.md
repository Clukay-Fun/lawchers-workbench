# 开发计划 20 · pdf-text 遮蔽走栅格化 + 大文件默认超时（基线验收导出的最小修复）

> 来源：10 份真实材料只读基线（237 页）。唯一阻断 bug = 纯 pdf-text 遮蔽导出失败；附带一个大文件超时风险。其余（渲染、扫描 OCR/NER、页数保持）基线证明无问题，不动。
> 定性：最小修复，不改架构、不引新功能。

## 基线实证（计划前提）
- 导出失败仅 2/10，都是**纯 pdf-text**（DOC-03/04）。引擎报错原文：`Text PDF masking failed: Verification failed: text '经' still extractable in masked region`。根因=文本层真删后**残留可提取**触发 fail-closed；词级框按字符宽度比例切，和 PDF 字形边界对不齐，边缘字符没删净。
- 已验证修法：同一文件 + 同一真实框，改走 `--document-kind pdf-scan`（栅格化）→ rc=0、16 框、**页数保持、框内可提取文本长度=0**。
- 大文件 analyze 耗时：57 页 185s、95 页 205s。均 < 600s，但**默认 `REDACT_TIMEOUT_MS`=120s** → 57 页以上用默认配置会超时失败。
- 渲染 237/237 全成功、页图失败 0、扫描 OCR+NER 全部命中、导出页数全保持 → **这些不在本计划范围**。

---

## P0 · pdf-text 遮蔽改走栅格化（唯一阻断项）
**原则**：遮蔽模式 = 视觉黑块、不可逆（既定契约）。对 pdf-text 不该做文本层删除，应像扫描件一样**渲染成图 → 打黑块 → image-only PDF**，从根上不存在"残留可提取"。

**改法（后端最小改动，已验证）**：
- `POST /tasks/:id/mask-export` 路由里，调用引擎时：若 `task.document_kind === 'pdf-text'`，传 `--document-kind pdf-scan`（强制栅格），其余 kind（pdf-scan/pdf-hybrid）**不变**。
- 引擎无需改（`mask_export` 已有 pdf-scan 栅格路径）。
- 可选更干净方案（不强制）：引擎加 `--raster` 显式标志、后端遮蔽模式统一传。本轮取后端重映射，改动最小。

**验收（真机贴证据）**：
- DOC-03/04 这类纯文本 PDF 遮蔽导出返回 200（之前 500）。
- 导出 PDF：框内区域**不可提取文本**(get_text ≈ 0)、黑块覆盖、**页数与源一致**。
- pdf-scan / pdf-hybrid 导出行为**不回归**（仍 200、仍正常）。

**边界**：遮蔽 pdf-text 输出为 image-only（整页栅格、文本层丢失）——这是遮蔽模式应有的不可逆视觉销毁,符合契约,不视为缺陷。不碰 star/placeholder（text-export 另一条路）。

---

## P1 · 抬高默认 OCR 超时（大文件不超时）
**改法**：默认 `REDACT_TIMEOUT_MS` 从 120000 提到 600000（analyze 路由 + redactService 读取处）。不改异步架构,先抬默认值。

**验收**：57 页 / 95 页材料在**默认配置**（不手动设环境变量）下 analyze 跑完不超时。

**边界**：若未来超大文件仍逼近 600s,再议分页任务/异步,本轮不做。

---

## 执行约束
- 后端最小改动；引擎不改（除非选 --raster 可选方案,需先确认）。
- 验证铁律：禁止只 build/lint；贴真实证据（pdf-text 导出 200 + 框内不可提取 + 页数保持 + scan/hybrid 不回归 + 大文件默认超时跑通）。
- Conventional Commits、原子提交、当前分支、不 push。
