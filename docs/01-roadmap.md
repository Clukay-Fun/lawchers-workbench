# 开发计划 ROADMAP

> **方向变更（2026-06-24）**：产品收窄为**纯案件材料脱敏工作台**，移除测算与法律意见书。
> 界面与边界以 [brand-spec.md](brand-spec.md) 为准；总体架构见 [README.md](../README.md)。
> 本文件下半部的 legal-desens 技术附录仍然有效（脱敏规则、检测/策略分层、派发规约）。

> **明文存储决策**：`entity` 表不存任何明文，可逆还原依赖 legal-desens 的 `map.json`（SHA256 + 位置映射）。

---

## 已完成（历史阶段）

- ✅ 脱敏引擎接入 legal-desens（regex+ner，含 NER 自检/降级）
- ✅ 按类型规则开关（检测层 + 策略层，见附录 E）
- ✅ SQLite 存储层（案件/材料/实体/审计；案号 `LC-<年>-<4位>` 按年重置）
- ✅ 案件登记簿 + 材料上传持久化
- ✅ 文档工作区重构（Solarized Light，双栏，文档优先）
- ✅ DOCX 高保真预览 / PDF 原页+文字标注层 / TXT·MD 工作副本
- ✅ 人工框选标注持久化本地映射；按原格式导出 + 残留复检
- ⏸️ 测算 + 意见书（已从界面移除；后端遗留代码待清理）

---

## 后续方向（按优先级）

1. **遗留代码清理**：移除/隔离 `analyzeService`、`generateService`、`CalcPanel.jsx` 及测算/意见书路由（`/analyze`、`/generate`、`/opinions/*`、`/export/opinion-docx`），与新边界对齐。
2. **PDF.js 按需加载**：前端包 ~795K，用动态 `import()` 拆分，降低首屏体积（非阻断）。
3. **脱敏校对体验**：实体筛选、批量放行/还原、扫描件白框区域微调。
4. **导出健壮性**：导出前残留复检结果在 UI 明示；不可逆扫描件导出强提示。
5. **审计可视化**：案件级审计日志（来源/引擎/人工确认）在界面可查。

> 多阶段任务派发请遵循附录 F（连续执行授权 + 真实总验收，禁止只 build/lint 充数）。

---

## 附录 A · 文件在工作台中间区的显示形式（重要设计）

中间区按材料类型分**两种显示模式**，统一以 legal-desens 的 redacted Markdown 为文本载体。

### A.1 文本类（可逆）：txt / md / csv / **docx** / **xlsx** / 文本层 PDF
- **显示**：渲染 `redacted.md`（Markdown 文本），在 map 标记的实体位置叠加**星号掩码标签**（`.ent`，可点切换明文/掩码、可划词增删）。
- **docx/xlsx**：legal-desens 是内容级可逆脱敏。中间区只做**文本校对**，不还原 Word/Excel 的复杂版式；最终可用 map `restore` 回原格式。
- **xlsx 特别处理**：表格内容转 Markdown 表格展示；公式单元格 legal-desens 会跳过（audit 标注），UI 提示。
- **取舍**：不在原版 PDF/Word 上做划词（版式坐标复杂、易错），统一降维到 Markdown 校对——这是已定方向。

### A.2 图片/扫描类（不可逆）：png/jpg/tiff/bmp / **扫描 PDF**
- **显示**：左右或上下对照——
  - 一侧：`redact-scan` 产出的**白框遮盖图**（敏感区域已被白块覆盖，预览安全）。
  - 另一侧：OCR 出的 **redacted Markdown 中间产物**（可读文本，供核对 OCR 是否漏识）。
- **手动脱敏**：因为是像素图，划词作用在 OCR 文本/识别框上；新增遮盖 = 在图上框选区域追加白框。**不可逆**，UI 明确标红「扫描件脱敏不可还原」。
- **低置信度提示**：OCR < 0.7 的行在 audit 里有告警，UI 高亮提醒人工复核。
- **格式限制**：`.doc/.xls/.wps/.pages` 等不支持，UI 引导先转 docx/xlsx 或 PDF/图片。

### A.3 显示模式判定
```
扩展名 → txt/md/csv/docx/xlsx/文本PDF  → 文本模式 A.1（可逆，星号掩码 + 划词）
       → png/jpg/tiff/bmp/扫描PDF     → 图片模式 A.2（不可逆，白框图 + OCR文本核对）
       → doc/xls/wps/...              → 不支持，引导转换
```

---

## 附录 B · 关于「日期等类型按需脱敏」

legal-desens 的 `rules.json` 里 **`date_cn` 默认 `enabled: false`**，`bank_account_cn` 也默认关。
→ 「有时脱敏日期、有时不脱」= **在设置/材料级勾选是否启用 DATE 规则**，重跑 redact 即可。无需自造开关机制，复用引擎能力。
→ 「全取消后想按规则重来」= §2.4 的**一键重新脱敏**：丢弃当前 map，按当前启用规则重跑。

---

## 附录 C · legal-desens 内置规则清单（rules.json）

| 规则 | 实体类型 | 标签 | 默认 |
|---|---|---|---|
| 中国大陆手机号 | PHONE | 手机号 | ✅ |
| 中国大陆固定电话 | LANDLINE | 电话 | ✅ |
| 身份证号 | ID_CARD | 身份证 | ✅ |
| 中国护照 | PASSPORT | 护照 | ✅ |
| 电子邮箱 | EMAIL | 邮箱 | ✅ |
| 案号 / 合同编号 | CASE_NO | 案号 | ✅ |
| 执行依据编号 | EXECUTION_NO | 执行依据 | ✅ |
| 统一社会信用代码 | ORG_CODE | 统一社会信用代码 | ✅ |
| 银行卡号 | BANK_CARD | 银行卡 | ✅ |
| 银行开户行/网点 | BANK_BRANCH | 银行信息 | ✅ |
| 中文金额 | MONEY | 金额 | ✅ |
| 车牌号 | PLATE | 车牌 | ✅ |
| 不动产权证号 | PROPERTY_CERT | 不动产权证 | ✅ |
| API Token/密钥 | API_TOKEN | 密钥 | ✅ |
| **中文日期** | DATE | 日期 | ❌ 默认关 |
| **银行账号** | BANK_ACCOUNT | 银行账号 | ❌ 默认关 |
| 姓名（NER） | PERSON | 姓名 | NER best-effort |
| 机构（NER） | ORG | 机构 | NER best-effort |
| 地点/地址（NER） | LOC | 地点 | NER best-effort |
| 时间（NER） | TIME | 时间 | NER best-effort |

---

## 附录 D · SQLite 数据模型

见 README「数据模型」一节。要点：`entity` 表不存明文，明文仅在 `map.json`。

---

## 附录 E · 脱敏的「检测层」vs「策略层」（按类型开关必看）

legal-desens 的脱敏分两层，**按实体类型开关时必须同时考虑两层，否则开关会静默失效**：

| 层 | 控制什么 | 由谁决定 |
|---|---|---|
| **检测层** | 某类实体**能不能被识别出来** | `rules.json` 的 `enabled`（正则规则）+ NER 模型 |
| **策略层** | 已检测到的实体**脱不脱敏** | `--entity-policy` 的 `preserve_types` / `force_redact_types` |

### 关键规则
1. **`--entity-policy` 只作用于"已检测到"的实体**，做 redact / preserve 的重新分类。它**无法启用一条被禁用的检测规则**。
2. 因此：
   - **关闭某类脱敏**（如默认会检测+脱敏的 PHONE）→ 把它放进 `preserve_types` 即可生效 ✅
   - **开启某类脱敏**，但该类**检测规则默认是关的**（如 `date_cn`、`bank_account_cn` 默认 `enabled:false`）→ **光靠 `force_redact_types` 无效**，因为压根没检测到该实体。必须**同时启用其检测规则**（走 `--rules` 或等价方式）再配策略层。
3. **键名用引擎"实体类型"**（`DATE`/`BANK_ACCOUNT`/`PERSON`/`ORG`/`TIME`…），**不是规则 ID**（`date_cn`/`bank_account_cn`）。`--entity-policy` 按 `entity_type` 匹配，传错键 = 静默失效。
4. **日期可能被 NER 识别为 `TIME` 而非 `DATE`**。涉及日期开关时，检测层与策略层都要把 `DATE` 和 `TIME` 一并处理。

### 实体类型权威清单（来自 `profiles/strict.json`）
`PERSON / ORG / ADDRESS / PHONE / LANDLINE / ID_CARD / EMAIL / ORG_CODE / BANK_ACCOUNT / BANK_BRANCH / CASE_NO / EXECUTION_NO / PASSPORT / BANK_CARD / PLATE / PROPERTY_CERT / API_TOKEN / DATE / TIME / MONEY / NER_MISC`
（注意：地址在 profile 里是 `ADDRESS`，规则表附录 C 标的 `LOC` 是 NER 标签口径，落地以 `ADDRESS` 为准。）

### 验证按类型开关时，必须真实跑通（不能只 build/lint）
- 传含 `2026年6月20日` 的 `.docx`，分别开/关该类型，**贴出**：生成的 policy json、实际 CLI 参数、两次 `redacted` 文本，并确认两次确有差异。

---

## 附录 F · 多阶段任务派发规约（连续执行 + 总验收，可复用）

派发跨多个阶段的任务给 agent 时，统一套用本规约，避免逐阶段往返。

### 连续执行授权
- 按编号顺序连续执行，每阶段做完跑该阶段【验证】并记录，**直接进下一阶段，不必逐阶段等批准**。
- **仅在以下情况停下问人**：① 需改数据模型 / 对外 API 契约 / AI 行为的真实决策点；② 某阶段验证失败且无法自行修复；③ 与 ROADMAP 或 AGENTS.md 冲突。否则一路做完。

### 每阶段都适用的红线
- 遵守 AGENTS.md。`entity` 表绝不存明文，明文只在 `map.json`。
- 不删本地原件与可逆格式 `map.json`；只清不可逆流程的中间产物。
- 测试只用合成/脱敏数据；绝不提交 `*.db`、`uploads/`、`map.json`、`.env`、密钥、真实材料。
- Conventional Commits，一个提交一个意图；在当前分支工作；不 `git push`。

### 验证证据要求
- **禁止只用 build/lint 充当验证**。涉及引擎行为/数据落库/接口的，必须贴**真实运行输出**（CLI 参数、生成的 json、返回文本、DB 行）。
- 涉及"两态对比"（如开关生效）时，必须贴两次输出并指出差异。

### 最终一次性总验收（跑完整闭环并贴证据）
1. `POST /api/cases` 建案 → 返回 `LC-<年>-<4位>`
2. 上传含手机号+日期的**合成**材料 → material 入库、文件落 `uploads/<case_id>/`
3. 脱敏 → 贴 redacted 文本 + 确认 `map.json` 留存、原件未被改动
4. 人工框选标注 → `manual-redaction` 持久化，贴 DB 行
5. 按原格式导出 → 生成原格式脱敏副本 + 残留复检通过，贴输出
6. 刷新前端/重启后端 → 案件与材料仍在
7. 附每阶段 git 提交列表

---
