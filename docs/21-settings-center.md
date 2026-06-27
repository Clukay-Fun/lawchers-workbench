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
逐项把硬编码/env 换成 `getSetting`:
1. **上传大小上限**(`uploadMaxMB`,默认 100):multer 设一个高天花板(如 500MB),在上传 handler 里按 `uploadMaxMB` 校验真实大小,超出返回 **413 + 明确文案**。(multer 模块级 limit 改不了 per-request,故 handler 校验。)
2. **OCR DPI / 识别精度**(`ocrDpi`,默认 200,可选 150/200/300):render-pages 3 处 `--dpi` 读 `ocrDpi`。**改 DPI 后已缓存 render-manifest 失效 → 需重渲染**(缓存按 dpi 分键或改值时清 pages 重渲)。
3. **处理超时**(`processTimeoutMs`,默认 600000):各 execFile timeout 读它。
4. **NER 模式**(`nerMode`: auto/regex-only,默认 auto):regex-only 时引擎传 `--regex-only`、analyze 跳过 ner-spans。
5. **掩码字符 / 保留格式 / 导出前校验**:从前端 props 改为落库持久化。

每项 verify:改设置 → 重新处理 → 行为按设置变(贴证据:大文件超上限被拒、DPI 改 150 渲染更快/字更糊、regex-only 时无 NER 命中)。

## P3 · 设置页 UI（可编辑、分组）
分组:**上传**(大小上限) / **识别**(DPI、NER 模式) / **性能**(处理超时) / **脱敏**(掩码字符、保留格式、导出前校验)。引擎状态那块保持只读诊断不动。
- 控件:数字输入 / 下拉 / 开关;改动即 `PATCH /api/settings`;给"已保存"反馈。
- verify:每个控件改值→落库→相应行为变;非法值(如上限 0、DPI 非档位)被拒。

---

## 不做（留 env / 高级,不进 UI）
端口、引擎 pin/commit、model_dir、binPath(只读诊断已显示)、脱敏 level(引擎语义,风险大)、OCR 置信度阈值(高级)、OMP 线程数(高级,可后续作"性能"补充项)。

## 执行约束
- 先 P1 持久化层,再 P2 接线,再 P3 UI。读取一律"库 → env → 默认"回退,不破坏现有行为。
- 验证铁律:禁止只 build/lint;每项贴真实证据(改值前后行为差异)。
- Conventional Commits、原子提交、当前分支、不 push。
