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
    const pathData = req.query['...path'];
    
    if (!pathData || (Array.isArray(pathData) && pathData.length === 0)) {
      return res.status(400).json({ error: 'Missing path' });
    }
    
    // 将数组路径转换为单个路径字符串
    const relativePath = Array.isArray(pathData) ? pathData.join('/') : pathData;
    
    // 构建完整路径（项目根目录）
    const fullPath = path.join(process.cwd(), relativePath);
    
    // 安全检查：防止路径遍历攻击
    const resolvedPath = path.resolve(fullPath);
    const projectRoot = path.resolve(process.cwd());
    
    if (!resolvedPath.startsWith(projectRoot)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // 检查文件是否存在
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'File not found', path: relativePath });
    }
    
    // 检查是否是文件（不是目录）
    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      return res.status(403).json({ error: 'Directory access denied' });
    }
    
    // 确定 Content-Type
    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    
    // 读取文件
    const fileContent = fs.readFileSync(resolvedPath);
    
    // 设置响应头
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', fileContent.length);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    res.status(200).send(fileContent);
  } catch (error) {
    console.error('Static file handler error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}
