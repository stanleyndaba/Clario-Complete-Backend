import { Router } from 'express';
import { authenticateToken, requireUser } from '../middleware/auth';

const router = Router();

router.use(authenticateToken);

// GET /api/v1/documents/:claimId
router.get('/:claimId', requireUser, async (req, res) => {
  try {
    const { claimId } = req.params;
    const { costDocService } = await import('../services/costDocService');
    const docs = await costDocService.getDocumentationByAnomalyId(claimId);
    const output = docs ? [{
      docId: (docs as any).id,
      type: 'claim_proof',
      url: (docs as any).s3_url || (docs as any).file_url,
      createdAt: (docs as any).created_at
    }] : [];
    res.json({ claimId, documents: output });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Internal error' });
  }
});

// POST /api/v1/documents/generate
router.post('/generate', requireUser, async (req, res) => {
  try {
    const { claimId } = req.body || {};
    if (!claimId) return res.status(400).json({ success: false, error: 'claimId is required' });
    // Generate PDF using costDocumentationService which persists and returns metadata
    const { costDocumentationService } = await import('../services/costDocumentationService');
    const doc = await costDocumentationService.generateClaimDocument(claimId);

    // Notify integrations SSE hub if configured
    try {
      const integrationsUrl = process.env['INTEGRATIONS_INTERNAL_URL'];
      const token = process.env['INTERNAL_EVENT_TOKEN'];
      const userId = (doc as any).seller_id || (doc as any).user_id;
      if (integrationsUrl && userId) {
        await fetch(`${integrationsUrl}/api/internal/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Internal-Token': token || '' },
          body: JSON.stringify({ userId, event: 'document_generated', data: { claimId, docId: (doc as any).id, url: (doc as any).s3_url || (doc as any).file_url } })
        });
      }
    } catch {}
    res.json({ docId: (doc as any).id, downloadUrl: (doc as any).s3_url || (doc as any).file_url });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Internal error' });
  }
});

// GET /api/v1/documents/:docId/download
router.get('/:docId/download', requireUser, async (req, res) => {
  try {
    const { docId } = req.params;
    const { s3Service } = await import('../services/s3Service');
    const url = await s3Service.getSignedDownloadUrl(docId);
    res.redirect(url);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Internal error' });
  }
});

export default router;

