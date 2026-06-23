/**
 * 描述: 案件文档解析服务
 * 主要功能:
 *     - 识别上传文件的扩展名
 *     - 分流处理 TXT、PDF 和 Word (.docx) 文档的文本提取
 */

import fs from 'fs/promises';
import path from 'path';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';

// #region 文档类型路由解析

/**
 * 解析文档总入口
 * @param {string} filePath - 文件本地路径
 * @param {string} originalName - 原始文件名
 * @returns {Promise<string>} 解析出的文本内容
 */
export async function parseDocument(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();

  switch (ext) {
    case '.txt':
    case '.md':
      return await parseTextFile(filePath);
    case '.pdf':
      return await parsePdfFile(filePath);
    case '.docx':
      return await parseDocxFile(filePath);
    default:
      throw new Error(`暂不支持解析该文件格式: ${ext}`);
  }
}

// #endregion

// #region 具体解析子模块

/**
 * 读取纯文本文件
 */
async function parseTextFile(filePath) {
  /**
   * 功能: 直接以 utf-8 编码读取纯文本内容
   */
  return await fs.readFile(filePath, 'utf-8');
}

/**
 * 解析 PDF 文件
 */
async function parsePdfFile(filePath) {
  /**
   * 功能: 使用 pdf-parse 库提取 PDF 文本内容
   */
  const dataBuffer = await fs.readFile(filePath);
  const pdfData = await pdf(dataBuffer);
  return pdfData.text || '';
}

/**
 * 解析 Word (.docx) 文件
 */
async function parseDocxFile(filePath) {
  /**
   * 功能: 使用 mammoth 库提取 .docx 文档的原始纯文本
   */
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value || '';
}

// #endregion
