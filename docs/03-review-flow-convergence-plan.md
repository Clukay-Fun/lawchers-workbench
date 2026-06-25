# 开发计划 03 · 复核流收敛（DOCX 已完成 + 文本 PDF 决策导出）

> 原则（Karpathy / 最少代码解决真实问题）：**借体验、不搬架构**。
> - 借：`上传 → 分析 → 复核(勾选/编辑/删除) → 选格式 → 脱敏下载` 四步体验（参考 legal-anonymizer，仅借流程，不抄架构/Web 设计）。
> - 不搬：不引入 Flask、不引入第二套 session、不替换现有 legal-desens CLI、不重写工作台。
> **范围：DOCX 闭环已完成（仅工作台）；本计划剩余工作 = 切片 2「文本 PDF 决策导出」，经确认跨 lawchers-workbench + legal-desensitizer 两仓库。扫描 / hybrid PDF 不在本计划。**

---

## 提交 1 · DOCX 稳定闭环 —— ✅ 已完成（勿重复执行）
- 完成提交（lawchers-workbench）：`c18ebf0` `5d5de25` `5624f37` `7ff4633` `8bd29f3` `8a75cf5` `f135d0d`。
- 引擎日期修复（legal-desensitizer）：`46c2afa`（已完成）。
- 已落地：删除不复活 + materialId 变化重置 ReviewPanel；`deleteDecision` 按决策 id 修正、手工标注可取消；`rulesConfig` 下传、日期默认保留；导出最终确认真正回写后端 + human 审计；`exported` 可继续编辑回 `reviewing`、不再 409；自动 prepare + 三态收敛 + `refreshReview` 不吞错；PDF 导出暂禁。
- ⚠️ 本节仅作记录，**不再派发、不要重跑**，以免回退已验证的 prepare 恢复与日期修复。

---

## 切片 2 · 文本 PDF 决策导出（中等规模、跨仓库）
> **更正（勿误判已完成）**：切片 2 曾完成"原文移除 + 残留通过"的初步验证，但漏验 replacement 完整写回；因此**不视为完整完成**。文本 PDF 按决策导出由 **docs/11** 重新收口。
> 现有 `_apply_decisions_pdf` 是**未完成原型**，必须**重写**到 `decisions_apply.py`，删除/替换 `cli.py` 中的原型；CLI 只负责**分发 + 审计**。分两次提交：**引擎先、工作台后**。

### 2A. PDF 字符坐标契约（必须先定义清楚）
- prepare 为 `pdf-text` 输出 `charMap`：**`block.text[i]` 与 `charMap[i]` 一一对应**，包含空格与换行；strip / 归一化规则要写明并与 `block.text` 同一套索引（同样的归一化）。
- **任一字符缺坐标 → fail-closed**（不得跳过、不得产出"看似成功"的文件）。
- **一个 redact 决策 → 一个 occurrence**；跨行时该 occurrence 的 `rectangles[]` 含多个矩形；**不得按矩形增加 occurrence**。

### 2B. 引擎重写（legal-desensitizer，`decisions_apply.py`）
- 按 block **字符偏移 → 精确字符矩形**映射；**禁止** `page.search_for(original)`（会删整页同文，破坏一处 redact 一处 keep）。
- 返回符合 `_apply_decisions` 接口的 `(map_data, app_result)`，执行 **requested == applied == entities == occurrences** 四方数量不变量。
- **删除前保存精确矩形**，`apply_redactions` 后用保存的矩形**插回掩码**；跨行掩码**只写一次或按字符区间分片**，不得每个矩形重复写完整掩码。
- 异常（页码越界 / 空页 / 缺 block / 空文字 / **字符坐标映射失败**）一律 **fail-closed**：计入 `failed`、阻断导出、清理半成品输出。
- **残留审计按目标矩形验证**，不得全局搜索原文（否则同文 keep 会误报）。
- **CLI 自身**必须拒绝 `pdf-scan` / `pdf-hybrid`，不能只靠工作台拦截。

### 2C. 工作台（lawchers-workbench）
- 仅对 `document_kind === 'pdf-text'` 去掉 501、开放导出；`pdf-scan` / `pdf-hybrid` **继续禁用**；导出入口仅在真正可导出时启用。

### 2D. 必过测试（缺一不可）
1. 同页相同文字：一处 redact、一处 keep —— 只删 redact 那处。
2. 跨行文字精确定位（一 occurrence、多 rectangle）。
3. 手工滑选新增脱敏。
4. 无效页码 / 偏移 / 缺失 block / **字符坐标映射失败** —— 全部 fail-closed。
5. 四方数量不变量成立。
6. 被选原文不可提取，keep 原文仍存在。
7. 导出后残留扫描（按目标矩形）通过。
8. 源文件 SHA 自 prepare 后变化 → 拒绝导出。
9. 字符坐标缺失 / 部分字符无 bbox → fail-closed。
10. 失败时输出文件被清理，不留半成品。
11. 工作台仅对 `pdf-text` 开放导出，`pdf-scan` / `pdf-hybrid` 仍禁用（且 CLI 层也拒绝）。

### （后续）扫描 / hybrid PDF —— 本计划不做
- 引擎无字符级 polygon 与 scan decisions-apply，是独立较大工程，保持禁用，留后续计划。

---

## 执行规约（强制）
1. **验证铁律**：禁止只用 build/lint/测试名充验证；涉及引擎/落库/接口/导出，贴真实运行输出（CLI 参数、返回 JSON、生成的 PDF、残留审计、DB 行、截图），两态对比贴两次。
2. **提交铁律**：Conventional Commits；原子提交，每提交自身可构建。**切片 2 = 两仓库各一个提交，引擎先、工作台后**；扫描 PDF 不计入本计划提交数。当前分支，不 `git push`。
3. **范围铁律**：只修必要问题；切片 2 仅限**文本 PDF**，不碰扫描/hybrid；不改 legal-desens strict 默认语义；不引入 Flask/第二套 session/不替换 CLI。
4. **不并发**：同一仓库同一时间只一个 agent。
5. **数据安全**：敏感数据仅本地（gitignore）；不提交 `*.db`/`uploads/`/`map.json`/`.env`/真实材料；**原件始终不修改**。
6. **审计真实**：人工确认/导出 audit 来源必须真实（human），不伪造决策来源。

---
