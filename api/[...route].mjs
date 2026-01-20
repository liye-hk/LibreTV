import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
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
  '.eot': 'application/vnd.ms-fontobject',
};

function sha256Hash(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

async function renderPage(filePath, password) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (password !== '') {
    const sha256 = await sha256Hash(password);
    content = content.replace('{{PASSWORD}}', sha256);
  } else {
    content = content.replace('{{PASSWORD}}', '');
  }
  return content;
}

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

function validateProxyAuth(req) {
  const authHash = req.query.auth;
  const timestamp = req.query.t;
  
  const serverPassword = process.env.PASSWORD || '';
  if (!serverPassword) {
    console.error('Server PASSWORD not set, proxy access denied');
    return false;
  }
  
  const serverPasswordHash = crypto.createHash('sha256').update(serverPassword).digest('hex');
  
  if (!authHash || authHash !== serverPasswordHash) {
    console.warn('Proxy auth failed: password hash mismatch');
    return false;
  }
  
  if (timestamp) {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000;
    if (now - parseInt(timestamp) > maxAge) {
      console.warn('Proxy auth failed: timestamp expired');
      return false;
    }
  }
  
  return true;
}

function serveFile(filePath, res) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      return null;
    }
    
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = fs.readFileSync(filePath);
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.status(200).send(content);
    return true;
  } catch (error) {
    console.error(`Error serving file ${filePath}:`, error);
    return null;
  }
}

async function serveHtmlFile(filePath, res, password) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    const content = await renderPage(filePath, password);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).send(content);
    return true;
  } catch (error) {
    console.error(`Error serving HTML file ${filePath}:`, error);
    return null;
  }
}

async function handleProxyRequest(encodedUrl, res) {
  try {
    const targetUrl = decodeURIComponent(encodedUrl);
    
    if (!isValidUrl(targetUrl)) {
      return res.status(400).json({ error: 'Invalid URL' });
    }
    
    const response = await axios({
      method: 'get',
      url: targetUrl,
      responseType: 'stream',
      timeout: 5000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const headers = { ...response.headers };
    const sensitiveHeaders = (
      process.env.FILTERED_HEADERS || 
      'content-security-policy,cookie,set-cookie,x-frame-options,access-control-allow-origin'
    ).split(',');
    
    sensitiveHeaders.forEach(header => delete headers[header]);
    res.set(headers);
    
    response.data.pipe(res);
  } catch (error) {
    console.error('Proxy error:', error.message);
    return res.status(502).json({ error: 'Proxy request failed' });
  }
}

export default async function handler(req, res) {
  try {
    const { route } = req.query;
    const pathname = Array.isArray(route) ? '/' + route.join('/') : '/';
    const password = process.env.PASSWORD || '';
    
    console.log(`[${new Date().toISOString()}] ${req.method} ${pathname}`);
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    
    const routeSegments = Array.isArray(route) ? route : [];
    
    if (routeSegments.length > 0 && routeSegments[0] === 'proxy') {
      const encodedUrl = routeSegments.slice(1).join('/');
      if (!encodedUrl) {
        return res.status(400).json({ error: 'Missing proxy URL' });
      }
      
      if (!validateProxyAuth(req)) {
        return res.status(401).json({
          success: false,
          error: 'Proxy access unauthorized: check password or auth parameters'
        });
      }
      
      return await handleProxyRequest(encodedUrl, res);
    }
    
    if (routeSegments.length > 0 && routeSegments[0] === 'api') {
      return res.status(404).json({ error: 'API route not found', path: pathname });
    }
    
    if (pathname.startsWith('/s=')) {
      const served = await serveHtmlFile(path.join(process.cwd(), 'index.html'), res, password);
      if (served) return;
      return res.status(404).json({ error: 'index.html not found' });
    }
    
    if (pathname.startsWith('/player') || pathname === '/player.html') {
      const served = await serveHtmlFile(path.join(process.cwd(), 'player.html'), res, password);
      if (served) return;
      return res.status(404).json({ error: 'player.html not found' });
    }
    
    if (pathname === '/watch.html') {
      const served = await serveHtmlFile(path.join(process.cwd(), 'watch.html'), res, password);
      if (served) return;
      return res.status(404).json({ error: 'watch.html not found' });
    }
    
    if (pathname === '/about.html') {
      const served = await serveHtmlFile(path.join(process.cwd(), 'about.html'), res, password);
      if (served) return;
      return res.status(404).json({ error: 'about.html not found' });
    }
    
    if (pathname === '/' || pathname === '/index.html') {
      const served = await serveHtmlFile(path.join(process.cwd(), 'index.html'), res, password);
      if (served) return;
      return res.status(404).json({ error: 'index.html not found' });
    }
    
    const filePath = path.join(process.cwd(), pathname);
    const resolvedPath = path.resolve(filePath);
    const projectRoot = path.resolve(process.cwd());
    
    if (!resolvedPath.startsWith(projectRoot)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (fs.existsSync(resolvedPath)) {
      const stat = fs.statSync(resolvedPath);
      if (stat.isFile()) {
        const ext = path.extname(pathname).toLowerCase();
        if (MIME_TYPES[ext]) {
          const served = serveFile(resolvedPath, res);
          if (served) return;
        } else {
          const served = serveFile(resolvedPath, res);
          if (served) return;
        }
      }
    }
    
    if (!path.extname(pathname)) {
      const htmlPath = path.join(process.cwd(), pathname + '.html');
      if (fs.existsSync(htmlPath)) {
        const served = await serveHtmlFile(htmlPath, res, password);
        if (served) return;
      }
    }
    
    console.log(`404 Not found: ${pathname}`);
    res.status(404).json({ error: 'Not found', path: pathname });
    
  } catch (error) {
    console.error('Handler error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  }
}
