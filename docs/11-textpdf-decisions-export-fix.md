# 开发计划 11 · 文本层 PDF 决策导出修正与收口

> ⏸️ **暂停（2026-06-25）**：PDF 脱敏 PDF 输出由 **docs/12 遮蔽模式**接管（文本 PDF 用 PyMuPDF redaction 真删+黑块，更统一覆盖扫描/盖章/签字页）。本计划"文本 PDF 按决策替换导出 PDF"不再单独做；星号/占位对 PDF 先只导出 TXT/MD/DOCX。保留此文件作历史记录。

> 核心定位：修正 text-layer PDF decisions export —— **精确删除、完整掩码写回、强审计、工作台开放 pdf-text**。
> 接续/修正 **docs/03 切片 2**（曾完成"原文移除 + 残留通过"初步验证，但**漏验 replacement 完整写回**，不视为完整完成）。
> **前置依赖：docs/10（工具模式改造）已落地**——本计划针对**新工具流** `/api/tasks`、`/api/tasks/:id/export`、`DesensitizePage`，**不再给旧 `/materials/:id/export` 复核状态机续命**。
> 范围：仅 **pdf-text**；**扫描 PDF / hybrid PDF 继续禁用**。

## 目标
```
上传 PDF → prepare 生成 MD 预览 + 候选 → 手动保留/新增/取消 → 按决策导出真正脱敏 PDF → 强审计通过后下载
```
硬要求：
- 不用 `page.search_for(original)` 做全局搜索；只改用户决策中的位置。
- 一处 redact、一处 keep 的同文必须正确（只删 redact 那处）。
- 导出 PDF **真删除文本层原文**（apply_redactions），不是盖色块。
- **掩码完整写回**（不是只插一小段）。
- 导出失败 **fail-closed**：删产物、返回非 0 / 409，不留"看似成功"的 PDF。
- 扫描 / hybrid PDF 暂不开放（CLI 与工作台都拒绝）。

---

## 阶段 1 · 修 `legal-desens` 文本 PDF decisions 导出
仓库：`/Users/clukay/Program/lawchers-skills/legal-desensitizer`

### 1.1 修 `apply_decisions_pdf`
- 按 decision 的 `blockId + start/end` 精确读 `charMap` → 精确字符矩形。
- **删除前保存每个 redact 矩形**；`apply_redactions()` 后，按保存矩形**写回完整掩码文本**（按矩形宽度 fit）。
- 跨行 = 多矩形归属**同一 occurrence**；掩码**只写一次或按字符区间分片**，不每矩形重复写完整掩码。
- 每条 decision 完整记录：`original / replacement / page / rectangles / blockId / start / end`。

### 1.2 强审计（这版核心，防"假成功"）
PDF audit 必须拆成可分辨的三个标志，而非笼统 `passed: true`：
```json
{ "original_removed": true, "replacement_written": true, "position_verification": true }
```
并执行强不变量：
- `requested == applied == entities == occurrences`（四方一致）。
- 每条 decision 都能映射到 charMap 矩形（映射不到 → 失败）。
- **目标矩形内原文不可提取**（逐目标矩形验证，**不全局搜原文**，否则同文 keep 误报）。
- **目标位置能证明掩码已写回**（replacement_written）。
- **keep 同文仍可提取**、不受影响。
- 任一失败：删除产物、返回非 0，不留半成品。

### 1.3 测试（至少）
`tests/test_decisions_pdf.py`：
- `pdf_same_text_keep_redact`
- `pdf_phone_id_money_redact`
- `pdf_manual_decision`
- `pdf_invalid_block_fail_closed`
- `pdf_out_of_bounds_fail_closed`
- `pdf_overlapping_decisions_fail_closed`
- `pdf_residual_original_not_extractable`
- `pdf_keep_text_still_extractable`
- （补）`pdf_replacement_written`（验证掩码确实写回，不只是原文消失）
- （补）`pdf_fail_closed_cleans_output`（失败删产物）

验收命令：`pytest tests/test_decisions_pdf.py && pytest tests/test_decisions.py`

---

## 阶段 2 · workbench 更新引擎 pin
仓库：`lawchers-workbench`
- `requirements-engine.txt` pin 到含 PDF 修复的新 commit。
- 验证安装：`bash scripts/setup-app.sh` → `.venv/bin/legal-desens --help` → `.venv/bin/legal-desens prepare sample.pdf ...` 可跑。

## 阶段 3 · 工作台开放 pdf-text 导出
- 后端 `/api/tasks/:id/export`：`pdf-text` → 允许；`pdf-scan` → 501（扫描 PDF 按决策导出未支持）；`pdf-hybrid` → 501（混合 PDF 未支持）。
- 前端 `DesensitizePage`：`documentKind === 'pdf-text'` 允许导出；`pdf-scan/pdf-hybrid` 禁用并显示原因。文案：**「文本层 PDF 可导出；扫描 PDF 暂不支持按决策导出。」**（不要笼统说"PDF 不支持"）。
- 下载页无需大改：导出成功后 history 有 `export_path` 即可下载。

## 阶段 4 · 端到端验证（合成 PDF，不用真实材料）
- **测试 1 基础**：`张三 手机号13800138000 / 身份证110101199001011234 / 工资15000元` → prepare 得候选 → 导出 200 → PDF 可打开 → 手机号/身份证文本层**不可提取** → audit 三标志全 true。
- **测试 2 同文 keep/redact**：两行同号一保留一脱敏 → 第一处可提取、第二处不可 → 不整页同删。
- **测试 3 手工滑选**：选中"天枢计划"→ 导出后不可提取。
- **测试 4 扫描 PDF**：prepare 可预览、导出按钮禁用、强制调接口返回 501、**不生成假脱敏 PDF**。

---

## 不做范围
扫描 PDF 像素级按决策导出 / hybrid 分页混合导出 / PDF 版式美化 / OCR polygon 字符级映射 / 英文 LLM 检测——后面单独排。

## 推荐提交拆分
1. `legal-desensitizer`：`fix(pdf): apply text pdf decisions with precise char-map redaction`
2. `lawchers-workbench`：`feat(export): enable reviewed export for text-layer pdf`

## 执行约束
- 验证铁律：禁止只跑测试名/build/lint 充验证；贴真实 redact 输出、生成的 PDF、audit 三标志、文本层提取结果、前后对比。
- 引擎先、工作台后；两仓库分开提交；当前分支、不 push。
- 不改 strict 默认语义；扫描/hybrid 不碰。
