/**
 * 任务历史仓储层（替代 material + case 的无状态脱敏任务）
 */

import db from './index.js';

export function createTask({ filename, ext, document_kind, entity_stats, export_path, map_path, audit_path, residual_passed }) {
  const stmt = db.prepare(`
    INSERT INTO "task" (filename, ext, document_kind, entity_stats, export_path, map_path, audit_path, residual_passed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
