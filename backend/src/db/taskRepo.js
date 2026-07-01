/**
 * 任务历史仓储层（替代 material + case 的无状态脱敏任务）
 */

import db from './index.js';
import { existsSync } from 'fs';
import path from 'path';

export function createTask({
  filename, ext, document_kind, entity_stats,
  export_path, map_path, audit_path, residual_passed,
  source_path, work_dir, manifest_path, source_map_path, rules_config,
  status, file_size,
}) {
  const stmt = db.prepare(`
    INSERT INTO "task" (
      filename, ext, document_kind, entity_stats,
      export_path, map_path, audit_path, residual_passed,
      source_path, work_dir, manifest_path, source_map_path, rules_config,
      status, file_size
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    status || 'uploaded',
    file_size || 0,
  );
  return { id: result.lastInsertRowid };
}

export function getTaskList() {
  const tasks = db.prepare(`SELECT * FROM "task" ORDER BY created_at DESC`).all();
  return tasks.map(inferStatus);
}

export function getTaskById(id) {
  const task = db.prepare(`SELECT * FROM "task" WHERE id = ?`).get(id);
  return task ? inferStatus(task) : null;
}

export function deleteTask(id) {
  return db.prepare(`DELETE FROM "task" WHERE id = ?`).run(id);
}

export function updateTask(id, {
  entity_stats, export_path, map_path, audit_path, residual_passed, work_dir,
  status, progress_step, error_message, file_size, document_kind,
}) {
  const fields = [];
  const values = [];
  if (entity_stats !== undefined) { fields.push('entity_stats = ?'); values.push(JSON.stringify(entity_stats)); }
  if (export_path !== undefined) { fields.push('export_path = ?'); values.push(export_path); }
  if (map_path !== undefined) { fields.push('map_path = ?'); values.push(map_path); }
  if (audit_path !== undefined) { fields.push('audit_path = ?'); values.push(audit_path); }
  if (residual_passed !== undefined) { fields.push('residual_passed = ?'); values.push(residual_passed ? 1 : 0); }
  if (work_dir !== undefined) { fields.push('work_dir = ?'); values.push(work_dir); }
  if (status !== undefined) { fields.push('status = ?'); values.push(status); }
  if (progress_step !== undefined) { fields.push('progress_step = ?'); values.push(progress_step); }
  if (error_message !== undefined) { fields.push('error_message = ?'); values.push(error_message); }
  if (file_size !== undefined) { fields.push('file_size = ?'); values.push(file_size); }
  if (document_kind !== undefined) { fields.push('document_kind = ?'); values.push(document_kind); }
  if (!fields.length) return;
  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);
  db.prepare(`UPDATE "task" SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * C5: Infer status for old tasks without the status column.
 * - Has session.json + redactions.json → 'ready'
 * - Has source file but no analysis products → 'uploaded'
 * - Never returns null — defaults to 'uploaded'
 */
function inferStatus(task) {
  if (task.status && task.status !== 'uploaded') return task;
  // Already has a real status (including 'uploaded' for new tasks)
  // For old tasks: status column may be 'uploaded' (default) but products exist
  if (task.work_dir && existsSync(path.join(task.work_dir, 'session.json'))) {
    // Has session — check if redactions.json also exists (fully ready)
    if (existsSync(path.join(task.work_dir, 'redactions.json')) ||
        existsSync(path.join(task.work_dir, 'edited-text.json'))) {
      return { ...task, status: 'ready' };
    }
    // Has session.json but no redactions — still ready (older format)
    return { ...task, status: 'ready' };
  }
  // No session — just uploaded (or old task with only source)
  return task;
}

