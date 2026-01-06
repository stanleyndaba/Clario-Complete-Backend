import { Router } from 'express';
import { transactionJournalService } from '../services/transactionJournalService';
import { authenticateToken, requireUser } from '../middleware/authMiddleware';
import { validateBody, validateQuery } from '../middleware/validation';
import { RecordTransactionSchema, ListTransactionsQuerySchema } from '../contracts';

const router = Router();

router.use(authenticateToken);

// POST /journal - record a transaction
router.post('/journal', requireUser, validateBody(RecordTransactionSchema), async (req, res) => {
  try {
    const { tx_type, entity_id, payload } = req.body || {};
    if (!tx_type || !entity_id || !payload) {
      return res.status(400).json({ success: false, error: 'tx_type, entity_id and payload are required' });
    }
    const entry = await transactionJournalService.recordTransaction({
      tx_type,
      entity_id,
      payload,
      actor_id: req.user.id,
    });
    res.json({ success: true, data: entry });
  } catch (err) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : 'Failed to record transaction' });
  }
});

// GET /journal - list transactions (filters & pagination)
router.get('/journal', requireUser, validateQuery(ListTransactionsQuerySchema), async (req, res) => {
  try {
    const { tx_type, entity_id, actor_id, since, until, limit, cursor } = req.query as any;
    const result = await transactionJournalService.getTransactions({
      tx_type,
      entity_id,
      actor_id,
      since,
      until,
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : 'Failed to fetch transactions' });
  }
});

// GET /journal/:id - fetch by id
router.get('/journal/:id', requireUser, async (req, res) => {
  try {
    const entry = await transactionJournalService.getTransactionById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: entry });
  } catch (err) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : 'Failed to fetch transaction' });
  }
});

export default router;


