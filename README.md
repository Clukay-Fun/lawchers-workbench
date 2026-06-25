# LAWCHERS 案件材料脱敏工作台

面向单个律师本地自用的**案件材料脱敏工作台**。在浏览器里完成一条闭环：

> 登记案件 → 上传材料 → 在文档上复核/增删脱敏标注 → 按原格式导出脱敏副本

**隐私说明**：数据全部保存在本机、不上云。脱敏由本地 [legal-desens](https://github.com/Clukay-Fun/lawchers-skills/tree/main/legal-desensitizer) 引擎（regex + 中文 NER）完成，原件只读，导出时生成新的脱敏副本。所有案件材料仅存于本机 `data/`、`uploads/` 目录（已被 git 忽略）。

---

## 快速开始（macOS）

### 方式一：双击安装（推荐）

1. `git clone https://github.com/Clukay-Fun/lawchers-workbench.git`
2. 双击 **安装 LAWCHERS.command**
3. 安装完成后，双击 **启动 LAWCHERS.command**
4. 浏览器自动打开 `http://localhost:3000`

> 首次安装需下载引擎 + NER 模型，约需几分钟。
> 若被 Gatekeeper 拦截：右键 → 打开（应用未签名）。

### 方式二：命令行

```bash
git clone https://github.com/Clukay-Fun/lawchers-workbench.git
cd lawchers-workbench
npm run setup     # 首次安装：引擎 + PDF/OCR + NER 模型，需几分钟
npm run dev       # 启动开发模式（前端 :5173 + 后端 :3001）
```

## 使用

1. **新建案件**：填当事人、相对方、案由。
2. **上传材料**：支持 DOCX、PDF；上传后自动预处理并识别敏感信息。
3. **复核脱敏**：文档里自动标注的敏感处以高亮显示——
   - 左键点击：确认该处脱敏（可临时查看原文）；
   - 右键：取消该处脱敏；
   - 框选文字：手动新增脱敏。
4. **导出**：确认后按原格式导出脱敏副本（导出前自动做残留复检，原件不被改动）。

## 环境要求

- Node.js ≥ 18
- Python ≥ 3.9
- macOS 或 Linux（主要支持平台）

## 开发模式

```bash
npm run dev:frontend   # 前端 Vite 开发服务器 (http://localhost:5173)
npm run dev:backend    # 后端 Express (http://localhost:3001)
```

## 技术栈

- **前端**：React + Vite
- **后端**：Node.js + Express + better-sqlite3
- **脱敏引擎**：legal-desens（Python，regex + NER ONNX）
- **PDF/OCR**：PyMuPDF + RapidOCR（可选）

## Windows

Windows 支持为 best-effort（未经实测）。运行 `安装 LAWCHERS.bat` / `启动 LAWCHERS.bat`。
