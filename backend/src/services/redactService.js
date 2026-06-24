/**
 * 描述: 高保真脱敏服务，集成 legal-desensitizer Python CLI
 * 主要功能:
 *     - 调用 legal_desens.cli redact 对上传文件执行 NER + 正则混合脱敏
 *     - 读回脱敏文本、实体映射表和审计日志，返回结构化数据契约
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { parseDocument } from './parserService.js';

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

// 从环境变量读取配置，提供默认 fallback
const DESENSITIZER_DIR = process.env.DESENSITIZER_DIR || '/Users/clukay/Program/lawchers-skills/legal-desensitizer';
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const REDACT_TIMEOUT_MS = parseInt(process.env.REDACT_TIMEOUT_MS || '60000', 10);

if (!process.env.DESENSITIZER_DIR) {
  console.warn(`[WARN] 环境变量 DESENSITIZER_DIR 未配置，使用默认路径: ${DESENSITIZER_DIR}`);
}
if (!process.env.PYTHON_BIN) {
  console.warn(`[WARN] 环境变量 PYTHON_BIN 未配置，使用默认指令: ${PYTHON_BIN}`);
}
if (!process.env.REDACT_TIMEOUT_MS) {
  console.warn(`[WARN] 环境变量 REDACT_TIMEOUT_MS 未配置，使用默认值: ${REDACT_TIMEOUT_MS}ms`);
}

/**
 * 验证脱敏环境配置是否正确
 * 
 * 功能:
 *     - 执行 python3 -m legal_desens.cli --help 检查基础命令可用性
 *     - 执行 python3 -m legal_desens.cli ner-inspect 检查 NER 模型就绪情况
 *     - 若未安装模型则打印警告，自动降级为 --regex-only 运行而不使服务崩溃
 */
export async function verifyDesensitizerEnvironment() {
  console.log(`[INFO] 开始自检脱敏环境...`);
  console.log(`[INFO] 目标路径 (DESENSITIZER_DIR): ${DESENSITIZER_DIR}`);
  console.log(`[INFO] 解释器 (PYTHON_BIN): ${PYTHON_BIN}`);
  
  // 1. 基础 CLI 运行检测
  try {
    await execFileAsync(PYTHON_BIN, ['-m', 'legal_desens.cli', '--help'], {
      cwd: DESENSITIZER_DIR,
      timeout: 10000,
    });
    console.log('[OK] 脱敏环境基础自检成功，Python CLI 可用。');
  } catch (error) {
    console.error('\n' + '='.repeat(80));
    console.error('[FATAL ERROR] 法律脱敏服务环境自检失败！无法调用 Python CLI。');
    console.error(`- 关联路径: ${DESENSITIZER_DIR}`);
    console.error(`- 执行指令: ${PYTHON_BIN}`);
    console.error(`- 错误描述: ${error.message}`);
    if (error.stderr) {
      console.error(`- 详细输出: ${error.stderr}`);
    }
    console.error('请检查 backend/.env 中的配置，并确保 legal-desensitizer 项目在此路径且 Python 依赖已安装。');
    console.error('='.repeat(80) + '\n');
    return false;
  }

  // 2. NER 模型状态检测
  try {
    await execFileAsync(PYTHON_BIN, ['-m', 'legal_desens.cli', 'ner-inspect'], {
      cwd: DESENSITIZER_DIR,
      timeout: 10000,
    });
    isNerEnabled = true;
    console.log('[OK] NER 模型检测通过，脱敏服务将以 regex+ner 混合模式运行。');
  } catch (error) {
    isNerEnabled = false;
    console.warn('\n' + '!'.repeat(80));
    console.warn('[WARN] NER 模型自检失败，脱敏服务已降级为 --regex-only 模式运行！');
    console.warn(`- 错误描述: ${error.message}`);
    if (error.stderr) {
      console.warn(`- 详细输出: ${error.stderr}`);
    }
    console.warn('如果您需要使用 NER（姓名、机构等识别）功能，请前往 legal-desensitizer 目录执行：');
    console.warn(`  bash scripts/install_with_model.sh`);
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
 * @returns {Promise<Object>} 结构化脱敏结果
 *
 * 功能:
 *     - 调用 python3 -m legal_desens.cli redact 执行脱敏
 *     - 输出文件存放到与输入文件同目录
 *     - 读回三件套（redacted / map / audit）并组装前端数据契约
 */
export async function redactDocument(inputFilePath, level = 'strict', rulesConfig = {}) {
  /**
   * 用处: 对指定文本格式文件执行高保真脱敏处理，保留原件与 map/audit 文件
   * 参数: 
   *   - inputFilePath: string (上传文件的绝对路径)
   *   - level: string (脱敏级别, 默认 'strict')
   *   - rulesConfig: Object (实体类型脱敏开关, 键为类型, 值为布尔值)
   * 功能:
   *   - 解析文件提取纯文本，写入临时 txt
   *   - 依据 rulesConfig 生成临时实体策略 policy.json，挂载为 --entity-policy
   *   - 依据 rulesConfig 动态装载临时 rules.json，覆盖规则检测启用状态，挂载为 --rules
   *   - 调用 Python CLI 进行脱敏，保留原件与可逆还原所需的 map/audit 结果
   *   - 仅物理清理中间临时 txt 文本与临时策略 json、临时规则 json
   */
  const uploadsDir = path.join(__dirname, '../../uploads');
  const baseName = path.basename(inputFilePath, path.extname(inputFilePath));
  const uniqueId = `${baseName}_${Date.now()}`;

  // 统一规整：把任何格式解析成纯文本，写成临时 txt 再脱敏
  const tmpTxt = path.join(uploadsDir, `${uniqueId}.src.txt`);
  const outRedacted = path.join(uploadsDir, `${uniqueId}.redacted.txt`); // 结果文件为 .txt 后缀
  const outMap = path.join(uploadsDir, `${uniqueId}.map.json`);
  const outAudit = path.join(uploadsDir, `${uniqueId}.audit.json`);

  // 绑定 DATE 与 TIME 控制状态，避免日期被 NER 认作 TIME 而导致漏脱敏/漏保留
  if (rulesConfig && rulesConfig.DATE !== undefined) {
    rulesConfig.TIME = rulesConfig.DATE;
  }

  // 1) 动态生成临时策略文件（基于 rulesConfig 映射，优先使用 cli.py 挂载）
  let policyPath = null;
  if (rulesConfig && Object.keys(rulesConfig).length > 0) {
    const preserve_types = [];
    const force_redact_types = [];
    for (const [entityType, enabled] of Object.entries(rulesConfig)) {
      if (enabled === false) {
        preserve_types.push(entityType);
      } else if (enabled === true) {
        force_redact_types.push(entityType);
      }
    }
    if (preserve_types.length > 0 || force_redact_types.length > 0) {
      policyPath = path.join(uploadsDir, `policy_${uniqueId}.json`);
      const policyData = {
        preserve_types,
        force_redact_types,
      };
      await fs.writeFile(policyPath, JSON.stringify(policyData, null, 2), 'utf-8');
    }
  }

  // 1.5) 动态生成临时 rules.json 文件以允许在不修改全局 rules.json 的前提下启用默认关闭的规则
  let tempRulesPath = null;
  const defaultRulesPath = path.join(DESENSITIZER_DIR, 'legal_desens/rules/rules.json');
  try {
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

    // 3) 写临时 .src.txt（统一采用 utf-8 编码）
    await fs.writeFile(tmpTxt, text, 'utf-8');

    // 4) 构造脱敏参数并执行 Python CLI
    const args = [
      '-m', 'legal_desens.cli',
    ];
    if (tempRulesPath) {
      args.push('--rules', tempRulesPath);
    }
    args.push(
      'redact',
      tmpTxt,
      '--level', level,
      '--out', outRedacted,
      '--map', outMap,
      '--audit', outAudit,
    );

    if (policyPath) {
      args.push('--entity-policy', policyPath);
    }

    // 若 NER 未启用，强制降级使用 --regex-only
    if (!isNerEnabled) {
      args.push('--regex-only');
    }

    console.log(`[TEST LOG] 实际 CLI 执行参数: ${PYTHON_BIN} ${args.join(' ')}`);
    if (policyPath) {
      const pRaw = await fs.readFile(policyPath, 'utf-8');
      console.log(`[TEST LOG] 生成的 policy.json 内容:\n${pRaw}`);
    }
    if (tempRulesPath) {
      const rRaw = await fs.readFile(tempRulesPath, 'utf-8');
      const rList = JSON.parse(rRaw);
      const dateRule = rList.find(r => r.id === 'date_cn');
      const bankRule = rList.find(r => r.id === 'bank_account_cn');
      console.log(`[TEST LOG] 生成的 rules.json 中 date_cn 与 bank_account_cn 规则状态:\n`, JSON.stringify({ date_cn: dateRule, bank_account_cn: bankRule }, null, 2));
    }

    await execFileAsync(PYTHON_BIN, args, {
      cwd: DESENSITIZER_DIR,
      timeout: REDACT_TIMEOUT_MS,
    });

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
          return {
            ...ent,
            entity_type: 'DATE',
            replacement: ent.replacement === '【时间】' ? '【日期】' : ent.replacement,
          };
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

    // 6) 清理中间临时敏感文件与策略配置（保留原件、redacted.txt、map.json、audit.json）
    await fs.unlink(tmpTxt).catch((e) => console.error(`[WARN] 物理清理临时文件 ${tmpTxt} 失败:`, e.message));
    if (policyPath) {
      await fs.unlink(policyPath).catch((e) => console.error(`[WARN] 物理清理临时策略文件 ${policyPath} 失败:`, e.message));
    }
    if (tempRulesPath) {
      await fs.unlink(tempRulesPath).catch((e) => console.error(`[WARN] 物理清理临时规则文件 ${tempRulesPath} 失败:`, e.message));
    }

    return result;
  } catch (error) {
    // 异常时物理清理所有可能已创建的临时/破损文件，但绝不动原件
    await Promise.all([
      fs.unlink(tmpTxt).catch(() => {}),
      fs.unlink(outRedacted).catch(() => {}),
      fs.unlink(outMap).catch(() => {}),
      fs.unlink(outAudit).catch(() => {}),
      policyPath ? fs.unlink(policyPath).catch(() => {}) : Promise.resolve(),
      tempRulesPath ? fs.unlink(tempRulesPath).catch(() => {}) : Promise.resolve(),
    ]);

    if (error.code === 'ETIMEDOUT') {
      throw new Error('脱敏处理超时，请检查文件大小或服务状态');
    }

    throw new Error(
      `脱敏处理失败: ${error.stderr || error.message}`
    );
  }
}

/**
 * 直接对原格式文件执行脱敏。
 *
 * 与旧的 redactDocument 不同，本函数不会先把 DOCX/PDF 拍平成 TXT：
 * legal-desens 会在原格式副本中修改 OOXML 文本节点或永久移除 PDF 文本，
 * 同时输出 map/audit。原件始终只读。
 */
export async function redactNativeDocument(
  inputFilePath,
  level = 'strict',
  rulesConfig = {},
  manualRedactions = [],
) {
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
  const defaultRulesPath = path.join(DESENSITIZER_DIR, 'legal_desens/rules/rules.json');

  const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const normalizedManual = [...new Set(
    (manualRedactions || [])
      .map((item) => typeof item === 'string' ? item : item?.text)
      .map((item) => String(item || '').trim())
      .filter((item) => item.length > 0)
  )];

  try {
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
      '-m', 'legal_desens.cli',
      '--rules', tempRulesPath,
      'redact', inputFilePath,
      '--level', level,
      '--out', outRedacted,
      '--map', outMap,
      '--audit', outAudit,
    ];
    if (!isNerEnabled) args.push('--regex-only');

    await execFileAsync(PYTHON_BIN, args, {
      cwd: DESENSITIZER_DIR,
      timeout: Math.max(REDACT_TIMEOUT_MS, 120000),
    });

    const [mapRaw, auditRaw] = await Promise.all([
      fs.readFile(outMap, 'utf-8'),
      fs.readFile(outAudit, 'utf-8'),
    ]);
    const mapData = JSON.parse(mapRaw);
    const auditData = JSON.parse(auditRaw);

    // 可逆文本/DOCX 额外跑一次独立残留审计。PDF 的 adapter 已在 redact
    // 阶段永久移除文本并执行容器残留检查，CLI 不提供二次 audit 命令。
    let postAuditData = auditData;
    if (ext !== '.pdf') {
      const auditArgs = [
        '-m', 'legal_desens.cli',
        '--rules', tempRulesPath,
        'audit', outRedacted,
        '--map', outMap,
        '--regex-only',
        '--out', outPostAudit,
      ];
      await execFileAsync(PYTHON_BIN, auditArgs, {
        cwd: DESENSITIZER_DIR,
        timeout: Math.max(REDACT_TIMEOUT_MS, 120000),
      });
      postAuditData = JSON.parse(await fs.readFile(outPostAudit, 'utf-8'));
    }

    const residualPassed =
      postAuditData?.residual_scan?.passed ??
      postAuditData?.verification?.passed ??
      auditData?.residual_scan?.passed ??
      false;

    if (!residualPassed) {
      throw new Error('导出后敏感信息复检未通过，已阻止发布脱敏副本');
    }

    let redactedText = '';
    try {
      redactedText = await parseDocument(outRedacted, path.basename(outRedacted));
    } catch {
      // 预览文本不是发布条件；扫描或复杂 PDF 可能无法再次提取文本。
    }

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
 * @param {string} inputFilePath 待脱敏文件的绝对路径
 * @param {string} [level='strict'] 脱敏级别
 * @returns {Promise<Object>} 图像脱敏结果数据契约
 *
 * 功能:
 *     - 调用 python3 -m legal_desens.cli redact-scan 执行 OCR + 白框像素脱敏
 *     - 读回 OCR 识别出的中间文本 (outMd)、实体映射表 (outMap) 和审计 (outAudit)
 *     - 立即清理敏感文件，保留脱敏后的安全白框文件，并返回其托管 URL
 */
export async function redactScanDocument(inputFilePath, level = 'strict', rulesConfig = {}) {
  /**
   * 用处: 对图片或扫描版 PDF 执行不可逆像素脱敏（白框覆盖），保留原件与白框件
   * 参数:
   *   - inputFilePath: string (待脱敏扫描件的绝对路径)
   *   - level: string (脱敏级别, 默认 'strict')
   *   - rulesConfig: Object (实体类型脱敏开关, 键为类型, 值为布尔值)
   * 功能:
   *   - 依据 rulesConfig 生成临时实体策略 policy.json，挂载为 --entity-policy
   *   - 依据 rulesConfig 动态装载临时 rules.json，覆盖规则检测启用状态，挂载为 --rules
   *   - 调用 Python CLI 执行 OCR 并生成白框覆盖的脱敏件
   *   - 仅物理清理 OCR 中间工作产物（文本 md、map/audit 结果），绝对不动原件
   */
  const uploadsDir = path.join(__dirname, '../../uploads');
  const ext = path.extname(inputFilePath);
  const baseName = path.basename(inputFilePath, ext);
  const uniqueId = `${baseName}_${Date.now()}`;

  // 输出路径规划
  const outRedactedScan = path.join(uploadsDir, `${uniqueId}.redacted${ext}`); // 保留的安全白框文件
  const outMd = path.join(uploadsDir, `${uniqueId}.intermediate.md`);         // 中间文本
  const outMap = path.join(uploadsDir, `${uniqueId}.map.json`);
  const outAudit = path.join(uploadsDir, `${uniqueId}.audit.json`);

  // 待清理的中间敏感临时文件列表（排除 outRedactedScan 与 inputFilePath）
  const intermediateFiles = [outMd, outMap, outAudit];

  // 绑定 DATE 与 TIME 控制状态，避免日期被 NER 认作 TIME 而导致漏脱敏/漏保留
  if (rulesConfig && rulesConfig.DATE !== undefined) {
    rulesConfig.TIME = rulesConfig.DATE;
  }

  // 1) 动态生成临时策略文件（基于 rulesConfig 映射，优先使用 cli.py 挂载）
  let policyPath = null;
  if (rulesConfig && Object.keys(rulesConfig).length > 0) {
    const preserve_types = [];
    const force_redact_types = [];
    for (const [entityType, enabled] of Object.entries(rulesConfig)) {
      if (enabled === false) {
        preserve_types.push(entityType);
      } else if (enabled === true) {
        force_redact_types.push(entityType);
      }
    }
    if (preserve_types.length > 0 || force_redact_types.length > 0) {
      policyPath = path.join(uploadsDir, `policy_${uniqueId}.json`);
      const policyData = {
        preserve_types,
        force_redact_types,
      };
      await fs.writeFile(policyPath, JSON.stringify(policyData, null, 2), 'utf-8');
    }
  }

  // 1.5) 动态生成临时 rules.json 文件以允许在不修改全局 rules.json 的前提下启用默认关闭的规则
  let tempRulesPath = null;
  const defaultRulesPath = path.join(DESENSITIZER_DIR, 'legal_desens/rules/rules.json');
  try {
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

  // 构造 CLI 参数
  const args = [
    '-m', 'legal_desens.cli',
  ];
  if (tempRulesPath) {
    args.push('--rules', tempRulesPath);
  }
  args.push(
    'redact-scan',
    inputFilePath,
    '--ocr', 'rapidocr',
    '--level', level,
    '--out', outRedactedScan,
    '--md-out', outMd,
    '--map', outMap,
    '--audit', outAudit,
  );

  if (policyPath) {
    args.push('--entity-policy', policyPath);
  }

  // 若 NER 未就绪，强行降级
  if (!isNerEnabled) {
    args.push('--regex-only');
  }

  try {
    // 执行图像脱敏
    await execFileAsync(PYTHON_BIN, args, {
      cwd: DESENSITIZER_DIR,
      timeout: REDACT_TIMEOUT_MS,
    });

    // 读回脱敏三件套（中介文本、map、audit）
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
          return {
            ...ent,
            entity_type: 'DATE',
            replacement: ent.replacement === '【时间】' ? '【日期】' : ent.replacement,
          };
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
      // 托管白框文件的虚拟路径，用于前端 img/iframe 引用
      redactedImageUrl: `/uploads/${path.basename(outRedactedScan)}`,
      sourceFile: mapData.source_file || path.basename(inputFilePath),
    };

    // 物理清理中间敏感工作文件（保留原件和白框覆盖脱敏件）
    await Promise.all(intermediateFiles.map((f) =>
      fs.unlink(f).catch((e) => console.error(`[WARN] 物理清理图片脱敏中间文件 ${f} 失败:`, e.message))
    ));
    if (policyPath) {
      await fs.unlink(policyPath).catch((e) => console.error(`[WARN] 物理清理临时策略文件 ${policyPath} 失败:`, e.message));
    }
    if (tempRulesPath) {
      await fs.unlink(tempRulesPath).catch((e) => console.error(`[WARN] 物理清理临时规则文件 ${tempRulesPath} 失败:`, e.message));
    }

    return result;
  } catch (error) {
    // 异常时将所有生成的临时/破损文件全部清理掉（包含 outRedactedScan，但不包含原件 inputFilePath）
    const failCleanupFiles = [...intermediateFiles, outRedactedScan];
    if (policyPath) {
      failCleanupFiles.push(policyPath);
    }
    if (tempRulesPath) {
      failCleanupFiles.push(tempRulesPath);
    }
    await Promise.all(failCleanupFiles.map((f) =>
      fs.unlink(f).catch(() => {})
    ));

    if (error.code === 'ETIMEDOUT') {
      throw new Error('扫描件脱敏处理超时，请检查文件大小或服务状态');
    }

    throw new Error(
      `扫描件脱敏处理失败: ${error.stderr || error.message}`
    );
  }
}

// #endregion
