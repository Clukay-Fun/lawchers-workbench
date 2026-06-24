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

    // 判断显示模式
    const isTextFormat = ['.txt', '.md', '.csv', '.docx', '.xlsx'].includes(ext);
    const isImageFormat = ['.png', '.jpg', '.jpeg', '.tiff', '.bmp'].includes(ext);
    let displayMode = 'text';
    if (isImageFormat) {
      displayMode = 'image';
    } else if (ext === '.pdf') {
      displayMode = (rawText && rawText.trim().length > 0) ? 'text' : 'image';
    } else if (!isTextFormat) {
      return res.status(400).json({ success: false, message: `暂不支持该文件格式: ${ext}` });
    }

    // 存储相对路径（相对于 backend/ 目录）
    const relativePath = path.relative(path.join(__dirname, '..'), finalPath);

    // 写入 material 表
    const material = addMaterial({
      case_id: parseInt(caseId, 10),
      filename: originalName,
      ext,
      stored_path: relativePath,
      display_mode: displayMode,
    });

    res.json({
      success: true,
      data: {
        materialId: material.id,
        filename: originalName,
        filePath: finalPath,
        rawText,
        displayMode,
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
  try {
    const matId = parseInt(req.params.id, 10);
    const { default: db } = await import('./db/index.js');
    const mat = db.prepare('SELECT * FROM "material" WHERE id = ?').get(matId);
    if (!mat) return res.status(404).json({ success: false, message: '材料不存在' });

    const sourcePath = path.resolve(path.join(__dirname, '..', mat.stored_path));
    if (!sourcePath.startsWith(path.resolve(uploadsDir))) {
      return res.status(403).json({ success: false, message: '非法材料路径' });
    }

    // 更新处理状态为 preparing
    db.prepare(`UPDATE "material" SET processing_status = 'preparing' WHERE id = ?`).run(matId);

    // 准备输出目录
    const caseDir = path.join(uploadsDir, String(mat.case_id));
    const workDir = path.join(caseDir, `.work_${matId}`);
    if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });

    const previewPath = path.join(workDir, 'preview.md');
    const manifestPath = path.join(workDir, 'manifest.json');
    const sourceMapPath = path.join(workDir, 'source-map.json');

    // 调用 legal-desens prepare
    const args = [
      '-m', 'legal_desens.cli',
      'prepare', sourcePath,
      '--level', 'strict',
      '--preview-md', previewPath,
      '--manifest', manifestPath,
      '--map', sourceMapPath,
    ];

    // NER 状态
    if (!getIsNerEnabled()) {
      args.push('--regex-only');
    }

    const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
    const DESENSITIZER_DIR = process.env.DESENSITIZER_DIR || '/Users/clukay/Program/lawchers-skills/legal-desensitizer';

    await execFileAsync(PYTHON_BIN, args, {
      cwd: DESENSITIZER_DIR,
      timeout: parseInt(process.env.REDACT_TIMEOUT_MS || '120000', 10),
    });

    // 读取结果
    const manifestRaw = await fs.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestRaw);
    const sourceMap = JSON.parse(await fs.readFile(sourceMapPath, 'utf-8'));
    if (!manifest.sourceSha256 || sourceMap.source_sha256 !== manifest.sourceSha256) {
      throw new Error('预处理输出的原件哈希不一致');
    }

    // 更新 material 表
    const relPreview = path.relative(path.join(__dirname, '..'), previewPath);
    const relManifest = path.relative(path.join(__dirname, '..'), manifestPath);

    db.prepare(`
      UPDATE "material" SET
        document_kind = ?,
        preview_path = ?,
        manifest_path = ?,
        source_sha256 = ?,
        processing_status = 'reviewing',
        redact_status = 'todo'
      WHERE id = ?
    `).run(
      manifest.documentKind || '',
      relPreview,
      relManifest,
      manifest.sourceSha256 || '',
      matId,
    );

    // 自动将 candidates 写入 redaction_decision（全量替换，prepare 初始化专用）
    const candidates = manifest.candidates || [];
    replaceAllDecisions(matId, candidates.map(c => ({
        candidateId: c.id,
        blockId: c.blockId,
        start: c.start,
        end: c.end,
        action: 'redact',
        origin: 'automatic',
        entityType: c.entityType,
        sourceLocator: c.sourceLocator,
      })));

    // 写审计
    await writeAuditLog({
      case_id: mat.case_id,
      action: 'prepare',
      source: 'legal-desens',
      model_config: {
        documentKind: manifest.documentKind,
        blocks: manifest.blocks?.length || 0,
        candidates: candidates.length,
      },
      human_confirmed: 0,
    });

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
    // 回退状态
    try {
      const { default: db } = await import('./db/index.js');
      db.prepare(`UPDATE "material" SET processing_status = 'failed' WHERE id = ?`).run(parseInt(req.params.id, 10));
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

    res.json({
      success: true,
      data: {
        materialId: matId,
        processingStatus: mat.processing_status,
        verificationStatus: mat.verification_status,
        documentKind: mat.document_kind,
        previewMd,
        manifest,
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
    if (!['reviewing', 'ready'].includes(mat.processing_status)) {
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
          if (deleteDecision(matId, d.id) === 0) {
            return res.status(404).json({ success: false, message: '决策不存在或不属于当前材料' });
          }
        } else {
          if (updateDecision(matId, d.id, {
            action: d.action,
            confirmed: 1,
          }) === 0) {
            return res.status(404).json({ success: false, message: '决策不存在或不属于当前材料' });
          }
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
      }
    }

    // P1: 决策变化后，使 ready 状态失效，退回 reviewing
    db.prepare(`
      UPDATE "material" SET processing_status = 'reviewing', redact_status = 'todo' WHERE id = ? AND processing_status = 'ready'
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
      data: { count: updatedDecisions.length },
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
 * POST /api/materials/:id/export - 按决策导出脱敏副本
 *
 * 人工确认门控：导出按钮即为人工确认动作。
 * 1. 校验 source_sha256 未变化
 * 2. 将未确认的自动候选按当前 action 标记为人工确认
 * 3. 校验所有决策均已确认
 * 4. 按 document_kind 分流：DOCX/text→redact，scan→redact-scan
 * 5. 残留复检必须 passed === true，失败则删除产物
 */
router.post('/materials/:id/export', async (req, res) => {
  try {
    const matId = parseInt(req.params.id, 10);
    const { default: db } = await import('./db/index.js');
    const mat = db.prepare(`
      SELECT * FROM "material" WHERE id = ?
    `).get(matId);
    if (!mat) return res.status(404).json({ success: false, message: '材料不存在' });

    const sourcePath = path.resolve(path.join(__dirname, '..', mat.stored_path));
    if (!sourcePath.startsWith(path.resolve(uploadsDir))) {
      return res.status(403).json({ success: false, message: '非法材料路径' });
    }

    // 1. 校验原件未变化
    const currentSha = createHash('sha256').update(await fs.readFile(sourcePath)).digest('hex');
    if (mat.source_sha256 && currentSha !== mat.source_sha256) {
      return res.status(409).json({ success: false, message: '原件自预处理后已变化，请重新预处理' });
    }

    // 2. 将未确认的自动候选标记为人工确认（用户点击导出 = 人工确认动作）
    db.prepare(`
      UPDATE "redaction_decision" SET confirmed = 1, origin = 'human'
      WHERE material_id = ? AND confirmed = 0 AND origin = 'automatic'
    `).run(matId);

    // 3. 校验所有决策均已确认
    const counts = getDecisionReviewCounts(matId);
    if (counts.confirmed !== counts.total) {
      return res.status(409).json({
        success: false,
        message: `仍有 ${counts.total - counts.confirmed} 处手动决策未确认`,
      });
    }

    // 4. 准备导出
    const workDir = path.join(uploadsDir, String(mat.case_id), `.work_${matId}`);
    if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });
    const ext = path.extname(mat.filename);
    const safeBase = path.basename(mat.filename, ext).replace(/[^\p{L}\p{N}._-]+/gu, '-');
    const exportFilename = `${safeBase || 'document'}.redacted${ext}`;
    const exportPath = path.join(workDir, exportFilename);
    const auditPath = path.join(workDir, 'export-audit.json');
    const mapPath = path.join(workDir, 'export-map.json');

    const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
    const DESENSITIZER_DIR = process.env.DESENSITIZER_DIR || '/Users/clukay/Program/lawchers-skills/legal-desensitizer';

    // 5. 按 document_kind 分流
    const isScan = mat.document_kind === 'pdf-scan';
    const args = ['-m', 'legal_desens.cli'];

    if (isScan) {
      args.push('redact-scan', sourcePath, '--ocr', 'rapidocr',
        '--level', 'strict', '--out', exportPath,
        '--map', mapPath, '--audit', auditPath);
    } else {
      args.push('redact', sourcePath,
        '--level', 'strict', '--out', exportPath,
        '--map', mapPath, '--audit', auditPath);
    }
    if (!getIsNerEnabled()) args.push('--regex-only');

    try {
      await execFileAsync(PYTHON_BIN, args, {
        cwd: DESENSITIZER_DIR,
        timeout: parseInt(process.env.REDACT_TIMEOUT_MS || '120000', 10),
      });
    } catch (cliErr) {
      // CLI 失败：清理产物
      await fs.unlink(exportPath).catch(() => {});
      return res.status(500).json({ success: false, message: '脱敏 CLI 执行失败', error: cliErr.message });
    }

    // 6. 残留复检：必须显式 passed === true
    let auditData = null;
    try {
      auditData = JSON.parse(await fs.readFile(auditPath, 'utf-8'));
    } catch {
      await fs.unlink(exportPath).catch(() => {});
      return res.status(500).json({ success: false, message: '无法读取审计文件，导出阻断' });
    }

    const residualPassed = auditData?.residual_scan?.passed === true;

    if (!residualPassed) {
      // 残留未通过：删除产物，保持 reviewing 状态
      await fs.unlink(exportPath).catch(() => {});
      db.prepare(`UPDATE "material" SET verification_status = 'failed', audit_json = ? WHERE id = ?`)
        .run(JSON.stringify(auditData), matId);
      await writeAuditLog({
        case_id: mat.case_id, action: 'export_failed', source: 'legal-desens',
        model_config: { residualPassed: false, format: ext, isScan }, human_confirmed: 1,
      });
      return res.status(409).json({ success: false, message: '残留扫描未通过，导出已阻断' });
    }

    // 7. 成功：更新状态
    db.prepare(`
      UPDATE "material" SET
        verification_status = 'passed', redacted_path = ?,
        audit_json = ?, processing_status = 'exported', redact_status = 'done'
      WHERE id = ?
    `).run(path.relative(path.join(__dirname, '..'), exportPath), JSON.stringify(auditData), matId);

    await writeAuditLog({
      case_id: mat.case_id, action: 'export', source: 'legal-desens',
      model_config: { residualPassed: true, format: ext, isScan,
        decisionCount: counts.total, autoConfirmed: counts.total - (counts.confirmed - (counts.total - counts.confirmed)) },
      human_confirmed: 1,
    });

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

export default router;
