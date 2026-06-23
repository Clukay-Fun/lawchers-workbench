/**
 * 描述: 案件争议事实要素仓储持久化数据访问层
 * 主要功能:
 *     - 提供以案件 ID 为主键的争议事实要素查询
 *     - 提供动态更新争议事实要素记录的功能，供算费器与前端反填使用
 */

import db from './index.js';

//region 外部访问 API 模块

/**
 * 查询指定案件的争议事实要素记录
 * 
 * 功能:
 *     - 按 case_id 获取 case_element 表中的单条记录
 */
export function getCaseElement(caseId) {
  return db.prepare(`
    SELECT * FROM "case_element" WHERE case_id = ?
  `).get(caseId);
}

/**
 * 动态更新指定案件的争议要素记录
 * 
 * 功能:
 *     - 根据传入的字段动态生成 SQL 并更新 case_element 记录
 */
export function updateCaseElement(caseId, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;

  const setClause = keys.map(k => `"${k}" = ?`).join(', ');
  const values = Object.values(fields);
  values.push(caseId);

  db.prepare(`
    UPDATE "case_element" SET ${setClause} WHERE case_id = ?
  `).run(...values);
}

//endregion
