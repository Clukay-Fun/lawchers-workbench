/**
 * 设置仓储层（key-value 持久化）
 *
 * 读取优先级：库值 → env → 硬编码默认
 */

import db from './index.js';

// ─── 默认值 ──────────────────────────────────────────────────

const DEFAULTS = {
  recognitionQuality: 'standard',  // fast | standard | fine
  uploadMaxMB: 100,
  maskChar: '*',
  preserveFormat: true,
  verifyBeforeExport: true,
};

const QUALITY_DPI = { fast: 150, standard: 200, fine: 300 };

// ─── 读取（库 → env → 默认）──────────────────────────────────

/**
 * Get a setting value with fallback chain: DB → env → default.
 * @param {string} key
 * @param {*} fallback - used only if not in DB and not in env
 * @returns {*}
 */
export function getSetting(key, fallback) {
  // 1. DB
  try {
    const row = db.prepare('SELECT value FROM "setting" WHERE key = ?').get(key);
    if (row) {
      const v = row.value;
      // Auto-coerce booleans and numbers for known keys
      if (v === 'true') return true;
      if (v === 'false') return false;
      const num = Number(v);
      if (!isNaN(num) && v.trim() !== '') return num;
      return v;
    }
  } catch {}

  // 2. Env (for recognized env-mapped keys)
  const envMap = {
    uploadMaxMB: 'UPLOAD_MAX_MB',
    recognitionQuality: 'RECOGNITION_QUALITY',
  };
  const envKey = envMap[key];
  if (envKey && process.env[envKey] !== undefined) {
    const v = process.env[envKey];
    const num = Number(v);
    if (!isNaN(num) && v.trim() !== '') return num;
    return v;
  }

  // 3. Default
  return fallback !== undefined ? fallback : DEFAULTS[key];
}

/**
 * Get DPI for current recognition quality setting.
 */
export function getDPI() {
  const quality = getSetting('recognitionQuality', 'standard');
  return QUALITY_DPI[quality] || 200;
}

/**
 * Get all settings as an object (for GET /api/settings).
 */
export function getAllSettings() {
  return {
    recognitionQuality: getSetting('recognitionQuality', 'standard'),
    uploadMaxMB: getSetting('uploadMaxMB', 100),
    maskChar: getSetting('maskChar', '*'),
    preserveFormat: getSetting('preserveFormat', true),
    verifyBeforeExport: getSetting('verifyBeforeExport', true),
  };
}

// ─── 写入 ────────────────────────────────────────────────────

export function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO "setting" (key, value) VALUES (?, ?)').run(key, String(value));
}

// ─── 验证 ────────────────────────────────────────────────────

const VALID_QUALITY = new Set(['fast', 'standard', 'fine']);
const VALID_MASK = new Set(['*', '●', '_']);

export function validateSetting(key, value) {
  if (key === 'recognitionQuality') {
    return VALID_QUALITY.has(value) ? null : '识别质量必须是 快速/标准/精细 之一';
  }
  if (key === 'uploadMaxMB') {
    const n = Number(value);
    if (isNaN(n) || n <= 0 || n > 500) return '文件大小上限必须在 1-500 MB 之间';
    return null;
  }
  if (key === 'maskChar') {
    return VALID_MASK.has(value) ? null : '脱敏符号无效';
  }
  if (key === 'preserveFormat' || key === 'verifyBeforeExport') {
    return (value === true || value === false || value === 'true' || value === 'false')
      ? null
      : '必须是开关值';
  }
  return '未知设置项';
}
