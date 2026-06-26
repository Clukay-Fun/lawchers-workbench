# 开发计划 16 · 扫描件 OCR 文本接入 NER（P8，工作台侧 / 架构 B）

> 背景（已核实根因）：扫描件 `/api/tasks/:id/analyze`（`routes.js:2320-2360`）的 `textEntities` 只在 Node 里用**正则**跑 OCR 文本生成，**全程没调 NER**。
> 结果：手机号/身份证/银行卡/金额（正则能稳）命中；公司名/律所/人名/地址（靠 NER）永远进不了 `textEntities` → 无 refinedBoxes → 扫描件只剩公章那条独立链路自动遮蔽。
> P6 只解决「已有实体行框→词框」，不负责「发现更多实体」。P8 补的是**扫描件 OCR 文本的实体发现能力**。
>
> **架构（已定，B）**：工作台调引擎已有的 `legal-desens ner-spans`，在**与现有 JS 正则同一 offset 空间**合并，复用 P6 的 `refineToEntityBoxes`。不把文本拼接/offset 契约搬进引擎（A 方案回归面大，不采）。

## 关键约束：offset 空间必须一致
- 现有 `textEntities` 的 start/end 是针对 `ocrBoxes.map(b => b.text).join('\n')` 这份拼接文本算的，`refineToEntityBoxes` 也依赖它。
- NER 必须跑**同一份拼接文本**，spans 的 start/end 落在同一 offset 空间，否则合并后框会错位。
- 因此：先在工作台拼好 ocrText（沿用现有拼法），把这份文本喂给 `ner-spans`，不要让引擎另算文本。

---

## 分项（每项带 verify）

1. **NER spans 接入**
   - analyze 路径拿到 ocrText 后，调 `legal-desens ner-spans`（用同一份 ocrText），解析出 NER spans（start/end/entity_type/text）。
   - 调用方式与 `ner-spans` 的入参/输出对齐（先读引擎 `_cmd_ner_spans` 确认是 stdin/文件/参数传文本、输出 JSON 结构）。
   - verify：对样本 ocrText 调用，打印 NER spans 数量 > 0，spans 文本与原文一致。

2. **合并（同 offset 空间）**
   - NER spans + 现有 JS 正则命中 + denylist/强制脱敏词，合并为统一 `textEntities`。
   - 去重 + 重叠消解：沿用现有「按 start、长度排序，贪心去重」逻辑，跨来源统一处理；冲突时保留更长 / 更高优先级（强制词 > 正则 > NER 可按需定，写注释说明）。
   - verify：构造同一处被多来源命中的样本，最终只保留一条、区间正确。

3. **复用 P6 生成遮蔽框**
   - 合并后的 `textEntities` 喂 `refineToEntityBoxes`；星号/占位继续直接用 `textEntities`。
   - verify：扫描件遮蔽模式下，机构/人名/地址出现词级遮蔽框（非整行）；星号/占位预览里这些被掩码。

4. **NER 启用前置 + 降级**
   - 确认 analyze 路径实际能用上 NER 模型（`LEGAL_DESENS_MODEL_DIR` / `getIsNerEnabled` 链路）；启动脚本已设模型目录。
   - NER 不可用（模型缺失/`ner-spans` 失败）时**降级为仅正则**，不报错、不阻断 analyze。
   - verify：模型可用时 NER 命中 > 0；手动制造模型不可用，analyze 仍成功、只是无 NER 实体且有降级提示。

5. **诊断提示**
   - analyze 响应里返回计数：OCR 行数 / regex 命中数 / NER 命中数 / seal 命中数。
   - 页面显示这些计数；NER 未启用时提示「扫描件当前仅正则识别，姓名/机构/地址可能不会自动脱敏」。
   - verify：页面能看到四类计数；关掉 NER 时出现该提示。

---

## 验收（真机贴证据，用真实扫描件）
- 拿委托代理合同扫描件跑完整链路，以下应进入 `textEntities` 并被遮蔽框/星号命中：
  - 「深圳市海源节能科技有限公司」「北京市隆安（深圳）律师事务所」「上海中联（深圳）律师事务所」
  - 人名「唐秀荣」「何育强」「张弛」「廖聪」
  - 地址类「深圳市福田区益田路平安金融中心北塔61楼」等
- NER 命中数 > 0；遮蔽框与原文位置对齐（offset 不错位，给截图）。
- 正则原本能命中的（手机号 0755-…、联系电话 15817465075、账号、金额）不丢。

## 边界（不做）
- 不动 P6 的 `refineToEntityBoxes` 逻辑、不改坐标契约。
- 正则仍走现有 JS（B 架构既定权衡，不搬进引擎）。
- 不调优 NER 模型本身 / 不解决 OCR 错字（如 `138 0013 8000` 被拆）——另排。
- 不碰 native（非扫描）文档链路。

## 执行约束
- 主要动工作台 analyze 路径与前端诊断显示；引擎 `ner-spans` 已存在，尽量只调用、不改；若发现 `ner-spans` 输出不含 offset 或语义不符，**先停下确认**，不在前端硬凑。
- 验证铁律：禁止只 build/lint；贴真实 analyze 响应（四类计数）、扫描件遮蔽截图（机构/人名命中、对齐）、降级路径验证。
- Conventional Commits、原子提交、当前分支、不 push。
