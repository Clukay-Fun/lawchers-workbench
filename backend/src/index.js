/**
 * 描述: 智能法律工作台后端服务入口文件
 * 主要功能:
 *     - 启动 Express 服务器，监听端口 3001
 *     - 配置 CORS 跨域与 JSON 解析中间件
 *     - 配置静态文件访问及错误处理
 */

import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import routes from './routes.js';

// #region 初始化与全局配置

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// 确保上传临时目录存在
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 全局中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// API 路由挂载
app.use('/api', routes);

// 静态文件服务 (若需要预览生成的文档)
app.use('/uploads', express.static(uploadDir));

// 生产模式：托管前端 dist + SPA 回退
const distDir = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(distDir)) {
  // 静态资源（JS/CSS/图片等）
  app.use(express.static(distDir));

  // SPA 回退：非 /api、非 /uploads 的普通 GET 请求 → index.html
  // 必须排在 /api 和 /uploads 之后
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/health')) {
      return next();
    }
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

// 基础健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// 全局错误捕获中间件
app.use((err, req, res, next) => {
  // Multer file size limit
  if (err.code === 'LIMIT_FILE_SIZE') {
    const maxMB = parseInt(process.env.UPLOAD_MAX_MB || '100', 10);
    return res.status(413).json({
      success: false,
      message: `文件超过 ${maxMB}MB 限制`,
    });
  }
  // Multer other errors
  if (err.code && err.code.startsWith('LIMIT_')) {
    return res.status(413).json({
      success: false,
      message: `上传限制: ${err.message}`,
    });
  }
  console.error('Server Error:', err);
  res.status(500).json({
    success: false,
    message: '服务器内部错误',
    error: err.message
  });
});

// 启动服务
app.listen(PORT, async () => {
  console.log(`Backend service is running on http://localhost:${PORT}`);
  
  // 运行脱敏环境自检
  try {
    const { verifyDesensitizerEnvironment } = await import('./services/redactService.js');
    await verifyDesensitizerEnvironment();
  } catch (err) {
    console.error('[ERROR] 加载 redactService 失败，无法进行脱敏环境自检:', err.message);
  }
});

// #endregion
