/**
 * Redactions — 单一事实源模型 (docs/24)
 *
 * redactions 数组是唯一状态。遮蔽框 / 星号实体 / 占位实体 / 待重选
 * 均由派生函数从 redactions 纯函数计算，不再双向同步。
 *
 * 复用既有算法：multiDiff / mapEntities / detectAmbiguous / findOcrSpansForBox
 * 只替换状态承载结构，不重写算法。
 */

import { multiDiff, mapEntities, detectAmbiguous } from './diff';

// ─── 数据模型 ───────────────────────────────────────────────

/**
 * @typedef {Object} Redaction
 * @property {string} id            — "red_N" 不可变 ID
 * @property {boolean} enabled      — false = 已取消（右键取消）
 * @property {'active'|'needs_reselect'} status
 * @property {string} entityType    — PERSON / PHONE / SEAL / CUSTOM ...
 * @property {string} original      — 敏感原文（纯视觉记录可为空串）
 * @property {'regex'|'ner'|'manual'|'seal'} source
 * @property {{start:number,end:number}|null} textAnchor — 在当前工作文本中的偏移
 * @property {PageRegion[]} pageRegions — 归一化坐标 [0,1]
 *
 * @typedef {Object} PageRegion
 * @property {string} id    — "reg_N"
 * @property {number} page
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

// ─── 校验器 ─────────────────────────────────────────────────

/**
 * 校验单条 redaction 结构合法性。
 * @returns {{valid:boolean, errors:string[]}}
 */
export function validateRedaction(r) {
  const errors = [];
  if (!r || typeof r !== 'object') { errors.push('redaction is not an object'); return { valid: false, errors }; }
  if (!r.id || typeof r.id !== 'string') errors.push('id missing or not string');
  if (typeof r.enabled !== 'boolean') errors.push('enabled must be boolean');
  if (r.status !== 'active' && r.status !== 'needs_reselect') errors.push(`status "${r.status}" not in {active, needs_reselect}`);
  if (!r.entityType || typeof r.entityType !== 'string') errors.push('entityType missing');
  if (typeof r.original !== 'string') errors.push('original must be string');
  if (!['regex', 'ner', 'manual', 'seal'].includes(r.source)) errors.push(`source "${r.source}" invalid`);
  if (r.textAnchor !== null) {
    if (typeof r.textAnchor !== 'object') { errors.push('textAnchor must be object or null'); }
    else {
      if (typeof r.textAnchor.start !== 'number' || typeof r.textAnchor.end !== 'number') errors.push('textAnchor.start/end must be numbers');
      else if (r.textAnchor.start < 0 || r.textAnchor.end <= r.textAnchor.start) errors.push('textAnchor range invalid');
    }
  }
  if (!Array.isArray(r.pageRegions)) errors.push('pageRegions must be array');
  else {
    for (let i = 0; i < r.pageRegions.length; i++) {
      const p = r.pageRegions[i];
      if (typeof p.page !== 'number' || typeof p.x !== 'number' || typeof p.y !== 'number' ||
          typeof p.width !== 'number' || typeof p.height !== 'number') { errors.push(`pageRegions[${i}] has non-numeric fields`); break; }
      if (p.x < 0 || p.y < 0 || p.width <= 0 || p.height <= 0 ||
          p.x + p.width > 1.001 || p.y + p.height > 1.001) { errors.push(`pageRegions[${i}] out of [0,1] bounds`); break; }
    }
  }
  return { valid: errors.length === 0, errors };
}

// ─── 派生函数（纯函数）──────────────────────────────────────

/**
 * 派生遮蔽框（mask 模式用）。
 * 规则（docs/24 表）:
 *   enabled=true + 有 pageRegions → 生效（含 needs_reselect，保留原框）
 *   enabled=false → 不生效
 *   只有 textAnchor → 不显框
 */
export function deriveBoxes(redactions) {
  if (!Array.isArray(redactions)) return [];
  const boxes = [];
  for (const r of redactions) {
    if (!r.enabled) continue;
    if (!r.pageRegions || r.pageRegions.length === 0) continue;
    for (const reg of r.pageRegions) {
      boxes.push({
        id: reg.id,
        page: reg.page,
        x: reg.x,
        y: reg.y,
        width: reg.width,
        height: reg.height,
        coordinateSpace: 'page-normalized',
        entityId: r.id,
        entityIds: [r.id],
        entityType: r.entityType,
        source: r.source,
        text: r.original,
        original: r.original,
      });
    }
  }
  return boxes;
}

/**
 * 派生文本实体（星号/占位模式用）。
 * 规则:
 *   enabled=true + status=active + 有 textAnchor → 生效
 *   status=needs_reselect → 暂停替换，不进文本导出
 *   只有 pageRegions → 不生效
 */
export function deriveTextEntities(redactions) {
  if (!Array.isArray(redactions)) return [];
  const entities = [];
  for (const r of redactions) {
    if (!r.enabled) continue;
    if (r.status !== 'active') continue;
    if (!r.textAnchor) continue;
    entities.push({
      id: r.id,
      original: r.original,
      entity_type: r.entityType,
      start: r.textAnchor.start,
      end: r.textAnchor.end,
      source: r.source,
    });
  }
  return entities;
}

/**
 * 派生待重选列表（文本模式 UI 提示用）。
 * needs_reselect 且有 original 文本的记录。
 */
export function derivePendingReselect(redactions) {
  if (!Array.isArray(redactions)) return [];
  const pending = [];
  for (const r of redactions) {
    if (!r.enabled) continue;
    if (r.status !== 'needs_reselect') continue;
    pending.push({
      id: r.id,
      original: r.original,
      entity_type: r.entityType,
    });
  }
  return pending;
}

/**
 * 派生已取消的 ID 集合（用于旧 cancelled-entities 兼容）。
 */
export function deriveCancelledIds(redactions) {
  if (!Array.isArray(redactions)) return [];
  return redactions.filter(r => !r.enabled).map(r => r.id);
}

// ─── 转换器（旧格式 → redactions，确定性）────────────────────

/**
 * 把旧格式 (textEntities + boxes + cancelled + pendingReselect)
 * 确定性转换成 redactions 数组。
 *
 * @param {Array} textEntities — 旧格式 [{id, original, entity_type, start, end, source}]
 * @param {Array} boxes — 旧格式 [{id, page, x, y, width, height, entityId, entityIds, source, entityType, text}]
 * @param {Set|Array} cancelled — 已取消的旧 ID 集合
 * @param {Array} pendingReselect — 旧格式 [{id, original, entity_type}]
 * @returns {Redaction[]} — redactions 数组
 */
export function convertToRedactions(textEntities = [], boxes = [], cancelled = [], pendingReselect = []) {
  const cancelledSet = cancelled instanceof Set ? cancelled : new Set(cancelled);
  const redactions = [];
  let counter = 0;

  const findBoxesForEntity = (entityId) => boxes.filter(b => {
    const linked = b.entityIds?.length ? b.entityIds : [b.entityId].filter(Boolean);
    return linked.includes(entityId);
  });

  // Phase 1: text-anchored entities
  for (const ent of textEntities) {
    const rid = `red_${counter++}`;
    const matchingBoxes = findBoxesForEntity(ent.id);
    const pageRegions = matchingBoxes.map(b => ({
      id: `reg_${b.id || rid}`,
      page: b.page || 1,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
    }));
    const source = ent.source || (ent.id?.startsWith('manual_') || ent.id?.startsWith('bbox_') ? 'manual' : 'regex');
    redactions.push({
      id: rid,
      enabled: !cancelledSet.has(ent.id),
      status: 'active',
      entityType: ent.entity_type || 'CUSTOM',
      original: ent.original || '',
      source,
      textAnchor: { start: ent.start, end: ent.end },
      pageRegions,
      _legacyId: ent.id,
    });
  }

  // Phase 2: pending reselect entities (keep boxes, no textAnchor)
  for (const p of pendingReselect) {
    const rid = `red_${counter++}`;
    const matchingBoxes = findBoxesForEntity(p.id);
    const pageRegions = matchingBoxes.map(b => ({
      id: `reg_${b.id || rid}`,
      page: b.page || 1,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
    }));
    redactions.push({
      id: rid,
      enabled: true,
      status: 'needs_reselect',
      entityType: p.entity_type || 'CUSTOM',
      original: p.original || '',
      source: 'regex',
      textAnchor: null,
      pageRegions,
      _legacyId: p.id,
    });
  }

  // Phase 3: boxes without any entity linkage (seals, pure-visual manual boxes)
  const entityIdsLinked = new Set();
  for (const ent of textEntities) entityIdsLinked.add(ent.id);
  for (const p of pendingReselect) entityIdsLinked.add(p.id);

  for (const b of boxes) {
    const linked = b.entityIds?.length ? b.entityIds : [b.entityId].filter(Boolean);
    const hasEntity = linked.some(id => entityIdsLinked.has(id));
    if (!hasEntity) {
      const rid = `red_${counter++}`;
      redactions.push({
        id: rid,
        enabled: !cancelledSet.has(b.entityId),
        status: 'active',
        entityType: b.entityType || (b.source === 'seal' ? 'SEAL' : 'CUSTOM'),
        original: b.text || b.original || '',
        source: b.source === 'seal' ? 'seal' : 'manual',
        textAnchor: null,
        pageRegions: [{
          id: `reg_${b.id || rid}`,
          page: b.page || 1,
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
        }],
        _legacyId: b.id,
      });
    }
  }

  return redactions;
}

// ─── 文本编辑重映射（复用 multiDiff / mapEntities / detectAmbiguous）─────────

/**
 * 文本编辑后重映射 redactions 的 textAnchor。
 * 复用 diff.js 的 multiDiff + mapEntities + detectAmbiguous，
 * 只把 redaction.textAnchor 适配为 {id, start, end, original} 喂给算法。
 *
 * - kept: 偏移平移，status 保持 active
 * - remapped: 更新 textAnchor 到新位置，status 保持 active
 * - needsReselect: status → needs_reselect，textAnchor 置 null（保留 pageRegions）
 * - trulyCancelled: enabled → false
 *
 * 纯视觉记录（textAnchor=null）不受文本编辑影响。
 *
 * @param {Redaction[]} redactions
 * @param {string} prevText
 * @param {string} nextText
 * @returns {Redaction[]} — 新 redactions 数组
 */
export function remapRedactions(redactions, prevText, nextText) {
  if (!redactions || redactions.length === 0) return redactions || [];
  if (prevText === nextText) return redactions;

  // 提取有 textAnchor 的 enabled 记录作为 "entities" 喂给 diff 算法
  const anchored = redactions
    .filter(r => r.enabled && r.textAnchor)
    .map(r => ({ id: r.id, start: r.textAnchor.start, end: r.textAnchor.end, original: r.original }));

  if (anchored.length === 0) return redactions;

  const changes = multiDiff(prevText, nextText);
  const { kept, cancelled } = mapEntities(anchored, changes);
  const { remapped, needsReselect } = detectAmbiguous(cancelled, nextText);

  const posMap = new Map();
  for (const e of kept) posMap.set(e.id, { start: e.start, end: e.end });
  for (const e of remapped) posMap.set(e.id, { start: e.start, end: e.end });

  const reselectIds = new Set(needsReselect.map(e => e.id));
  const remapIds = new Set(remapped.map(e => e.id));
  const trulyCancelledIds = new Set(
    cancelled.filter(e => !reselectIds.has(e.id) && !remapIds.has(e.id)).map(e => e.id)
  );

  return redactions.map(r => {
    if (!r.enabled || !r.textAnchor) return r;
    if (trulyCancelledIds.has(r.id)) return { ...r, enabled: false };
    if (reselectIds.has(r.id)) return { ...r, status: 'needs_reselect', textAnchor: null };
    if (posMap.has(r.id)) return { ...r, textAnchor: posMap.get(r.id), status: 'active' };
    return r;
  });
}

// ─── 操作辅助（S3 用，纯函数返回新数组）──────────────────────

/**
 * 新增 redaction。
 */
export function addRedaction(redactions, partial) {
  const maxN = redactions.reduce((mx, r) => {
    const m = r.id?.match(/^red_(\d+)$/);
    return m ? Math.max(mx, parseInt(m[1], 10)) : mx;
  }, -1);
  const id = `red_${maxN + 1}`;
  const r = {
    id,
    enabled: true,
    status: 'active',
    entityType: partial.entityType || 'CUSTOM',
    original: partial.original || '',
    source: partial.source || 'manual',
    textAnchor: partial.textAnchor || null,
    pageRegions: partial.pageRegions || [],
  };
  return [...redactions, r];
}

/**
 * 更新 redaction（移动/缩放框等）。
 */
export function updateRedaction(redactions, id, patch) {
  return redactions.map(r => r.id === id ? { ...r, ...patch } : r);
}

/**
 * 取消 redaction（右键取消 = enabled=false）。
 */
export function cancelRedaction(redactions, id) {
  return redactions.map(r => r.id === id ? { ...r, enabled: false } : r);
}

/**
 * 重新选择（从 needs_reselect 恢复到 active，更新 textAnchor/original）。
 */
export function resolveRedaction(redactions, id, textAnchor, original) {
  return redactions.map(r => r.id === id
    ? { ...r, status: 'active', textAnchor, original: original || r.original }
    : r
  );
}
