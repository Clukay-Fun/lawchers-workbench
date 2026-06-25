/**
 * 规则仓储层（自定义正则 + 黑名单 + 白名单）
 */

import db from './index.js';

export function getAllRules() {
  return db.prepare(`SELECT * FROM "rule" ORDER BY category, id`).all();
}

export function getRulesByCategory(category) {
  return db.prepare(`SELECT * FROM "rule" WHERE category = ? ORDER BY id`).all(category);
}

export function createRule({ name, category, regex, token_prefix, description, is_active, sample }) {
  const stmt = db.prepare(`
    INSERT INTO "rule" (name, category, regex, token_prefix, description, is_active, sample)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    name,
    category || 'custom',
    regex || null,
    token_prefix || null,
    description || '',
    is_active !== false ? 1 : 0,
    sample || null,
  );
  return { id: result.lastInsertRowid };
}

export function updateRule(id, fields) {
  const allowed = ['name', 'regex', 'token_prefix', 'description', 'is_active', 'sample'];
  const entries = Object.entries(fields).filter(([k]) => allowed.includes(k));
  if (!entries.length) return;
  const set = entries.map(([k]) => `"${k}" = ?`).join(', ');
  const values = entries.map(([, v]) => v);
  values.push(id);
  return db.prepare(`UPDATE "rule" SET ${set} WHERE id = ?`).run(...values);
}

export function deleteRule(id) {
  return db.prepare(`DELETE FROM "rule" WHERE id = ?`).run(id);
}
