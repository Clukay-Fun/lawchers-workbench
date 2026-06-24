/**
 * 描述: 法律工作台后端 API 请求封装模块
 * 主要功能:
 *     - 案件 CRUD API (Stage 4)
 *     - 材料上传、脱敏、确认 API (Stage 4)
 *     - 要素分析 API (Stage 5)
 *     - 意见书生成、确认 API (Stage 6)
 *     - 导出 API (Stage 7)
 */

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api';

// #region Stage 4: 案件 CRUD API

/**
 * 创建新案件
 * @param {Object} caseData { employee, company, title, cause }
 * @returns {Promise<Object>} { id, caseNo }
 */
export async function createCase(caseData) {
  const response = await fetch(`${API_BASE}/cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(caseData),
  });
  if (!response.ok) throw new Error('创建案件失败');
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '创建案件异常');
  return result.data;
}

/**
 * 获取案件列表
 * @returns {Promise<Array>} 案件列表
 */
export async function getCases() {
  const response = await fetch(`${API_BASE}/cases`, { method: 'GET' });
  if (!response.ok) throw new Error('获取案件列表失败');
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '获取案件列表异常');
  return result.data;
}

/**
 * 获取案件详情（含材料、要素、意见书、审计日志）
 * @param {number|string} id 案件 ID 或案号
 * @returns {Promise<Object>} 案件详情
 */
export async function getCaseDetail(id) {
  const response = await fetch(`${API_BASE}/cases/${id}`, { method: 'GET' });
  if (!response.ok) throw new Error('获取案件详情失败');
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '获取案件详情异常');
  return result.data;
}

/**
 * 更新案件
 * @param {number} id 案件 ID
 * @param {Object} fields 更新字段
 */
export async function updateCase(id, fields) {
  const response = await fetch(`${API_BASE}/cases/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!response.ok) throw new Error('更新案件失败');
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '更新案件异常');
  return result;
}

/**
 * 删除案件
 * @param {number} id 案件 ID
 */
export async function deleteCase(id) {
  const response = await fetch(`${API_BASE}/cases/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('删除案件失败');
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '删除案件异常');
  return result;
}

// #endregion

// #region 接口请求函数模块

/**
 * 上传案件文档材料并获取解析文本
 * @param {File} file 待上传的文件对象
 * @param {number} caseId 案件 ID
 * @returns {Promise<Object>} materialId, filename, filePath, rawText, displayMode
 */
export async function uploadFile(file, caseId) {
  const formData = new FormData();
  formData.append('file', file);
  if (caseId) {
    formData.append('caseId', String(caseId));
  }

  const response = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('材料文件上传解析失败');
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.message || '材料解析异常');
  }

  return result.data;
}

/**
 * 对已上传文件调用 legal-desensitizer 执行脱敏
 * @param {string} filePath 文件绝对路径
 * @param {string} [level='strict'] 脱敏级别
 * @param {Object} [rulesConfig={}] 规则开关
 * @param {number} [materialId] 材料 ID（传入则持久化到 DB）
 * @returns {Promise<Object>} 脱敏结果
 */
export async function redactFile(filePath, level = 'strict', rulesConfig = {}, materialId = null, manualRedactions = []) {
  const body = { filePath, level, rulesConfig, manualRedactions };
  if (materialId) body.materialId = materialId;

  const response = await fetch(`${API_BASE}/redact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error('文件脱敏处理失败');
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '脱敏业务异常');
  return result.data;
}

/**
 * 保存用户在原格式预览中框选的人工脱敏文本。
 */
export async function saveManualRedactions(materialId, items) {
  const response = await fetch(`${API_BASE}/materials/${materialId}/manual-redactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  if (!response.ok) throw new Error('保存人工脱敏标注失败');
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '保存人工脱敏标注异常');
  return result.data;
}

export async function saveMaterialText(materialId, text) {
  const response = await fetch(`${API_BASE}/materials/${materialId}/text`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error('保存文本工作副本失败');
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '保存文本工作副本异常');
}

/**
 * 扫描件脱敏
 */
export async function redactScanFile(filePath, level = 'strict', rulesConfig = {}, materialId = null) {
  const body = { filePath, level, rulesConfig };
  if (materialId) body.materialId = materialId;

  const response = await fetch(`${API_BASE}/redact-scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error('扫描件像素脱敏处理失败');
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '扫描件脱敏业务异常');
  return result.data;
}

/**
 * 确认材料脱敏完成
 * @param {number} materialId 材料 ID
 */
export async function confirmMaterial(materialId) {
  const response = await fetch(`${API_BASE}/materials/${materialId}/confirm`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('确认材料失败');
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '确认材料异常');
  return result;
}

/**
 * 删除材料（连带本地脱敏产物与实体）
 * @param {number} materialId 材料 ID
 */
export async function deleteMaterial(materialId) {
  const response = await fetch(`${API_BASE}/materials/${materialId}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('删除材料失败');
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '删除材料异常');
  return result;
}

/**
 * 从后端获取 NER 脱敏引擎状态
 */
export async function getNerStatus() {
  const response = await fetch(`${API_BASE}/redact/status`, { method: 'GET' });
  if (!response.ok) throw new Error('获取脱敏自检状态失败');
  const result = await response.json();
  if (!result.success) throw new Error('脱敏引擎状态异常');
  return result.data;
}

// #endregion

// #region Stage 5: 要素分析 API

/**
 * 提取劳动争议核心要素
 * @param {string} text 脱敏后的文本
 * @param {number} [caseId] 案件 ID（传入则持久化要素）
 * @returns {Promise<Object>} 要素与计算结果
 */
export async function analyzeCase(text, caseId = null) {
  const body = { text };
  if (caseId) body.caseId = caseId;

  const response = await fetch(`${API_BASE}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error('案件要素提取与算费失败');
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '要素自动提取业务异常');
  return result.data;
}

// #endregion

// #region Stage 6: 意见书生成与确认 API

/**
 * 生成法律意见书
 * @param {Object} elements 确认的要素
 * @param {string} templateType 模板类型
 * @param {number} [caseId] 案件 ID（传入则持久化到 opinion 表）
 * @returns {Promise<Object>} 意见书文本
 */
export async function generateOpinion(elements, templateType = 'labor_standard', caseId = null) {
  const body = { elements, templateType };
  if (caseId) body.caseId = caseId;

  const response = await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error('法律意见书生成失败');
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '法律意见书生成业务异常');
  return result.data;
}

/**
 * 人工确认意见书
 * @param {number} opinionId 意见书 ID
 */
export async function confirmOpinion(opinionId) {
  const response = await fetch(`${API_BASE}/opinions/${opinionId}/confirm`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('确认意见书失败');
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '确认意见书异常');
  return result;
}

// #endregion

// #region Stage 7: 导出 API

/**
 * 导出脱敏材料为 .docx
 * @param {number} materialId 材料 ID
 */
export async function exportRedactedDocx(materialId) {
  const response = await fetch(`${API_BASE}/export/redacted-docx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ materialId }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || '导出脱敏文档失败');
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `redacted-${Date.now()}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

/**
 * 按原文件格式导出脱敏副本。服务端会从原件重新生成并执行残留复检。
 */
export async function exportRedactedFile(materialId, filename = 'document') {
  const response = await fetch(`${API_BASE}/export/redacted`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ materialId }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || '原格式脱敏导出失败');
  }

  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const fallbackName = filename.replace(/(\.[^.]+)?$/, '.redacted$1');
  const downloadName = encodedName ? decodeURIComponent(encodedName) : fallbackName;
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

/**
 * 导出意见书为 .docx（仅限已确认）
 * @param {number} opinionId 意见书 ID
 */
export async function exportOpinionDocx(opinionId) {
  const response = await fetch(`${API_BASE}/export/opinion-docx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ opinionId }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || '导出意见书失败');
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `opinion-${Date.now()}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

// #endregion

// #region Markdown 复核工作流 API

/**
 * 触发文档预处理（调 legal-desens prepare）
 * @param {number} materialId 材料 ID
 * @param {Object} [rulesConfig] 脱敏规则配置（含日期开关等）
 * @returns {Promise<Object>} 预处理结果
 */
export async function prepareMaterial(materialId, rulesConfig = null) {
  const body = {};
  if (rulesConfig) body.rulesConfig = rulesConfig;

  const response = await fetch(`${API_BASE}/materials/${materialId}/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || '文档预处理失败');
  }
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '预处理异常');
  return result.data;
}

/**
 * 获取复核数据（preview + manifest + decisions）
 * @param {number} materialId 材料 ID
 * @returns {Promise<Object>} 复核数据
 */
export async function getReviewData(materialId) {
  const response = await fetch(`${API_BASE}/materials/${materialId}/review`, {
    method: 'GET',
  });
  if (!response.ok) throw new Error('获取复核数据失败');
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '获取复核数据异常');
  return result.data;
}

/**
 * 批量更新决策
 * @param {number} materialId 材料 ID
 * @param {Array} decisions 决策列表
 * @returns {Promise<Object>} { count, added }
 */
export async function updateDecisions(materialId, decisions) {
  const response = await fetch(`${API_BASE}/materials/${materialId}/decisions`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decisions }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || '更新决策失败');
  }
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '更新决策异常');
  return result.data;
}

/**
 * 标记复核完成
 * @param {number} materialId 材料 ID
 * @returns {Promise<Object>}
 */
export async function completeReview(materialId) {
  const response = await fetch(`${API_BASE}/materials/${materialId}/review-complete`, {
    method: 'POST',
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || '标记复核完成失败');
  }
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '标记复核完成异常');
  return result.data;
}

/**
 * 按决策导出脱敏副本
 * @param {number} materialId 材料 ID
 * @param {string} filename 原始文件名
 */
export async function exportWithDecisions(materialId, filename, confirmPending = false) {
  const response = await fetch(`${API_BASE}/materials/${materialId}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmPending }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || '导出失败');
  }
  const blob = await response.blob();
  const ext = filename ? filename.substring(filename.lastIndexOf('.')) : '';
  const baseName = filename ? filename.substring(0, filename.lastIndexOf('.')) : 'document';
  const downloadName = `${baseName}.redacted${ext}`;
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

// #endregion
