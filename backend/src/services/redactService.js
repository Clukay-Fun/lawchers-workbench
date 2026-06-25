/**
 * 描述: 高保真脱敏服务，集成 legal-desensitizer Python CLI
 * 主要功能:
 *     - 调用 legal-desens redact 对上传文件执行 NER + 正则混合脱敏
 *     - 读回脱敏文本、实体映射表和审计日志，返回结构化数据契约
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { parseDocument } from './parserService.js';
import { resolveLegalDesensBin, getRulesPath } from './cliResolver.js';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// #region 配置加载与降级

let isNerEnabled = false;

/**
 * 获取当前脱敏服务是否启用了 NER 模型
 * @returns {boolean}
 */
export function getIsNerEnabled() {
  return isNerEnabled;
}

const REDACT_TIMEOUT_MS = parseInt(process.env.REDACT_TIMEOUT_MS || '60000', 10);

if (!process.env.REDACT_TIMEOUT_MS) {
  console.warn(`[WARN] 环境变量 REDACT_TIMEOUT_MS 未配置，使用默认值: ${REDACT_TIMEOUT_MS}ms`);
}

/**
 * 验证脱敏环境配置是否正确
 *
 * 功能:
 *     - 执行 legal-desens --help 检查基础命令可用性
 *     - 执行 legal-desens ner-inspect 检查 NER 模型就绪情况
 *     - 若未安装模型则打印警告，自动降级为 --regex-only 运行而不使服务崩溃
 */
export async function verifyDesensitizerEnvironment() {
  let bin;
  try {
    bin = resolveLegalDesensBin();
    console.log(`[INFO] 开始自检脱敏环境...`);
    console.log(`[INFO] legal-desens binary: ${bin}`);
  } catch (err) {
    console.error('\n' + '='.repeat(80));
    console.error('[FATAL ERROR] 法律脱敏服务环境自检失败！无法定位 legal-desens 二进制。');
    console.error(`- 错误描述: ${err.message}`);
    console.error('请运行 npm run setup 安装引擎，或在 .env.local 中设置 LEGAL_DESENS_BIN。');
    console.error('='.repeat(80) + '\n');
    return false;
  }

  // 1. 基础 CLI 运行检测
  try {
    await execFileAsync(bin, ['--help'], { timeout: 10000 });
    console.log('[OK] 脱敏环境基础自检成功，legal-desens CLI 可用。');
  } catch (error) {
    console.error('\n' + '='.repeat(80));
    console.error('[FATAL ERROR] 法律脱敏服务环境自检失败！无法调用 legal-desens CLI。');
    console.error(`- 执行指令: ${bin}`);
    console.error(`- 错误描述: ${error.message}`);
    if (error.stderr) console.error(`- 详细输出: ${error.stderr}`);
    console.error('请检查 backend/.env 中的配置，并确保 legal-desens 已安装。');
    console.error('='.repeat(80) + '\n');
    return false;
  }

  // 2. NER 模型状态检测
  try {
    await execFileAsync(bin, ['ner-inspect'], { timeout: 10000 });
    isNerEnabled = true;
    console.log('[OK] NER 模型检测通过，脱敏服务将以 regex+ner 混合模式运行。');
  } catch (error) {
    isNerEnabled = false;
    console.warn('\n' + '!'.repeat(80));
    console.warn('[WARN] NER 模型自检失败，脱敏服务已降级为 --regex-only 模式运行！');
    console.warn(`- 错误描述: ${error.message}`);
    if (error.stderr) console.warn(`- 详细输出: ${error.stderr}`);
    console.warn('如果您需要使用 NER（姓名、机构等识别）功能，请运行:');
    console.warn('  npm run setup');
    console.warn('!'.repeat(80) + '\n');
  }

  return true;
}

// #endregion

// #region 核心脱敏调用

/**
 * 对指定文件执行高保真脱敏处理
 * @param {string} inputFilePath 已上传文件的绝对路径
 * @param {string} [level='strict'] 脱敏级别（strict / labor）
 * @param {Object} [rulesConfig={}] 实体类型脱敏开关
 * @returns {Promise<Object>} 结构化脱敏结果
 */
export async function redactDocument(inputFilePath, level = 'strict', rulesConfig = {}) {
  const bin = resolveLegalDesensBin();
  const uploadsDir = path.join(__dirname, '../../uploads');
  const baseName = path.basename(inputFilePath, path.extname(inputFilePath));
  const uniqueId = `${baseName}_${Date.now()}`;

  const tmpTxt = path.join(uploadsDir, `${uniqueId}.src.txt`);
  const outRedacted = path.join(uploadsDir, `${uniqueId}.redacted.txt`);
  const outMap = path.join(uploadsDir, `${uniqueId}.map.json`);
  const outAudit = path.join(uploadsDir, `${uniqueId}.audit.json`);

  // 绑定 DATE 与 TIME 控制状态
  if (rulesConfig && rulesConfig.DATE !== undefined) {
    rulesConfig.TIME = rulesConfig.DATE;
  }

  // 1) 动态生成临时策略文件
  let policyPath = null;
  if (rulesConfig && Object.keys(rulesConfig).length > 0) {
    const preserve_types = [];
    const force_redact_types = [];
    for (const [entityType, enabled] of Object.entries(rulesConfig)) {
      if (enabled === false) preserve_types.push(entityType);
      else if (enabled === true) force_redact_types.push(entityType);
    }
    if (preserve_types.length > 0 || force_redact_types.length > 0) {
      policyPath = path.join(uploadsDir, `policy_${uniqueId}.json`);
      await fs.writeFile(policyPath, JSON.stringify({ preserve_types, force_redact_types }, null, 2), 'utf-8');
    }
  }

  // 1.5) 动态生成临时 rules.json
  let tempRulesPath = null;
  try {
    const defaultRulesPath = getRulesPath();
    const defaultRulesRaw = await fs.readFile(defaultRulesPath, 'utf-8');
    const rulesList = JSON.parse(defaultRulesRaw);
    let rulesChanged = false;
    for (const rule of rulesList) {
      if (rulesConfig && rulesConfig[rule.entity_type] !== undefined) {
        rule.enabled = !!rulesConfig[rule.entity_type];
        rulesChanged = true;
      }
    }
    if (rulesChanged) {
      tempRulesPath = path.join(uploadsDir, `rules_${uniqueId}.json`);
      await fs.writeFile(tempRulesPath, JSON.stringify(rulesList, null, 2), 'utf-8');
    }
  } catch (err) {
    console.error(`[WARN] 动态生成临时 rules.json 失败:`, err.message);
  }

  try {
    // 2) 解析文件提取纯文本
    const text = await parseDocument(inputFilePath, path.basename(inputFilePath));
    if (!text || !text.trim()) {
      throw new Error('文档解析为空，可能是扫描件 PDF（无文字层）或空文件');
    }

    // 3) 写临时 .src.txt
    await fs.writeFile(tmpTxt, text, 'utf-8');

    // 4) 构造脱敏参数并执行
    const args = [];
    if (tempRulesPath) args.push('--rules', tempRulesPath);
    args.push('redact', tmpTxt, '--level', level, '--out', outRedacted, '--map', outMap, '--audit', outAudit);
    if (policyPath) args.push('--entity-policy', policyPath);
    if (!isNerEnabled) args.push('--regex-only');

    await execFileAsync(bin, args, { timeout: REDACT_TIMEOUT_MS });

    // 5) 读回脱敏后的文本及相关契约数据
    const [redactedText, mapRaw, auditRaw] = await Promise.all([
      fs.readFile(outRedacted, 'utf-8'),
      fs.readFile(outMap, 'utf-8'),
      fs.readFile(outAudit, 'utf-8'),
    ]);

    const mapData = JSON.parse(mapRaw);
    const auditData = JSON.parse(auditRaw);

    const result = {
      redactedText,
      entities: (mapData.entities || []).map((ent) => {
        if (ent.entity_type === 'TIME') {
          return { ...ent, entity_type: 'DATE', replacement: ent.replacement === '【时间】' ? '【日期】' : ent.replacement };
        }
        return ent;
      }),
      occurrences: mapData.occurrences || [],
      audit: {
        totalEntities: auditData.summary?.total_entities || 0,
        totalOccurrences: auditData.summary?.total_occurrences || 0,
        residualScanPassed: auditData.residual_scan?.passed ?? false,
        mode: mapData.mode || 'unknown',
        nerEnabled: isNerEnabled,
        byEntityType: auditData.summary?.by_entity_type || {},
        byEngine: auditData.summary?.by_engine || {},
        warnings: auditData.warnings || [],
      },
      sourceFile: mapData.source_file || path.basename(inputFilePath),
    };

    // 6) 清理中间临时文件
    await fs.unlink(tmpTxt).catch(() => {});
    if (policyPath) await fs.unlink(policyPath).catch(() => {});
    if (tempRulesPath) await fs.unlink(tempRulesPath).catch(() => {});

    return result;
  } catch (error) {
    await Promise.all([
      fs.unlink(tmpTxt).catch(() => {}),
      fs.unlink(outRedacted).catch(() => {}),
      fs.unlink(outMap).catch(() => {}),
      fs.unlink(outAudit).catch(() => {}),
      policyPath ? fs.unlink(policyPath).catch(() => {}) : Promise.resolve(),
      tempRulesPath ? fs.unlink(tempRulesPath).catch(() => {}) : Promise.resolve(),
    ]);
    if (error.code === 'ETIMEDOUT') throw new Error('脱敏处理超时，请检查文件大小或服务状态');
    throw new Error(`脱敏处理失败: ${error.stderr || error.message}`);
  }
}

/**
 * 直接对原格式文件执行脱敏（保留原件，生成脱敏副本）
 */
export async function redactNativeDocument(inputFilePath, level = 'strict', rulesConfig = {}, manualRedactions = []) {
  const bin = resolveLegalDesensBin();
  const ext = path.extname(inputFilePath).toLowerCase();
  if (!['.txt', '.md', '.docx', '.pdf'].includes(ext)) {
    throw new Error(`原格式脱敏暂不支持 ${ext || '未知格式'}`);
  }

  const dir = path.dirname(inputFilePath);
  const baseName = path.basename(inputFilePath, ext);
  const runId = Date.now();
  const outRedacted = path.join(dir, `${baseName}.${runId}.redacted${ext}`);
  const outMap = path.join(dir, `${baseName}.${runId}.map.json`);
  const outAudit = path.join(dir, `${baseName}.${runId}.audit.json`);
  const outPostAudit = path.join(dir, `${baseName}.${runId}.post-audit.json`);
  const tempRulesPath = path.join(dir, `${baseName}.${runId}.rules.json`);

  const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const normalizedManual = [...new Set(
    (manualRedactions || [])
      .map((item) => typeof item === 'string' ? item : item?.text)
      .map((item) => String(item || '').trim())
      .filter((item) => item.length > 0)
  )];

  try {
    const defaultRulesPath = getRulesPath();
    const rules = JSON.parse(await fs.readFile(defaultRulesPath, 'utf-8'));
    for (const rule of rules) {
      if (rulesConfig?.[rule.entity_type] !== undefined) {
        rule.enabled = Boolean(rulesConfig[rule.entity_type]);
      }
    }
    normalizedManual.forEach((text, index) => {
      rules.push({
        id: `manual_${index + 1}`,
        name: `人工标注 ${index + 1}`,
        entity_type: 'MANUAL',
        label_prefix: '敏感信息',
        pattern: escapeRegex(text),
        enabled: true,
        priority: 1000,
      });
    });
    await fs.writeFile(tempRulesPath, JSON.stringify(rules, null, 2), 'utf-8');

    const args = [
      '--rules', tempRulesPath,
      'redact', inputFilePath,
      '--level', level,
      '--out', outRedacted,
      '--map', outMap,
      '--audit', outAudit,
    ];
    if (!isNerEnabled) args.push('--regex-only');

    await execFileAsync(bin, args, { timeout: Math.max(REDACT_TIMEOUT_MS, 120000) });

    const [mapRaw, auditRaw] = await Promise.all([
      fs.readFile(outMap, 'utf-8'),
      fs.readFile(outAudit, 'utf-8'),
    ]);
    const mapData = JSON.parse(mapRaw);
    const auditData = JSON.parse(auditRaw);

    // 可逆文本/DOCX 额外跑一次独立残留审计
    let postAuditData = auditData;
    if (ext !== '.pdf') {
      const auditArgs = [
        '--rules', tempRulesPath,
        'audit', outRedacted,
        '--map', outMap,
        '--regex-only',
        '--out', outPostAudit,
      ];
      await execFileAsync(bin, auditArgs, { timeout: Math.max(REDACT_TIMEOUT_MS, 120000) });
      postAuditData = JSON.parse(await fs.readFile(outPostAudit, 'utf-8'));
    }

    const residualPassed =
      postAuditData?.residual_scan?.passed ??
      postAuditData?.verification?.passed ??
      auditData?.residual_scan?.passed ?? false;

    if (!residualPassed) {
      throw new Error('导出后敏感信息复检未通过，已阻止发布脱敏副本');
    }

    let redactedText = '';
    try {
      redactedText = await parseDocument(outRedacted, path.basename(outRedacted));
    } catch {}

    return {
      redactedText,
      entities: mapData.entities || [],
      occurrences: mapData.occurrences || [],
      mapData,
      auditData: postAuditData,
      audit: {
        totalEntities: postAuditData.summary?.total_entities ?? mapData.entities?.length ?? 0,
        totalOccurrences: postAuditData.summary?.total_occurrences ?? mapData.occurrences?.length ?? 0,
        residualScanPassed: residualPassed,
        mode: mapData.mode || (isNerEnabled ? 'regex+ner' : 'regex-only'),
        nerEnabled: isNerEnabled,
        warnings: postAuditData.warnings || [],
      },
      redactedPath: outRedacted,
      mapPath: outMap,
      auditPath: ext === '.pdf' ? outAudit : outPostAudit,
      sourceFile: mapData.source_file || path.basename(inputFilePath),
      documentType: ext.slice(1),
    };
  } catch (error) {
    await Promise.all([
      fs.unlink(outRedacted).catch(() => {}),
      fs.unlink(outMap).catch(() => {}),
      fs.unlink(outAudit).catch(() => {}),
      fs.unlink(outPostAudit).catch(() => {}),
    ]);
    throw new Error(`原格式脱敏失败: ${error.stderr || error.message}`);
  } finally {
    await fs.unlink(tempRulesPath).catch(() => {});
  }
}

/**
 * 对图片或扫描版 PDF 执行不可逆像素脱敏（白框覆盖）
 */
export async function redactScanDocument(inputFilePath, level = 'strict', rulesConfig = {}) {
  const bin = resolveLegalDesensBin();
  const uploadsDir = path.join(__dirname, '../../uploads');
  const ext = path.extname(inputFilePath);
  const baseName = path.basename(inputFilePath, ext);
  const uniqueId = `${baseName}_${Date.now()}`;

  const outRedactedScan = path.join(uploadsDir, `${uniqueId}.redacted${ext}`);
  const outMd = path.join(uploadsDir, `${uniqueId}.intermediate.md`);
  const outMap = path.join(uploadsDir, `${uniqueId}.map.json`);
  const outAudit = path.join(uploadsDir, `${uniqueId}.audit.json`);
  const intermediateFiles = [outMd, outMap, outAudit];

  if (rulesConfig && rulesConfig.DATE !== undefined) {
    rulesConfig.TIME = rulesConfig.DATE;
  }

  let policyPath = null;
  if (rulesConfig && Object.keys(rulesConfig).length > 0) {
    const preserve_types = [];
    const force_redact_types = [];
    for (const [entityType, enabled] of Object.entries(rulesConfig)) {
      if (enabled === false) preserve_types.push(entityType);
      else if (enabled === true) force_redact_types.push(entityType);
    }
    if (preserve_types.length > 0 || force_redact_types.length > 0) {
      policyPath = path.join(uploadsDir, `policy_${uniqueId}.json`);
      await fs.writeFile(policyPath, JSON.stringify({ preserve_types, force_redact_types }, null, 2), 'utf-8');
    }
  }

  let tempRulesPath = null;
  try {
    const defaultRulesPath = getRulesPath();
    const defaultRulesRaw = await fs.readFile(defaultRulesPath, 'utf-8');
    const rulesList = JSON.parse(defaultRulesRaw);
    let rulesChanged = false;
    for (const rule of rulesList) {
      if (rulesConfig && rulesConfig[rule.entity_type] !== undefined) {
        rule.enabled = !!rulesConfig[rule.entity_type];
        rulesChanged = true;
      }
    }
    if (rulesChanged) {
      tempRulesPath = path.join(uploadsDir, `rules_${uniqueId}.json`);
      await fs.writeFile(tempRulesPath, JSON.stringify(rulesList, null, 2), 'utf-8');
    }
  } catch (err) {
    console.error(`[WARN] 动态生成临时 rules.json 失败:`, err.message);
  }

  const args = [];
  if (tempRulesPath) args.push('--rules', tempRulesPath);
  args.push('redact-scan', inputFilePath, '--ocr', 'rapidocr', '--level', level,
    '--out', outRedactedScan, '--md-out', outMd, '--map', outMap, '--audit', outAudit);
  if (policyPath) args.push('--entity-policy', policyPath);
  if (!isNerEnabled) args.push('--regex-only');

  try {
    await execFileAsync(bin, args, { timeout: REDACT_TIMEOUT_MS });

    const [redactedText, mapRaw, auditRaw] = await Promise.all([
      fs.readFile(outMd, 'utf-8'),
      fs.readFile(outMap, 'utf-8'),
      fs.readFile(outAudit, 'utf-8'),
    ]);

    const mapData = JSON.parse(mapRaw);
    const auditData = JSON.parse(auditRaw);

    const result = {
      redactedText,
      entities: (mapData.entities || []).map((ent) => {
        if (ent.entity_type === 'TIME') {
          return { ...ent, entity_type: 'DATE', replacement: ent.replacement === '【时间】' ? '【日期】' : ent.replacement };
        }
        return ent;
      }),
      occurrences: mapData.occurrences || [],
      audit: {
        totalEntities: auditData.summary?.total_entities || 0,
        totalOccurrences: auditData.summary?.total_occurrences || 0,
        residualScanPassed: auditData.residual_scan?.passed ?? false,
        mode: mapData.mode || 'scan',
        nerEnabled: isNerEnabled,
        byEntityType: auditData.summary?.by_entity_type || {},
        byEngine: auditData.summary?.by_engine || {},
        warnings: auditData.warnings || [],
      },
      redactedImageUrl: `/uploads/${path.basename(outRedactedScan)}`,
      sourceFile: mapData.source_file || path.basename(inputFilePath),
    };

    await Promise.all(intermediateFiles.map((f) => fs.unlink(f).catch(() => {})));
    if (policyPath) await fs.unlink(policyPath).catch(() => {});
    if (tempRulesPath) await fs.unlink(tempRulesPath).catch(() => {});

    return result;
  } catch (error) {
    const failCleanupFiles = [...intermediateFiles, outRedactedScan];
    if (policyPath) failCleanupFiles.push(policyPath);
    if (tempRulesPath) failCleanupFiles.push(tempRulesPath);
    await Promise.all(failCleanupFiles.map((f) => fs.unlink(f).catch(() => {})));
    if (error.code === 'ETIMEDOUT') throw new Error('扫描件脱敏处理超时，请检查文件大小或服务状态');
    throw new Error(`扫描件脱敏处理失败: ${error.stderr || error.message}`);
  }
}

// #endregion
