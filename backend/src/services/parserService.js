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
  let text = '';

  switch (ext) {
    case '.txt':
    case '.md':
      text = await parseTextFile(filePath);
      break;
    case '.pdf':
      text = await parsePdfFile(filePath);
      break;
    case '.docx':
      text = await parseDocxFile(filePath);
      break;
    default:
      throw new Error(`暂不支持解析该文件格式: ${ext}`);
  }

  // 1. 去除首尾的多余换行符与空白字符（解决中栏顶部一大段空白的问题）
  text = (text || '').trim();

  // 2. 针对二进制排版导出的 .docx 和 .pdf，清洗并拼接段落内异常硬折行
  if (ext === '.docx' || ext === '.pdf') {
    text = cleanNewlines(text);
  }

  return text;
}

/**
 * 清洗并拼接段落内由于页面排版被单回车 \n 断开的异常折行
 * @param {string} text 待清洗文本
 * @returns {string} 拼接后的通顺文本
 */
function cleanNewlines(text) {
  if (!text) return '';
  // 统一换行符为 \n
  let cleaned = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 1. 拼合中文/数字/星号与中文/数字/英文字母/星号之间，或者英文字母与中文/数字之间断开的情况（至少有一侧不是纯英文单词）
  // 这样可以确保类似 "杭州\nXX" 或 "XX\n科技" 被直接粘合拼起
  cleaned = cleaned.replace(/([\u4e00-\u9fa5\d*])[ \t]*\n+[ \t]*([\u4e00-\u9fa5\da-zA-Z])/g, '$1$2');
  cleaned = cleaned.replace(/([a-zA-Z])[ \t]*\n+[ \t]*([\u4e00-\u9fa5\d])/g, '$1$2');

  // 2. 针对纯英文单词与英文单词被换行断开的情况（如 "the\ncompany"），拼合时中间保留一个空格，避免单词粘连
  cleaned = cleaned.replace(/([a-zA-Z])[ \t]*\n+[ \t]*([a-zA-Z])/g, '$1 $2');

  return cleaned;
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
