import express, { Request, Response } from 'express';
import axios from 'axios';
import logger from '../utils/logger';

const router = express.Router();

// Python backend URL - can be overridden by environment variable
const PYTHON_API_URL = process.env.PYTHON_API_URL || 'https://opside-python-api.onrender.com';

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
    
    // Forward authorization header if present
    if (req.headers.authorization) {
      headers['Authorization'] = req.headers.authorization;
    }
    
    // Forward cookies if present
    if (req.headers.cookie) {
      headers['Cookie'] = req.headers.cookie;
    }
    
    logger.info(`Proxying ${req.method} ${req.path} to ${url}`);
    
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
router.get('/api/documents', (req, res) => proxyToPython(req, res, '/api/documents'));
router.get('/api/documents/:id', (req, res) => proxyToPython(req, res, `/api/documents/${req.params.id}`));
router.get('/api/documents/:id/view', (req, res) => proxyToPython(req, res, `/api/documents/${req.params.id}/view`));
router.get('/api/documents/:id/download', (req, res) => proxyToPython(req, res, `/api/documents/${req.params.id}/download`));
router.post('/api/documents/upload', (req, res) => proxyToPython(req, res, '/api/documents/upload'));

// Metrics endpoints
router.get('/api/metrics/recoveries', (req, res) => proxyToPython(req, res, '/api/metrics/recoveries'));
router.get('/api/metrics/dashboard', (req, res) => proxyToPython(req, res, '/api/metrics/dashboard'));

export default router;

