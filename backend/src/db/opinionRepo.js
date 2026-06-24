/**
 * 描述: 法律意见书文书仓储持久化数据访问层
 * 主要功能:
 *     - 提供意见书草稿的创建（默认状态为 draft）
 *     - 提供人工确认流程修改（升级状态至 confirmed）
 *     - 提供意见书记录查询及删除接口
 */

import db from './index.js';

//region 外部访问 API 模块

/**
 * 新建法律意见书记录
 * 
 * 功能:
 *     - 默认将 status 设为 'draft'
 */
export function createOpinion(opinionData) {
  const stmt = db.prepare(`
    INSERT INTO "opinion" (case_id, template_type, content_md, status)
    VALUES (?, ?, ?, 'draft')
  `);
  
  const res = stmt.run(
    opinionData.case_id,
    opinionData.template_type,
    opinionData.content_md
  );
  
  return { id: res.lastInsertRowid };
}

/**
 * 查询指定案件名下的所有法律意见书
 */
export function getOpinionsByCaseId(caseId) {
  return db.prepare(`
    SELECT * FROM "opinion" WHERE case_id = ? ORDER BY created_at DESC
  `).all(caseId);
}

/**
 * 承办律师确认意见书（将草稿置为人工确认状态）
 * 
 * 功能:
 *     - 将 status 更新为 'confirmed'
 */
export function confirmOpinion(id) {
  const stmt = db.prepare(`
    UPDATE "opinion" SET status = 'confirmed' WHERE id = ?
  `);
  stmt.run(id);
}

/**
 * 删除法律意见书记录
 */
export function deleteOpinion(id) {
  const stmt = db.prepare(`
    DELETE FROM "opinion" WHERE id = ?
  `);
  stmt.run(id);
}

//endregion
