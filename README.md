# lawchers-workbench（敬法智能办案工作台）

面向**单个律师本地自用**的劳动争议办案工作台。核心闭环：

> 上传材料 → 自动脱敏（可划词增删）→ 提取案件要素 → 劳动法算费测算 → 生成法律意见书

开发与提交规范见 [AGENTS.md](AGENTS.md)（最高优先级约定，OVERRIDE 一切默认行为）。

---

## 形态与架构决策（2026-06-20 确认）

| 决策项 | 选择 | 理由 |
|---|---|---|
| **工作台形态** | 本地运行的 Web 应用（localhost） | 数据全留本地、不出机器，契合 AGENTS.md「法律数据优先、不外传」 |
| **使用规模** | 单律师本地自用（暂不做账号体系） | 先打磨核心办案闭环，协作/多租户以后再说 |
| **本地存储** | 后端 SQLite + 本地文件目录 | 结构化数据可追溯/可备份/可全文检索；脱敏 map.json、audit.json、意见书落本地文件 |
| **脱敏引擎** | 接入 `legal-desens` CLI（非后端手写正则） | 生产级可逆脱敏（位置映射 + SHA256 + 审计），见下文 |

> ⚠️ 这是**本地自用工具**：所有案件数据、脱敏映射、意见书都只存在运行这台机器上，不上云、不入库到远端、不提交进 git（见 `.gitignore`）。

---

## 技术栈

**前端** `frontend/`
- React 19 + Vite
- 视图：首页仪表盘（案件项目卡）/ 三栏办案区 / 设置
- 暂不引入路由库与状态库（单页视图切换 + 组件状态足够；规模变大再评估）

**后端** `backend/`
- Node.js + Express（ESM）
- 文档解析：`pdf-parse`（PDF）、`mammoth`（.docx）、原生（.txt/.md）
- 脱敏：shell out 调用 `legal-desens` CLI（`redactService.js`）
- 算费：劳动合同法 47/82/87 条规则引擎（`analyzeService.js`）
- 意见书：Markdown 模板变量渲染（`generateService.js`）
- **存储（待建）**：SQLite（建议 `better-sqlite3`，本地同步、零配置）

**脱敏引擎** `legal-desens` CLI（独立项目）
- 位置：`/Users/clukay/Program/lawchers-skills/legal-desensitizer`
- 后端调用 `legal-desens redact --level strict`，读回 `redacted.md` + `map.json` + `audit.json`
- 中间区统一转 **Markdown**，不在原版 PDF/Word 上做划词
- 显示态用**星号掩码**（王*锤 / 138****5678）；map 保留可逆还原能力

---

## 数据模型（SQLite，规划中）

```
case            案件        id, case_no, title, cause(案由,先固定"劳动争议"),
                            employee, company, stage, claim_amount,
                            created_at, updated_at
material        材料        id, case_id, filename, ext, stored_path,
                            raw_md_path, redacted_md_path, redact_status, uploaded_at
entity          脱敏实体     id, material_id, type, original(仅本地), masked,
                            start, end, revealed(bool)   ← 对应 legal-desens map.json
case_element    案件要素     case_id, entry_date, leave_date, salary,
                            has_contract, leave_reason, working_months
opinion         意见书       id, case_id, template_type, content_md,
                            status(draft/confirmed), created_at
audit           审计        id, case_id, action, source, model_config,
                            human_confirmed, created_at   ← AI 可追溯要求
```

本地文件目录（均在 `.gitignore` 内）：

```
data/
  lawchers.sqlite          结构化数据
uploads/<case_id>/
  <原始材料>                上传原件
  raw.md / redacted.md     解析与脱敏产物
  map.json / audit.json    legal-desens 可逆映射与审计
exports/
  legal-opinion-*.md/.docx 生成的意见书
```

---

## 本地开发

```bash
# 安装（workspace 根目录）
npm install

# 同时起前后端
npm run dev

# 或分别起
npm run dev:frontend   # Vite 开发服务器
npm run dev:backend    # Express @ http://localhost:3001
```

环境依赖：
- Node.js（建议 ≥ 18）
- `legal-desens` CLI 已安装并可运行（NER ONNX 模型在 `~/.legal-desens/models/`）；后端启动时会跑脱敏环境自检

---

## API（后端 `/api`）

| 方法 | 路径 | 功能 | 状态 |
|---|---|---|---|
| POST | `/upload` | 上传并解析文档（pdf/docx/txt/md）为文本 | ✅ |
| POST | `/desensitize` | 旧版手写正则脱敏 | ⚠️ 待废弃 |
| POST | `/redact` | 接 legal-desens 的可逆脱敏 | 🚧 接入中 |
| POST | `/analyze` | 提取劳动争议要素 + 算费 | ✅ |
| POST | `/generate` | 按要素与模板生成意见书 Markdown | ✅ |
| GET | `/health` | 健康检查 | ✅ |

---

## 当前状态

- ✅ 前端：首页 / 三栏办案区 / 脱敏编辑器（自动识别 + 划词增删脱敏）/ 设置
- ✅ 后端：4 个核心 API 跑通；`redactService` 已接 legal-desens
- ✅ 交互原型：`prototype.html`（高保真单文件，供视觉/交互参考）
- 🚧 **存储层未建**：案件数据仍在前端内存，刷新即丢 → 下一优先级
- 🚧 算费规则前端/后端两套，需统一到后端
- ⚠️ `analyzeService` 内有硬编码默认值（王* / 某某科技），需与真实要素打通

## 路线图（建议顺序）

1. **建 SQLite 存储层**：案件/材料/要素/意见书落盘，新建·列表·详情打通持久化
2. 脱敏流程切到 `/redact`（legal-desens），中间区消费 redacted markdown + map
3. 算费规则统一到后端，前端只展示
4. 意见书生成接审计记录（来源/模型/人工确认状态）
5. 导出 .docx / 打印 PDF

---

## 开发约定（摘自 AGENTS.md）

- 不提交真实客户数据、案件材料、日志、数据库或密钥；测试用合成/脱敏数据。
- AI 输出标记为草稿/建议，保留来源与人工确认状态，不伪装成最终法律意见。
- 提交遵循 Conventional Commits；每个 PR 写明 Summary、Verification、Risk。
