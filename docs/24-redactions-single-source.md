# 开发计划 24 · 单一脱敏记录 redactions（三模式派生，收敛双向同步）

> 架构收敛:用唯一事实源 `redactions` 派生 遮蔽框 / 星号实体 / 占位实体,**取代** docs/22(P1/P1.5)+docs/23(P2) 累积的 `boxes ↔ textEntities` 双向同步与多个 sidecar 文件。
> 复用既有算法(不可变 id、多段 diff、待重选、画框 OCR 反查),**只替换状态承载结构**,不重写算法。
> 定性:一次架构收敛,**走 feature 分支整体合入**,不碎补丁。

## 现状（已核,说明为何收敛）
- P1/P1.5/P2 已落地。但 session 现需拼装 `boxes.json + edited-text.json(text+textEntities+pendingReselect) + cancelled-entities.json + refinedBoxes + sealBoxes`,前端再 derive/sync —— 即"重复拼装 + 双向同步"技术债。
- 风险认知:本计划重写**已 17/0 验证的脱敏核心**。价值=止血双向同步;缓解=feature 分支 + 派生函数 + 迁移带回滚 + 10 条必过真机回归门控。

## 唯一事实源
```
redactions ──┬─ 遮蔽模式 → 派生 pageRegions(框)
             ├─ 星号模式 → 派生文字实体
             └─ 占位模式 → 派生文字实体
```
新增 / 取消 / 刷新恢复 **只改 redactions**。

### 数据模型
```js
{
  id: "red_12",
  enabled: true,
  status: "active",            // active | needs_reselect
  entityType: "PERSON",
  original: "张三",
  source: "regex",             // regex | ner | manual | seal
  textAnchor: { start: 120, end: 122 } | null,
  pageRegions: [ { id, page, x, y, width, height } ]   // 归一化坐标
}
```
| 数据 | 遮蔽 | 星号/占位 |
|---|---|---|
| textAnchor + pageRegions | 生效 | 生效 |
| 只有 textAnchor | 不显框 | 生效 |
| 只有 pageRegions | 生效 | 不生效 |
| enabled=false | 不生效 | 不生效 |
| status=needs_reselect | **保留原框、正常预览+导出** | 暂停替换、不进文本导出 |

公章/签名/图片区域 = 纯视觉(只有 pageRegions),不强行同步文本模式。

### needs_reselect 语义（写死）
原文编辑只让文字偏移失效,不改 PDF 页面坐标;隐藏框会让已保护区域重新泄露。法律数据"宁可继续遮蔽"。
- 遮蔽:保留原框,正常预览和导出。
- 星号/占位:暂停替换,不进文本导出。
- UI:文本模式显示"待重新选择";遮蔽框可加**琥珀色小标识**,但不变灰、不隐藏。
- 重新选择后:更新 textAnchor/original,状态回 active,**沿用原 id/pageRegions**。

## 操作语义
- 右键取消:统一 `enabled=false`。
- 文本滑选新增:建文字实体;能匹配 OCR 坐标则同时生成 pageRegions。
- 遮蔽画框:能映射敏感文字→生成文字+坐标完整记录;覆盖多个实体→**拆成多个词级记录**(一框不关联多 id);无文字(公章)→纯视觉记录。
- 移动/缩放框:只改该记录 pageRegions。
- 编辑原文:重映射 textAnchor(复用多段 diff);无法唯一定位→status=needs_reselect。
- 刷新 / 历史继续编辑:直接恢复 redactions,**不重新识别**。

## 持久化
- 工作目录新增 `redactions.json`;接口 `GET /api/tasks/:id/redactions`、`PATCH /api/tasks/:id/redactions`。
- 保存校验:id 唯一;**textAnchor 切片 == original 针对【当前工作文本】校验**(非原始 OCR,否则编辑过的任务保存即报错);归一化坐标合法;临时文件写完原子替换;日志只记数量/操作,**不记敏感原文**。

---

## 迁移切片（S1–S5,feature 分支,整体合入）

### S1 · 建立统一模型（不动 UI）
- 加 redactions 结构 + 校验器 + 派生函数 `deriveBoxes(redactions)` / `deriveTextEntities(redactions)`(纯函数)。
- 把现有 `textEntities + boxes + cancelled + pendingReselect` 转成 redactions(转换器)。
- verify:转换器**确定性**;转换后派生回三模式,与迁移前等价(算法层真测,贴用例)。

### S2 · 切换前端状态
- 组件只存 `const [redactions, setRedactions] = useState([])`。
- `textEntities`/`boxes` 改为选择器 `deriveTextEntities/deriveBoxes`。
- 删除两集合间的同步 handler。
- verify:三模式渲染与切换正常(真机)。

### S3 · 统一新增与取消
- 所有入口只调 `addRedaction / updateRedaction / cancelRedaction(id) / resolveRedaction(id, textAnchor)`。
- 三模式不再各自操作状态。
- verify:任一模式取消/新增,三模式即时同步(真机);公章取消只影响遮蔽。

### S4 · 持久化与旧任务迁移
- 新任务直接写 redactions.json;旧任务首次打开自动转换并保存新文件;**原有文件保留一版便于回滚**。
- verify:旧任务无损迁移(迁移前后派生等价),可回滚。

### S5 · 删除旧链路（**门控**）
- **前置硬条件:下方 10 条必过在真机回归全绿**。未全绿不得删。
- 删除 `cancelled-entities.json`、`boxes↔textEntities` 双向同步、`entityId/entityIds[]` 混合关联、session 重复拼装/过滤。
- verify:删除后 10 条必过仍全绿。

---

## 必过验收（真机,逐条贴证据）
1. 自动识别实体在三模式均出现。
2. 任一模式取消,三模式立即同步。
3. 任一模式新增,可映射时三模式同步。
4. 公章取消只影响遮蔽模式。
5. 刷新后状态不复活。
6. 历史继续编辑不重新 OCR。
7. 编辑原文后实体正确平移或进入待重选。
8. 同文多处不串项。
9. 导出只用 enabled=true 的记录(needs_reselect 遮蔽框仍导出、文本不替换)。
10. 旧任务可无损迁移和回滚。

## 边界 / 不做
- 不引 contenteditable/富文本/协同/撤销栈。
- 复用既有 diff、不可变 id、OCR 反查、待重选算法,只换状态承载。
- S5 删除严格门控,新模型未证明稳前不删旧路径。

## 执行约束
- **走 feature 分支**(非直接 dev),S1→S5 顺序、整体作为一次架构收敛合入。
- 验证铁律:禁止只 build/lint;S1/S4 算法层真测(派生等价),S2/S3 真机,S5 后跑满 10 条必过;逐条贴证据。
- Conventional Commits、原子提交、不 push(合入由用户决定)。
