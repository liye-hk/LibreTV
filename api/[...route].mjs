import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 项目根目录（从 /api 目录往上两级）
const PROJECT_ROOT = path.resolve(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function isValidUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    const allowedProtocols = ['http:', 'https:'];
    const blockedHostnames = (process.env.BLOCKED_HOSTS || 'localhost,127.0.0.1,0.0.0.0,::1').split(',');
    const blockedPrefixes = (process.env.BLOCKED_IP_PREFIXES || '192.168.,10.,172.').split(',');
    
    if (!allowedProtocols.includes(parsed.protocol)) return false;
    if (blockedHostnames.includes(parsed.hostname)) return false;
    for (const prefix of blockedPrefixes) {
      if (parsed.hostname.startsWith(prefix)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function serveFile(filePath, res) {
  try {
    console.log(`[serveFile] Checking: ${filePath}`);
    
    if (!fs.existsSync(filePath)) {
      console.log(`[serveFile] File not found: ${filePath}`);
      return null;
    }
    
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      console.log(`[serveFile] Is directory: ${filePath}`);
      return null;
    }
    
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = fs.readFileSync(filePath);
    
    console.log(`[serveFile] Serving ${filePath} as ${contentType}`);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', content.length);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.status(200).send(content);
    return true;
  } catch (error) {
    console.error(`[serveFile] Error: ${error.message}`);
    return null;
  }
}

export default async function handler(req, res) {
  try {
    const { route } = req.query;
    const pathname = Array.isArray(route) ? '/' + route.join('/') : '/';
    
    console.log(`[API] ${req.method} ${pathname}`);
    console.log(`[API] PROJECT_ROOT: ${PROJECT_ROOT}`);
    
    // 1. 处理代理请求
    if (pathname.startsWith('/proxy/')) {
      const encodedUrl = pathname.slice(7);
      const targetUrl = decodeURIComponent(encodedUrl);
      
      if (!isValidUrl(targetUrl)) {
        return res.status(400).json({ error: 'Invalid URL' });
      }
      
      try {
        const response = await axios({
          method: 'get',
          url: targetUrl,
          responseType: 'stream',
          timeout: 5000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream');
        response.data.pipe(res);
        return;
      } catch (error) {
        console.error('Proxy error:', error.message);
        return res.status(502).json({ error: 'Proxy request failed' });
      }
    }
    
    // 2. 检查是否是有扩展名的文件（js, css, json, 图片等）
    const hasExtension = path.extname(pathname);
    if (hasExtension) {
      const filePath = path.join(PROJECT_ROOT, pathname);
      const resolvedPath = path.resolve(filePath);
      
      // 安全检查
      if (!resolvedPath.startsWith(PROJECT_ROOT)) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const served = serveFile(resolvedPath, res);
      if (served) return;
      
      // 文件不存在，返回 404
      return res.status(404).json({ error: 'File not found', path: pathname });
    }
    
    // 3. 处理搜索路由
    if (pathname.match(/^\/s=/)) {
      const filePath = path.join(PROJECT_ROOT, 'index.html');
      return serveFile(filePath, res) || 
             res.status(404).json({ error: 'index.html not found' });
    }
    
    // 4. 处理 player 路由
    if (pathname.startsWith('/player')) {
      const filePath = path.join(PROJECT_ROOT, 'player.html');
      return serveFile(filePath, res) ||
             res.status(404).json({ error: 'player.html not found' });
    }
    
    // 5. 处理根路由
    if (pathname === '/') {
      const filePath = path.join(PROJECT_ROOT, 'index.html');
      return serveFile(filePath, res) ||
             res.status(404).json({ error: 'index.html not found' });
    }
    
    // 6. 其他路由尝试作为 HTML 页面提供
    let htmlPath = path.join(PROJECT_ROOT, pathname + '.html');
    let resolvedPath = path.resolve(htmlPath);
    
    if (resolvedPath.startsWith(PROJECT_ROOT) && fs.existsSync(resolvedPath)) {
      return serveFile(resolvedPath, res) ||
             res.status(500).json({ error: 'Error reading HTML' });
    }
    
    // 7. 都不行，返回 404
    console.log(`[API] No match found for ${pathname}`);
    res.status(404).json({ error: 'Not found', path: pathname });
    
  } catch (error) {
    console.error('[API] Handler error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}
