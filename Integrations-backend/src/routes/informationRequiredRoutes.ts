import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { supabase, supabaseAdmin, supabaseStorage, convertUserIdToUuid } from '../database/supabaseClient';
import logger from '../utils/logger';
import { EmailService } from '../notifications/services/delivery/email_service';

const router = Router();
const emailService = new EmailService();
const BUCKET = 'evidence-documents';
const MAX_FILES = 10;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set([
      'text/csv', 'text/plain', 'application/csv', 'application/pdf',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ]);
    const extension = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
    if (allowed.has(file.mimetype) || ['.csv', '.txt', '.pdf', '.xls', '.xlsx'].includes(extension)) cb(null, true);
    else cb(new Error('Unsupported file type. Please choose a CSV, TXT, PDF, XLS, or XLSX file.'));
  },
});

function storageClient(): any | null {
  return supabaseStorage?.storage ? supabaseStorage : supabaseAdmin?.storage ? supabaseAdmin : supabase?.storage ? supabase : null;
}

function safeFilename(name: string) {
  const normalized = String(name || 'document').normalize('NFKD').replace(/[^\x20-\x7E]/g, '');
  const extensionIndex = normalized.lastIndexOf('.');
  const base = (extensionIndex > 0 ? normalized.slice(0, extensionIndex) : normalized)
    .replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/\s+/g, '_').replace(/^\.+/, '').slice(0, 120) || 'document';
  const extension = extensionIndex > 0 ? normalized.slice(extensionIndex).toLowerCase().replace(/[^a-z0-9.]/g, '') : '';
  return `${base}${extension}`;
}

async function sendSubmissionEmails(input: { email: string | null; tenantId: string; userId: string; auditId: string; submissionId: string; filenames: string[]; note: string | null }) {
  const submittedAt = new Date().toISOString();
  const details = input.filenames.join(', ');
  const sellerTasks: Promise<unknown>[] = [];
  if (input.email) {
    sellerTasks.push(emailService.sendEmail({
      to: input.email,
      subject: 'We received your files',
      text: "We've received the additional Amazon records for your Margin Audit. Our team will review them and use them to complete your report.\n\nWe'll be in touch once the review is complete.\n\n— Margin",
      html: '<p>We\'ve received the additional Amazon records for your Margin Audit. Our team will review them and use them to complete your report.</p><p>We\'ll be in touch once the review is complete.</p><p>— Margin</p>',
      idempotencyKey: `information-required-seller:${input.submissionId}`,
    }));
  }
  const internalEmail = process.env.INFORMATION_REQUIRED_INTERNAL_EMAIL || process.env.INTERNAL_NOTIFICATION_EMAIL || process.env.EMAIL_REPLY_TO;
  if (internalEmail) {
    sellerTasks.push(emailService.sendEmail({
      to: internalEmail,
      subject: `New information-required submission: ${input.auditId}`,
      text: `A seller submitted additional records.\n\nUser: ${input.userId}\nTenant: ${input.tenantId}\nAudit: ${input.auditId}\nSubmitted: ${submittedAt}\nFiles: ${details}\nNote: ${input.note || 'Not provided'}`,
      html: `<p>A seller submitted additional records.</p><ul><li>User: ${input.userId}</li><li>Tenant: ${input.tenantId}</li><li>Audit: ${input.auditId}</li><li>Submitted: ${submittedAt}</li><li>Files: ${details}</li></ul><p>Note: ${input.note || 'Not provided'}</p>`,
      idempotencyKey: `information-required-internal:${input.submissionId}`,
    }));
  }
  const results = await Promise.allSettled(sellerTasks);
  results.filter((result) => result.status === 'rejected').forEach((result) => logger.warn('[INFORMATION REQUIRED] Notification failed after durable submission', { error: result.reason?.message || String(result.reason) }));
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = String((req as any).userId || '');
    const tenantId = String((req as any).tenant?.tenantId || '');
    const auditId = String(req.query.auditId || '').trim();
    if (!userId || !tenantId) return res.status(401).json({ success: false, error: 'Authenticated tenant context is required.' });
    const db = supabaseAdmin || supabase;
    let auditQuery = db.from('audit_runs').select('id, status, source_type, summary, created_at, updated_at').eq('user_id', userId).eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(1);
    if (auditId) auditQuery = db.from('audit_runs').select('id, status, source_type, summary, created_at, updated_at').eq('id', auditId).eq('user_id', userId).eq('tenant_id', tenantId).limit(1);
    const { data: audits, error: auditError } = await auditQuery;
    if (auditError) throw new Error(auditError.message);
    const audit = audits?.[0] || null;
    if (!audit) return res.status(404).json({ success: false, error: 'Audit not found.' });
    const { data: submission, error } = await db.from('information_required_submissions').select('id, audit_run_id, note, status, submitted_at, created_at, updated_at').eq('audit_run_id', audit.id).eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    return res.json({ success: true, audit, submission: submission || null });
  } catch (error: any) {
    logger.error('[INFORMATION REQUIRED] Failed to load state', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: 'Unable to load the information request.' });
  }
});

router.post('/submit', upload.array('files', MAX_FILES), async (req: Request, res: Response) => {
  try {
    const userId = String((req as any).userId || '');
    const tenantId = String((req as any).tenant?.tenantId || '');
    if (!userId || !tenantId) return res.status(401).json({ success: false, error: 'Authenticated tenant context is required.' });
    const auditId = String(req.body?.auditId || req.query?.auditId || '').trim();
    if (!auditId) return res.status(400).json({ success: false, error: 'An audit is required for this submission.' });
    const files = ((req.files || []) as Express.Multer.File[]);
    if (!files.length) return res.status(400).json({ success: false, error: 'Add at least one file to continue.' });
    const db = supabaseAdmin || supabase;
    const { data: audit, error: auditError } = await db.from('audit_runs').select('id, status, user_id, tenant_id').eq('id', auditId).eq('user_id', userId).eq('tenant_id', tenantId).maybeSingle();
    if (auditError) throw new Error(auditError.message);
    if (!audit) return res.status(404).json({ success: false, error: 'Audit not found.' });
    const { data: existing, error: existingError } = await db.from('information_required_submissions').select('id, status, submitted_at').eq('audit_run_id', auditId).eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) return res.json({ success: true, duplicate: true, submission: existing, message: 'Your files were already received.' });
    const storage = storageClient();
    if (!storage) return res.status(503).json({ success: false, error: 'File storage is temporarily unavailable. Please try again.' });
    const { data: submission, error: submissionError } = await db.from('information_required_submissions').insert({ audit_run_id: auditId, tenant_id: tenantId, user_id: convertUserIdToUuid(userId), note: typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 4000) || null : null }).select('*').single();
    if (submissionError) {
      if (submissionError.code === '23505') {
        const { data: raced } = await db.from('information_required_submissions').select('id, status, submitted_at').eq('audit_run_id', auditId).eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle();
        return res.json({ success: true, duplicate: true, submission: raced || null, message: 'Your files were already received.' });
      }
      throw new Error(submissionError.message);
    }
    const saved: any[] = [];
    const uploadedStoragePaths: string[] = [];
    try {
      for (const file of files) {
        const documentId = uuidv4();
        const storagePath = `${tenantId}/${documentId}/${safeFilename(file.originalname)}`;
        const { error: uploadError } = await storage.storage.from(BUCKET).upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });
        if (uploadError) throw new Error(`Could not store ${file.originalname}.`);
        uploadedStoragePaths.push(storagePath);
        const { data: document, error: documentError } = await db.from('evidence_documents').insert({ id: documentId, user_id: convertUserIdToUuid(userId), tenant_id: tenantId, seller_id: tenantId, external_id: `information_required:${submission.id}:${documentId}`, doc_type: 'other', filename: file.originalname, original_filename: file.originalname, content_type: file.mimetype, mime_type: file.mimetype, size_bytes: file.size, storage_path: storagePath, processing_status: 'pending', parser_status: 'pending', provider: 'information_required', ingested_at: new Date().toISOString(), information_required_submission_id: submission.id, metadata: { source: 'information_required', audit_run_id: auditId, submission_id: submission.id, original_filename: file.originalname } }).select('id, filename, size_bytes, content_type').single();
        if (documentError) throw new Error(`Could not record ${file.originalname}.`);
        saved.push(document);
      }
    } catch (fileError: any) {
      if (uploadedStoragePaths.length) {
        await storage.storage.from(BUCKET).remove(uploadedStoragePaths).catch(() => undefined);
      }
      await db.from('information_required_submissions').delete().eq('id', submission.id);
      return res.status(500).json({ success: false, error: fileError?.message || 'Files could not be stored. Please try again.' });
    }
    const { data: currentAudit } = await db.from('audit_runs').select('summary').eq('id', auditId).single();
    const summary = currentAudit?.summary && typeof currentAudit.summary === 'object' ? currentAudit.summary : {};
    await db.from('audit_runs').update({ summary: { ...summary, information_required: { status: 'review_pending', submission_id: submission.id, submitted_at: submission.submitted_at, file_count: saved.length } }, updated_at: new Date().toISOString() }).eq('id', auditId).eq('tenant_id', tenantId).eq('user_id', userId);
    const { data: user } = await db.from('users').select('email').eq('id', convertUserIdToUuid(userId)).maybeSingle();
    void sendSubmissionEmails({ email: user?.email || null, tenantId, userId, auditId, submissionId: submission.id, filenames: files.map((file) => file.originalname), note: submission.note }).catch((error) => logger.warn('[INFORMATION REQUIRED] Notification dispatch failed', { error: error?.message || String(error) }));
    return res.status(201).json({ success: true, submission: { id: submission.id, status: submission.status, submitted_at: submission.submitted_at }, files: saved, message: 'Files received. Our review team has received your files.' });
  } catch (error: any) {
    logger.error('[INFORMATION REQUIRED] Submission failed', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: 'We could not receive these files. Please try again.' });
  }
});

export default router;
