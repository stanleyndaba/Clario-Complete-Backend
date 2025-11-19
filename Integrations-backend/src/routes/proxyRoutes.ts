import express, { Request, Response } from 'express';
import axios from 'axios';
import multer from 'multer';
import logger from '../utils/logger';

// Type for multer file
interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

const router = express.Router();

// Python backend URL - can be overridden by environment variable
const PYTHON_API_URL = process.env.PYTHON_API_URL || process.env.VITE_PYTHON_API_URL || 'https://python-api-5.onrender.com';

// Configure multer for file uploads (memory storage)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

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
  const url = `${PYTHON_API_URL}${path}`;
  
  try {
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
      hasCookie: !!req.headers.cookie,
      pythonApiUrl: PYTHON_API_URL,
      queryParams: Object.keys(req.query).length > 0 ? req.query : undefined
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
    const errorDetails = {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText,
      url: url,
      pythonApiUrl: PYTHON_API_URL,
      path: req.path,
      method: req.method
    };
    
    logger.error(`Proxy error for ${req.path}:`, errorDetails);
    
    if (error.response) {
      // Forward error response from Python backend
      logger.error(`Python backend returned error: ${error.response.status}`, {
        status: error.response.status,
        data: error.response.data,
        url
      });
      res.status(error.response.status).json(error.response.data);
    } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      logger.error(`Python backend timeout`, { url, timeout: 30000 });
      res.status(504).json({ 
        error: 'Gateway Timeout', 
        message: 'Python backend did not respond in time',
        pythonApiUrl: PYTHON_API_URL
      });
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      logger.error(`Cannot connect to Python backend`, { 
        url, 
        pythonApiUrl: PYTHON_API_URL,
        errorCode: error.code,
        errorMessage: error.message
      });
      res.status(502).json({ 
        error: 'Bad Gateway', 
        message: `Failed to connect to Python backend at ${PYTHON_API_URL}`,
        pythonApiUrl: PYTHON_API_URL,
        errorCode: error.code
      });
    } else {
      logger.error(`Unknown proxy error`, { 
        error: error.message,
        code: error.code,
        stack: error.stack,
        url
      });
      res.status(502).json({ 
        error: 'Bad Gateway', 
        message: `Failed to connect to Python backend: ${error.message}`,
        pythonApiUrl: PYTHON_API_URL,
        errorCode: error.code
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
// File upload endpoint - use multer to handle multipart/form-data
router.post('/api/documents/upload', upload.any(), async (req: Request, res: Response) => {
  try {
    const files = (req as any).files as MulterFile[];
    const claim_id = req.query.claim_id as string | undefined;
    
    if (!files || files.length === 0) {
      return res.status(400).json({
        error: 'No files provided',
        message: 'Expected at least one file in the request'
      });
    }
    
    logger.info(`Proxying file upload to Python API`, {
      fileCount: files.length,
      filenames: files.map(f => f.originalname),
      claim_id
    });
    
    // Create FormData to forward files to Python API
    const FormData = (await import('form-data')).default;
    const formData = new FormData();
    
    // Add all files with 'file' field name (singular, as expected by Python API)
    files.forEach(file => {
      formData.append('file', file.buffer, {
        filename: file.originalname,
        contentType: file.mimetype
      });
    });
    
    // Add claim_id if provided
    if (claim_id) {
      formData.append('claim_id', claim_id);
    }
    
    // Extract token for authentication
    const token = req.cookies?.session_token || req.headers['authorization']?.replace('Bearer ', '');
    
    const headers: Record<string, string> = {
      ...formData.getHeaders()
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    // Forward X-User-Id if present
    if (req.headers['x-user-id']) {
      headers['X-User-Id'] = req.headers['x-user-id'] as string;
    }
    
    const pythonUrl = `${PYTHON_API_URL}/api/documents/upload${claim_id ? `?claim_id=${claim_id}` : ''}`;
    
    const response = await axios.post(pythonUrl, formData, {
      headers,
      timeout: 60000, // 60 second timeout for file uploads
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    
    res.status(response.status).json(response.data);
  } catch (error: any) {
    logger.error(`Proxy error for file upload:`, error.message);
    
    if (error.response) {
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
});

// Metrics endpoints
router.get('/api/metrics/recoveries', (req, res) => proxyToPython(req, res, '/api/metrics/recoveries'));
router.get('/api/metrics/dashboard', (req, res) => proxyToPython(req, res, '/api/metrics/dashboard'));

// Integrations status endpoint - proxy to Python API
router.get('/api/v1/integrations/status', (req, res) => proxyToPython(req, res, '/api/v1/integrations/status'));

// Evidence endpoints - proxy to Python API
router.post('/api/evidence/sync', (req, res) => proxyToPython(req, res, '/api/evidence/sync'));
router.post('/api/evidence/auto-collect', (req, res) => proxyToPython(req, res, '/api/evidence/auto-collect'));

// Health check endpoint to test Python backend connection
router.get('/api/health/python-backend', async (req, res) => {
  try {
    const healthUrl = `${PYTHON_API_URL}/health`;
    logger.info(`Checking Python backend health at ${healthUrl}`);
    
    const response = await axios.get(healthUrl, {
      timeout: 10000, // 10 second timeout for health check
    });
    
    res.json({
      status: 'ok',
      pythonBackend: {
        url: PYTHON_API_URL,
        status: response.status,
        statusText: response.statusText,
        data: response.data
      }
    });
  } catch (error: any) {
    logger.error('Python backend health check failed', {
      pythonApiUrl: PYTHON_API_URL,
      error: error.message,
      code: error.code,
      status: error.response?.status
    });
    
    res.status(502).json({
      status: 'error',
      pythonBackend: {
        url: PYTHON_API_URL,
        error: error.message,
        code: error.code,
        status: error.response?.status,
        message: `Cannot connect to Python backend at ${PYTHON_API_URL}`
      }
    });
  }
});

export default router;

