# 开发计划 21 · 设置中心：可配置项落地 + 持久化层

> 目标：把散落在代码/env 里的可调项收进**设置页**,用户可改、重启仍在、改了真生效。
> 定性：补能力,但**克制**——只开放用户友好且安全的少数旋钮,高级项留 env。先建持久化层,再接调用点。

## 现状（已核）
- **无后端设置持久化**:`settings`(maskChar/preserveFormat/verifyBeforeExport)只是前端 props,不落库;刷新/换机即丢。
- `--dpi 200` 硬编码 3 处(render-pages);上传上限 env `UPLOAD_MAX_MB`=100、UI 无入口;`REDACT_TIMEOUT_MS`=600s env;NER 自动降级。
- 设置页现为只读诊断 + 几个未持久化开关。

---

## P1 · 设置持久化层（先做）
- 新增 `setting` 表(key TEXT PRIMARY KEY, value TEXT) 或单行 JSON 设置;`GET /api/settings`、`PATCH /api/settings`。
- 读取统一走 `getSetting(key, fallback)`:**优先库值 → 再 env → 再硬编码默认**,保证旧行为不变。
- verify:PATCH 写入后 GET 读回一致;重启后仍在。

## P2 · 接上调用点（改了真生效）
只接这 5 项用户友好设置,逐项把硬编码/env 换成 `getSetting`:
1. **识别质量**(`recognitionQuality`: fast/standard/fine → DPI 150/200/300,默认 standard):render-pages 3 处 `--dpi` 读它。**UI 不露 "DPI" 字样**。改质量后已缓存 render-manifest 失效 → 需重渲染(缓存按 dpi 分键或改值时清 pages 重渲)。
2. **单个文件大小上限**(`uploadMaxMB`,默认 100):multer 设高天花板(如 500MB),上传 handler 按 `uploadMaxMB` 校验真实大小,超出返回 **413 + 明确文案**。(multer 模块级 limit 改不了 per-request,故 handler 校验。)
3. **脱敏符号**(`maskChar`,默认 ﹡):从前端 props 改为落库。
4. **保留原文档格式**(`preserveFormat`,开关):落库。
5. **导出前残留检查**(`verifyBeforeExport`,开关,默认开):落库。

每项 verify:改设置 → 重新处理 → 行为按设置变(贴证据:识别质量改"快速"渲染更快/字更糊、超上限文件被拒 413、脱敏符号换成 × 后预览变)。

## P3 · 设置页 UI（可编辑、分组,大白话）
分组:**识别**(识别质量:快速/标准/精细) / **上传**(单个文件大小上限 MB) / **脱敏**(脱敏符号、保留原文档格式、导出前残留检查)。引擎状态那块保持只读诊断不动。
- 控件:下拉 / 数字 / 开关;改动即 `PATCH /api/settings`;给"已保存"反馈。
- **文案大白话,不出现 DPI / NER / 正则 / 超时 等技术词。**
- verify:每个控件改值→落库→相应行为变;非法值(上限 0、质量非档位)被拒。

---

## 不做（太专业,留 env / 高级,不进 UI）
处理超时(秒)、NER 模式/强制仅正则、OMP 线程数、OCR 置信度阈值、端口、引擎 pin/commit、model_dir、脱敏 level。这些律师看不懂,保持 env 配置即可。

## 执行约束
- 先 P1 持久化层,再 P2 接线,再 P3 UI。读取一律"库 → env → 默认"回退,不破坏现有行为。
- 验证铁律:禁止只 build/lint;每项贴真实证据(改值前后行为差异)。
- Conventional Commits、原子提交、当前分支、不 push。
