# 开发计划 08 · 脱敏引擎诊断面板（只读，把黑盒打开）

> 这轮只做"**把黑盒打开**"——让人能看懂"为什么这次效果差"（regex-only？DATE 关了？旧候选？pin commit 和 skill 不一致？），**不顺手修业务流**。
> 只读诊断、不带动作、不动 legal-desens、不新增"重新预处理"。范围：仅 lawchers-workbench（前端 + 后端）。

## 硬边界
- **只读**：不改 candidates/decisions，不触发 re-prepare，不自动装模型/自动重跑。
- **不动引擎**：版本只用 `pip show` + requirements 里的 pin commit；不给 legal-desens 加命令。
- **失败不阻断主流程**：诊断接口/字段拿不到就显示 `unknown`，绝不影响上传/复核/导出。

---

## 一、后端：`GET /api/diagnostics`（全局，只读）
返回（任一字段取不到→`unknown`，不抛错）：
- `binPath`：解析出的 legal-desens 可执行文件路径（docs/05 resolver）。
- `installedVersion`：`pip show legal-desens` 的 Version。
- `pinnedCommit`：解析 `requirements-engine.txt` 里的 `@<commit>`。
- `nerEnabled`：`getIsNerEnabled()`。
- `modelDir`：NER model_dir。
- `rulesPath`：`legal-desens paths --json` 的 rules 路径。
- `defaultRules`：当前默认规则开关（含 DATE/TIME 默认状态）。

> 该端点**自身要 try/catch 兜底**：单个字段失败返回 `unknown`，整体仍 200。

## 二、前端：设置页「引擎状态」区
展示一中所有字段：
- legal-desens 路径 / 安装版本 / requirements pin commit / NER 是否启用 / NER model_dir / rules 路径 / 当前默认规则开关。
- **regex-only 显著告警**（NER 未启用时红色）：
  > NER 未启用：当前将以 regex-only 运行，姓名/机构/地址识别能力会下降。

## 三、前端：ReviewPanel 折叠「诊断信息」（材料级，只读）
该材料的：
- `documentKind` / `processing_status` / `source_sha256`
- prepare 时的 `rulesConfig`
- **DATE/TIME 是否关闭**（明确显示 `DATE/TIME preserved`）
- **候选实体类型统计**（decisions 按 `entityType` 分组计数）
- **decisions 数量**：redact / keep / manual / confirmed / unconfirmed
- **是否旧候选**：显示 `prepared_at` / `updated_at`（有就显示，没有就 `未知`）
- **该材料 prepare 时是否 regex-only**：从 manifest/prepare-audit 的 mode 推导；若未记录，可在 prepare 写 audit 时补记 `nerEnabled`（工作台侧小改，**不动引擎**），否则显示 `未知`。若为 regex-only：
  > 该材料预处理时使用 regex-only；如需 NER，请安装/修复模型后重新预处理。
  （只提示，不自动重跑、不自动装模型。）

> 数据尽量复用现有 `review` 返回 + prepare 写入 audit 的 `rulesConfig`；候选统计前端现算。

---

## 成功标准（验收）
1. 启动后设置页能看到 legal-desens 路径、version、pin commit、NER 状态、model_dir。
2. NER 失败时显示**红色告警**，不再只能看终端日志。
3. 任一材料复核页能看到 prepare 参数和候选类型统计。
4. DATE 关闭时明确显示 `DATE/TIME preserved`。
5. 旧材料/旧候选可从 prepared/audit 信息看出来。
6. 诊断接口失败**不影响**上传、复核、导出。

## 约束
- 只读、不动引擎、不新增重新预处理。
- 验证：真跑——设置页截图（含 NER 红色告警态）、某材料诊断折叠区截图、诊断接口故意失败时主流程仍正常。禁止只 build/lint。
- Conventional Commits、原子提交、当前分支、不 push。
