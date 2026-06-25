/**
 * 任务历史仓储层（替代 material + case 的无状态脱敏任务）
 */

import db from './index.js';

export function createTask({
  filename, ext, document_kind, entity_stats,
  export_path, map_path, audit_path, residual_passed,
  source_path, work_dir, manifest_path, source_map_path, rules_config,
}) {
  const stmt = db.prepare(`
    INSERT INTO "task" (
      filename, ext, document_kind, entity_stats,
      export_path, map_path, audit_path, residual_passed,
      source_path, work_dir, manifest_path, source_map_path, rules_config
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    filename,
    ext || '',
    document_kind || '',
    entity_stats ? JSON.stringify(entity_stats) : null,
    export_path || null,
    map_path || null,
    audit_path || null,
    residual_passed ? 1 : 0,
    source_path || null,
    work_dir || null,
    manifest_path || null,
    source_map_path || null,
    rules_config ? JSON.stringify(rules_config) : null,
  );
  return { id: result.lastInsertRowid };
}

export function getTaskList() {
  return db.prepare(`SELECT * FROM "task" ORDER BY created_at DESC`).all();
}

export function getTaskById(id) {
  return db.prepare(`SELECT * FROM "task" WHERE id = ?`).get(id);
}

export function deleteTask(id) {
  return db.prepare(`DELETE FROM "task" WHERE id = ?`).run(id);
}

export function updateTask(id, {
  entity_stats, export_path, map_path, audit_path, residual_passed, work_dir,
}) {
  const fields = [];
  const values = [];
  if (entity_stats !== undefined) { fields.push('entity_stats = ?'); values.push(JSON.stringify(entity_stats)); }
  if (export_path !== undefined) { fields.push('export_path = ?'); values.push(export_path); }
  if (map_path !== undefined) { fields.push('map_path = ?'); values.push(map_path); }
  if (audit_path !== undefined) { fields.push('audit_path = ?'); values.push(audit_path); }
  if (residual_passed !== undefined) { fields.push('residual_passed = ?'); values.push(residual_passed ? 1 : 0); }
  if (work_dir !== undefined) { fields.push('work_dir = ?'); values.push(work_dir); }
  if (!fields.length) return;
  values.push(id);
  db.prepare(`UPDATE "task" SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}
