# 开发计划 22 · 文本实体单一事实源 + 三模式联动收敛

> 目标:把"自动脱敏"的事实源统一到 `textEntities`,遮蔽框是它的坐标投影;编辑原文不再清空高亮;遮蔽画框反向生成文本实体。
> 定性:收敛 + 小重构,不引新框架。按风险 **P1 → P1.5 → P2** 三段,先解用户现在真正撞到的问题。

## 现状（已核,含一处必须修的设计缺陷）
- 跨模式取消**主体已接线且一致**:后端给 textEntity 赋 `ent.id`,refinedBox.entityId 用同一键,`handleCancelBox`(824)/`handleCancelEntity`(835) 双向匹配、写 `cancelled-entities.json`、恢复回读(669)。
- **真凶**:`handleTextChange`(890) 编辑原文即 `setTextEntities([])` + 删所有带 entityId 的框 + 清空 cancelled → 全部高亮被毁。
- **设计缺陷(必须修)**:`ent.id = 类型:start:end`(routes.js:2426)、refinedBox.entityId 同源(1940)。**id 依赖位置**,P1 平移 offset 后 id 变化 → 关联又断。**必须改为一次性赋的不可变 ID**(计数器/uuid),offset 变化不影响 id。`cancelled-entities.json` 随之存不可变 id(旧 composite 键的历史数据丢弃可接受,本地单用户、数据可弃)。
- 边界:手工框/公章框无文本实体,只作用遮蔽——合理,不强配。

---

## P1 · 编辑只取消受影响实体 + 合并 cancel + 不可变 ID + 真实回归
**核心(单一变更区间策略,不做完整 diff 引擎)**:
- 改 `handleTextChange`:求新旧文本**最长公共前缀 + 最长公共后缀** → 夹出唯一"变更区间"。
  - 变更区间**之前**的实体:原样保留。
  - 变更区间**之后**的实体:整体平移 offset(start/end 加上长度差)。
  - 与变更区间**相交**的实体:取消(进 cancelled set)。
  - 其余高亮全部保留,**不再清空**。
- **不可变 ID**:后端实体生成处改为赋一次性稳定 id(不再用 `类型:start:end`);refinedBox.entityId 复用该 id;前端平移只动 offset 不动 id。
- **合并** `handleCancelBox`/`handleCancelEntity` 为单一 `cancelEntity(entityId)`:删 textEntity + 删该 entityId 的框 + 写 cancelled + 持久化,三模式即时同步。
- **真实回归(点1:代码已接线≠现象不存在)**:加真机/脚本测试,右键时打印真实 `box.entityId`,覆盖**旧任务恢复、保存后的框、恢复路径**——验证这些路径 entityId 未丢;若丢,补齐关联或修恢复路径。

**P1 必过测试**:
- 遮蔽取消 → 星号/占位同步恢复原文;星号取消 → 遮蔽框消失;切模式/刷新/历史继续编辑后不变。
- 在某实体**前**插入文字 → 其余高亮保留、位置正确(offset 平移、id 不变)。
- 改某实体**内部** → 只取消该实体,其余不动。
- 同文重复出现不串位置。
- 手工框/公章框右键不误删文本实体。
- 缺/丢 entityId 的恢复路径有测试覆盖,联动不断。

## P1.5 · 遮蔽画框 → OCR 实体 → 文本模式同步（独立切片,不可遗漏）
画框完成后:
- 按 OCR 坐标**反查框内文字**(命中的 ocrBoxes 文本 + offset)。
- 生成或复用对应**文本实体**(不可变 id),框保存 `entityIds[]`(一个框可盖多个实体)。
- 星号/占位**同步新增**该实体的脱敏。
- 框内**无 OCR 文字**(公章/签名)→ 仍只作用遮蔽,不造空实体。

**verify**:遮蔽模式画一个盖住"张三手机号"的框 → 切星号/占位,该处已被替换;画一个盖公章的框 → 文本模式无新增、遮蔽有效。

## P2 · 持久化编辑工作文本 + 完整多段 diff + contenteditable（单独评估,风险隔离）
- 持久化编辑后的**工作文本 + 实体位置**到 session(否则刷新仍恢复旧 OCR 文本)。
- 完整多段 diff(P1 的单变更区间升级为多区间)。
- contenteditable 保留高亮的编辑区,保存时执行位置映射。
- 无法唯一定位的重复文字:标记**待重新选择**,不猜测关联。

> P2 是真正的 single-source-of-truth 重构,值得做但不混进 P1/P1.5。

---

## 执行约束
- 顺序 P1 → P1.5 → P2,各自原子提交、独立验证。
- 不可变 ID 改动要贯穿:后端实体生成 + refinedBox.entityId + cancelled-entities.json + 前端平移逻辑,一处不漏。
- 验证铁律:禁止只 build/lint;P1 必过测试逐条贴真实证据(尤其"代码已接线"的路径要真机回归,不靠静态判定)。
- Conventional Commits、原子提交、当前分支、不 push。
