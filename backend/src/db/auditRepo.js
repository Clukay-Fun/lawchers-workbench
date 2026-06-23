/**
 * 描述: 法律操作可追溯审计日志持久化数据访问层
 * 主要功能:
 *     - 提供对脱敏、提取和意见书生成等 AI 操作审计日志的写入接口
 *     - 提供按案件检索审计记录的功能，以便于向律师追溯展示每一次模型调用与人工确认
 */

import db from './index.js';

//region 外部访问 API 模块

/**
 * 记录新的审计操作日志
 * 
 * 参数:
 *   - auditData.case_id: number (关联案件 ID)
 *   - auditData.action: string (redact/element_extract/opinion_generate/opinion_confirm)
 *   - auditData.source: string (legal-desens/regex/ner/llm/human)
 *   - auditData.model_config: Object|string (调用的模型参数配置，如引擎或是否启动 NER)
 *   - auditData.human_confirmed: number (是否人工确认，0=否，1=是)
 * 功能:
 *   - 自动将 model_config 对象进行 JSON 序列化存盘
 */
export function writeAuditLog(auditData) {
  let modelConfigStr = '';
  if (auditData.model_config) {
    modelConfigStr = typeof auditData.model_config === 'string'
      ? auditData.model_config
      : JSON.stringify(auditData.model_config);
  }

  const stmt = db.prepare(`
    INSERT INTO "audit" (case_id, action, source, model_config, human_confirmed)
    VALUES (?, ?, ?, ?, ?)
  `);

  const res = stmt.run(
    auditData.case_id,
    auditData.action,
    auditData.source,
    modelConfigStr,
    auditData.human_confirmed ?? 0
  );

  return { id: res.lastInsertRowid };
}

/**
 * 获取指定案件的所有审计追踪记录
 * 
 * 功能:
 *   - 查询 audit 表，并将 model_config 字段重新解析成 JSON 对象后返回
 */
export function getAuditLogsByCaseId(caseId) {
  const list = db.prepare(`
    SELECT * FROM "audit" WHERE case_id = ? ORDER BY created_at DESC
  `).all(caseId);

  return list.map((item) => {
    let parsedConfig = null;
    if (item.model_config) {
      try {
        parsedConfig = JSON.parse(item.model_config);
      } catch {
        parsedConfig = item.model_config;
      }
    }
    return {
      ...item,
      model_config: parsedConfig,
    };
  });
}

//endregion
