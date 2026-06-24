/**
 * 描述: 脱敏决策仓储层
 * 主要功能:
 *     - replaceAllDecisions: 全量替换（仅用于 prepare 初始化）
 *     - insertDecisions: 追加插入（用于手动新增决策）
 *     - 单条更新、确认、删除
 */

import db from './index.js';

//region 外部访问 API 模块

/**
 * 全量替换指定材料的所有决策（仅用于 prepare 初始化）
 * 会先删除旧决策再插入新决策
 */
export function replaceAllDecisions(materialId, decisions) {
  const stmt = db.prepare(`
    INSERT INTO "redaction_decision" (material_id, candidate_id, block_id, start, end, action, origin, entity_type, source_locator, confirmed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((list) => {
    db.prepare('DELETE FROM "redaction_decision" WHERE material_id = ?').run(materialId);
    for (const d of list) {
      stmt.run(
        materialId,
        d.candidateId || d.candidate_id || null,
        d.blockId || d.block_id,
        d.start,
        d.end,
        d.action || 'redact',
        d.origin || 'automatic',
        d.entityType || d.entity_type || '',
        typeof d.sourceLocator === 'string' ? d.sourceLocator : JSON.stringify(d.sourceLocator || d.source_locator || {}),
        d.confirmed ? 1 : 0,
      );
    }
  });

  tx(decisions);
}

/**
 * 追加插入决策（不删除已有记录）
 */
export function insertDecisions(materialId, decisions) {
  const stmt = db.prepare(`
    INSERT INTO "redaction_decision" (material_id, candidate_id, block_id, start, end, action, origin, entity_type, source_locator, confirmed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((list) => {
    for (const d of list) {
      stmt.run(
        materialId,
        d.candidateId || d.candidate_id || null,
        d.blockId || d.block_id,
        d.start,
        d.end,
        d.action || 'redact',
        d.origin || 'automatic',
        d.entityType || d.entity_type || '',
        typeof d.sourceLocator === 'string' ? d.sourceLocator : JSON.stringify(d.sourceLocator || d.source_locator || {}),
        d.confirmed ? 1 : 0,
      );
    }
  });

  tx(decisions);
}

/**
 * 查询指定材料的所有脱敏决策
 */
export function getDecisionsByMaterialId(materialId) {
  return db.prepare(`
    SELECT * FROM "redaction_decision" WHERE material_id = ? ORDER BY id ASC
  `).all(materialId);
}

/**
 * 查询已确认的脱敏决策数量
 */
export function getDecisionReviewCounts(materialId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN confirmed = 1 THEN 1 ELSE 0 END) AS confirmed
    FROM "redaction_decision"
    WHERE material_id = ?
  `).get(materialId);
  return {
    total: row?.total || 0,
    confirmed: row?.confirmed || 0,
  };
}

/**
 * 更新单条决策
 */
export function updateDecision(materialId, id, fields) {
  const allowedFields = new Set(['action', 'confirmed']);
  const keys = Object.keys(fields).filter((key) => allowedFields.has(key));
  if (keys.length === 0) return;
  const setClause = keys.map(k => `"${k}" = ?`).join(', ');
  const values = keys.map((key) => fields[key]);
  values.push(id, materialId);
  return db.prepare(`
    UPDATE "redaction_decision" SET ${setClause}
    WHERE id = ? AND material_id = ?
  `).run(...values).changes;
}

/**
 * 删除单条决策
 */
export function deleteDecision(id) {
  db.prepare(`DELETE FROM "redaction_decision" WHERE id = ?`).run(id);
}

//endregion
