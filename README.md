# LAWCHERS 法律文书脱敏工具

本地优先的中文法律文书脱敏工具。在浏览器里完成一条闭环：

> 上传文件 → 自动识别敏感信息 → 选脱敏模式（遮蔽 / 星号 / 占位）→ 调整框选与标注 → 导出脱敏副本

**隐私说明**：数据全部保存在本机、不上云。脱敏由本地 [legal-desens](https://github.com/Clukay-Fun/lawchers-skills/tree/main/legal-desensitizer) 引擎（regex 规则 + 中文 NER + OCR + 公章检测）完成，原件只读，导出时另存为新的脱敏副本。所有文件与历史仅存于本机（`backend/data/`、`uploads/` 等目录，已被 git 忽略）。

---

## 功能概览

主导航：**脱敏 / 还原 / 历史 / 规则 / 设置 / 下载**。

### 三种脱敏模式

| 模式 | 原理 | 适用 | 导出格式 | 示例 |
|---|---|---|---|---|
| **遮蔽**（默认） | 页面坐标 / 像素 / PDF 视觉层，敏感处盖黑块 | 扫描 PDF、盖章页、签字页、图片证据、文本 PDF | 脱敏版 **PDF** | 敏感区域不可提取、像素为黑 |
| **星号** | 文本内容 / OCR 文本，按字符掩码 | DOCX、TXT/MD、文本/扫描 PDF | TXT / MD / DOCX | `深圳市康成泰实业有限公司 → 深**********司` |
| **占位** | 文本内容，替换为编号占位符 | 同上 | TXT / MD / DOCX | `… → <单位1>` |

- 遮蔽模式：左右双栏，左为原页面 + 可编辑遮蔽框，右为遮蔽预览；遮蔽框来源 = 命中敏感类型的识别候选 + 公章候选 + 强制脱敏词 + 手动框，可拖动 / 缩放 / 删除。
- 星号 / 占位模式：文本双栏，左为原文（命中高亮），右为替换后预览。
- **公章 / OCR 为 best-effort**：自动识别命中即给框，识别不到可手动框选补充。

### 其他页面

- **还原**：用脱敏时生成的映射，把占位/掩码文本还原回原文。
- **历史**：本机处理记录，可重新下载导出产物。
- **规则**：强制脱敏词、保留词库、自定义规则。
- **设置**：引擎 / NER 开关等。
- **下载**：导出产物下载入口。

---

## 快速开始

> 首次安装需联网下载脱敏引擎 + NER 模型（约几分钟、模型约 500MB）。装好后离线可用。

### macOS（推荐双击）

1. `git clone https://github.com/Clukay-Fun/lawchers-workbench.git`
2. 双击 **安装 LAWCHERS.command**（一键装依赖、引擎、模型并构建前端，可断点续装）
3. 装好后双击 **启动 LAWCHERS.command**
4. 浏览器自动打开 `http://localhost:3000`

> 若被 Gatekeeper 拦截：右键 → 打开（应用未签名）。

### Windows（双击）

1. `git clone https://github.com/Clukay-Fun/lawchers-workbench.git`
2. 双击 **安装 LAWCHERS.bat**
3. 装好后双击 **启动 LAWCHERS.bat**
4. 浏览器自动打开 `http://localhost:3000`

> Windows 启动器与 macOS 等价，但需在 Windows 机器上实测确认。

---

## 环境要求

- Node.js ≥ 18
- Python ≥ 3.9
- macOS / Linux / Windows

---

## 开发者

命令行安装与运行（开发模式，前后端分离）：

```bash
git clone https://github.com/Clukay-Fun/lawchers-workbench.git
cd lawchers-workbench
npm run setup          # 安装引擎到 .venv（PDF/OCR extras）
npm run dev            # 前端 Vite :5173 + 后端 Express :3001
```

> `npm run setup` 只装引擎。完整安装（Node 依赖 + 引擎 + NER 模型 + 前端构建）由双击安装脚本 `scripts/setup-app.sh` / `scripts/setup-app.ps1` 完成。

单独启动：

```bash
npm run dev:frontend   # 前端 Vite (http://localhost:5173)
npm run dev:backend    # 后端 Express (http://localhost:3001)
```

生产单服务（双击启动器走的就是这个）：

```bash
NODE_ENV=production node backend/src/index.js   # 默认 http://localhost:3000
```

---

## 技术栈

- **前端**：React + Vite + Tailwind + shadcn/ui
- **后端**：Node.js + Express + better-sqlite3（SQLite）
- **脱敏引擎**：legal-desens（Python，regex + NER ONNX）
- **PDF / OCR / 公章**：PyMuPDF + RapidOCR + OpenCV

引擎以固定 commit pin 在 `requirements-engine.txt`（git 安装，可复现）。升级时改 hash 并重跑安装脚本。
