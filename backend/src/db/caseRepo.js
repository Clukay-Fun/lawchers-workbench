/**
 * 描述: 案件仓储持久化数据访问层
 * 主要功能:
 *     - 提供案件的创建 (含 Lc-年份-0001 年号自增按年重置算法)、更新、删除及列表查询
 *     - 使用事务机制同时初始化配套争议要素行，保证要素一对一完整性
 *     - 基于 ON DELETE CASCADE 外键约束，实现删除案件时物理删除全套子项
 */

import db from './index.js';

/**
 * 依据 Lc-<年份>-<4位自增> 规则，计算并分配最新案号
 * @returns {string} 拼装后的唯一案号
 */
function generateCaseNo() {
  const currentYear = new Date().getFullYear();
  const prefix = `LC-${currentYear}-`;

  // 查询当年已有案号的最大记录
  const lastCase = db.prepare(`
    SELECT case_no FROM "case" 
    WHERE case_no LIKE ? 
    ORDER BY case_no DESC LIMIT 1
  `).get(`${prefix}%`);

  let nextNum = 1;
  if (lastCase && lastCase.case_no) {
    const parts = lastCase.case_no.split('-');
    if (parts.length === 3) {
      const lastNum = parseInt(parts[2], 10);
      if (!isNaN(lastNum)) {
        nextNum = lastNum + 1;
      }
    }
  }

  // 补齐 4 位自增序号
  return `${prefix}${String(nextNum).padStart(4, '0')}`;
}

//region 外部访问 API 模块

/**
 * 创建新案件，并配套生成唯一的争议要素行
 * @param {Object} caseData 案件输入数据
 * @param {string} caseData.employee 劳动者姓名
 * @param {string} caseData.company 被申请人单位
 * @param {string} [caseData.title] 案件标题，可选
 * @returns {Object} 数据库持久化后的案件主键 id 和案号 caseNo
 */
export function createCase(caseData) {
  const tx = db.transaction((data) => {
    const caseNo = generateCaseNo();
    const title = data.title || `${data.employee}诉${data.company}劳动争议案`;

    // 1. 插入主案件记录
    const insertCaseStmt = db.prepare(`
      INSERT INTO "case" (case_no, title, cause, employee, company, stage, claim_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const res = insertCaseStmt.run(
      caseNo,
      title,
      data.cause || '劳动争议',
      data.employee,
      data.company,
      data.stage || 'todo',
      data.claim_amount || 0.0
    );
    const caseId = res.lastInsertRowid;

    // 2. 插入配套争议事实要素行，以 case_id 作为主键
    const insertElementStmt = db.prepare(`
      INSERT INTO "case_element" (case_id, entry_date, leave_date, salary, has_contract, leave_reason, working_months, job_title)
      VALUES (?, NULL, NULL, 0.0, 1, 'dismiss', 0.0, '')
    `);
    insertElementStmt.run(caseId);

    return { id: caseId, caseNo };
  });

  return tx(caseData);
}

/**
 * 查询案件列表
 * @returns {Array} 案件信息列表
 */
export function getCasesList() {
  return db.prepare(`
    SELECT c.*, COUNT(m.id) AS material_count
    FROM "case" c
    LEFT JOIN "material" m ON m.case_id = c.id
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `).all();
}

/**
 * 按主键或案号获取具体案件详细信息（融合关联的材料、算费要素、意见书等）
 * @param {number|string} identifier 案件主键 id 或 案号 case_no
 * @returns {Object|null} 整合包装后的案件全景实体
 */
export function getCaseDetail(identifier) {
  let queryField = 'id';
  if (typeof identifier === 'string' && identifier.startsWith('LC-')) {
    queryField = 'case_no';
  }

  // 1. 查案件基础主体
  const caseObj = db.prepare(`
    SELECT * FROM "case" WHERE ${queryField} = ?
  `).get(identifier);

  if (!caseObj) return null;

  // 2. 查争议计算器要素
  const element = db.prepare(`
    SELECT * FROM "case_element" WHERE case_id = ?
  `).get(caseObj.id);

  // 3. 查名下关联文档材料
  const mList = db.prepare(`
    SELECT * FROM "material" WHERE case_id = ? ORDER BY uploaded_at ASC
  `).all(caseObj.id);

  // 为材料组装对应的脱敏实体标签
  const materials = mList.map((mat) => {
    const entities = db.prepare(`
      SELECT * FROM "entity" WHERE material_id = ?
    `).all(mat.id);
    return {
      ...mat,
      entities,
    };
  });

  // 4. 查名下关联文书意见书
  const opinions = db.prepare(`
    SELECT * FROM "opinion" WHERE case_id = ? ORDER BY created_at DESC
  `).all(caseObj.id);

  return {
    ...caseObj,
    calculatorInput: element ? {
      employeeName: caseObj.employee,
      companyName: caseObj.company,
      entryDate: element.entry_date || '',
      leaveDate: element.leave_date || '',
      salary: element.salary || 0,
      hasContract: element.has_contract === 1,
      leaveReason: element.leave_reason || 'dismiss',
      workingMonths: element.working_months || 0.0,
      jobTitle: element.job_title || '技术开发岗',
    } : null,
    materials,
    opinions,
  };
}

/**
 * 修改案件状态属性
 * @param {number} id 案件主键 id
 * @param {Object} fields 待更新的键值对字段
 */
export function updateCase(id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;

  const setClause = keys.map(k => `"${k}" = ?`).join(', ');
  const values = Object.values(fields);
  values.push(id);

  db.prepare(`
    UPDATE "case" SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(...values);
}

/**
 * 物理级联删除案件
 * @param {number} id 案件主键 id
 */
export function deleteCase(id) {
  db.prepare(`
    DELETE FROM "case" WHERE id = ?
  `).run(id);
}

//endregion
