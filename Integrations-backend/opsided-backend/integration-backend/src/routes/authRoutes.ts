import { Router } from 'express';
import { login, logout, refreshToken } from '../controllers/authController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// Public routes
router.post('/login', login);
router.post('/refresh', refreshToken);

// Protected routes
router.post('/logout', authenticateToken, logout);

export default router; 