/**
 * LAWCHERS 本地法律文档脱敏工具 API
 */

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

async function readApiError(response, fallback) {
  const err = await response.json().catch(() => ({}));
  const detail = err.error || err.detail;
  return detail ? `${err.message || fallback}：${detail}` : (err.message || fallback);
}

// #region 工具模式 API

/** 上传文件 + 自动 prepare */
export async function createTask(file, rulesConfig = {}) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('rulesConfig', JSON.stringify(rulesConfig));
  const response = await fetch(`${API_BASE}/tasks`, { method: 'POST', body: formData });
  if (!response.ok) throw new Error(await readApiError(response, '文档处理失败'));
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '处理异常');
  return result.data;
}

/** 按决策导出脱敏副本 */
export async function exportTask(taskId, payload) {
  const response = await fetch(`${API_BASE}/tasks/${taskId}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, '导出失败'));
  }
  return response;
}

/** 获取历史列表 */
export async function getHistory() {
  const response = await fetch(`${API_BASE}/history`, { method: 'GET' });
  if (!response.ok) throw new Error('获取历史失败');
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '获取历史异常');
  return result.data;
}

/** 删除历史记录 */
export async function deleteHistory(id) {
  const response = await fetch(`${API_BASE}/history/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('删除失败');
  return response.json();
}

/** 重新下载已导出的脱敏文件 */
export async function downloadHistoryFile(id) {
  const response = await fetch(`${API_BASE}/history/${id}/download`, { method: 'GET' });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || '下载失败');
  }
  return response;
}

/** 下载占位导出的 map.json */
export async function downloadHistoryMap(id) {
  const response = await fetch(`${API_BASE}/history/${id}/download-map`, { method: 'GET' });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || '下载 map.json 失败');
  }
  return response;
}

/** 还原脱敏文件 */
export async function restoreFile(redactedFile, mapFile) {
  const formData = new FormData();
  formData.append('redactedFile', redactedFile);
  formData.append('mapFile', mapFile);
  const response = await fetch(`${API_BASE}/restore`, { method: 'POST', body: formData });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || '还原失败');
  }
  return response;
}

/** 获取规则（系统 + 自定义） */
export async function getRules() {
  const response = await fetch(`${API_BASE}/rules`, { method: 'GET' });
  if (!response.ok) throw new Error('获取规则失败');
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '获取规则异常');
  return result.data;
}

/** 新增自定义规则 */
export async function createRule(rule) {
  const response = await fetch(`${API_BASE}/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || '创建规则失败');
  }
  return response.json();
}

/** 更新规则（启停等） */
export async function updateRule(id, fields) {
  const response = await fetch(`${API_BASE}/rules/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!response.ok) throw new Error('更新规则失败');
  return response.json();
}

/** 删除规则 */
export async function deleteRule(id) {
  const response = await fetch(`${API_BASE}/rules/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('删除规则失败');
  return response.json();
}

/** 获取所有设置 */
export async function getSettings() {
  const response = await fetch(`${API_BASE}/settings`, { method: 'GET' });
  if (!response.ok) throw new Error('获取设置失败');
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '获取设置异常');
  return result.data;
}

/** 更新设置 */
export async function updateSettings(updates) {
  const response = await fetch(`${API_BASE}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || '更新设置失败');
  }
  return response.json();
}

/** 测试正则样例 */
export async function testRegex(regex, sample) {
  const response = await fetch(`${API_BASE}/rules/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ regex, sample }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || '测试失败');
  }
  return response.json();
}

// #endregion

// #region 视觉遮蔽模式 API (P1)

/** OCR 分析 PDF，返回归一化文字框 */
export async function analyzeTask(taskId) {
  const response = await fetch(`${API_BASE}/tasks/${taskId}/analyze`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(await readApiError(response, 'OCR 分析失败'));
  }
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '分析异常');
  return result.data;
}

/** 恢复任务会话（不重跑 analyze，从 work_dir 回读） */
export async function getTaskSession(taskId) {
  const response = await fetch(`${API_BASE}/tasks/${taskId}/session`, { method: 'GET' });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || '恢复会话失败');
  }
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '恢复会话异常');
  return result.data;
}

/** 重新渲染全部页面 */
export async function renderTasksPages(taskId) {
  const response = await fetch(`${API_BASE}/tasks/${taskId}/render-pages`, { method: 'POST' });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || '重新渲染页面失败');
  }
  return response.json();
}


/** 更新任务的遮蔽框列表 */
export async function updateTaskBoxes(taskId, boxes) {
  const response = await fetch(`${API_BASE}/tasks/${taskId}/boxes`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ boxes }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || '更新框失败');
  }
  return response.json();
}

/** 更新已取消的实体列表 */
export async function updateCancelledEntities(taskId, cancelled) {
  const response = await fetch(`${API_BASE}/tasks/${taskId}/cancelled-entities`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cancelled }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || '更新取消列表失败');
  }
  return response.json();
}

/** 导出遮蔽 PDF */
export async function maskExportTask(taskId, boxes) {
  const response = await fetch(`${API_BASE}/tasks/${taskId}/mask-export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ boxes }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || '遮蔽导出失败');
  }
  return response;
}

/** 文本替换导出（星号/占位） */
export async function textExportTask(taskId, entities, mode, format, text) {
  const response = await fetch(`${API_BASE}/tasks/${taskId}/text-export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entities, mode, format, text }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || '文本替换导出失败');
  }
  return response;
}

/** 保存编辑后的工作文本与实体位置 */
export async function updateEditedText(taskId, data) {
  const response = await fetch(`${API_BASE}/tasks/${taskId}/edited-text`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const j = await response.json();
  if (!j.success) throw new Error(j.message || '保存编辑文本失败');
  return j;
}

/** 批量上传文件 */
export async function batchUpload(files) {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  const response = await fetch(`${API_BASE}/batch`, { method: 'POST', body: formData });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || '批量上传失败');
  }
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '批量上传异常');
  return result.data;
}

// #endregion

// #region 诊断 API

export async function getDiagnostics() {
  const response = await fetch(`${API_BASE}/diagnostics`, { method: 'GET' });
  if (!response.ok) throw new Error('获取诊断信息失败');
  const result = await response.json();
  if (!result.success) throw new Error(result.message || '获取诊断信息异常');
  return result.data;
}

// #endregion
