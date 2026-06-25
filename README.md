# LAWCHERS 案件材料脱敏工作台

面向单个律师本地自用的**案件材料脱敏工作台**。在浏览器里完成一条闭环：

> 登记案件 → 上传材料 → 在文档上复核/增删脱敏标注 → 按原格式导出脱敏副本

数据全部保存在本机、不上云。脱敏由本地 `legal-desens` 引擎（regex + 中文 NER）完成，原件只读，导出时生成新的脱敏副本。

---

## 环境要求

- Node.js ≥ 18
- Python ≥ 3.9
- `legal-desens` CLI 已安装且可运行；后端启动时会自检。

## 安装

```bash
npm install        # 在仓库根目录（npm workspace，一次装好前后端）
```

## 安装脱敏引擎与 NER 模型

脱敏引擎 `legal-desens` 需要单独安装。NER 模型用于识别姓名、机构名、地址等非结构化实体（正则引擎开箱即用，NER 为增强能力）。

```bash
# 1. 克隆脱敏引擎仓库
git clone https://github.com/Clukay-Fun/lawchers-skills.git
cd lawchers-skills/legal-desensitizer

# 2. 一键安装引擎 + NER 模型（脚本会自动下载 ONNX 模型到 ~/.legal-desens/models/）
bash scripts/install_with_model.sh

# 3. 验证 NER 模型是否就绪
python3 -m legal_desens.cli ner-inspect
# 应看到 self_test.passed=true；若为 false，模型未正确安装
```

如需手动安装模型（例如离线环境），可从 [ModelScope](https://modelscope.cn/models/Clukay416/legal-desens-cluener-onnx) 下载模型包并解压到 `~/.legal-desens/models/roberta-crf-ner/`。

> 后端启动时会自动检测 NER 状态；若模型未安装，系统降级为纯正则模式（仍可工作，但不识别人名/机构等）。

## 运行

```bash
npm run dev            # 同时启动前端 + 后端
# 或分别启动：
npm run dev:frontend   # 前端 Vite 开发服务器
npm run dev:backend    # 后端 Express（http://localhost:3001）
```

启动后在浏览器打开前端地址（默认 Vite 的 `http://localhost:5173`）。

## 使用

1. **新建案件**：填当事人、相对方、案由。
2. **上传材料**：支持 DOCX、PDF 等；上传后自动预处理并识别敏感信息。
3. **复核脱敏**：文档里自动标注的敏感处以高亮显示——
   - 左键点击：临时查看原文；
   - 右键：取消该处脱敏；
   - 框选文字：手动新增脱敏。
4. **导出**：确认后按原格式导出脱敏副本（导出前自动做残留复检，原件不被改动）。

> 案件、材料、脱敏映射均存于本机（`data/`、`uploads/`、`exports/`，已被 git 忽略），不会提交进仓库或上传外部。
