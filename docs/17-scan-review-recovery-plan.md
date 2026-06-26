# 开发计划 17 · 扫描件复核体验与任务可恢复闭环（P9）

> 接续 P8（docs/16，扫描件接 NER）。P8 让扫描件能发现实体了，但暴露三条线交织的问题：
> ① 识别过敏（律师/负责人/书名号被脱）② 视觉交互不够（无左右联动、刷新即丢）③ 持久化与还原契约不完整。
> 本计划（**P9**，非 P8）按"先把可信度和契约补齐，再补体验，最后修识别精度"切片。
> 编号说明：P8 已用于 docs/16，本档为 P9 / docs/17。

## 已核实的事实（计划前提）
- `PATCH /api/tasks/:id/boxes` **已存在**（`routes.js:2465`），前端 `updateTaskBoxes` **已接**，但只在点「保存」(`VisualMaskPage.jsx:357`) 和导出前(`:367`) 调——**非编辑即存**。
- 组件挂载时**重新跑 analyze 取 refinedBoxes**(`:318`)，**没有 GET 回读已保存 boxes** → 刷新即重新分析、丢弃之前编辑。这是"刷新就没了"的根因。
- task 表有 `work_dir / source_path / export_path`；analyze 产物（analyze.json / render-manifest.json / seals.json）**已落盘在 work_dir**。
- 引擎类型映射（`engine/ner.py:35-44`）：`name→PER`、`company/government/organization→ORG`、`address/scene→LOC`、`book/game/movie/position→NER_MISC`。所以"律师/负责人"=position=NER_MISC、《…》=book=NER_MISC；但"法院/司法部门/行政机关"=government=**ORG**（与真实机构同类，类型过滤分不开，需 denylist）。

---

## P9-1 · 任务恢复闭环（最高优先，产品可信度）
**目标**：刷新 / 离开后能从历史「继续编辑」回到原编辑态，不丢框。

- 保存：确认 boxes 可靠持久化（保留显式「保存」，可选编辑后 debounce 自动存；至少保证保存后服务端有最新 boxes）。
- 新增 `GET /api/tasks/:id/session`：从 `work_dir` 回读并组装：`task / manifest(render-manifest) / boxes(已存) / textEntities / ocrText / sealBoxes / mode(可选)`。**不重跑 analyze**。
- 前端挂载逻辑改：优先走 session 回读（有缓存就 hydrate），无缓存才跑 analyze。
- 历史页加「继续编辑」：`work_dir/source_path` 在 → 可编辑并 hydrate；源文件被清理 → 按钮禁用提示"源文件已清理，仅可下载已导出结果"；已导出 → 仍允许继续编辑，再导出生成新版本。
- **verify**：上传→改框→刷新→历史「继续编辑」→框还在、位置一致；清掉 work_dir 的任务按钮禁用。

## P9-2 · 占位可逆导出 + 还原契约（还原功能基础）
**契约写死（避免误导）**：
- 遮蔽 PDF：不可逆，**不生成 map.json**。
- 星号：有损（字符已销毁），不可逆，**不生成 map.json**。
- 占位：可逆，**生成 map.json**。
- 还原页**只接受**「占位导出文件 + map.json」。

- 仅占位模式导出时生成 `原文件名_脱敏.map.json`（与脱敏文件同源）。
- 下载页：占位任务可下载 脱敏文件 / map.json / ZIP（两者打包）；遮蔽、星号任务不出现 map.json 入口。
- 还原页文案与入口调整：「遮蔽 PDF 不可还原；星号文本不可还原；占位文本可凭 map.json 还原。扫描件占位导出仅还原文本内容，不还原原 PDF 版式。」
- **verify**：占位导出得到脱敏文件 + map.json；还原页用这两个还原出原文；遮蔽/星号导出无 map.json、还原页拒绝并给文案。

## P9-3 · 左右联动体验
- 星号/占位**双栏同步滚动**：原文栏与结果栏同一外层 scroll container（或 scrollTop 同步），优先同容器，简单稳定。
- **左右对应高亮**（需每实体/框稳定 id，非数组下标）：
  - 文本模式：hover 左侧原文实体 → 左淡黄 + 右对应替换蓝色高亮；hover 右 → 反向。
  - 遮蔽模式：hover 左框 → 右黑框白描边；hover 右黑框 → 左框蓝描边。
- 右侧黑框 selected/hover：黑底 + **白色描边** + 细蓝外光；编辑（拖拽/删除）仍只在左侧，右侧只做对应预览。
- **verify**：双栏同步滚不漂；hover 左右联动高亮；右黑框选中有白描边。

## P9-4 · 误识别过滤（识别精度，成本低、可与 P9-1 同批/紧跟）
- **第一层（主杠杆）**：默认过滤 `NER_MISC`（position/book/game/movie 不进自动脱敏候选）→ 直接挡掉"律师/负责人/委托代理合同/《…标准》"。
- **第二层**：泛法律词 denylist / preserve-list（法院/司法部门/行政机关/合同/甲方/乙方/签约时间/签约地点/律师/事务所…）。规则：**仅当"实体全文就是泛词"才过滤**；含具体地名/机构结构的完整实体（"北京市隆安（深圳）律师事务所"）**不过滤**。
- **verify**："律师/负责人/法院/《…标准》"不再被脱；"深圳市海源节能科技有限公司 / 隆安（深圳）律师事务所 / 唐秀荣 / 何育强 / 地址"仍被脱。

## P9-5 · 诊断区（调试少靠猜，普通用户不打扰）
- 可折叠小面板显示：OCR 行数 / OCR 全文长度 / textEntities 数 / refinedBoxes 数 / sealBoxes 数 / NER 是否启用 / 各 entity_type 命中统计 / 被过滤数量。
- **verify**：上传后能看到这些计数；"没渲染"时可据此区分 OCR/规则/UI 哪层缺。

---

## 优先级
P9-1（恢复闭环）≈ P9-2（占位 map.json 契约）最关键；**P9-4（丢 NER_MISC）成本低、立竿见影，与 P9-1 同批或紧跟**；P9-3（联动体验）、P9-5（诊断）随后。

## 边界（不做）
- 星号可逆（违背直觉，不做）。
- 自动魔法恢复（无需历史入口的无感恢复）——先做到"历史→继续编辑"可靠即可。
- 右侧预览栏可编辑（保持单侧编辑，避免状态复杂）。
- 引擎模型调优 / OCR 错字纠正（另排）。

## 执行约束
- 复用已有 `PATCH boxes`、work_dir 落盘产物，不重做架构、不重跑 analyze 做恢复。
- 验证铁律：禁止只 build/lint；贴真实证据（刷新后继续编辑截图、占位 map.json 还原结果、左右联动高亮录屏/截图、过滤前后对比、诊断计数）。
- Conventional Commits、原子提交、当前分支、不 push。
