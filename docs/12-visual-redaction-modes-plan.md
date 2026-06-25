# 开发计划 12 · 视觉遮蔽优先的本地脱敏主线（遮蔽 / 星号 / 占位 三模式）

> **产品主线**：视觉遮蔽优先的本地脱敏工具。脱敏页重做为「双栏图像 + 可编辑框」。
> 关系：**取代 docs/10 的 MD 预览 + decisions 脱敏交互**（其降为底层/过渡能力，不再作主交互）；**docs/11 暂停**（PDF 脱敏 PDF 输出由本计划遮蔽模式接管）。导航不动：脱敏 / 还原 / 历史 / 规则 / 设置 / 下载，只重做「脱敏」页。

## 两套脱敏模型（不可混）
- **遮蔽模式（默认、主模式）**：基于**页面坐标 / 像素 / PDF 视觉层**。适合扫描 PDF、盖章页、签字页、图片证据、文本 PDF。导出 = 原文件的遮蔽版 **PDF**。
- **替换模式（星号 / 占位）**：基于**文本内容 / OCR 文本 / DOCX XML / TXT·MD**。编辑文本。导出 TXT/MD/DOCX。
  - 星号：`深圳市康成泰实业有限公司 → 深**********司`
  - 占位：`… → <单位1>`

## 文件类型 × 模式 × 导出格式
| 文件类型 | 遮蔽 | 星号替换 | 占位替换 |
|---|---|---|---|
| 扫描 PDF | 导出 PDF | TXT/MD/DOCX | TXT/MD/DOCX |
| 文本 PDF | 导出 PDF | TXT/MD/DOCX（后续可 PDF） | TXT/MD/DOCX（后续可 PDF） |
| DOCX | 可预览遮蔽（不优先） | DOCX/TXT/MD | DOCX/TXT/MD |
| TXT/MD | 不适合 | TXT/MD | TXT/MD |

---

## P0 · 坐标映射契约 + 页面渲染（**第一优先级，硬前置**）
> 不先钉死坐标，遮蔽必然变成"看着遮住了、导出歪了"。

**坐标空间（统一定义、写进代码注释）**：
- 页面坐标：PDF point（pt），**原点统一**（左上或左下二选一并固定）。
- 渲染坐标：page image / canvas 像素（按渲染 DPI）。
- 显示坐标：CSS 像素。
- 导出坐标：PDF point（文本 PDF redaction）或 raster image 像素（扫描）。

**box 一律存"页面归一化坐标"，禁止存屏幕像素**：
```js
{ id, page, x, y, width, height,   // x/y/w/h ∈ [0,1] 相对页面
  coordinateSpace: 'page-normalized', pageWidth, pageHeight,  // 页面 pt 尺寸
  source: 'ocr'|'seal'|'manual'|'rule', entityType, locked:false }
```
- 前端显示：归一化 → CSS 像素（按当前缩放/retina）。
- 导出：归一化 → PDF point / raster 像素。

**P0 验收（必须真跑、贴证据）**：
- 100% 缩放导出对齐；150% 缩放导出对齐；Retina 不偏移；多页不串页；页面旋转不偏移；手动画框导出后覆盖位置与预览一致（像素级，给容差）。

---

## P1 · 遮蔽主干（端到端跑通）
- 引擎：PDF → 每页渲染为图片（已知 DPI/scale）；OCR 出文字框（带 box）。
- 前端「脱敏」页双栏：
  - 左：原文件页面图 + 自动识别框 + **可编辑框 overlay**——鼠标默认即"框选模式"，框选立即新增 box；hover 显示 `×`（删除）+ 右下角 resize handle；拖框移动、拖角缩放、点 × 删除。
  - 右：**实时**把同样的框画成黑色遮蔽块（不要右侧脱敏列表）。
  - 顶部：遮蔽 / 星号 / 占位 模式切换（默认遮蔽）。
- 导出遮蔽 PDF（真遮蔽）：
  - 扫描 PDF：页面渲染成图 → 像素画黑块 → 重建 image-only PDF。
  - 文本 PDF：PyMuPDF redaction annotation **真删除框内文字层** + 画黑块。
- **P1 验收**：合成扫描 PDF + 文本 PDF 各一，自动框+手动框 → 导出遮蔽 PDF → 黑块位置与预览一致；文本 PDF 框内文字**不可提取**；扫描 PDF 框内像素为黑；失败 fail-closed 不留半成品。

## P1.5 · 公章检测（独立切片，不阻塞主干，best-effort）
- 引擎 OpenCV：红色 HSV 阈值 + 圆/椭圆轮廓 + 面积/圆度过滤 → seal box（`source:'seal'`）。
- 检测到给框、用户可调整/删除；检测不到用户手动框。**明说 best-effort，不保证全中**。

## P2 · 星号 / 占位文本导出
- OCR/文本抽取 → 可编辑文本视图；星号预览 / 占位预览；导出 TXT/MD/DOCX。
- PDF 的星号/占位先导出 TXT/MD/DOCX，**不强行回写 PDF**。

## P3 · 规则中心深度接入
- 强制脱敏词 / 保留词库 / 自定义正则 / 公章签名手写区域规则 / 批量处理——喂给两条管线。

---

## 数据模型
```
Task
├── source file
├── pages[]  { index, image, pageWidth/pageHeight(pt), textBoxes[], sealBoxes[], manualBoxes[] }
├── redactionMode: mask | star | placeholder
└── exportResult
```
box 全部 page-normalized（见 P0）。

## 引擎（legal-desensitizer，Python） / 工作台 分工
- 引擎：PDF→页图、OCR 框、（P1.5）OpenCV 红章、遮蔽导出（像素/redaction）。新依赖 **OpenCV**（评估 macOS arm64 安装成本，纳入 setup）。
- 工作台：双栏 + 可编辑框 overlay + 实时黑块 + 模式切换 + 导出 + 历史。

## API
- `POST /api/tasks`：上传 + 分析（渲染页图、OCR 框；P1.5 加红章）。
- `GET /api/tasks/:id`：任务、页面、框。
- `PATCH /api/tasks/:id/boxes`：增删改框（存归一化坐标）。
- `POST /api/tasks/:id/export`：按模式导出（遮蔽→PDF；星号/占位→TXT/MD/DOCX），导出前校验、fail-closed。

## 不做范围
PDF 回写星号/占位（后续）、签名/手写检测模型、批量（P3 再说）、英文 LLM。

## 执行约束
- **P0 坐标契约先行**，未通过 P0 验收不进 P1。
- 视觉沿用当前 Solarized / 米白 / LAWCHERS，不照抄元典 UI。
- 验证铁律：每阶段贴真实证据（导出文件、像素/文本提取核对、对齐截图），禁止只 build/lint。
- 引擎/工作台分仓库提交；Conventional Commits、原子提交、当前分支、不 push。
