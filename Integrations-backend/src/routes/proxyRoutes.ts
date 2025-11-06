import express, { Request, Response } from 'express';
import axios from 'axios';
import logger from '../utils/logger';

const router = express.Router();

// Python backend URL - can be overridden by environment variable
const PYTHON_API_URL = process.env.PYTHON_API_URL || process.env.PYTHON_API_BASE_URL || 'https://python-api-newest.onrender.com';

/**
 * Extract JWT token from cookie or Authorization header
 */
function extractToken(req: Request): string | null {
  // Priority 1: Check cookie (session_token)
  const cookieToken = req.cookies?.session_token;
  if (cookieToken) return cookieToken;
  
  // Priority 2: Check Authorization header
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }
  
  return null;
}

/**
 * Proxy function to forward requests to Python backend
 */
async function proxyToPython(req: Request, res: Response, path: string) {
  try {
    const url = `${PYTHON_API_URL}${path}`;
    
    // Forward headers (preserve auth, content-type, etc.)
    const headers: Record<string, string> = {
      'Content-Type': req.headers['content-type'] || 'application/json',
    };
    
    // Extract token from cookie or Authorization header
    const token = extractToken(req);
    if (token) {
      // Forward as Authorization header (works cross-domain)
      headers['Authorization'] = `Bearer ${token}`;
      logger.debug(`Extracted token from request, forwarding as Authorization header`);
    } else {
      logger.warn(`No token found in request for ${req.path}`);
    }
    
    // Also forward cookies if present (for compatibility)
    if (req.headers.cookie) {
      headers['Cookie'] = req.headers.cookie;
    }
    
    logger.info(`Proxying ${req.method} ${req.path} to ${url}`, {
      hasToken: !!token,
      hasCookie: !!req.headers.cookie
    });
    
    const config: any = {
      method: req.method,
      url,
      headers,
      timeout: 30000, // 30 second timeout
    };
    
    // Forward request body for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      config.data = req.body;
    }
    
    // Forward query parameters
    if (Object.keys(req.query).length > 0) {
      config.params = req.query;
    }
    
    const response = await axios(config);
    
    // Forward response status and data
    res.status(response.status).json(response.data);
  } catch (error: any) {
    logger.error(`Proxy error for ${req.path}:`, error.message);
    
    if (error.response) {
      // Forward error response from Python backend
      res.status(error.response.status).json(error.response.data);
    } else if (error.code === 'ECONNABORTED') {
      res.status(504).json({ 
        error: 'Gateway Timeout', 
        message: 'Python backend did not respond in time' 
      });
    } else {
      res.status(502).json({ 
        error: 'Bad Gateway', 
        message: 'Failed to connect to Python backend' 
      });
    }
  }
}

// Recoveries endpoints
router.get('/api/recoveries', (req, res) => proxyToPython(req, res, '/api/recoveries'));
router.get('/api/recoveries/:id', (req, res) => proxyToPython(req, res, `/api/recoveries/${req.params.id}`));
router.get('/api/recoveries/:id/status', (req, res) => proxyToPython(req, res, `/api/recoveries/${req.params.id}/status`));
router.post('/api/recoveries/:id/submit', (req, res) => proxyToPython(req, res, `/api/recoveries/${req.params.id}/submit`));
router.post('/api/claims/:id/submit', (req, res) => proxyToPython(req, res, `/api/claims/${req.params.id}/submit`));
router.get('/api/recoveries/:id/document', (req, res) => proxyToPython(req, res, `/api/recoveries/${req.params.id}/document`));
router.post('/api/recoveries/:id/answer', (req, res) => proxyToPython(req, res, `/api/recoveries/${req.params.id}/answer`));
router.post('/api/recoveries/:id/documents/upload', (req, res) => proxyToPython(req, res, `/api/recoveries/${req.params.id}/documents/upload`));

// Documents endpoints
router.get('/api/documents', (req, res) => {
  logger.info('Documents endpoint hit', { path: req.path, query: req.query });
  proxyToPython(req, res, '/api/documents');
});
router.get('/api/documents/:id', (req, res) => proxyToPython(req, res, `/api/documents/${req.params.id}`));
router.get('/api/documents/:id/view', (req, res) => proxyToPython(req, res, `/api/documents/${req.params.id}/view`));
router.get('/api/documents/:id/download', (req, res) => proxyToPython(req, res, `/api/documents/${req.params.id}/download`));
router.post('/api/documents/upload', (req, res) => proxyToPython(req, res, '/api/documents/upload'));

// Metrics endpoints
router.get('/api/metrics/recoveries', (req, res) => proxyToPython(req, res, '/api/metrics/recoveries'));
router.get('/api/metrics/dashboard', (req, res) => proxyToPython(req, res, '/api/metrics/dashboard'));

export default router;

