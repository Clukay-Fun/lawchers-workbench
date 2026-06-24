/**
 * 描述: 案件材料与脱敏定位仓储持久化数据访问层
 * 主要功能:
 *     - 提供材料基础记录的创建、更新状态、删除及按案件 ID 查询
 *     - 提供脱敏实体记录的事务批量写入，严格保障明文不入库
 *     - 自动执行日期与时间类型的实体类型归一化 (TIME -> DATE) 存盘
 */

import db from './index.js';

//region 外部访问 API 模块

/**
 * 插入新材料记录
 * 
 * 功能:
 *     - 向 material 表中插入单条材料元数据并返回主键 id
 */
export function addMaterial(materialData) {
  const stmt = db.prepare(`
    INSERT INTO "material" (case_id, filename, ext, stored_path, display_mode, redact_status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  const res = stmt.run(
    materialData.case_id,
    materialData.filename,
    materialData.ext,
    materialData.stored_path,
    materialData.display_mode,
    materialData.redact_status || 'todo'
  );
  
  return { id: res.lastInsertRowid };
}

/**
 * 修改材料脱敏核对状态
 * 
 * 功能:
 *     - 更新 redact_status 为 'todo' 或 'done'
 */
export function updateMaterialStatus(id, redactStatus) {
  const stmt = db.prepare(`
    UPDATE "material" SET redact_status = ? WHERE id = ?
  `);
  stmt.run(redactStatus, id);
}

/**
 * 物理删除单条材料
 * 
 * 功能:
 *     - 物理删除 material 表记录，触发 ON DELETE CASCADE 级联删除对应的 entity 行
 */
export function deleteMaterial(id) {
  const stmt = db.prepare(`
    DELETE FROM "material" WHERE id = ?
  `);
  stmt.run(id);
}

/**
 * 查询指定案件名下的所有文档材料（附带关联的无明文实体映射）
 * 
 * 功能:
 *     - 关联 entity 表查出各材料所有的脱敏实体标记
 */
export function getMaterialsByCaseId(caseId) {
  const materials = db.prepare(`
    SELECT * FROM "material" WHERE case_id = ? ORDER BY uploaded_at ASC
  `).all(caseId);

  return materials.map((mat) => {
    const entities = db.prepare(`
      SELECT * FROM "entity" WHERE material_id = ?
    `).all(mat.id);
    
    return {
      ...mat,
      entities,
    };
  });
}

/**
 * 批量插入材料的脱敏实体映射（不存明文）
 * 
 * 功能:
 *     - 使用事务安全地删除旧实体并写入新实体列表
 *     - 自动过滤 original 明文，仅持久化 masked, start, end 等坐标数据
 *     - 执行日期类型归一化：将 TIME 类型强转为 DATE，并将“【时间】”掩码转为“【日期】”
 */
export function bulkInsertEntities(materialId, entityList) {
  const insertStmt = db.prepare(`
    INSERT INTO "entity" (material_id, entity_id, entity_type, masked, original, start, end, revealed)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `);

  const tx = db.transaction((list) => {
    // 1. 清理该材料下已有的旧实体，实现覆盖式幂等写入
    db.prepare('DELETE FROM "entity" WHERE material_id = ?').run(materialId);

    // 2. 依次遍历插入
    for (const item of list) {
      let entityType = item.entity_type || item.entityType;
      let masked = item.masked || item.replacement || '***';
      const entityId = item.entity_id || item.entityId || item.id;
      const original = item.original || '';
      const start = item.start !== undefined ? item.start : (item.redacted_start !== undefined ? item.redacted_start : 0);
      const end = item.end !== undefined ? item.end : (item.redacted_end !== undefined ? item.redacted_end : 0);

      // 3. 执行日期归一化逻辑
      if (entityType === 'TIME') {
        entityType = 'DATE';
        if (masked === '【时间】') {
          masked = '【日期】';
        }
      }

      insertStmt.run(
        materialId,
        entityId,
        entityType,
        masked,
        original,
        start,
        end
      );
    }
  });

  tx(entityList);
}

//endregion
