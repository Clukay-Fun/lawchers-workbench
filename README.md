# lawchers-workbench（LAWCHERS 案件材料脱敏工作台）

面向**单个律师本地自用**的案件材料**脱敏工作台**。核心闭环：

> 登记案件 → 上传材料（原件只读）→ 原格式预览中检测/人工标注敏感信息 → 按原格式导出脱敏副本（导出前残留复检）

界面与设计规范见 [docs/brand-spec.md](docs/brand-spec.md)；开发与提交规范见 [AGENTS.md](AGENTS.md)（最高优先级约定）。

---

## 产品边界（重要）

LAWCHERS 是**本地优先的案件材料脱敏工作区**，**不是**律所管理后台。界面**不包含**：

- 律师身份 / 律所 / 执业证号
- 赔偿测算计算器
- 法律意见书生成

> 历史版本曾包含测算与意见书功能。当前已从界面移除；相关后端代码（`analyzeService`/`generateService` 及对应路由）暂时保留但**已脱离界面**，后续可清理。详见路线图。

---

## 形态与架构决策

| 决策项 | 选择 | 理由 |
|---|---|---|
| **工作台形态** | 本地运行的 Web 应用（localhost） | 数据全留本地、不出机器，契合 AGENTS.md「法律数据优先、不外传」 |
| **使用规模** | 单律师本地自用（暂不做账号体系） | 聚焦脱敏核心闭环 |
| **本地存储** | 后端 SQLite + 本地文件目录 | 案件/材料/实体/审计可追溯；原件、脱敏副本、map.json 落本地文件 |
| **脱敏引擎** | 接入 `legal-desens` CLI（非自写正则） | 生产级可逆脱敏（位置映射 + SHA256 + 审计） |
| **界面风格** | Solarized Light，文档优先，无 emoji/渐变 | 见 brand-spec.md |

> ⚠️ **本地自用工具**：所有案件数据、原件、脱敏映射只存在运行这台机器上，不上云、不提交进 git（见 `.gitignore`）。

---

## 交互规则（摘自 brand-spec.md）

- **原件不可变**。所有标注只写入本地映射；导出时从原件重新生成副本。
- 文档默认以**脱敏预览**模式呈现。
- 所有实体类别共用**同一种视觉脱敏处理**；类别信息仅保留给检测层与审计层。
- **导出始终生成原格式的派生副本**，并在释放文件前运行**残留敏感数据复检**。

---

## 技术栈

**前端** `frontend/`
- React 19 + Vite
- 视图：案件登记簿（Home）/ 双栏文档工作区（Workspace）/ 精简设置
- 文档预览：
  - **DOCX**：`docx-preview` 高保真渲染 + DOM 文本标注
  - **PDF**：`pdfjs-dist` 渲染原页 + 文字层标注（按字符归一化定位）
  - **Markdown / TXT**：独立可编辑工作副本，原件不变
- 暂不引入路由库与状态库（视图切换 + 组件状态足够）

**后端** `backend/`
- Node.js + Express（ESM）+ SQLite（`better-sqlite3`）
- 文档解析：`pdf-parse`（PDF）、`mammoth`（.docx）、原生（.txt/.md）
- 脱敏：shell out 调用 `legal-desens` CLI（`redactService.js`）
- 人工标注持久化、按原格式导出 + 残留复检

**脱敏引擎** `legal-desens` CLI（独立项目）
- 位置：`/Users/clukay/Program/lawchers-skills/legal-desensitizer`
- 可逆格式（txt/md/csv/docx/xlsx）：`redact` → `redacted.ext` + `map.json` + `audit.json`
- 图片/扫描 PDF：`redact-scan` → 白框遮盖（不可逆）+ OCR markdown 中间产物
- NER 模型：`bash scripts/install_with_model.sh`；无模型降级 `--regex-only`

---

## 数据模型（SQLite）

```
case            案件        id, case_no, title, cause, employee, company,
                            stage, created_at, updated_at
material        材料        id, case_id, filename, ext, stored_path,
                            display_mode, redacted_md, map_json,
                            occurrences_json, redact_status, uploaded_at
entity          脱敏实体     id, material_id, entity_id, entity_type, masked,
                            original, start, end, revealed
manual_redaction 人工标注    material 上的人工框选文本（持久化到本地映射）
audit           审计        id, case_id, action, source, model_config,
                            human_confirmed, created_at
```

> **明文存本地库**：`entity.original` 存敏感原文，仅落本地 SQLite（已 gitignore、不出机器），用于刷新后重新定位脱敏；可逆还原仍以 legal-desens 的 `map.json` 为准。

本地文件目录（均在 `.gitignore` 内）：

```
data/lawchers.sqlite        结构化数据
uploads/<case_id>/          原件 + raw.md + redacted/map/audit 产物
exports/                    原格式脱敏副本（导出时生成）
```

> 案号规则：`LC-<年份>-<4位自增>`（如 `LC-2026-0001`），按年重置。

---

## 本地开发

```bash
npm install            # workspace 根目录
npm run dev            # 同时起前后端
npm run dev:frontend   # 仅前端（Vite）
npm run dev:backend    # 仅后端（Express @ :3001）
```

环境依赖：Node.js ≥ 18；`legal-desens` CLI 已安装并可运行（NER 模型在 `~/.legal-desens/models/`，后端启动会自检）。

---

## API（后端 `/api`，与当前界面相关的核心）

| 方法 | 路径 | 功能 |
|---|---|---|
| GET/POST | `/cases` · `/cases/:id` | 案件登记簿 CRUD |
| POST | `/upload` | 上传原件（存 uploads/<case_id>/）、解析、写 material |
| POST | `/redact` | 可逆格式脱敏（legal-desens），写回 material/entity |
| POST | `/redact-scan` | 图片/扫描 PDF 不可逆白框脱敏 |
| POST | `/materials/:id/manual-redactions` | 人工框选标注持久化 |
| PATCH | `/materials/:id/text` | TXT/MD 工作副本保存 |
| POST | `/materials/:id/confirm` · DELETE `/materials/:id` | 确认 / 删除材料 |
| POST | `/export/redacted` · `/export/redacted-docx` | 按原格式导出脱敏副本 + 残留复检 |
| GET | `/redact/status` · `/cases/:id/audit` | NER 状态 / 审计日志 |

> 已脱离界面的遗留路由：`/analyze`、`/generate`、`/opinions/:id/confirm`、`/export/opinion-docx`（测算/意见书，保留待清理）。

---

## 当前状态

- ✅ 案件登记簿 + 双栏文档工作区（Solarized Light）
- ✅ DOCX 高保真预览；PDF 原页 + 文字标注层；TXT/MD 工作副本
- ✅ 自动检测（legal-desens regex+ner）+ 人工框选标注，持久化本地映射
- ✅ 按原格式导出（从原件重脱敏）+ 残留复检
- ✅ SQLite 持久化（案件/材料/实体/审计）
- ⚠️ PDF.js 使前端包偏大（~795K），后续可做按需加载（非阻断）
- ⚠️ 测算/意见书旧代码保留但已脱离界面，待清理

---

## 开发约定（摘自 AGENTS.md）

- 不提交真实客户数据、案件材料、日志、数据库或密钥；测试用合成/脱敏数据。
- 原件不可变；导出前必须残留复检。
- 提交遵循 Conventional Commits；每个 PR 写明 Summary、Verification、Risk。
