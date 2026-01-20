// /api/assets/[...path].mjs - Vercel Serverless Function for Static Assets

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME_TYPES = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
};

export default async function handler(req, res) {
  try {
    // 获取路径参数
    const pathData = req.query['...path'];
    
    if (!pathData || (Array.isArray(pathData) && pathData.length === 0)) {
      return res.status(400).json({ error: 'Missing path' });
    }
    
    // 组合路径
    const filePathParts = Array.isArray(pathData) ? pathData : [pathData];
    
    // 构建完整路径
    const fullPath = path.join(process.cwd(), ...filePathParts);
    
    // 安全检查：防止路径遍历攻击
    if (!fullPath.startsWith(process.cwd())) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // 检查文件是否存在
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // 检查是否是文件
    const stats = fs.statSync(fullPath);
    if (!stats.isFile()) {
      return res.status(404).json({ error: 'Not a file' });
    }
    
    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    
    const fileContent = fs.readFileSync(fullPath);
    
    // 设置响应头
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    
    res.status(200).send(fileContent);
  } catch (error) {
    console.error('Static file handler error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
