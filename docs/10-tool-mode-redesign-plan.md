# 开发计划 10 · 改为「LAWCHERS 本地法律文档脱敏工具」（一把梭，但边界钉死）

> 一句话：把 `lawchers-workbench` 从「案件复核工作台」改成**元典式本地脱敏工具**；**功能结构参考元典，视觉和实现基于当前项目，底层继续用 legal-desens**。

## 目标
- 主导航变为：**脱敏 / 还原 / 历史 / 规则 / 设置 / 下载**。
- 脱敏工具直接好用：上传 → 识别 → 预览/手动增删 → 导出（带残留审计）。
- 吸收元典的**规则中心**（系统规则/自定义/黑名单/白名单）与**任务历史**概念。

## 非目标（明确不做）
- **不照抄元典 UI**：视觉沿用当前 **Solarized Light / 米白纸张、克制法律工具感、低阴影细线分层**。
- 第一版**不做 AI 生成正则**、不做 LLM/Ollama、不做英文。
- 不做 PDF/扫描件还原。
- 不丢已验证的引擎能力（见"保留底座"）。

## 最终导航
`脱敏(默认) / 还原 / 历史 / 规则 / 设置 / 下载`

## 保留底座（不许拆）
- `legal-desens prepare`（manifest / source-map / candidates）
- `redact --decisions` 按决策导出（含文本 PDF 切片 2 成果）
- audit / 残留扫描；restore（可逆格式）
- 规则、NER 状态、引擎诊断（docs/08）、CLI resolver（docs/05）

## 删除的产品概念
案件 / 我的案件 / 案件登记簿 / 办案区 / 智能办案 Workspace / 复核流程（独立 ReviewPanel + 状态机）/ 意见书 / 要素提取 / 赔偿测算 / 律师信息（姓名/律所/执业证号/承办律师）。

---

## 新数据模型
- **去案件中心**：丢弃 `case` / `case_element` / `opinion` / `redaction_decision`（长期持久化决策）/ `processing_status` 状态机（reviewing/ready/exported）。
- **任务历史（新）** `task`：`id, filename, created_at, ext, document_kind, entity_stats(json), export_path, map_path, audit_path, residual_passed`。
- **决策改内存态**：当前任务的 candidates → 前端本地 decisions（增/删/取消）→ **仅导出时**临时物化为 `decisions.json` 交后端 → `legal-desens redact --decisions` → audit → 写 history。**不再按材料长期持久化决策。**
- **规则库** `rule`：自定义正则 + 黑名单 + 白名单存 SQLite（`id, name, category(system/custom/blacklist/whitelist), regex, tokenPrefix, description, isActive, sample`）。系统规则来自 legal-desens（`paths --json` → rules.json，**只读展示 + 运行时用 entity-policy 开关**，不改引擎规则文件）。

---

## 页面规格
1. **脱敏**（核心）：上传文件 → 选规则/类型 → 开始识别 → 左原文/预览、右脱敏结果、下方实体列表/替换记录 → 手动**新增脱敏（划选）/取消脱敏（点实体）** → 导出 MD/DOCX/PDF（按格式可用性）→ 显示**残留审计结果**。交互保留人工修正，但**不叫"复核"、无状态机**。
2. **还原**：上传脱敏文件 + 上传 `map.json` → 还原 → 下载。仅支持可逆格式（txt/md/csv/docx/xlsx）；**明确不支持 PDF/扫描件还原**。
3. **历史**：任务列表（文件名/时间/格式/脱敏实体统计/导出文件/map/audit/是否残留通过）；搜索；查看详情。**不是案件历史**。
4. **规则**：四类 Tab（系统/自定义/黑名单/白名单）。支持启用停用、新增自定义正则（**正则合法性校验 + 占位符唯一性 + 测试样例匹配**）、黑名单（一定脱）、白名单（一定不脱）。第一版无 AI 生成正则。
5. **设置**：引擎状态面板（docs/08）/ NER 状态 / 模型路径 / 规则默认开关 / 数据目录 / 清理缓存。**不再出现律师姓名/律所/执业证号/承办律师**。
6. **下载**：本机安装状态 / macOS 双击安装说明 / Windows best-effort 提示 / 模型状态 / 清理缓存说明 / 版本信息。**不做商城式页面**。

---

## API 规格（在现有路由上重构，不重起一套）
- 脱敏：`POST /api/tasks`（上传+prepare，返回 candidates+preview+document_kind）；`POST /api/tasks/:id/export`（body 带当前 decisions + 目标格式 → 生成脱敏文件 + 残留审计；通过才允许下载；写 history）。
- 还原：`POST /api/restore`（脱敏文件 + map.json → 还原文件）。
- 历史：`GET /api/history`、`GET /api/history/:id`。
- 规则：`GET /api/rules`、`POST /api/rules`（自定义）、`PATCH /api/rules/:id`（启停）、`DELETE /api/rules/:id`、`POST /api/rules/test`（样例匹配）；黑/白名单同 `rule` 表按 category。
- 诊断：沿用 docs/08 `GET /api/diagnostics`。
- 旧 `/api/cases`、`/materials/*`、`/analyze`、`/generate`、`/opinions/*` → 迁移期保留至新路径可跑后删除。

---

## 迁移策略（"一把梭 ≠ 随便删"）
1. **先建新壳与新路由**（脱敏/还原/历史/规则/设置/下载 + 新 API），复用底座。
2. 新路径**可运行、通过验收后**，再删旧入口与旧概念代码。
3. **严禁在新导出路径未跑通前删除底层导出能力**（prepare / redact --decisions / audit / restore）。
4. 分内部里程碑落地，但目标是一次性切到新形态（旧壳删除）。

## 待删代码清单（迁移完成后）
- 前端：`Home.jsx`(案件登记簿)、`Workspace.jsx`、`ReviewPanel.jsx`(状态机式)、`CalcPanel.jsx`、案件/材料/意见书相关组件与 api 函数、律师设置。
- 后端：`/api/cases`、`/materials/*` 中案件态相关、`/analyze`、`/generate`、`/opinions/*`、`/export/opinion-docx`；`analyzeService.js`、`generateService.js`。
- 表：`case`、`case_element`、`opinion`、`redaction_decision`、material 上的 `processing_status` 等状态机字段（按新模型重整）。
- **保留并复用**：prepare/redact/redact-scan/restore/export(decisions)/diagnostics/规则读取。

---

## 验收标准（硬）
1. 首页不再出现案件/律师/意见书/赔偿测算。
2. 主导航为 脱敏/还原/历史/规则/设置/下载。
3. 脱敏页可上传 DOCX/PDF/TXT/MD。
4. 可识别 candidates 并生成脱敏预览。
5. 可手动新增/取消脱敏。
6. 可导出至少当前支持的原格式脱敏文件。
7. 导出后 residual audit passed 才允许下载。
8. 历史页记录任务。
9. 规则页可查看系统规则、新增自定义规则、黑白名单。
10. 还原页支持可逆格式还原。
11. 设置页显示引擎状态。
12. 全站视觉保持当前 Solarized / LAWCHERS 风格，不照抄元典。

## 约束
- 验证铁律：每条验收贴真实运行证据（截图 + 接口/文件输出），禁止只 build/lint。
- 先建新壳再替换；新路径未跑通不得删底层。
- Conventional Commits、原子提交、当前分支、不 push。
- 提示词不写进本文件，单独提供。
