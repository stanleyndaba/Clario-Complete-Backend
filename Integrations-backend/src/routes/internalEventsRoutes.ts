import { Router } from 'express';
import sseHub from '../utils/sseHub';

const router = Router();

// POST /api/internal/events
// Body: { userId: string, event: string, data: any }
router.post('/', (req, res) => {
  try {
    const token = req.header('X-Internal-Token');
    const expected = process.env['INTERNAL_EVENT_TOKEN'];
    if (expected && token !== expected) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Invalid internal token' } });
    }

    const { userId, event, data } = req.body || {};
    if (!userId || !event) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'userId and event are required' } });
    }

    sseHub.sendEvent(userId, event, data || {});
    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } });
  }
});

// POST /api/internal/events/smart-prompts/:id/answer
// Body: { userId: string, selectedOptionId: string }
router.post('/smart-prompts/:id/answer', async (req, res) => {
  try {
    const token = req.header('X-Internal-Token');
    const expected = process.env['INTERNAL_EVENT_TOKEN'];
    if (expected && token !== expected) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Invalid internal token' } });
    }

    const { id } = req.params;
    const { userId, selectedOptionId } = req.body || {};
    if (!userId || !selectedOptionId) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'userId and selectedOptionId are required' } });
    }

    const { smartPromptService } = await import('../services/smartPromptService');
    await smartPromptService.answerPrompt(userId, id, selectedOptionId);
    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error?.message || 'Internal error' } });
  }
});

export default router;


