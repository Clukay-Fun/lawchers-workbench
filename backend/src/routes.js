/**
 * 描述: 智能法律工作台 API 路由文件
 * 主要功能:
 *     - 案件 CRUD API (Stage 4)
 *     - 材料上传、脱敏、确认 API (Stage 4)
 *     - 要素分析 API (Stage 5)
 *     - 意见书生成、确认、审计 API (Stage 6)
 *     - 导出 .docx API (Stage 7)
 */

import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { execFile as execFileCb } from 'child_process';
import { createHash } from 'crypto';
import { promisify } from 'util';
import { resolveLegalDesensBin, getRulesPath } from './services/cliResolver.js';

const execFileAsync = promisify(execFileCb);

// 导入业务服务
import { parseDocument } from './services/parserService.js';
import { analyzeCaseElements } from './services/analyzeService.js';
import { generateOpinionDocument } from './services/generateService.js';
import { redactNativeDocument, redactScanDocument, getIsNerEnabled } from './services/redactService.js';

// 导入数据仓储层
import { createCase, getCasesList, getCaseDetail, updateCase, deleteCase } from './db/caseRepo.js';
import { addMaterial, updateMaterialStatus, deleteMaterial, bulkInsertEntities, getMaterialsByCaseId } from './db/materialRepo.js';
import { getCaseElement, updateCaseElement } from './db/elementRepo.js';
import { createOpinion, confirmOpinion, getOpinionsByCaseId, deleteOpinion } from './db/opinionRepo.js';
import { writeAuditLog, getAuditLogsByCaseId } from './db/auditRepo.js';
import { replaceAllDecisions, insertDecisions, getDecisionsByMaterialId, getDecisionReviewCounts, updateDecision, deleteDecision } from './db/decisionRepo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// 确保 uploads 根目录存在
const uploadsDir = path.join(__dirname, '../uploads');
if (!existsSync(uploadsDir)) {
  mkdirSync(uploadsDir, { recursive: true });
}

// 确保 exports 目录存在 (Stage 6/7)
const exportsDir = path.join(__dirname, '../exports');
if (!existsSync(exportsDir)) {
  mkdirSync(exportsDir, { recursive: true });
}

// 配置 Multer 文件上传（临时存到 uploads 根，后续移动到 case 子目录）
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

// #region 旧版 API 退役门控（默认关闭，设 LEGACY_API_ENABLED=true 可重新启用）
if (!process.env.LEGACY_API_ENABLED) {
  const legacyPaths = ['/cases', '/upload', '/analyze', '/generate', '/opinions', '/materials'];
  for (const p of legacyPaths) {
    router.all(`${p}`, (_req, res) => res.status(410).json({ success: false, message: '此 API 已退役，请使用工具模式' }));
    router.all(`${p}/*`, (_req, res) => res.status(410).json({ success: false, message: '此 API 已退役，请使用工具模式' }));
  }
}
// #endregion

// #region Stage 4: 案件 CRUD API

/**
 * POST /api/cases - 创建新案件
 */
router.post('/cases', async (req, res) => {
  try {
    const { employee, company, title, cause, claim_amount } = req.body;
    if (!employee || !company) {
      return res.status(400).json({ success: false, message: '请填写劳动者姓名和用人单位名称' });
    }

    const result = createCase({
      employee,
      company,
      title,
      cause: cause || '劳动争议',
      claim_amount: claim_amount || 0,
    });

    await writeAuditLog({
      case_id: result.id,
      action: 'case_create',
      source: 'human',
      model_config: null,
      human_confirmed: 1,
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Create Case Error:', error);
    res.status(500).json({ success: false, message: '创建案件失败', error: error.message });
  }
});

/**
 * GET /api/cases - 获取案件列表
 */
router.get('/cases', (req, res) => {
  try {
    const cases = getCasesList();
    res.json({ success: true, data: cases });
  } catch (error) {
    console.error('List Cases Error:', error);
    res.status(500).json({ success: false, message: '获取案件列表失败', error: error.message });
  }
});

/**
 * GET /api/cases/:id - 获取案件详情（含材料、要素、意见书）
 */
router.get('/cases/:id', (req, res) => {
  try {
    const identifier = req.params.id;
    const detail = getCaseDetail(identifier);
    if (!detail) {
      return res.status(404).json({ success: false, message: '案件不存在' });
    }

    // 获取审计日志
    const auditLogs = getAuditLogsByCaseId(detail.id);

    res.json({ success: true, data: { ...detail, auditLogs } });
  } catch (error) {
    console.error('Get Case Detail Error:', error);
    res.status(500).json({ success: false, message: '获取案件详情失败', error: error.message });
  }
});

/**
 * PATCH /api/cases/:id - 更新案件
 */
router.patch('/cases/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const fields = req.body;
    delete fields.id;
    delete fields.case_no;
    delete fields.created_at;

    updateCase(id, fields);
    res.json({ success: true });
  } catch (error) {
    console.error('Update Case Error:', error);
    res.status(500).json({ success: false, message: '更新案件失败', error: error.message });
  }
});

/**
 * DELETE /api/cases/:id - 删除案件（级联删除所有子表）
 */
router.delete('/cases/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    deleteCase(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete Case Error:', error);
    res.status(500).json({ success: false, message: '删除案件失败', error: error.message });
  }
});

// #endregion

// #region Stage 4: 材料上传与持久化

/**
 * POST /api/upload - 上传材料文件，存入 uploads/<case_id>/ 并写 material 表
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请上传文件' });
    }

    const caseId = req.body.caseId;
    if (!caseId) {
      return res.status(400).json({ success: false, message: '缺少案件 ID' });
    }

    // multer 以 latin1 解析 originalname，中文文件名会乱码，转回 utf-8
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(originalName).toLowerCase();
    const tmpPath = req.file.path; // multer 临时存储路径

    if (!['.docx', '.pdf'].includes(ext)) {
      await fs.unlink(tmpPath).catch(() => {});
      return res.status(400).json({ success: false, message: '仅支持 DOCX 和 PDF 文件' });
    }
    const handle = await fs.open(tmpPath, 'r');
    const signature = Buffer.alloc(4);
    try {
      await handle.read(signature, 0, 4, 0);
    } finally {
      await handle.close();
    }
    const validSignature = ext === '.pdf'
      ? signature.toString('ascii') === '%PDF'
      : signature[0] === 0x50 && signature[1] === 0x4b;
    if (!validSignature) {
      await fs.unlink(tmpPath).catch(() => {});
      return res.status(400).json({ success: false, message: '文件内容与扩展名不匹配' });
    }

    // 移动文件到 uploads/<case_id>/ 子目录
    const caseUploadDir = path.join(uploadsDir, String(caseId));
    if (!existsSync(caseUploadDir)) {
      mkdirSync(caseUploadDir, { recursive: true });
    }

    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const newFilename = `${uniqueSuffix}-${originalName}`;
    const finalPath = path.join(caseUploadDir, newFilename);

    await fs.rename(tmpPath, finalPath);

    // 解析文档文本
    const rawText = await parseDocument(finalPath, originalName);

    // 保存 raw.md 到同目录
    const rawMdPath = path.join(caseUploadDir, `${path.basename(newFilename, ext)}.raw.md`);
    if (rawText && rawText.trim()) {
      await fs.writeFile(rawMdPath, rawText, 'utf-8');
    }

    // 存储相对路径（相对于 backend/ 目录）
    const relativePath = path.relative(path.join(__dirname, '..'), finalPath);

    // 写入 material 表
    // display_mode 已废弃：documentKind 由 prepare 阶段权威判定，不再依赖上传时启发式猜测
    const material = addMaterial({
      case_id: parseInt(caseId, 10),
      filename: originalName,
      ext,
      stored_path: relativePath,
      display_mode: 'text', // deprecated，保留列兼容性
    });

    res.json({
      success: true,
      data: {
        materialId: material.id,
        filename: originalName,
        filePath: finalPath,
        rawText,
      }
    });
  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ success: false, message: '文件上传解析失败', error: error.message });
  }
});

// #endregion

// #region Stage 4: 脱敏 API（接 material 持久化）

/**
 * POST /api/redact - 对已上传文件执行脱敏，结果写入 DB
 */
router.post('/redact', async (req, res) => {
  try {
    const { filePath, level, rulesConfig, materialId, manualRedactions } = req.body;
    let finalFilePath = filePath;
    let matId = null;

    if (materialId) {
      matId = parseInt(materialId, 10);
      try {
        const { default: db } = await import('./db/index.js');
        const matRow = db.prepare('SELECT stored_path FROM "material" WHERE id = ?').get(matId);
        if (!matRow) {
          return res.status(404).json({ success: false, message: '找不到对应的材料记录，请重新上传文件' });
        }
        // 基于 stored_path 自动在后端还原出最安全、无瑕疵的绝对物理路径，屏蔽前端传来的含 http:// 的异常路径
        finalFilePath = path.resolve(path.join(__dirname, '..', matRow.stored_path));
      } catch (dbErr) {
        console.error('[WARN] 预校验 materialId 失败:', dbErr.message);
      }
    }

    if (!finalFilePath) {
      return res.status(400).json({ success: false, message: '缺少待脱敏文件路径' });
    }

    // 安全校验
    const resolvedPath = path.resolve(finalFilePath);
    if (!resolvedPath.startsWith(path.resolve(uploadsDir))) {
      return res.status(403).json({ success: false, message: '非法文件路径' });
    }

    const result = await redactNativeDocument(
      resolvedPath,
      level || 'strict',
      rulesConfig || {},
      manualRedactions || [],
    );

    // 如果提供了 materialId，且获取到了 matId，则持久化到 DB
    if (matId) {

      // 写入脱敏结果到 material 表
      const mapData = result.mapData || { entities: result.entities, occurrences: result.occurrences };
      try {
        const { default: db } = await import('./db/index.js');
        db.prepare(`
          UPDATE "material"
          SET redacted_md = ?, map_json = ?, occurrences_json = ?,
              redacted_path = ?, audit_json = ?, manual_redactions_json = ?
          WHERE id = ?
        `).run(
          result.redactedText,
          JSON.stringify(mapData),
          JSON.stringify(result.occurrences),
          path.relative(path.join(__dirname, '..'), result.redactedPath),
          JSON.stringify(result.auditData || {}),
          JSON.stringify(manualRedactions || []),
          matId
        );
      } catch (dbErr) {
        console.error('[WARN] 写入脱敏结果到 material 表失败:', dbErr.message);
      }

      // 批量写入脱敏实体到 entity 表（合并 occurrences 中的位置信息）
      if (result.entities && result.entities.length > 0) {
        // 构建 entityId → position 快速索引
        const posMap = {};
        for (const occ of (result.occurrences || [])) {
          if (!posMap[occ.entity_id]) {
            posMap[occ.entity_id] = { start: occ.redacted_start, end: occ.redacted_end };
          }
        }
        // 合并位置信息到实体
        const entitiesWithPos = result.entities.map(ent => ({
          ...ent,
          start: posMap[ent.id]?.start ?? 0,
          end: posMap[ent.id]?.end ?? 0,
        }));
        bulkInsertEntities(matId, entitiesWithPos);
      }

      // 写入审计日志
      const mat = getMaterialsByCaseId(0).find(() => false); // skip, use materialId
      try {
        const { default: db } = await import('./db/index.js');
        const matRow = db.prepare('SELECT case_id FROM "material" WHERE id = ?').get(matId);
        if (matRow) {
          await writeAuditLog({
            case_id: matRow.case_id,
            action: 'redact',
            source: 'legal-desens',
            model_config: {
              level: level || 'strict',
              nerEnabled: getIsNerEnabled(),
              rulesConfig: rulesConfig || {},
            },
            human_confirmed: 0,
          });
        }
      } catch (auditErr) {
        console.error('[WARN] 写入脱敏审计日志失败:', auditErr.message);
      }
    }

    const redactedRelative = result.redactedPath
      ? path.relative(path.join(__dirname, '..'), result.redactedPath).split(path.sep).join('/')
      : '';
    res.json({
      success: true,
      data: {
        ...result,
        mapData: undefined,
        auditData: undefined,
        mapPath: undefined,
        auditPath: undefined,
        redactedPath: undefined,
        redactedFileUrl: redactedRelative ? `/${redactedRelative}` : null,
      },
    });
  } catch (error) {
    console.error('Redact Error:', error);
    res.status(500).json({ success: false, message: '脱敏处理失败', error: error.message });
  }
});

/**
 * POST /api/materials/:id/manual-redactions
 * 保存人工框选的敏感文本。原件不变；下次预览/导出时从原件重新生成副本。
 */
router.post('/materials/:id/manual-redactions', async (req, res) => {
  try {
    const materialId = parseInt(req.params.id, 10);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const normalized = [...new Set(items
      .map((item) => typeof item === 'string' ? item : item?.text)
      .map((text) => String(text || '').trim())
      .filter((text) => text.length > 0 && text.length <= 500)
    )].slice(0, 100);

    const { default: db } = await import('./db/index.js');
    const mat = db.prepare('SELECT case_id FROM "material" WHERE id = ?').get(materialId);
    if (!mat) return res.status(404).json({ success: false, message: '材料不存在' });

    db.prepare(`
      UPDATE "material"
      SET manual_redactions_json = ?, redact_status = 'todo'
      WHERE id = ?
    `).run(JSON.stringify(normalized), materialId);

    await writeAuditLog({
      case_id: mat.case_id,
      action: 'manual_redactions_update',
      source: 'human',
      model_config: { count: normalized.length },
      human_confirmed: 1,
    });

    res.json({ success: true, data: { items: normalized } });
  } catch (error) {
    console.error('Manual Redactions Error:', error);
    res.status(500).json({ success: false, message: '保存人工脱敏标注失败', error: error.message });
  }
});

/** 保存 Markdown/TXT 的可编辑工作副本；上传原件始终不改写。 */
router.patch('/materials/:id/text', async (req, res) => {
  try {
    const materialId = parseInt(req.params.id, 10);
    const text = typeof req.body?.text === 'string' ? req.body.text : null;
    if (text === null) return res.status(400).json({ success: false, message: '缺少文本内容' });

    const { default: db } = await import('./db/index.js');
    const mat = db.prepare('SELECT case_id, ext FROM "material" WHERE id = ?').get(materialId);
    if (!mat) return res.status(404).json({ success: false, message: '材料不存在' });
    if (!['.txt', '.md'].includes(String(mat.ext).toLowerCase())) {
      return res.status(400).json({ success: false, message: '仅 Markdown/TXT 支持正文编辑' });
    }

    db.prepare(`UPDATE "material" SET working_text = ?, redact_status = 'todo' WHERE id = ?`).run(text, materialId);
    await writeAuditLog({
      case_id: mat.case_id,
      action: 'working_copy_update',
      source: 'human',
      model_config: { format: String(mat.ext).slice(1), length: text.length },
      human_confirmed: 1,
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Working Text Error:', error);
    res.status(500).json({ success: false, message: '保存工作副本失败', error: error.message });
  }
});

/**
 * GET /api/redact/status - NER 状态
 */
router.get('/redact/status', (req, res) => {
  res.json({ success: true, data: { nerEnabled: getIsNerEnabled() } });
});

/**
 * POST /api/redact-scan - 扫描件脱敏
 */
router.post('/redact-scan', async (req, res) => {
  try {
    const { filePath, level, rulesConfig, materialId } = req.body;
    if (!filePath) {
      return res.status(400).json({ success: false, message: '缺少待脱敏文件路径' });
    }

    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(uploadsDir))) {
      return res.status(403).json({ success: false, message: '非法文件路径' });
    }

    const result = await redactScanDocument(resolvedPath, level || 'strict', rulesConfig || {});

    // 持久化到 DB
    if (materialId) {
      const matId = parseInt(materialId, 10);
      const mapData = { entities: result.entities, occurrences: result.occurrences };
      try {
        const { default: db } = await import('./db/index.js');
        db.prepare(`
          UPDATE "material" SET redacted_md = ?, map_json = ?, occurrences_json = ? WHERE id = ?
        `).run(
          result.redactedText,
          JSON.stringify(mapData),
          JSON.stringify(result.occurrences),
          matId
        );
      } catch (dbErr) {
        console.error('[WARN] 写入扫描件脱敏结果失败:', dbErr.message);
      }

      if (result.entities && result.entities.length > 0) {
        const posMap = {};
        for (const occ of (result.occurrences || [])) {
          if (!posMap[occ.entity_id]) {
            posMap[occ.entity_id] = { start: occ.redacted_start, end: occ.redacted_end };
          }
        }
        const entitiesWithPos = result.entities.map(ent => ({
          ...ent,
          start: posMap[ent.id]?.start ?? 0,
          end: posMap[ent.id]?.end ?? 0,
        }));
        bulkInsertEntities(matId, entitiesWithPos);
      }

      try {
        const { default: db } = await import('./db/index.js');
        const matRow = db.prepare('SELECT case_id FROM "material" WHERE id = ?').get(matId);
        if (matRow) {
          await writeAuditLog({
            case_id: matRow.case_id,
            action: 'redact',
            source: 'legal-desens-scan',
            model_config: {
              level: level || 'strict',
              nerEnabled: getIsNerEnabled(),
              rulesConfig: rulesConfig || {},
            },
            human_confirmed: 0,
          });
        }
      } catch (auditErr) {
        console.error('[WARN] 写入扫描件审计日志失败:', auditErr.message);
      }
    }

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Redact Scan Error:', error);
    res.status(500).json({ success: false, message: '扫描件脱敏处理失败', error: error.message });
  }
});

/**
 * POST /api/materials/:id/confirm - 确认材料脱敏完成
 */
router.post('/materials/:id/confirm', async (req, res) => {
  try {
    const matId = parseInt(req.params.id, 10);
    updateMaterialStatus(matId, 'done');

    // 获取 case_id 写审计
    const { default: db } = await import('./db/index.js');
    const matRow = db.prepare('SELECT case_id FROM "material" WHERE id = ?').get(matId);
    if (matRow) {
      await writeAuditLog({
        case_id: matRow.case_id,
        action: 'material_confirm',
        source: 'human',
        model_config: null,
        human_confirmed: 1,
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Confirm Material Error:', error);
    res.status(500).json({ success: false, message: '确认材料失败', error: error.message });
  }
});

/**
 * DELETE /api/materials/:id - 删除材料（连带本地脱敏产物文件 + 级联实体）
 */
router.delete('/materials/:id', async (req, res) => {
  try {
    const matId = parseInt(req.params.id, 10);
    const { default: db } = await import('./db/index.js');
    const matRow = db.prepare('SELECT case_id, stored_path FROM "material" WHERE id = ?').get(matId);
    if (!matRow) {
      return res.status(404).json({ success: false, message: '材料不存在' });
    }

    // best-effort 清理本地原件及同目录脱敏产物（不阻断删除）
    if (matRow.stored_path) {
      const abs = path.resolve(path.join(__dirname, '..'), matRow.stored_path);
      if (abs.startsWith(path.resolve(uploadsDir))) {
        const dir = path.dirname(abs);
        const base = path.basename(abs, path.extname(abs));
        const fileCandidates = [
          abs,
          path.join(dir, `${base}.raw.md`),
          path.join(dir, `${base}.redacted.txt`),
          path.join(dir, `${base}.map.json`),
          path.join(dir, `${base}.audit.json`),
        ];
        await Promise.all(fileCandidates.map((p) => fs.unlink(p).catch(() => {})));

        // P1: 清理 .work_<materialId> 工作目录（含 preview/manifest/decisions/export 产物）
        const workDir = path.join(dir, `.work_${matId}`);
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
      }
    }

    deleteMaterial(matId); // 级联删除 entity（外键 ON DELETE CASCADE）

    await writeAuditLog({
      case_id: matRow.case_id,
      action: 'material_delete',
      source: 'human',
      model_config: null,
      human_confirmed: 1,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete Material Error:', error);
    res.status(500).json({ success: false, message: '删除材料失败', error: error.message });
  }
});

// #endregion

// #region Stage 5: 要素分析 API

/**
 * POST /api/analyze - 分析案件要素并持久化到 case_element
 */
router.post('/analyze', async (req, res) => {
  try {
    const { text, caseId } = req.body;
    if (!text) {
      return res.status(400).json({ success: false, message: '请求文本不能为空' });
    }

    const elements = await analyzeCaseElements(text);

    // 如果提供了 caseId，将要素持久化到 case_element 表
    if (caseId) {
      const cid = parseInt(caseId, 10);
      updateCaseElement(cid, {
        entry_date: elements.entryDate || null,
        leave_date: elements.leaveDate || null,
        salary: elements.monthlySalary || 0,
        has_contract: elements.hasContract ? 1 : 0,
        leave_reason: elements.leaveReason === '用人单位违法解除劳动合同' ? 'dismiss'
          : elements.leaveReason === '劳动合同期满不续签' ? 'expire'
          : elements.leaveReason === '劳动者主动辞职' ? 'quit' : 'dismiss',
        working_months: elements.workingMonths || 0,
        job_title: elements.jobTitle || '技术开发岗',
      });

      // 更新案件索赔总额
      if (elements.calculationResult?.totalClaimAmount) {
        updateCase(cid, { claim_amount: elements.calculationResult.totalClaimAmount });
      }

      // 写审计
      await writeAuditLog({
        case_id: cid,
        action: 'element_extract',
        source: 'llm',
        model_config: { method: 'regex+rule' },
        human_confirmed: 0,
      });
    }

    res.json({ success: true, data: elements });
  } catch (error) {
    console.error('Analyze Error:', error);
    res.status(500).json({ success: false, message: '案件要素提取失败', error: error.message });
  }
});

// #endregion

// #region Stage 6: 意见书生成与审计 API

/**
 * POST /api/generate - 生成法律意见书，存入 opinion 表 + exports/
 */
router.post('/generate', async (req, res) => {
  try {
    const { elements, templateType, caseId } = req.body;
    if (!elements) {
      return res.status(400).json({ success: false, message: '案件要素数据不能为空' });
    }

    const documentData = await generateOpinionDocument(elements, templateType || 'labor_standard');

    // 如果提供了 caseId，持久化到 opinion 表
    let opinionId = null;
    if (caseId) {
      const cid = parseInt(caseId, 10);
      const opinion = createOpinion({
        case_id: cid,
        template_type: templateType || 'labor_standard',
        content_md: documentData.opinionText,
      });
      opinionId = opinion.id;

      // 同时保存到 exports/ 目录
      const exportFilename = `opinion-${cid}-${Date.now()}.md`;
      const exportPath = path.join(exportsDir, exportFilename);
      await fs.writeFile(exportPath, documentData.opinionText, 'utf-8');

      // 写审计
      await writeAuditLog({
        case_id: cid,
        action: 'opinion_generate',
        source: 'llm',
        model_config: { template: templateType || 'labor_standard' },
        human_confirmed: 0,
      });
    }

    res.json({
      success: true,
      data: {
        ...documentData,
        opinionId,
        status: 'draft',
      }
    });
  } catch (error) {
    console.error('Generate Document Error:', error);
    res.status(500).json({ success: false, message: '法律意见书生成失败', error: error.message });
  }
});

/**
 * POST /api/opinions/:id/confirm - 人工确认意见书
 */
router.post('/opinions/:id/confirm', async (req, res) => {
  try {
    const opinionId = parseInt(req.params.id, 10);
    confirmOpinion(opinionId);

    // 获取 case_id 写审计
    const { default: db } = await import('./db/index.js');
    const opinionRow = db.prepare('SELECT case_id FROM "opinion" WHERE id = ?').get(opinionId);
    if (opinionRow) {
      await writeAuditLog({
        case_id: opinionRow.case_id,
        action: 'opinion_confirm',
        source: 'human',
        model_config: null,
        human_confirmed: 1,
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Confirm Opinion Error:', error);
    res.status(500).json({ success: false, message: '确认意见书失败', error: error.message });
  }
});

/**
 * GET /api/cases/:id/audit - 获取审计日志
 */
router.get('/cases/:id/audit', (req, res) => {
  try {
    const caseId = parseInt(req.params.id, 10);
    const logs = getAuditLogsByCaseId(caseId);
    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('Get Audit Error:', error);
    res.status(500).json({ success: false, message: '获取审计日志失败', error: error.message });
  }
});

// #endregion

// #region Markdown 复核工作流 API

/**
 * POST /api/materials/:id/prepare - 触发文档预处理（调 legal-desens prepare）
 */
router.post('/materials/:id/prepare', async (req, res) => {
  let tempDir = null;
  let workDir = null;
  let backupDir = null;
  let installedNewWorkDir = false;
  let committed = false;
  let previousStatus = 'uploaded';
  let hadPreviousReview = false;
  try {
    const matId = parseInt(req.params.id, 10);
    const { rulesConfig } = req.body || {};
    const { default: db } = await import('./db/index.js');
    const mat = db.prepare('SELECT * FROM "material" WHERE id = ?').get(matId);
    if (!mat) return res.status(404).json({ success: false, message: '材料不存在' });
    previousStatus = mat.processing_status || 'uploaded';
    hadPreviousReview = Boolean(mat.manifest_path && mat.preview_path);

    const sourcePath = path.resolve(path.join(__dirname, '..', mat.stored_path));
    if (!sourcePath.startsWith(path.resolve(uploadsDir))) {
      return res.status(403).json({ success: false, message: '非法材料路径' });
    }

    db.prepare(`UPDATE "material" SET processing_status = 'preparing' WHERE id = ?`).run(matId);

    const caseDir = path.join(uploadsDir, String(mat.case_id));
    workDir = path.join(caseDir, `.work_${matId}`);
    backupDir = `${workDir}.backup`;
    tempDir = path.join(caseDir, `.tmp_prepare_${matId}_${Date.now()}`);
    if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });

    const tempPreview = path.join(tempDir, 'preview.md');
    const tempManifest = path.join(tempDir, 'manifest.json');
    const tempSourceMap = path.join(tempDir, 'source-map.json');

    const args = [
      'prepare', sourcePath,
      '--level', 'strict',
      '--preview-md', tempPreview,
      '--manifest', tempManifest,
      '--map', tempSourceMap,
    ];

    if (!getIsNerEnabled()) {
      args.push('--regex-only');
    }

    // Apply the workbench switches in the detector itself so the manifest,
    // persisted decisions and audit all describe the same candidate set.
    const preserveTypes = [];
    const typeAliases = { LOC: ['ADDRESS'], DATE: ['DATE', 'TIME'] };
    for (const [type, enabled] of Object.entries(rulesConfig || {})) {
      if (enabled !== false) continue;
      preserveTypes.push(...(typeAliases[type] || [type]));
    }
    const dateOff = preserveTypes.includes('DATE') || preserveTypes.includes('TIME');
    if (preserveTypes.length) {
      const policyPath = path.join(tempDir, 'entity-policy.json');
      await fs.writeFile(policyPath, JSON.stringify({ preserve_types: [...new Set(preserveTypes)] }), 'utf-8');
      args.push('--entity-policy', policyPath);
    }

    const legalDesensBin = resolveLegalDesensBin();

    await execFileAsync(legalDesensBin, args, {
      timeout: parseInt(process.env.REDACT_TIMEOUT_MS || '120000', 10),
    });

    const manifestRaw = await fs.readFile(tempManifest, 'utf-8');
    const manifest = JSON.parse(manifestRaw);
    const sourceMap = JSON.parse(await fs.readFile(tempSourceMap, 'utf-8'));
    if (!manifest.sourceSha256 || sourceMap.source_sha256 !== manifest.sourceSha256) {
      throw new Error('预处理输出的原件哈希不一致');
    }
    const previewRaw = await fs.readFile(tempPreview, 'utf-8');
    if (!previewRaw || !previewRaw.trim()) {
      throw new Error('预处理输出的预览内容为空');
    }

    const candidates = manifest.candidates || [];
    const decisionRows = candidates.map(c => ({
      candidateId: c.id,
      blockId: c.blockId,
      start: c.start,
      end: c.end,
      action: 'redact',
      origin: 'automatic',
      entityType: c.entityType,
      sourceLocator: c.sourceLocator,
    }));

    // Install the verified files with a rollback copy. SQLite changes are
    // committed together; any ordinary failure restores the previous review.
    await fs.rm(backupDir, { recursive: true, force: true });
    if (existsSync(workDir)) {
      await fs.rename(workDir, backupDir);
    }
    try {
      await fs.rename(tempDir, workDir);
      installedNewWorkDir = true;
      tempDir = null;
    } catch (error) {
      if (existsSync(backupDir)) await fs.rename(backupDir, workDir);
      throw error;
    }

    // 更新 material 表
    const relPreview = path.relative(path.join(__dirname, '..'), path.join(workDir, 'preview.md'));
    const relManifest = path.relative(path.join(__dirname, '..'), path.join(workDir, 'manifest.json'));

    db.transaction(() => {
      db.prepare(`
        UPDATE "material" SET
          document_kind = ?, preview_path = ?, manifest_path = ?,
          source_sha256 = ?, processing_status = 'reviewing', redact_status = 'todo'
        WHERE id = ?
      `).run(
        manifest.documentKind || '', relPreview, relManifest,
        manifest.sourceSha256 || '', matId,
      );
      replaceAllDecisions(matId, decisionRows);
      writeAuditLog({
        case_id: mat.case_id,
        action: 'prepare',
        source: 'legal-desens',
        model_config: {
          materialId: matId,
          documentKind: manifest.documentKind,
          blocks: manifest.blocks?.length || 0,
          candidates: candidates.length,
          rulesConfig: rulesConfig || {},
          datePreserved: dateOff,
          nerEnabled: getIsNerEnabled(),
          binPath: legalDesensBin,
        },
        human_confirmed: 0,
      });
    })();
    committed = true;
    await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});

    res.json({
      success: true,
      data: {
        materialId: matId,
        documentKind: manifest.documentKind,
        blockCount: manifest.blocks?.length || 0,
        candidateCount: candidates.length,
        previewPath: relPreview,
        manifestPath: relManifest,
      },
    });
  } catch (error) {
    console.error('Prepare Error:', error);
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
    if (installedNewWorkDir && !committed && workDir) {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
      if (backupDir && existsSync(backupDir)) {
        await fs.rename(backupDir, workDir).catch(() => {});
      }
    }
    try {
      const { default: db } = await import('./db/index.js');
      if (!committed) {
        db.prepare(`UPDATE "material" SET processing_status = ? WHERE id = ?`).run(
          hadPreviousReview ? previousStatus : 'failed',
          parseInt(req.params.id, 10),
        );
      }
    } catch {}
    res.status(500).json({ success: false, message: '文档预处理失败', error: error.message });
  }
});

/**
 * GET /api/materials/:id/review - 获取复核数据（preview + manifest + decisions）
 */
router.get('/materials/:id/review', async (req, res) => {
  try {
    const matId = parseInt(req.params.id, 10);
    const { default: db } = await import('./db/index.js');
    const mat = db.prepare('SELECT * FROM "material" WHERE id = ?').get(matId);
    if (!mat) return res.status(404).json({ success: false, message: '材料不存在' });

    // 读取 preview markdown
    let previewMd = '';
    if (mat.preview_path) {
      const absPath = path.resolve(path.join(__dirname, '..', mat.preview_path));
      try { previewMd = await fs.readFile(absPath, 'utf-8'); } catch {}
    }

    // 读取 manifest
    let manifest = null;
    if (mat.manifest_path) {
      const absPath = path.resolve(path.join(__dirname, '..', mat.manifest_path));
      try { manifest = JSON.parse(await fs.readFile(absPath, 'utf-8')); } catch {}
    }

    // 获取决策
    const decisions = getDecisionsByMaterialId(matId);

    // 获取当前材料的 prepare 审计日志（用于诊断）
    let prepareAudit = null;
    try {
      const auditLogs = getAuditLogsByCaseId(mat.case_id);
      // 优先匹配当前材料的 prepare 审计（model_config.materialId === matId）
      prepareAudit = auditLogs.find(a => {
        if (a.action !== 'prepare') return false;
        let cfg = a.model_config;
        if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch { return false; } }
        return cfg && cfg.materialId === matId;
      }) || null;
      // fallback: 旧材料无 materialId 标记，取第一条 prepare（标注为旧审计）
      if (!prepareAudit) {
        prepareAudit = auditLogs.find(a => a.action === 'prepare') || null;
        if (prepareAudit) {
          if (typeof prepareAudit.model_config === 'string') {
            try { prepareAudit.model_config = JSON.parse(prepareAudit.model_config); } catch {}
          }
          // 标记为旧审计，前端可显示"旧审计无法精确匹配"
          if (prepareAudit?.model_config && !prepareAudit.model_config.materialId) {
            prepareAudit._legacyMatch = true;
          }
        }
      } else {
        if (typeof prepareAudit.model_config === 'string') {
          try { prepareAudit.model_config = JSON.parse(prepareAudit.model_config); } catch {}
        }
      }
    } catch {}

    res.json({
      success: true,
      data: {
        materialId: matId,
        processingStatus: mat.processing_status,
        verificationStatus: mat.verification_status,
        documentKind: mat.document_kind,
        sourceSha256: mat.source_sha256 || '',
        previewMd,
        manifest,
        rulesConfig: prepareAudit?.model_config?.rulesConfig || null,
        nerEnabled: prepareAudit?.model_config?.nerEnabled ?? null,
        preparedAt: prepareAudit?.created_at || null,
        updatedAt: mat.updated_at || null,
        legacyAudit: prepareAudit?._legacyMatch || false,
        decisions: decisions.map(d => ({
          id: d.id,
          candidateId: d.candidate_id,
          blockId: d.block_id,
          start: d.start,
          end: d.end,
          action: d.action,
          origin: d.origin,
          entityType: d.entity_type,
          sourceLocator: (() => { try { return JSON.parse(d.source_locator); } catch { return {}; } })(),
          confirmed: d.confirmed === 1,
        })),
      },
    });
  } catch (error) {
    console.error('Get Review Error:', error);
    res.status(500).json({ success: false, message: '获取复核数据失败', error: error.message });
  }
});

/**
 * PUT /api/materials/:id/decisions - 批量更新决策（脱敏/保留/取消）
 */
router.put('/materials/:id/decisions', async (req, res) => {
  try {
    const matId = parseInt(req.params.id, 10);
    const { decisions } = req.body;
    if (!Array.isArray(decisions)) {
      return res.status(400).json({ success: false, message: 'decisions 必须是数组' });
    }

    const { default: db } = await import('./db/index.js');
    const mat = db.prepare(`
      SELECT case_id, manifest_path, processing_status
      FROM "material" WHERE id = ?
    `).get(matId);
    if (!mat) return res.status(404).json({ success: false, message: '材料不存在' });
    if (!['reviewing', 'ready', 'exported'].includes(mat.processing_status)) {
      return res.status(409).json({ success: false, message: '材料尚未进入可编辑的复核状态' });
    }

    let manifest = null;
    if (mat.manifest_path) {
      const manifestPath = path.resolve(path.join(__dirname, '..', mat.manifest_path));
      if (!manifestPath.startsWith(path.resolve(uploadsDir))) {
        return res.status(403).json({ success: false, message: '非法复核清单路径' });
      }
      try {
        manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
      } catch (error) {
        return res.status(409).json({ success: false, message: '复核清单缺失或损坏，请重新预处理材料' });
      }
    }
    const blocksById = new Map((manifest?.blocks || []).map((block) => [block.id, block]));

    // 处理每条决策
    const allowedActions = new Set(['redact', 'keep', 'cancel']);
    const addedDecisions = [];
    for (const d of decisions) {
      if (!allowedActions.has(d.action)) {
        return res.status(400).json({ success: false, message: `不支持的决策动作: ${d.action}` });
      }
      if (d.id) {
        const existingDecision = db.prepare(`
          SELECT origin FROM "redaction_decision"
          WHERE id = ? AND material_id = ?
        `).get(d.id, matId);
        if (!existingDecision) {
          return res.status(404).json({ success: false, message: '决策不存在或不属于当前材料' });
        }
        // 更新已有决策
        if (d.action === 'cancel') {
          if (existingDecision.origin !== 'manual') {
            return res.status(400).json({ success: false, message: '自动候选必须明确选择脱敏或保留' });
          }
          deleteDecision(d.id);
        } else {
          updateDecision(matId, d.id, {
            action: d.action,
            confirmed: 1,
          });
        }
      } else if (d.action !== 'cancel') {
        const block = blocksById.get(d.blockId);
        const start = Number(d.start);
        const end = Number(d.end);
        if (!block || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > block.text.length) {
          return res.status(400).json({ success: false, message: '人工脱敏位置无效或已过期，请重新选择' });
        }
        // 新增手动决策（追加，不删除已有）
        insertDecisions(matId, [{
          candidateId: d.candidateId || null,
          blockId: d.blockId,
          start: d.start,
          end: d.end,
          action: d.action,
          origin: 'manual',
          entityType: d.entityType || '',
          sourceLocator: block.sourceLocator || {},
          confirmed: true,
        }]);
        // 查询刚插入的决策，返回真实 id
        const lastDecision = db.prepare(`
          SELECT * FROM "redaction_decision"
          WHERE material_id = ? AND block_id = ? AND start = ? AND end = ? AND origin = 'manual'
          ORDER BY id DESC LIMIT 1
        `).get(matId, d.blockId, d.start, d.end);
        if (lastDecision) {
          addedDecisions.push({
            id: lastDecision.id,
            candidateId: lastDecision.candidate_id,
            blockId: lastDecision.block_id,
            start: lastDecision.start,
            end: lastDecision.end,
            action: lastDecision.action,
            origin: lastDecision.origin,
            entityType: lastDecision.entity_type,
            sourceLocator: (() => { try { return JSON.parse(lastDecision.source_locator); } catch { return {}; } })(),
            confirmed: lastDecision.confirmed === 1,
          });
        }
      }
    }

    // A4: 决策变化后，使 ready/exported 状态失效，退回 reviewing
    db.prepare(`
      UPDATE "material" SET processing_status = 'reviewing', redact_status = 'todo'
      WHERE id = ? AND processing_status IN ('ready', 'exported')
    `).run(matId);

    await writeAuditLog({
      case_id: mat.case_id,
      action: 'decisions_update',
      source: 'human',
      model_config: { count: decisions.length },
      human_confirmed: 1,
    });

    const updatedDecisions = getDecisionsByMaterialId(matId);
    res.json({
      success: true,
      data: { count: updatedDecisions.length, added: addedDecisions },
    });
  } catch (error) {
    console.error('Update Decisions Error:', error);
    res.status(500).json({ success: false, message: '更新决策失败', error: error.message });
  }
});

/**
 * POST /api/materials/:id/review-complete - 标记复核完成
 */
router.post('/materials/:id/review-complete', async (req, res) => {
  try {
    const matId = parseInt(req.params.id, 10);
    const { default: db } = await import('./db/index.js');
    const mat = db.prepare(`
      SELECT case_id, processing_status, source_sha256, stored_path
      FROM "material" WHERE id = ?
    `).get(matId);
    if (!mat) return res.status(404).json({ success: false, message: '材料不存在' });

    // P1: 必须处于 reviewing 状态
    if (mat.processing_status !== 'reviewing') {
      return res.status(409).json({
        success: false,
        message: `材料当前状态为 ${mat.processing_status}，只有 reviewing 状态才能标记完成`,
      });
    }

    const sourcePath = path.resolve(path.join(__dirname, '..', mat.stored_path));
    if (!sourcePath.startsWith(path.resolve(uploadsDir))) {
      return res.status(403).json({ success: false, message: '非法材料路径' });
    }
    const currentSourceSha256 = createHash('sha256')
      .update(await fs.readFile(sourcePath))
      .digest('hex');
    if (!mat.source_sha256 || currentSourceSha256 !== mat.source_sha256) {
      db.prepare(`UPDATE "material" SET processing_status = 'failed' WHERE id = ?`).run(matId);
      return res.status(409).json({
        success: false,
        message: '原件自预处理后已发生变化，请重新预处理并复核',
      });
    }

    // 每个候选都必须有明确的人工决策；零候选时点击本接口即为整份人工确认。
    const reviewCounts = getDecisionReviewCounts(matId);
    if (reviewCounts.confirmed !== reviewCounts.total) {
      return res.status(409).json({
        success: false,
        message: `仍有 ${reviewCounts.total - reviewCounts.confirmed} 处候选未经人工确认`,
      });
    }

    db.prepare(`
      UPDATE "material" SET processing_status = 'ready', redact_status = 'done' WHERE id = ?
    `).run(matId);

    await writeAuditLog({
      case_id: mat.case_id,
      action: 'review_complete',
      source: 'human',
      model_config: null,
      human_confirmed: 1,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Review Complete Error:', error);
    res.status(500).json({ success: false, message: '标记复核完成失败', error: error.message });
  }
});

/**
 * POST /api/materials/:id/export - 按复核决策导出脱敏副本
 *
 * 前置校验：
 *   - material.processing_status ∈ {reviewing, ready}
 *   - manifest + source_map 存在
 *   - source_sha256 匹配
 *   - 所有决策已确认（未确认的自动候选在前端由用户逐项确认后才能点导出）
 *   - hybrid PDF 暂不支持导出（需逐页混合管线）
 *
 * 导出流程：
 *   - 将 redaction_decision 导出为 decisions.json
 *   - 调用 legal-desens redact --decisions --source-map（跳过自动检测）
 *   - 残留复检：passed === true
 *   - 失败则删除产物
 */
router.post('/materials/:id/export', async (req, res) => {
  try {
    const matId = parseInt(req.params.id, 10);
    const confirmPending = req.body?.confirmPending === true;
    const { default: db } = await import('./db/index.js');
    const mat = db.prepare('SELECT * FROM "material" WHERE id = ?').get(matId);
    if (!mat) return res.status(404).json({ success: false, message: '材料不存在' });

    // 状态校验：允许 exported 状态重新导出
    if (!['reviewing', 'ready', 'exported'].includes(mat.processing_status)) {
      return res.status(409).json({ success: false, message: `材料状态 ${mat.processing_status} 不允许导出，需先完成预处理和复核` });
    }

    // manifest 和 source_map 校验
    if (!mat.manifest_path || !mat.preview_path) {
      return res.status(409).json({ success: false, message: '材料未完成预处理，缺少 manifest' });
    }

    // 原件完整性校验
    const sourcePath = path.resolve(path.join(__dirname, '..', mat.stored_path));
    if (!sourcePath.startsWith(path.resolve(uploadsDir))) {
      return res.status(403).json({ success: false, message: '非法材料路径' });
    }
    if (!mat.source_sha256) {
      return res.status(409).json({ success: false, message: '缺少原件哈希，请重新预处理' });
    }
    const currentSha = createHash('sha256').update(await fs.readFile(sourcePath)).digest('hex');
    if (currentSha !== mat.source_sha256) {
      return res.status(409).json({ success: false, message: '原件自预处理后已变化，请重新预处理' });
    }

    // PDF: only pdf-text supports decisions export; pdf-scan/hybrid not yet implemented
    if (mat.document_kind && mat.document_kind.includes('pdf')) {
      if (mat.document_kind === 'pdf-text') {
        // pdf-text is supported — continue to export
      } else if (mat.document_kind === 'pdf-hybrid') {
        return res.status(501).json({ success: false, message: '混合型 PDF（含扫描页）的按决策导出尚未实现，请拆分或转换为 DOCX' });
      } else {
        // pdf-scan
        return res.status(501).json({ success: false, message: '扫描件 PDF 的按决策导出尚未实现，请使用 redact-scan 或转换为 DOCX' });
      }
    }

    // 决策完整性校验
    const counts = getDecisionReviewCounts(matId);
    const pendingCount = counts.total - counts.confirmed;
    if (pendingCount > 0 && !confirmPending) {
      return res.status(409).json({ success: false, message: `仍有 ${counts.total - counts.confirmed} 处决策未确认，请先逐项确认` });
    }

    // 准备工作目录
    const workDir = path.join(uploadsDir, String(mat.case_id), `.work_${matId}`);
    if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });

    // 导出 decisions.json（从 DB 读取，保持 origin 不变）
    const decisions = getDecisionsByMaterialId(matId);
    const decisionsPath = path.join(workDir, 'decisions.json');
    await fs.writeFile(decisionsPath, JSON.stringify(decisions.map(d => {
      let sourceLocator = {};
      try { sourceLocator = JSON.parse(d.source_locator || '{}'); } catch {}
      return {
        id: d.id, candidateId: d.candidate_id, blockId: d.block_id,
        start: d.start, end: d.end, action: d.action, origin: d.origin,
        entityType: d.entity_type, sourceLocator, confirmed: d.confirmed === 1,
      };
    }), null, 2), 'utf-8');

    // source-map 路径
    const sourceMapPath = path.join(workDir, 'source-map.json');

    const ext = path.extname(mat.filename);
    const safeBase = path.basename(mat.filename, ext).replace(/[^\p{L}\p{N}._-]+/gu, '-');
    const exportFilename = `${safeBase || 'document'}.redacted${ext}`;
    const exportPath = path.join(workDir, exportFilename);
    const auditPath = path.join(workDir, 'export-audit.json');
    const mapPath = path.join(workDir, 'export-map.json');

    const legalDesensBin = resolveLegalDesensBin();

    // 调用 legal-desens redact --decisions（跳过自动检测，按决策精确导出）
    const args = [
      'redact', sourcePath,
      '--level', 'strict',
      '--decisions', decisionsPath,
      '--source-map', sourceMapPath,
      '--out', exportPath,
      '--map', mapPath,
      '--audit', auditPath,
    ];
    if (!getIsNerEnabled()) args.push('--regex-only');

    try {
      await execFileAsync(legalDesensBin, args, {
        timeout: parseInt(process.env.REDACT_TIMEOUT_MS || '120000', 10),
      });
    } catch (cliErr) {
      await fs.unlink(exportPath).catch(() => {});
      return res.status(500).json({ success: false, message: '决策导出 CLI 执行失败', error: cliErr.message });
    }

    // 残留复检
    let auditData = null;
    try {
      auditData = JSON.parse(await fs.readFile(auditPath, 'utf-8'));
    } catch {
      await fs.unlink(exportPath).catch(() => {});
      return res.status(500).json({ success: false, message: '无法读取审计文件，导出阻断' });
    }

    const residualPassed = auditData?.residual_scan?.passed === true;
    if (!residualPassed) {
      await fs.unlink(exportPath).catch(() => {});
      db.prepare('UPDATE "material" SET verification_status = ?, audit_json = ? WHERE id = ?')
        .run('failed', JSON.stringify(auditData), matId);
      await writeAuditLog({
        case_id: mat.case_id, action: 'export_failed', source: 'legal-desens',
        model_config: { residualPassed: false, format: ext }, human_confirmed: 1,
      });
      return res.status(409).json({ success: false, message: '残留扫描未通过，导出已阻断' });
    }

    // Persist final confirmation and successful export together. The original
    // decision origins remain unchanged; this only records human confirmation.
    db.transaction(() => {
      if (pendingCount > 0) {
        db.prepare(`
          UPDATE "redaction_decision" SET confirmed = 1
          WHERE material_id = ? AND confirmed = 0
        `).run(matId);
      }
      db.prepare(`
        UPDATE "material" SET
          verification_status = 'passed', redacted_path = ?,
          audit_json = ?, processing_status = 'exported', redact_status = 'done'
        WHERE id = ?
      `).run(path.relative(path.join(__dirname, '..'), exportPath), JSON.stringify(auditData), matId);
      writeAuditLog({
        case_id: mat.case_id, action: 'export', source: 'legal-desens',
        model_config: {
          decisionCount: counts.total,
          confirmedOnExport: pendingCount,
          format: ext,
          exportMode: 'decisions',
        },
        human_confirmed: 1,
      });
    })();

    res.download(exportPath, exportFilename);
  } catch (error) {
    console.error('Export Error:', error);
    res.status(500).json({ success: false, message: '导出失败', error: error.message });
  }
});

// #endregion

// #region Stage 7: 导出 .docx

/**
 * POST /api/export/redacted - 按原格式生成并导出脱敏副本。
 *
 * 每次导出都从只读原件重新执行脱敏。legal-desens 会在输出阶段执行
 * 残留检查；TXT/MD/DOCX 还会再运行一次独立 audit，未通过则不下载。
 */
router.post('/export/redacted', async (req, res) => {
  try {
    const materialId = parseInt(req.body?.materialId, 10);
    if (!materialId) {
      return res.status(400).json({ success: false, message: '缺少材料 ID' });
    }

    const { default: db } = await import('./db/index.js');
    const mat = db.prepare('SELECT * FROM "material" WHERE id = ?').get(materialId);
    if (!mat) return res.status(404).json({ success: false, message: '材料不存在' });

    if (mat.preview_path || ['preparing', 'reviewing', 'ready', 'exported'].includes(mat.processing_status)) {
      return res.status(409).json({
        success: false,
        message: '该材料已进入 Markdown 复核流程，旧版导出已禁用。',
      });
    }

    const sourcePath = path.resolve(path.join(__dirname, '..', mat.stored_path));
    if (!sourcePath.startsWith(path.resolve(uploadsDir))) {
      return res.status(403).json({ success: false, message: '非法材料路径' });
    }

    let manualRedactions = [];
    try {
      manualRedactions = JSON.parse(mat.manual_redactions_json || '[]');
    } catch {
      manualRedactions = [];
    }

    let sourceForRedaction = sourcePath;
    let workingSourcePath = null;
    if (['.txt', '.md'].includes(String(mat.ext).toLowerCase()) && mat.working_text) {
      workingSourcePath = path.join(
        path.dirname(sourcePath),
        `${path.basename(sourcePath, mat.ext)}.working${mat.ext}`,
      );
      await fs.writeFile(workingSourcePath, mat.working_text, 'utf-8');
      sourceForRedaction = workingSourcePath;
    }

    let result;
    try {
      result = await redactNativeDocument(sourceForRedaction, 'strict', {}, manualRedactions);
    } finally {
      if (workingSourcePath) await fs.unlink(workingSourcePath).catch(() => {});
    }
    if (!result.audit?.residualScanPassed) {
      return res.status(409).json({ success: false, message: '导出后敏感信息复检未通过' });
    }

    const relativeRedactedPath = path.relative(path.join(__dirname, '..'), result.redactedPath);
    db.prepare(`
      UPDATE "material"
      SET redacted_md = ?, map_json = ?, occurrences_json = ?,
          redacted_path = ?, audit_json = ?, redact_status = 'done'
      WHERE id = ?
    `).run(
      result.redactedText || mat.redacted_md || '',
      JSON.stringify(result.mapData || {}),
      JSON.stringify(result.occurrences || []),
      relativeRedactedPath,
      JSON.stringify(result.auditData || {}),
      materialId,
    );

    await writeAuditLog({
      case_id: mat.case_id,
      action: 'redacted_export',
      source: 'legal-desens',
      model_config: {
        format: path.extname(sourcePath).slice(1),
        residualScanPassed: true,
        manualRedactionCount: manualRedactions.length,
      },
      human_confirmed: 1,
    });

    const ext = path.extname(mat.filename);
    const safeBase = path.basename(mat.filename, ext).replace(/[^\p{L}\p{N}._-]+/gu, '-');
    const downloadName = `${safeBase || 'document'}.redacted${ext}`;
    res.download(result.redactedPath, downloadName);
  } catch (error) {
    console.error('Export Native Redacted Error:', error);
    res.status(500).json({ success: false, message: '原格式脱敏导出失败', error: error.message });
  }
});

/**
 * POST /api/export/redacted-docx - 导出脱敏材料为 .docx
 */
router.post('/export/redacted-docx', async (req, res) => {
  try {
    const { materialId } = req.body;
    if (!materialId) {
      return res.status(400).json({ success: false, message: '缺少材料 ID' });
    }

    const { default: db } = await import('./db/index.js');
    const mat = db.prepare('SELECT * FROM "material" WHERE id = ?').get(parseInt(materialId, 10));
    if (!mat) {
      return res.status(404).json({ success: false, message: '材料不存在' });
    }

    if (!mat.redacted_md) {
      return res.status(400).json({ success: false, message: '该材料尚未完成脱敏，无法导出' });
    }

    // 动态导入 docx 库
    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');

    // 将 redacted markdown 按行拆分为段落
    const lines = mat.redacted_md.split('\n');
    const children = lines.map(line => {
      if (line.startsWith('# ')) {
        return new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: line.substring(2), bold: true, size: 32 })],
        });
      }
      if (line.startsWith('## ')) {
        return new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: line.substring(3), bold: true, size: 28 })],
        });
      }
      if (line.startsWith('### ')) {
        return new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: [new TextRun({ text: line.substring(4), bold: true, size: 24 })],
        });
      }
      if (line.startsWith('---')) {
        return new Paragraph({
          children: [new TextRun({ text: '─'.repeat(50), color: 'CCCCCC' })],
        });
      }
      return new Paragraph({
        children: [new TextRun({ text: line || ' ', size: 24 })],
      });
    });

    const doc = new Document({
      sections: [{
        properties: {},
        children,
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    const exportFilename = `redacted-${mat.filename.replace(/\.[^.]+$/, '')}-${Date.now()}.docx`;
    const exportPath = path.join(exportsDir, exportFilename);
    await fs.writeFile(exportPath, buffer);

    res.download(exportPath, exportFilename);
  } catch (error) {
    console.error('Export Redacted Docx Error:', error);
    res.status(500).json({ success: false, message: '导出脱敏文档失败', error: error.message });
  }
});

/**
 * POST /api/export/opinion-docx - 导出意见书为 .docx（仅限已确认）
 */
router.post('/export/opinion-docx', async (req, res) => {
  try {
    const { opinionId } = req.body;
    if (!opinionId) {
      return res.status(400).json({ success: false, message: '缺少意见书 ID' });
    }

    const { default: db } = await import('./db/index.js');
    const opinion = db.prepare('SELECT * FROM "opinion" WHERE id = ?').get(parseInt(opinionId, 10));
    if (!opinion) {
      return res.status(404).json({ success: false, message: '意见书不存在' });
    }

    // AGENTS.md 铁律：未确认不得对外导出
    if (opinion.status !== 'confirmed') {
      return res.status(403).json({ success: false, message: '意见书尚未人工确认，不得对外导出' });
    }

    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');

    const lines = opinion.content_md.split('\n');
    const children = lines.map(line => {
      if (line.startsWith('# ')) {
        return new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: line.substring(2), bold: true, size: 32 })],
        });
      }
      if (line.startsWith('## ')) {
        return new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: line.substring(3), bold: true, size: 28 })],
        });
      }
      if (line.startsWith('### ')) {
        return new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: [new TextRun({ text: line.substring(4), bold: true, size: 24 })],
        });
      }
      if (line.startsWith('---')) {
        return new Paragraph({
          children: [new TextRun({ text: '─'.repeat(50), color: 'CCCCCC' })],
        });
      }
      if (line.startsWith('|')) {
        return new Paragraph({
          children: [new TextRun({ text: line, size: 20, font: 'Courier New' })],
        });
      }
      return new Paragraph({
        children: [new TextRun({ text: line || ' ', size: 24 })],
      });
    });

    const doc = new Document({
      sections: [{
        properties: {},
        children,
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    const exportFilename = `opinion-${opinion.case_id}-${Date.now()}.docx`;
    const exportPath = path.join(exportsDir, exportFilename);
    await fs.writeFile(exportPath, buffer);

    res.download(exportPath, exportFilename);
  } catch (error) {
    console.error('Export Opinion Docx Error:', error);
    res.status(500).json({ success: false, message: '导出意见书失败', error: error.message });
  }
});

// #endregion

// #region 诊断 API（只读）

/**
 * GET /api/diagnostics - 引擎诊断信息（只读，单字段失败返回 unknown，整体仍 200）
 */
router.get('/diagnostics', async (req, res) => {
  const UNKNOWN = 'unknown';
  const result = {
    binPath: UNKNOWN,
    installedVersion: UNKNOWN,
    pinnedCommit: UNKNOWN,
    nerEnabled: UNKNOWN,
    modelDir: UNKNOWN,
    rulesPath: UNKNOWN,
    defaultRules: UNKNOWN,
  };

  // binPath
  try {
    result.binPath = resolveLegalDesensBin();
  } catch {}

  // installedVersion via pip show
  try {
    const bin = result.binPath !== UNKNOWN ? result.binPath : null;
    if (bin) {
      const { stdout } = await execFileAsync(bin, ['--version'], { timeout: 5000, encoding: 'utf-8' });
      // legal-desens --version 输出格式可能不同，尝试多种解析
      const verMatch = stdout.match(/(\d+\.\d+[\.\d]*)/);
      result.installedVersion = verMatch ? verMatch[1] : stdout.trim() || UNKNOWN;
    }
  } catch {
    // fallback: try pip show
    try {
      const { stdout } = await execFileAsync('pip3', ['show', 'legal-desens'], { timeout: 5000, encoding: 'utf-8' });
      const verMatch = stdout.match(/Version:\s*(.+)/i);
      result.installedVersion = verMatch ? verMatch[1].trim() : UNKNOWN;
    } catch {}
  }

  // pinnedCommit from requirements-engine.txt
  try {
    const reqPath = path.join(__dirname, '..', '..', 'requirements-engine.txt');
    const content = await fs.readFile(reqPath, 'utf-8');
    const commitMatch = content.match(/@([a-f0-9]{7,40})#/);
    result.pinnedCommit = commitMatch ? commitMatch[1] : UNKNOWN;
  } catch {}

  // nerEnabled
  try {
    result.nerEnabled = getIsNerEnabled();
  } catch {}

  // modelDir: 优先从 ner-inspect 获取真实模型路径
  try {
    const bin = result.binPath !== UNKNOWN ? result.binPath : null;
    if (bin) {
      const { stdout: nerOut } = await execFileAsync(bin, ['ner-inspect'], { timeout: 10000, encoding: 'utf-8' });
      const nerData = JSON.parse(nerOut);
      result.modelDir = nerData.model_dir || nerData.modelDir || UNKNOWN;
    }
  } catch {
    // ner-inspect 失败（模型未安装），modelDir 保持 unknown
  }

  // rulesPath
  try {
    const bin = result.binPath !== UNKNOWN ? result.binPath : null;
    if (bin) {
      const { stdout } = await execFileAsync(bin, ['paths', '--json'], { timeout: 10000, encoding: 'utf-8' });
      const parsed = JSON.parse(stdout);
      result.rulesPath = parsed.rules || UNKNOWN;
    }
  } catch {}

  // rulesPath fallback
  if (result.rulesPath === UNKNOWN) {
    try {
      result.rulesPath = getRulesPath();
    } catch {}
  }

  // defaultRules - 读取 rules.json
  try {
    if (result.rulesPath !== UNKNOWN) {
      const rulesContent = await fs.readFile(result.rulesPath, 'utf-8');
      const rules = JSON.parse(rulesContent);
      // 提取关键规则的启用状态（尤其是 DATE/TIME）
      if (Array.isArray(rules)) {
        result.defaultRules = {};
        for (const rule of rules) {
          if (rule.id && rule.enabled !== undefined) {
            result.defaultRules[rule.id] = rule.enabled;
          }
        }
      } else if (typeof rules === 'object') {
        result.defaultRules = rules;
      }
    }
  } catch {}

  res.json({ success: true, data: result });
});

// #endregion

// #region 工具模式 API（脱敏/还原/历史/规则）

import { createTask, getTaskList, getTaskById, deleteTask, updateTask } from './db/taskRepo.js';
import { getAllRules, getRulesByCategory, createRule, updateRule, deleteRule } from './db/ruleRepo.js';

/**
 * 将引擎默认规则 + DB 自定义规则/强制脱敏词合并，写入临时 rules 文件。
 * 保留词库不写入 rules：legal-desens 的 rules.json 只表达“检测候选”，
 * 保留语义由工作台在 prepare 后过滤候选完成。
 * @returns {Promise<string>} 临时 rules 文件路径
 */
async function buildMergedRulesFile(workDir) {
  const { resolveLegalDesensBin } = await import('./services/cliResolver.js');
  const { execFile: execFileCb } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFileCb);
  const bin = resolveLegalDesensBin();

  // 读取引擎默认规则
  let engineRules = [];
  try {
    const { stdout } = await execFileAsync(bin, ['paths', '--json'], { timeout: 10000 });
    const paths = JSON.parse(stdout);
    if (paths.rules && existsSync(paths.rules)) {
      engineRules = JSON.parse(await fs.readFile(paths.rules, 'utf-8'));
    }
  } catch {
    // fallback: 尝试 getRulesPath
    try {
      const { getRulesPath } = await import('./services/cliResolver.js');
      const rp = getRulesPath();
      if (rp && existsSync(rp)) engineRules = JSON.parse(await fs.readFile(rp, 'utf-8'));
    } catch { /* ignore */ }
  }

  // 读取 DB 中的自定义规则 + 强制脱敏词
  let dbRules = [];
  try {
    dbRules = getAllRules().filter(r => r.is_active && r.regex && r.category !== 'whitelist');
  } catch { /* ignore */ }

  // 合并：DB 规则作为附加规则条目
  for (const r of dbRules) {
    try {
      new RegExp(r.regex); // 验证正则合法性
    } catch { continue; } // 跳过不合法正则

    const category = r.category || 'custom';
    if (category === 'blacklist') {
      // 强制脱敏词：作为高优先级检测规则，命中后一定进入候选
      engineRules.push({
        id: `db_force_${r.id}`,
        name: r.name || `强制脱敏词 #${r.id}`,
        entity_type: r.token_prefix || 'FORCE',
        label_prefix: r.description || '强制脱敏',
        pattern: r.regex,
        enabled: true,
        priority: 10000,
      });
    } else {
      // 自定义规则：作为普通检测规则
      engineRules.push({
        id: `db_custom_${r.id}`,
        name: r.name || `自定义 #${r.id}`,
        entity_type: r.token_prefix || 'CUSTOM',
        label_prefix: r.description || '自定义规则',
        pattern: r.regex,
        enabled: true,
        priority: 500,
      });
    }
  }

  const mergedPath = path.join(workDir, 'merged-rules.json');
  await fs.writeFile(mergedPath, JSON.stringify(engineRules, null, 2), 'utf-8');
  return mergedPath;
}

function activeWhitelistMatchers() {
  try {
    return getRulesByCategory('whitelist')
      .filter(r => r.is_active && r.regex)
      .map((rule) => {
        try {
          return { id: rule.id, re: new RegExp(rule.regex) };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function candidateText(candidate, blocksById) {
  if (candidate.original || candidate.text) return candidate.original || candidate.text;
  const blockText = blocksById.get(candidate.blockId) || '';
  if (
    Number.isInteger(candidate.start) &&
    Number.isInteger(candidate.end) &&
    candidate.start >= 0 &&
    candidate.end >= candidate.start
  ) {
    return blockText.slice(candidate.start, candidate.end);
  }
  return '';
}

function applyWhitelistToManifest(manifest) {
  const matchers = activeWhitelistMatchers();
  if (!matchers.length || !Array.isArray(manifest?.candidates)) return manifest;

  const blocksById = new Map((manifest.blocks || []).map((block) => [block.id, block.text || '']));
  const candidates = manifest.candidates.filter((candidate) => {
    const text = candidateText(candidate, blocksById);
    return !text || !matchers.some(({ re }) => re.test(text));
  });

  return { ...manifest, candidates };
}

/**
 * POST /api/tasks - 上传文件 + 自动 prepare + 返回 candidates/preview
 */
router.post('/tasks', upload.single('file'), async (req, res) => {
  let tempDir = null;
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '请上传文件' });

    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(originalName).toLowerCase();
    const tmpPath = req.file.path;

    if (!['.docx', '.pdf', '.txt', '.md'].includes(ext)) {
      await fs.unlink(tmpPath).catch(() => {});
      return res.status(400).json({ success: false, message: '仅支持 DOCX、PDF、TXT、MD 文件' });
    }

    // 验证文件签名
    const handle = await fs.open(tmpPath, 'r');
    const signature = Buffer.alloc(4);
    try { await handle.read(signature, 0, 4, 0); } finally { await handle.close(); }
    const validSig = ext === '.pdf'
      ? signature.toString('ascii') === '%PDF'
      : ['.txt', '.md'].includes(ext) || (signature[0] === 0x50 && signature[1] === 0x4b);
    if (!validSig) {
      await fs.unlink(tmpPath).catch(() => {});
      return res.status(400).json({ success: false, message: '文件内容与扩展名不匹配' });
    }

    // 移动到 uploads/tasks/ 目录
    const tasksDir = path.join(uploadsDir, 'tasks');
    if (!existsSync(tasksDir)) mkdirSync(tasksDir, { recursive: true });
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const newFilename = `${uniqueSuffix}-${originalName}`;
    const finalPath = path.join(tasksDir, newFilename);
    await fs.rename(tmpPath, finalPath);

    // 解析 rulesConfig（FormData 中是 JSON 字符串）
    let rulesConfig = {};
    try {
      rulesConfig = typeof req.body?.rulesConfig === 'string'
        ? JSON.parse(req.body.rulesConfig)
        : (req.body?.rulesConfig || {});
    } catch { rulesConfig = {}; }

    const { resolveLegalDesensBin } = await import('./services/cliResolver.js');
    const legalDesensBin = resolveLegalDesensBin();

    tempDir = path.join(tasksDir, `.tmp_${Date.now()}`);
    if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });

    const tempPreview = path.join(tempDir, 'preview.md');
    const tempManifest = path.join(tempDir, 'manifest.json');
    const tempSourceMap = path.join(tempDir, 'source-map.json');

    // 构建合并规则文件（引擎默认 + DB 自定义/黑名单/白名单）
    let mergedRulesPath = null;
    try {
      mergedRulesPath = await buildMergedRulesFile(tempDir);
    } catch (mergeErr) {
      console.warn('[WARN] 构建合并规则文件失败，使用引擎默认:', mergeErr.message);
    }

    const args = [];
    if (mergedRulesPath) args.push('--rules', mergedRulesPath);
    args.push(
      'prepare', finalPath,
      '--level', 'strict',
      '--preview-md', tempPreview,
      '--manifest', tempManifest,
      '--map', tempSourceMap,
    );

    const { getIsNerEnabled } = await import('./services/redactService.js');
    if (!getIsNerEnabled()) args.push('--regex-only');

    // entity-policy for date/time preservation
    const preserveTypes = [];
    const typeAliases = { LOC: ['ADDRESS'], DATE: ['DATE', 'TIME'] };
    for (const [type, enabled] of Object.entries(rulesConfig)) {
      if (enabled === false) preserveTypes.push(...(typeAliases[type] || [type]));
    }
    if (preserveTypes.length) {
      const policyPath = path.join(tempDir, 'entity-policy.json');
      await fs.writeFile(policyPath, JSON.stringify({ preserve_types: [...new Set(preserveTypes)] }), 'utf-8');
      args.push('--entity-policy', policyPath);
    }

    await execFileAsync(legalDesensBin, args, {
      timeout: parseInt(process.env.REDACT_TIMEOUT_MS || '120000', 10),
    });

    const manifest = applyWhitelistToManifest(JSON.parse(await fs.readFile(tempManifest, 'utf-8')));
    await fs.writeFile(tempManifest, JSON.stringify(manifest, null, 2), 'utf-8');
    const sourceMap = JSON.parse(await fs.readFile(tempSourceMap, 'utf-8'));
    const previewMd = await fs.readFile(tempPreview, 'utf-8');

    // 将 prepare 产物移到最终位置
    const workDir = path.join(tasksDir, `.work_${Date.now()}`);
    await fs.rename(tempDir, workDir);
    tempDir = null;

    // 写入 DB（服务端拥有任务生命周期）
    const task = createTask({
      filename: originalName,
      ext,
      document_kind: manifest.documentKind || '',
      entity_stats: null,
      source_path: finalPath,
      work_dir: workDir,
      manifest_path: path.join(workDir, 'manifest.json'),
      source_map_path: path.join(workDir, 'source-map.json'),
      rules_config: rulesConfig,
    });

    res.json({
      success: true,
      data: {
        taskId: task.id,
        filename: originalName,
        ext,
        documentKind: manifest.documentKind || '',
        blockCount: manifest.blocks?.length || 0,
        candidateCount: (manifest.candidates || []).length,
        previewMd,
        manifest,
        sourceMap,
      },
    });
  } catch (error) {
    console.error('Task Error:', error);
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    res.status(500).json({ success: false, message: '文档处理失败', error: error.message });
  }
});

/**
 * POST /api/tasks/:id/export - 按决策导出脱敏副本 + 残留审计 + 更新任务
 * 只接受 decisions，其余路径从 DB 读取
 */
router.post('/tasks/:id/export', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    const task = getTaskById(taskId);
    if (!task) return res.status(404).json({ success: false, message: '任务不存在' });

    const { decisions } = req.body;
    if (!decisions || !Array.isArray(decisions)) {
      return res.status(400).json({ success: false, message: '缺少 decisions' });
    }

    const filePath = task.source_path;
    if (!filePath || !existsSync(filePath)) {
      return res.status(409).json({ success: false, message: '源文件已丢失，请重新上传' });
    }

    // PDF sub-kind routing: pdf-text allowed, pdf-scan/pdf-hybrid blocked
    if (task.document_kind && task.document_kind.includes('pdf')) {
      if (task.document_kind === 'pdf-scan') {
        return res.status(501).json({ success: false, message: '扫描 PDF 按决策导出未支持（需要像素级多边形红action）' });
      }
      if (task.document_kind === 'pdf-hybrid') {
        return res.status(501).json({ success: false, message: '混合 PDF 按决策导出未支持（需要逐页混合管线）' });
      }
      // pdf-text is allowed — continue to export
    }

    const { resolveLegalDesensBin } = await import('./services/cliResolver.js');
    const legalDesensBin = resolveLegalDesensBin();

    // 使用已有的 work_dir 作为导出工作目录
    const workDir = task.work_dir || path.join(uploadsDir, 'tasks', `.export_${Date.now()}`);
    if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });

    const decisionsPath = path.join(workDir, 'decisions.json');
    const sourceMapPath = task.source_map_path || path.join(workDir, 'source-map.json');
    const exportPath = path.join(workDir, `redacted${path.extname(task.filename || '.docx')}`);
    const auditPath = path.join(workDir, 'export-audit.json');
    const mapPath = path.join(workDir, 'export-map.json');

    // 写 decisions
    await fs.writeFile(decisionsPath, JSON.stringify(decisions, null, 2), 'utf-8');

    // 如果 source-map 不在 work_dir 中，复制一份
    if (task.source_map_path && existsSync(task.source_map_path) && task.source_map_path !== sourceMapPath) {
      await fs.copyFile(task.source_map_path, sourceMapPath);
    }

    // 构建合并规则文件
    let mergedRulesPath = null;
    try {
      mergedRulesPath = await buildMergedRulesFile(workDir);
    } catch (mergeErr) {
      console.warn('[WARN] 导出时构建合并规则文件失败:', mergeErr.message);
    }

    // 调用 legal-desens redact --decisions
    const args = [];
    if (mergedRulesPath) args.push('--rules', mergedRulesPath);
    args.push(
      'redact', filePath,
      '--level', 'strict',
      '--decisions', decisionsPath,
      '--source-map', sourceMapPath,
      '--out', exportPath,
      '--map', mapPath,
      '--audit', auditPath,
    );

    const { getIsNerEnabled } = await import('./services/redactService.js');
    if (!getIsNerEnabled()) args.push('--regex-only');

    try {
      await execFileAsync(legalDesensBin, args, {
        timeout: parseInt(process.env.REDACT_TIMEOUT_MS || '120000', 10),
      });
    } catch (cliErr) {
      await fs.unlink(exportPath).catch(() => {});
      return res.status(500).json({ success: false, message: '决策导出 CLI 执行失败', error: cliErr.message });
    }

    // 残留复检
    let auditData = null;
    try {
      auditData = JSON.parse(await fs.readFile(auditPath, 'utf-8'));
    } catch {
      await fs.unlink(exportPath).catch(() => {});
      return res.status(500).json({ success: false, message: '无法读取审计文件，导出阻断' });
    }

    const residualPassed = auditData?.residual_scan?.passed === true;
    if (!residualPassed) {
      await fs.unlink(exportPath).catch(() => {});
      return res.status(409).json({ success: false, message: '残留扫描未通过，导出已阻断' });
    }

    // 更新 DB 任务记录（不新建，而是更新已有记录）
    const entityStats = {};
    for (const d of decisions) {
      if (d.action === 'redact') {
        const t = d.entityType || 'UNKNOWN';
        entityStats[t] = (entityStats[t] || 0) + 1;
      }
    }
    updateTask(taskId, {
      entity_stats: entityStats,
      export_path: path.relative(path.join(__dirname, '..'), exportPath),
      map_path: path.relative(path.join(__dirname, '..'), mapPath),
      audit_path: path.relative(path.join(__dirname, '..'), auditPath),
      residual_passed: true,
    });

    // 返回文件下载
    const downloadName = (task.filename || 'document').replace(/(\.[^.]+)?$/, '.redacted$1');
    res.download(exportPath, downloadName);
  } catch (error) {
    console.error('Task Export Error:', error);
    res.status(500).json({ success: false, message: '导出失败', error: error.message });
  }
});

// #endregion

// #region 视觉遮蔽模式 API（P1 遮蔽主干）

/**
 * POST /api/tasks/:id/analyze - OCR 分析 PDF，返回归一化文字框 + 公章检测
 */
router.post('/tasks/:id/analyze', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    const task = getTaskById(taskId);
    if (!task) return res.status(404).json({ success: false, message: '任务不存在' });

    const sourcePath = task.source_path;
    if (!sourcePath || !existsSync(sourcePath)) {
      return res.status(409).json({ success: false, message: '源文件已丢失' });
    }

    const { resolveLegalDesensBin } = await import('./services/cliResolver.js');
    const bin = resolveLegalDesensBin();

    const workDir = task.work_dir || path.join(uploadsDir, 'tasks', `.work_${Date.now()}`);
    if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });

    const analyzeOut = path.join(workDir, 'analyze.json');
    const sealOut = path.join(workDir, 'seals.json');

    // Run OCR analyze
    await execFileAsync(bin, ['analyze', sourcePath, '--out', analyzeOut], {
      timeout: parseInt(process.env.REDACT_TIMEOUT_MS || '120000', 10),
    });

    const analyzeData = JSON.parse(await fs.readFile(analyzeOut, 'utf-8'));

    // Run seal detection (best-effort, don't fail if it errors)
    let sealBoxes = [];
    try {
      await execFileAsync(bin, ['detect-seals', sourcePath, '--out', sealOut], {
        timeout: 60000,
      });
      const sealData = JSON.parse(await fs.readFile(sealOut, 'utf-8'));
      sealBoxes = (sealData.seals || []).map((s, i) => ({
        id: `seal_${i}`,
        page: s.page,
        x: s.x, y: s.y, width: s.width, height: s.height,
        source: 'seal',
        confidence: s.confidence,
        areaRatio: s.area_ratio,
      }));
    } catch (sealErr) {
      console.warn('Seal detection failed (non-fatal):', sealErr.message);
    }

    res.json({
      success: true,
      data: {
        ocrBoxes: analyzeData.ocrBoxes || [],
        sealBoxes,
        manifest: analyzeData.manifest || {},
      },
    });
  } catch (error) {
    console.error('Analyze Error:', error);
    res.status(500).json({ success: false, message: 'OCR 分析失败', error: error.message });
  }
});

/**
 * PATCH /api/tasks/:id/boxes - 更新任务的遮蔽框列表
 */
router.patch('/tasks/:id/boxes', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    const task = getTaskById(taskId);
    if (!task) return res.status(404).json({ success: false, message: '任务不存在' });

    const { boxes } = req.body;
    if (!Array.isArray(boxes)) {
      return res.status(400).json({ success: false, message: 'boxes 必须是数组' });
    }

    // Validate boxes
    for (const box of boxes) {
      if (typeof box.x !== 'number' || typeof box.y !== 'number' ||
          typeof box.width !== 'number' || typeof box.height !== 'number' ||
          typeof box.page !== 'number') {
        return res.status(400).json({ success: false, message: '框缺少必要字段 (page, x, y, width, height)' });
      }
      if (box.x < 0 || box.x > 1 || box.y < 0 || box.y > 1 ||
          box.width <= 0 || box.width > 1 || box.height <= 0 || box.height > 1) {
        return res.status(400).json({ success: false, message: '坐标必须在 [0,1] 范围内' });
      }
      if (box.x + box.width > 1 || box.y + box.height > 1) {
        return res.status(400).json({ success: false, message: '遮蔽框不能超出页面边界' });
      }
    }

    // Save boxes to work_dir
    const workDir = task.work_dir || path.join(uploadsDir, 'tasks', `.work_${taskId}`);
    if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });
    const boxesPath = path.join(workDir, 'boxes.json');
    await fs.writeFile(boxesPath, JSON.stringify(boxes, null, 2), 'utf-8');

    res.json({ success: true, data: { count: boxes.length, boxesPath } });
  } catch (error) {
    console.error('Boxes Update Error:', error);
    res.status(500).json({ success: false, message: '更新框失败', error: error.message });
  }
});

/**
 * POST /api/tasks/:id/mask-export - 导出遮蔽 PDF
 */
router.post('/tasks/:id/mask-export', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    const task = getTaskById(taskId);
    if (!task) return res.status(404).json({ success: false, message: '任务不存在' });

    const sourcePath = task.source_path;
    if (!sourcePath || !existsSync(sourcePath)) {
      return res.status(409).json({ success: false, message: '源文件已丢失，请重新上传' });
    }

    const { boxes } = req.body;
    if (!Array.isArray(boxes) || boxes.length === 0) {
      return res.status(400).json({ success: false, message: '缺少遮蔽框' });
    }
    for (const box of boxes) {
      if (typeof box.x !== 'number' || typeof box.y !== 'number' ||
          typeof box.width !== 'number' || typeof box.height !== 'number' ||
          typeof box.page !== 'number') {
        return res.status(400).json({ success: false, message: '框缺少必要字段 (page, x, y, width, height)' });
      }
      if (box.x < 0 || box.x > 1 || box.y < 0 || box.y > 1 ||
          box.width <= 0 || box.width > 1 || box.height <= 0 || box.height > 1 ||
          box.x + box.width > 1 || box.y + box.height > 1) {
        return res.status(400).json({ success: false, message: '遮蔽框坐标非法或超出页面边界' });
      }
    }

    const { resolveLegalDesensBin } = await import('./services/cliResolver.js');
    const bin = resolveLegalDesensBin();

    const workDir = task.work_dir || path.join(uploadsDir, 'tasks', `.work_${taskId}`);
    if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });

    // Write boxes to temp file
    const boxesPath = path.join(workDir, 'mask-boxes.json');
    await fs.writeFile(boxesPath, JSON.stringify(boxes, null, 2), 'utf-8');

    const exportPath = path.join(workDir, 'masked.pdf');
    const auditPath = path.join(workDir, 'mask-audit.json');

    const docKind = task.document_kind || 'pdf-text';
    const args = [
      'mask-export', sourcePath,
      '--boxes', boxesPath,
      '--out', exportPath,
      '--document-kind', docKind,
      '--audit', auditPath,
    ];

    // Add merged rules file (system + custom + blacklist)
    let mergedRulesPath = null;
    try {
      mergedRulesPath = await buildMergedRulesFile(workDir);
      if (mergedRulesPath) args.push('--rules', mergedRulesPath);
    } catch (mergeErr) {
      console.warn('[WARN] 构建合并规则文件失败，使用引擎默认:', mergeErr.message);
    }

    // Add denylist (forced redaction words)
    let denylistPath = null;
    try {
      const blacklistRules = getRulesByCategory('blacklist').filter(r => r.is_active && r.regex);
      if (blacklistRules.length > 0) {
        denylistPath = path.join(workDir, 'denylist.txt');
        await fs.writeFile(denylistPath, blacklistRules.map(r => r.regex).join('\n'), 'utf-8');
        args.push('--denylist', denylistPath);
      }
    } catch (denyErr) {
      console.warn('[WARN] 构建 denylist 失败:', denyErr.message);
    }

    try {
      await execFileAsync(bin, args, {
        timeout: parseInt(process.env.REDACT_TIMEOUT_MS || '120000', 10),
      });
    } catch (cliErr) {
      await fs.unlink(exportPath).catch(() => {});
      return res.status(500).json({ success: false, message: '遮蔽导出失败', error: cliErr.message });
    }

    // Verify audit passed. Missing/malformed audit must fail closed.
    let auditData = null;
    try {
      auditData = JSON.parse(await fs.readFile(auditPath, 'utf-8'));
    } catch {
      await fs.unlink(exportPath).catch(() => {});
      return res.status(500).json({ success: false, message: '无法读取遮蔽审计文件，导出阻断' });
    }

    const passed = auditData?.verification?.passed === true;
    if (!passed) {
      await fs.unlink(exportPath).catch(() => {});
      return res.status(409).json({ success: false, message: '遮蔽验证未通过' });
    }

    // Update task record
    const entityStats = {};
    for (const box of boxes) {
      const src = box.source || 'manual';
      entityStats[src] = (entityStats[src] || 0) + 1;
    }
    updateTask(taskId, {
      entity_stats: entityStats,
      export_path: path.relative(path.join(__dirname, '..'), exportPath),
      residual_passed: true,
    });

    const downloadName = (task.filename || 'document').replace(/(\.[^.]+)?$/, '.masked$1');
    res.download(exportPath, downloadName);
  } catch (error) {
    console.error('Mask Export Error:', error);
    res.status(500).json({ success: false, message: '遮蔽导出失败', error: error.message });
  }
});

/**
 * GET /api/tasks/:id/page-image/:pageNum - 获取任务的页面图像
 */
router.get('/tasks/:id/page-image/:pageNum', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    const pageNum = parseInt(req.params.pageNum, 10);
    const task = getTaskById(taskId);
    if (!task) return res.status(404).json({ success: false, message: '任务不存在' });

    const sourcePath = task.source_path;
    if (!sourcePath || !existsSync(sourcePath)) {
      return res.status(409).json({ success: false, message: '源文件已丢失' });
    }

    // Render the specific page on-demand
    const { resolveLegalDesensBin } = await import('./services/cliResolver.js');
    const bin = resolveLegalDesensBin();

    const workDir = task.work_dir || path.join(uploadsDir, 'tasks', `.work_${taskId}`);
    const pagesDir = path.join(workDir, 'pages');
    if (!existsSync(pagesDir)) mkdirSync(pagesDir, { recursive: true });

    const manifestPath = path.join(workDir, 'render-manifest.json');

    // Check if we already have a render manifest
    let manifest = null;
    try {
      manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
    } catch {
      // Need to render
      await execFileAsync(bin, ['render-pages', sourcePath, '--dpi', '200', '--out-dir', pagesDir, '--out', manifestPath], {
        timeout: 60000,
      });
      manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
    }

    const pageMeta = manifest.pages?.[pageNum - 1];
    if (!pageMeta) return res.status(404).json({ success: false, message: `页面 ${pageNum} 不存在` });

    const imagePath = pageMeta.imagePath;
    if (!imagePath || !existsSync(imagePath)) {
      return res.status(404).json({ success: false, message: '页面图像未生成' });
    }

    res.sendFile(imagePath);
  } catch (error) {
    console.error('Page Image Error:', error);
    res.status(500).json({ success: false, message: '获取页面图像失败', error: error.message });
  }
});

/**
 * POST /api/tasks/:id/text-export - 文本替换导出（星号/占位）
 */
router.post('/tasks/:id/text-export', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    const task = getTaskById(taskId);
    if (!task) return res.status(404).json({ success: false, message: '任务不存在' });

    const sourcePath = task.source_path;
    if (!sourcePath || !existsSync(sourcePath)) {
      return res.status(409).json({ success: false, message: '源文件已丢失' });
    }

    const { entities, mode, format } = req.body;
    if (!entities || !Array.isArray(entities)) {
      return res.status(400).json({ success: false, message: '缺少 entities' });
    }
    if (!['star', 'placeholder'].includes(mode)) {
      return res.status(400).json({ success: false, message: 'mode 必须是 star 或 placeholder' });
    }
    if (!['txt', 'md', 'docx'].includes(format)) {
      return res.status(400).json({ success: false, message: 'format 必须是 txt、md 或 docx' });
    }

    const { resolveLegalDesensBin } = await import('./services/cliResolver.js');
    const bin = resolveLegalDesensBin();

    const workDir = task.work_dir || path.join(uploadsDir, 'tasks', `.work_${taskId}`);
    if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });

    // Write entities to temp file
    const entitiesPath = path.join(workDir, 'text-entities.json');
    await fs.writeFile(entitiesPath, JSON.stringify(entities, null, 2), 'utf-8');

    const ext = `.${format}`;
    const exportPath = path.join(workDir, `replaced${ext}`);

    const args = [
      'text-export', sourcePath,
      '--entities', entitiesPath,
      '--out', exportPath,
      '--mode', mode,
      '--format', format,
    ];

    // For PDF sources, we need OCR text
    const sourceExt = path.extname(sourcePath).toLowerCase();
    if (sourceExt === '.pdf') {
      // Run analyze to get OCR text
      const analyzeOut = path.join(workDir, 'analyze.json');
      try {
        await execFileAsync(bin, ['analyze', sourcePath, '--out', analyzeOut], {
          timeout: 120000,
        });
        const analyzeData = JSON.parse(await fs.readFile(analyzeOut, 'utf-8'));
        const ocrText = (analyzeData.ocrBoxes || []).map(b => b.text).join('\n');
        const ocrPath = path.join(workDir, 'ocr-text.txt');
        await fs.writeFile(ocrPath, ocrText, 'utf-8');
        args.push('--ocr-text', ocrPath);
      } catch (analyzeErr) {
        return res.status(500).json({ success: false, message: 'PDF OCR 分析失败', error: analyzeErr.message });
      }
    }

    // Add merged rules file
    let mergedRulesPath = null;
    try {
      mergedRulesPath = await buildMergedRulesFile(workDir);
      if (mergedRulesPath) args.push('--rules', mergedRulesPath);
    } catch (mergeErr) {
      console.warn('[WARN] 构建合并规则文件失败:', mergeErr.message);
    }

    // Add denylist (forced redaction words)
    try {
      const blacklistRules = getRulesByCategory('blacklist').filter(r => r.is_active && r.regex);
      if (blacklistRules.length > 0) {
        const denylistPath = path.join(workDir, 'denylist.txt');
        await fs.writeFile(denylistPath, blacklistRules.map(r => r.regex).join('\n'), 'utf-8');
        args.push('--denylist', denylistPath);
      }
    } catch (denyErr) {
      console.warn('[WARN] 构建 denylist 失败:', denyErr.message);
    }

    // Add whitelist (never-redact words)
    try {
      const whitelistRules = getRulesByCategory('whitelist').filter(r => r.is_active && r.regex);
      if (whitelistRules.length > 0) {
        const whitelistPath = path.join(workDir, 'whitelist.txt');
        await fs.writeFile(whitelistPath, whitelistRules.map(r => r.regex).join('\n'), 'utf-8');
        args.push('--whitelist', whitelistPath);
      }
    } catch (wlErr) {
      console.warn('[WARN] 构建 whitelist 失败:', wlErr.message);
    }

    try {
      await execFileAsync(bin, args, {
        timeout: parseInt(process.env.REDACT_TIMEOUT_MS || '120000', 10),
      });
    } catch (cliErr) {
      return res.status(500).json({ success: false, message: '文本替换导出失败', error: cliErr.message });
    }

    if (!existsSync(exportPath)) {
      return res.status(500).json({ success: false, message: '导出文件未生成' });
    }

    // Update task
    updateTask(taskId, {
      export_path: path.relative(path.join(__dirname, '..'), exportPath),
      residual_passed: true,
    });

    const downloadName = (task.filename || 'document').replace(/(\.[^.]+)?$/, `.replaced${ext}`);
    res.download(exportPath, downloadName);
  } catch (error) {
    console.error('Text Export Error:', error);
    res.status(500).json({ success: false, message: '文本替换导出失败', error: error.message });
  }
});

/**
 * POST /api/batch - 批量上传文件并创建任务
 */
router.post('/batch', upload.array('files', 20), async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, message: '请上传文件' });
    }

    const results = [];
    for (const file of files) {
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const ext = path.extname(originalName).toLowerCase();

      if (!['.docx', '.pdf', '.txt', '.md'].includes(ext)) {
        await fs.unlink(file.path).catch(() => {});
        results.push({ filename: originalName, success: false, error: '不支持的文件格式' });
        continue;
      }

      // Move to tasks dir
      const tasksDir = path.join(uploadsDir, 'tasks');
      if (!existsSync(tasksDir)) mkdirSync(tasksDir, { recursive: true });
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const newFilename = `${uniqueSuffix}-${originalName}`;
      const finalPath = path.join(tasksDir, newFilename);
      await fs.rename(file.path, finalPath);

      // Create task
      const task = createTask({
        filename: originalName,
        ext,
        document_kind: ext === '.pdf' ? 'pdf-text' : ext.replace('.', ''),
        source_path: finalPath,
      });

      results.push({ taskId: task.id, filename: originalName, success: true });
    }

    res.json({ success: true, data: results });
  } catch (error) {
    console.error('Batch Upload Error:', error);
    res.status(500).json({ success: false, message: '批量上传失败', error: error.message });
  }
});

// #endregion

/**
 * GET /api/history - 任务历史列表
 */
router.get('/history', (req, res) => {
  try {
    const tasks = getTaskList();
    res.json({ success: true, data: tasks });
  } catch (error) {
    console.error('History Error:', error);
    res.status(500).json({ success: false, message: '获取历史失败', error: error.message });
  }
});

/**
 * GET /api/history/:id - 任务详情
 */
router.get('/history/:id', (req, res) => {
  try {
    const task = getTaskById(parseInt(req.params.id, 10));
    if (!task) return res.status(404).json({ success: false, message: '任务不存在' });
    res.json({ success: true, data: task });
  } catch (error) {
    console.error('History Detail Error:', error);
    res.status(500).json({ success: false, message: '获取详情失败', error: error.message });
  }
});

/**
 * GET /api/history/:id/download - 重新下载已导出的脱敏文件
 */
router.get('/history/:id/download', (req, res) => {
  try {
    const task = getTaskById(parseInt(req.params.id, 10));
    if (!task) return res.status(404).json({ success: false, message: '任务不存在' });
    if (!task.export_path || !task.residual_passed) {
      return res.status(409).json({ success: false, message: '此任务尚无可下载的脱敏文件' });
    }

    const backendRoot = path.resolve(__dirname, '..');
    const exportPath = path.isAbsolute(task.export_path)
      ? path.resolve(task.export_path)
      : path.resolve(backendRoot, task.export_path);

    if (!exportPath.startsWith(`${backendRoot}${path.sep}`)) {
      return res.status(403).json({ success: false, message: '导出文件路径非法' });
    }
    if (!existsSync(exportPath)) {
      return res.status(404).json({ success: false, message: '脱敏文件不存在，可能已被清理' });
    }

    const downloadName = (task.filename || 'document').replace(/(\.[^.]+)?$/, '.redacted$1');
    res.download(exportPath, downloadName);
  } catch (error) {
    console.error('History Download Error:', error);
    res.status(500).json({ success: false, message: '下载失败', error: error.message });
  }
});

/**
 * DELETE /api/history/:id - 删除历史记录 + 清理关联文件
 */
router.delete('/history/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const task = getTaskById(id);
    if (task) {
      // 清理 export/map/audit 文件（敏感残留）
      const basePath = path.join(__dirname, '..');
      for (const filePath of [task.export_path, task.map_path, task.audit_path]) {
        if (filePath) {
          const abs = path.isAbsolute(filePath) ? filePath : path.resolve(basePath, filePath);
          await fs.unlink(abs).catch(() => {});
        }
      }
      // 清理 work_dir（含 source-map、manifest、原始文件等）
      if (task.work_dir) {
        const absWork = path.isAbsolute(task.work_dir) ? task.work_dir : path.resolve(basePath, task.work_dir);
        await fs.rm(absWork, { recursive: true, force: true }).catch(() => {});
      }
      // 清理 source_path（上传原件）
      if (task.source_path) {
        const absSrc = path.isAbsolute(task.source_path) ? task.source_path : path.resolve(basePath, task.source_path);
        await fs.unlink(absSrc).catch(() => {});
      }
    }
    deleteTask(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete History Error:', error);
    res.status(500).json({ success: false, message: '删除失败', error: error.message });
  }
});

/**
 * POST /api/restore - 还原脱敏文件（仅可逆格式）
 */
router.post('/restore', upload.fields([
  { name: 'redactedFile', maxCount: 1 },
  { name: 'mapFile', maxCount: 1 },
]), async (req, res) => {
  try {
    const redactedFile = req.files?.redactedFile?.[0];
    const mapFile = req.files?.mapFile?.[0];
    if (!redactedFile || !mapFile) {
      return res.status(400).json({ success: false, message: '请上传脱敏文件和 map.json' });
    }

    const ext = path.extname(redactedFile.originalname).toLowerCase();
    if (!['.txt', '.md', '.csv', '.docx', '.xlsx'].includes(ext)) {
      await fs.unlink(redactedFile.path).catch(() => {});
      await fs.unlink(mapFile.path).catch(() => {});
      return res.status(400).json({ success: false, message: '仅支持 txt/md/csv/docx/xlsx 还原' });
    }

    const { resolveLegalDesensBin } = await import('./services/cliResolver.js');
    const bin = resolveLegalDesensBin();

    const restoreDir = path.join(uploadsDir, 'restore');
    if (!existsSync(restoreDir)) mkdirSync(restoreDir, { recursive: true });
    const outPath = path.join(restoreDir, `restored-${Date.now()}${ext}`);

    const args = [
      'restore', redactedFile.path,
      '--map', mapFile.path,
      '--out', outPath,
    ];

    try {
      await execFileAsync(bin, args, { timeout: 60000 });
    } catch (cliErr) {
      await fs.unlink(redactedFile.path).catch(() => {});
      await fs.unlink(mapFile.path).catch(() => {});
      return res.status(409).json({ success: false, message: '还原失败（文件不匹配或格式错误）', error: cliErr.message });
    }

    // 清理上传临时文件
    await fs.unlink(redactedFile.path).catch(() => {});
    await fs.unlink(mapFile.path).catch(() => {});

    const downloadName = redactedFile.originalname.replace(/(\.[^.]+)?$/, '.restored$1');
    res.download(outPath, downloadName, async () => {
      // 下载完成后清理还原产物（敏感残留）
      await fs.unlink(outPath).catch(() => {});
    });
  } catch (error) {
    console.error('Restore Error:', error);
    res.status(500).json({ success: false, message: '还原失败', error: error.message });
  }
});

/**
 * GET /api/rules - 获取所有规则
 */
router.get('/rules', async (req, res) => {
  try {
    // 系统规则来自 legal-desens paths --json → rules.json（只读）
    let systemRules = [];
    try {
      const rulesPath = getRulesPath();
      const rulesRaw = await fs.readFile(rulesPath, 'utf-8');
      const parsed = JSON.parse(rulesRaw);
      systemRules = (Array.isArray(parsed) ? parsed : []).map(r => ({
        id: r.id, name: r.name, category: 'system',
        regex: r.pattern, token_prefix: r.label_prefix,
        description: r.name, is_active: r.enabled !== false, sample: '',
      }));
    } catch {}

    const customRules = getAllRules();
    res.json({ success: true, data: { system: systemRules, custom: customRules } });
  } catch (error) {
    console.error('Rules Error:', error);
    res.status(500).json({ success: false, message: '获取规则失败', error: error.message });
  }
});

/**
 * POST /api/rules - 新增自定义规则
 */
router.post('/rules', (req, res) => {
  try {
    const { name, category, regex, token_prefix, description, sample } = req.body;
    if (!name) return res.status(400).json({ success: false, message: '规则名称不能为空' });

    // 正则合法性校验
    if (regex) {
      try { new RegExp(regex); } catch { return res.status(400).json({ success: false, message: '正则表达式不合法' }); }
    }

    const rule = createRule({ name, category, regex, token_prefix, description, sample });
    res.json({ success: true, data: rule });
  } catch (error) {
    console.error('Create Rule Error:', error);
    res.status(500).json({ success: false, message: '创建规则失败', error: error.message });
  }
});

/**
 * PATCH /api/rules/:id - 更新规则（启停等）
 */
router.patch('/rules/:id', (req, res) => {
  try {
    updateRule(parseInt(req.params.id, 10), req.body);
    res.json({ success: true });
  } catch (error) {
    console.error('Update Rule Error:', error);
    res.status(500).json({ success: false, message: '更新规则失败', error: error.message });
  }
});

/**
 * DELETE /api/rules/:id - 删除规则
 */
router.delete('/rules/:id', (req, res) => {
  try {
    deleteRule(parseInt(req.params.id, 10));
    res.json({ success: true });
  } catch (error) {
    console.error('Delete Rule Error:', error);
    res.status(500).json({ success: false, message: '删除规则失败', error: error.message });
  }
});

/**
 * POST /api/rules/test - 测试正则样例匹配（带超时保护）
 */
router.post('/rules/test', (req, res) => {
  try {
    const { regex, sample } = req.body;
    if (!regex) return res.status(400).json({ success: false, message: '缺少正则' });
    if (!sample) return res.json({ success: true, data: { matches: [] } });

    // 验证正则合法性
    let re;
    try { re = new RegExp(regex, 'g'); } catch {
      return res.status(400).json({ success: false, message: '正则表达式不合法' });
    }

    // 超时保护：复杂正则可能卡住
    const TIMEOUT_MS = 3000;
    const start = Date.now();
    const matches = [];
    let m;
    while ((m = re.exec(sample)) !== null) {
      if (Date.now() - start > TIMEOUT_MS) {
        return res.json({ success: true, data: { matches, warning: '匹配超时，已截断' } });
      }
      matches.push({ text: m[0], index: m.index });
      if (!m[0]) break; // 防止零宽匹配死循环
      if (matches.length > 1000) {
        return res.json({ success: true, data: { matches, warning: '匹配数过多，已截断' } });
      }
    }
    res.json({ success: true, data: { matches } });
  } catch (error) {
    res.status(400).json({ success: false, message: '正则不合法或匹配出错', error: error.message });
  }
});

// #endregion

export default router;
