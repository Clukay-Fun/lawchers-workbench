# 开发计划 05 · GitHub 可安装分发（pinned git subdirectory install）

> 目标：别人 `git clone lawchers-workbench` 后，`npm run setup && npm run dev` 即可安装并运行——**全部所需组件（引擎 + pdf/ocr + NER 模型 + SQLite）一次装完**。
> 方向（已拍板）：**pip-from-git 子目录装引擎，不拆独立仓库、不 submodule、不发 PyPI、不打二进制；只承诺 macOS/Linux。**

## 一句话
先用 **pinned git subdirectory install** 达成 GitHub 可安装闭环；给 `legal-desens` 加最小 `paths --json` 资源发现命令；把工作台从"引擎源码绝对路径依赖"里彻底解出来。

---

## 一、引擎最小改动（仓库 lawchers-skills / legal-desensitizer；**先做**）
- 新增 CLI 子命令 `legal-desens paths --json`，输出包内资源路径：
  ```json
  { "rules": "/.../legal_desens/rules/rules.json" }
  ```
  第一版只需 `rules`；预留可扩展 `profiles` / `models`。
- 仅此一处改动，不动 strict 默认语义、不改规则、不动现有命令。
- 提交后**记下该 commit hash**，供工作台 pin。

## 二、工作台改动（仓库 lawchers-workbench；引擎提交后再做）

### 2.1 CLI 解析器（去硬编码）
- 新增一个解析模块，按顺序找 `legal-desens` 可执行文件：
  1. `process.env.LEGAL_DESENS_BIN`
  2. `<repo>/.venv/bin/legal-desens`
  3. `<repo>/.venv/Scripts/legal-desens.exe`（路径先留，**不承诺 Windows**）
  4. `PATH` 里的 `legal-desens`
- **代码里不得再出现** `/Users/clukay/...` 兜底路径；本机调试路径只能放 `.env.local`（gitignore），不进仓库。

### 2.2 替换所有调用点
把现有 `DESENSITIZER_DIR + python3 -m legal_desens.cli ... (cwd: DESENSITIZER_DIR)` 全部换成解析出的 `legal-desens <子命令>`（console script，无需 `-m`、无需 cwd）。落点：
- `backend/src/routes.js`：prepare(~819-850)、export(~1301-1319)。
- `backend/src/services/redactService.js`：self-check(`verifyDesensitizerEnvironment`)、redact、redact-scan、audit、动态规则段。

### 2.3 日期开关：用 `--entity-policy`，不再读引擎源码里的 rules.json
- `prepare` 已支持 `--entity-policy <json文件>`。日期关闭时，工作台**写临时 entity-policy 文件**（`preserve_types: ["DATE","TIME"]`）传入，运行后清理。
- **删除** `path.join(DESENSITIZER_DIR, 'legal_desens/rules/rules.json')` 这类按源码路径读规则的逻辑。
- 若某处确需规则路径（自检/能力显示），改用 `legal-desens paths --json` 获取，不假设源码目录。
- 边界：工作台**只传策略，不在运行时改写规则**。

### 2.4 安装与脚手架
- `requirements-engine.txt`（pin commit）：
  ```
  legal-desens[pdf,ocr] @ git+https://github.com/Clukay-Fun/lawchers-skills.git@<pinned-commit>#subdirectory=legal-desensitizer
  ```
- `scripts/setup-engine.sh`（macOS/Linux）：建 `.venv` → `pip install -r requirements-engine.txt` → 跑模型安装（`install_with_model.sh` 或等价）→ `legal-desens --version` / 一次 `prepare` 烟雾测试。
- `npm run setup` 编排：
  1. 安装 Node 依赖
  2. 创建 `.venv`
  3. `pip install` 引擎（pdf/ocr extras，pin commit）
  4. 安装 NER 模型
  5. 初始化 SQLite
  6. `legal-desens` 自检（version + prepare smoke test）
  7. 打印 `npm run dev`
- setup 要**明确打印耗时提示**：
  ```
  Installing legal-desens with pdf/ocr extras...
  Downloading local NER model...
  This may take several minutes on first run.
  ```

### 2.5 `.env.example` 与 README
- `.env.example`：写 `LEGAL_DESENS_BIN`（注释说明默认走 `.venv`）；本机兜底路径仅作注释示例。
- README 改为：
  ```bash
  git clone <lawchers-workbench>
  cd lawchers-workbench
  npm run setup     # 首次会装引擎+pdf/ocr+NER模型，需几分钟
  npm run dev
  ```
  并写明：不内置真实客户数据；脱敏由 legal-desens 引擎提供；首次启动安装本地引擎；所有材料默认只存本机。

---

## 三、不做（本阶段明确排除）
- 不拆 `legal-desensitizer` 独立仓库、不 submodule、不发 PyPI、不打二进制。
- 不承诺 Windows 完整支持（resolver 留 `.venv/Scripts` 路径，但不测试/不保证）。

## 四、验收（收口）
- **干净环境**：在一个全新 clone 的工作台目录 `npm run setup && npm run dev` 跑通（macOS，至少口头确认 Linux 路径一致）。
- 代码内 `grep -rn "/Users/clukay"` **零命中**；`DESENSITIZER_DIR + -m legal_desens.cli` 全部替换。
- `legal-desens paths --json` 返回正确 rules 路径。
- **真实 e2e（贴证据）**：上传文本 PDF → prepare(pdf-text) → 导出真脱敏 PDF + 残留通过；日期关闭→无日期候选（用 entity-policy）。
- 不回退已完成功能（DOCX 闭环、文本 PDF 导出、死码清理）。

## 五、约束
- 两仓库分开提交：引擎(`paths` 命令)先、工作台后；引擎提交 hash 写进工作台 `requirements-engine.txt`。
- 验证铁律：禁止只 build/lint 充验证，要贴真实安装/运行输出。
- Conventional Commits、原子提交、当前分支、不 push。
