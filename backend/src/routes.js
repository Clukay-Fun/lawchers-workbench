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

// 导入业务服务
import { parseDocument } from './services/parserService.js';
import { analyzeCaseElements } from './services/analyzeService.js';
import { generateOpinionDocument } from './services/generateService.js';
import { redactDocument, redactScanDocument, getIsNerEnabled } from './services/redactService.js';

// 导入数据仓储层
import { createCase, getCasesList, getCaseDetail, updateCase, deleteCase } from './db/caseRepo.js';
import { addMaterial, updateMaterialStatus, deleteMaterial, bulkInsertEntities, getMaterialsByCaseId } from './db/materialRepo.js';
import { getCaseElement, updateCaseElement } from './db/elementRepo.js';
import { createOpinion, confirmOpinion, getOpinionsByCaseId, deleteOpinion } from './db/opinionRepo.js';
import { writeAuditLog, getAuditLogsByCaseId } from './db/auditRepo.js';

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

    const originalName = req.file.originalname;
    const ext = path.extname(originalName).toLowerCase();
    const tmpPath = req.file.path; // multer 临时存储路径

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
    const { filePath, level, rulesConfig, materialId } = req.body;
    if (!filePath) {
      return res.status(400).json({ success: false, message: '缺少待脱敏文件路径' });
    }

    // 安全校验
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(uploadsDir))) {
      return res.status(403).json({ success: false, message: '非法文件路径' });
    }

    const result = await redactDocument(resolvedPath, level || 'strict', rulesConfig || {});

    // 如果提供了 materialId，持久化到 DB
    if (materialId) {
      const matId = parseInt(materialId, 10);

      // 写入脱敏结果到 material 表
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

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Redact Error:', error);
    res.status(500).json({ success: false, message: '脱敏处理失败', error: error.message });
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

// #region Stage 7: 导出 .docx

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
