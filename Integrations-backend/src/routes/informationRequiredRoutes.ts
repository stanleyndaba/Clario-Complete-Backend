import { Router, Request, Response, NextFunction } from 'express';
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
type UploadedInformationFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

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
  if (supabaseStorage?.from && !supabaseStorage?.storage) return { storage: supabaseStorage };
  if (supabaseStorage?.storage) return supabaseStorage;
  if (supabaseAdmin?.storage) return supabaseAdmin;
  if (supabase?.storage) return supabase;
  return null;
}

const INFORMATION_REQUIRED_MIME_TYPES = [
  'text/csv',
  'text/plain',
  'application/csv',
  'application/pdf',
  'application/octet-stream',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

async function ensureEvidenceDocumentsBucket(storage: any): Promise<void> {
  try {
    const { data: buckets, error: listError } = await storage.storage.listBuckets();
    if (listError) {
      logger.warn('[INFORMATION REQUIRED] Could not list evidence storage buckets', { error: listError.message });
      return;
    }
    const bucketExists = buckets?.some((bucket: { name: string }) => bucket.name === BUCKET);
    if (!bucketExists) {
      const { error: createError } = await storage.storage.createBucket(BUCKET, {
        public: false,
        fileSizeLimit: MAX_FILE_SIZE,
        allowedMimeTypes: INFORMATION_REQUIRED_MIME_TYPES,
      });
      if (createError && !/already exists/i.test(createError.message || '')) {
        logger.warn('[INFORMATION REQUIRED] Could not create evidence storage bucket', { error: createError.message });
        return;
      }
    }
    const { error: updateError } = await storage.storage.updateBucket(BUCKET, {
      public: false,
      fileSizeLimit: MAX_FILE_SIZE,
      allowedMimeTypes: INFORMATION_REQUIRED_MIME_TYPES,
    });
    if (updateError) {
      logger.warn('[INFORMATION REQUIRED] Could not update evidence storage bucket mime types', { error: updateError.message });
    }
  } catch (error: any) {
    logger.warn('[INFORMATION REQUIRED] Evidence storage bucket check failed', { error: error?.message || String(error) });
  }
}

function safeFilename(name: string) {
  const normalized = String(name || 'document').normalize('NFKD').replace(/[^\x20-\x7E]/g, '');
  const extensionIndex = normalized.lastIndexOf('.');
  const base = (extensionIndex > 0 ? normalized.slice(0, extensionIndex) : normalized)
    .replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/\s+/g, '_').replace(/^\.+/, '').slice(0, 120) || 'document';
  const extension = extensionIndex > 0 ? normalized.slice(extensionIndex).toLowerCase().replace(/[^a-z0-9.]/g, '') : '';
  return `${base}${extension}`;
}

type EmailDeliveryStatus = 'sent' | 'skipped' | 'failed';
type EmailDeliveryResult = {
  status: EmailDeliveryStatus;
  provider?: 'resend';
  providerMessageId?: string | null;
  error?: string;
};

async function sendSubmissionEmails(input: { email: string | null; tenantId: string; userId: string; auditId: string; submissionId: string; filenames: string[]; note: string | null }) {
  const submittedAt = new Date().toISOString();
  const details = input.filenames.join(', ');
  const sellerTasks: Array<{ kind: 'seller' | 'internal'; task: Promise<unknown> }> = [];
  if (input.email) {
    sellerTasks.push({ kind: 'seller', task: emailService.sendEmail({
      to: input.email,
      subject: 'We received your files',
      text: "We've received the additional Amazon records for your Margin Audit. Our team will review them and use them to complete your report.\n\nWe'll be in touch once the review is complete.\n\n— Margin",
      html: '<p>We\'ve received the additional Amazon records for your Margin Audit. Our team will review them and use them to complete your report.</p><p>We\'ll be in touch once the review is complete.</p><p>— Margin</p>',
      idempotencyKey: `information-required-seller:${input.submissionId}`,
    }) });
  }
  const internalEmail = process.env.INFORMATION_REQUIRED_INTERNAL_EMAIL || process.env.INTERNAL_NOTIFICATION_EMAIL || process.env.EMAIL_REPLY_TO;
  if (internalEmail) {
    sellerTasks.push({ kind: 'internal', task: emailService.sendEmail({
      to: internalEmail,
      subject: `New information-required submission: ${input.auditId}`,
      text: `A seller submitted additional records.\n\nUser: ${input.userId}\nTenant: ${input.tenantId}\nAudit: ${input.auditId}\nSubmitted: ${submittedAt}\nFiles: ${details}\nNote: ${input.note || 'Not provided'}`,
      html: `<p>A seller submitted additional records.</p><ul><li>User: ${input.userId}</li><li>Tenant: ${input.tenantId}</li><li>Audit: ${input.auditId}</li><li>Submitted: ${submittedAt}</li><li>Files: ${details}</li></ul><p>Note: ${input.note || 'Not provided'}</p>`,
      idempotencyKey: `information-required-internal:${input.submissionId}`,
    }) });
  }
  const statuses: { seller: EmailDeliveryResult; internal: EmailDeliveryResult } = {
    seller: input.email ? { status: 'failed' } : { status: 'skipped' },
    internal: internalEmail ? { status: 'failed' } : { status: 'skipped' },
  };
  const results = await Promise.allSettled(sellerTasks.map(({ task }) => task));
  results.forEach((result, index) => {
    const kind = sellerTasks[index].kind;
    if (result.status === 'fulfilled') {
      const value = result.value as { provider?: 'resend'; providerMessageId?: string | null } | undefined;
      statuses[kind] = {
        status: 'sent',
        provider: value?.provider || 'resend',
        providerMessageId: value?.providerMessageId || null,
      };
      logger.info('[INFORMATION REQUIRED] Notification accepted by provider', {
        channel: kind,
        submissionId: input.submissionId,
        provider: statuses[kind].provider,
        providerMessageId: statuses[kind].providerMessageId,
      });
      return;
    }
    const error = result.reason?.message || String(result.reason);
    statuses[kind] = { status: 'failed', error };
    logger.error('[INFORMATION REQUIRED] Notification failed after durable submission', {
      channel: kind,
      submissionId: input.submissionId,
      error,
    });
  });
  return statuses;
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = String((req as any).userId || '');
    const tenantId = String((req as any).tenant?.tenantId || '');
    const auditId = String(req.query.auditId || '').trim();
    if (!userId || !tenantId) return res.status(401).json({ success: false, error: 'Authenticated tenant context is required.' });
    const userUuid = convertUserIdToUuid(userId);
    const db = supabaseAdmin || supabase;
    let auditQuery = db.from('audit_runs').select('id, status, source_type, summary, created_at, updated_at').eq('user_id', userUuid).eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(1);
    if (auditId) auditQuery = db.from('audit_runs').select('id, status, source_type, summary, created_at, updated_at').eq('id', auditId).eq('user_id', userUuid).eq('tenant_id', tenantId).limit(1);
    const { data: audits, error: auditError } = await auditQuery;
    if (auditError) throw new Error(auditError.message);
    const audit = audits?.[0] || null;
    if (!audit) return res.status(404).json({ success: false, error: 'Audit not found.' });
    const { data: submission, error } = await db.from('information_required_submissions').select('id, audit_run_id, note, status, submitted_at, created_at, updated_at').eq('audit_run_id', audit.id).eq('tenant_id', tenantId).eq('user_id', userUuid).maybeSingle();
    if (error) throw new Error(error.message);
    return res.json({ success: true, audit, submission: submission || null });
  } catch (error: any) {
    logger.error('[INFORMATION REQUIRED] Failed to load state', { error: error?.message || String(error) });
    return res.status(500).json({ success: false, error: 'Unable to load the information request.' });
  }
});

router.post('/submit', (req: Request, res: Response, next: NextFunction) => {
  upload.array('files', MAX_FILES)(req, res, (err: any) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'This file is larger than 25 MB. Please choose a smaller file.'
      : err.message || 'Those files could not be uploaded. Please try again.';
    return res.status(400).json({ success: false, error: message });
  });
}, async (req: Request, res: Response) => {
  try {
    const userId = String((req as any).userId || '');
    const tenantId = String((req as any).tenant?.tenantId || '');
    if (!userId || !tenantId) return res.status(401).json({ success: false, error: 'Authenticated tenant context is required.' });
    const userUuid = convertUserIdToUuid(userId);
    const auditId = String(req.body?.auditId || req.query?.auditId || '').trim();
    if (!auditId) return res.status(400).json({ success: false, error: 'An audit is required for this submission.' });
    const files = ((req.files || []) as UploadedInformationFile[]);
    if (!files.length) return res.status(400).json({ success: false, error: 'Add at least one file to continue.' });
    const db = supabaseAdmin || supabase;
    const { data: audit, error: auditError } = await db.from('audit_runs').select('id, status, user_id, tenant_id').eq('id', auditId).eq('user_id', userUuid).eq('tenant_id', tenantId).maybeSingle();
    if (auditError) throw new Error(auditError.message);
    if (!audit) return res.status(404).json({ success: false, error: 'Audit not found.' });
    const { data: existing, error: existingError } = await db.from('information_required_submissions').select('id, status, submitted_at').eq('audit_run_id', auditId).eq('tenant_id', tenantId).eq('user_id', userUuid).maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) return res.json({ success: true, duplicate: true, submission: existing, message: 'Your files were already received.' });
    const storage = storageClient();
    if (!storage) return res.status(503).json({ success: false, error: 'File storage is temporarily unavailable. Please try again.' });
    await ensureEvidenceDocumentsBucket(storage);
    const { data: submission, error: submissionError } = await db.from('information_required_submissions').insert({ audit_run_id: auditId, tenant_id: tenantId, user_id: userUuid, note: typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 4000) || null : null }).select('*').single();
    if (submissionError) {
      if (submissionError.code === '23505') {
        const { data: raced } = await db.from('information_required_submissions').select('id, status, submitted_at').eq('audit_run_id', auditId).eq('tenant_id', tenantId).eq('user_id', userUuid).maybeSingle();
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
        const contentType = file.mimetype && file.mimetype !== 'application/octet-stream'
          ? file.mimetype
          : (file.originalname.toLowerCase().endsWith('.csv') ? 'text/csv' : file.mimetype || 'application/octet-stream');
        const { error: uploadError } = await storage.storage.from(BUCKET).upload(storagePath, file.buffer, { contentType, upsert: false });
        if (uploadError) {
          logger.error('[INFORMATION REQUIRED] Storage upload failed', { filename: file.originalname, contentType, error: uploadError.message });
          throw new Error(`Could not store ${file.originalname}: ${uploadError.message}`);
        }
        uploadedStoragePaths.push(storagePath);
        const { data: document, error: documentError } = await db.from('evidence_documents').insert({ id: documentId, user_id: userUuid, tenant_id: tenantId, seller_id: tenantId, external_id: `information_required:${submission.id}:${documentId}`, doc_type: 'other', filename: file.originalname, original_filename: file.originalname, content_type: contentType, mime_type: contentType, size_bytes: file.size, storage_path: storagePath, processing_status: 'pending', parser_status: 'pending', provider: 'information_required', ingested_at: new Date().toISOString(), information_required_submission_id: submission.id, metadata: { source: 'information_required', audit_run_id: auditId, submission_id: submission.id, original_filename: file.originalname } }).select('id, filename, size_bytes, content_type').single();
        if (documentError) {
          logger.error('[INFORMATION REQUIRED] Document insert failed', { filename: file.originalname, error: documentError.message });
          throw new Error(`Could not record ${file.originalname}: ${documentError.message}`);
        }
        saved.push(document);
      }
    } catch (fileError: any) {
      if (uploadedStoragePaths.length) {
        await storage.storage.from(BUCKET).remove(uploadedStoragePaths).catch(() => undefined);
      }
      await db.from('information_required_submissions').delete().eq('id', submission.id);
      return res.status(500).json({ success: false, error: fileError?.message || 'Files could not be stored. Please try again.' });
    }
    const { data: currentAudit, error: currentAuditError } = await db.from('audit_runs').select('summary').eq('id', auditId).maybeSingle();
    if (currentAuditError || !currentAudit) {
      logger.error('[INFORMATION REQUIRED] Review state lookup failed after durable submission', {
        submissionId: submission.id,
        auditId,
        error: currentAuditError?.message || 'Audit not found',
      });
    } else {
      const summary = currentAudit?.summary && typeof currentAudit.summary === 'object' ? currentAudit.summary : {};
      const { error: summaryError } = await db.from('audit_runs').update({
        summary: {
          ...summary,
          information_required: {
            status: 'review_pending',
            submission_id: submission.id,
            submitted_at: submission.submitted_at,
            file_count: saved.length,
          },
        },
        updated_at: new Date().toISOString(),
      }).eq('id', auditId).eq('tenant_id', tenantId);
      if (summaryError) {
        logger.error('[INFORMATION REQUIRED] Review state update failed after durable submission', {
          submissionId: submission.id,
          auditId,
          error: summaryError.message,
        });
      }
    }
    const { data: user, error: userError } = await db.from('users').select('email').eq('id', userUuid).maybeSingle();
    if (userError) logger.error('[INFORMATION REQUIRED] Seller email lookup failed after durable submission', { submissionId: submission.id, error: userError.message });
    let emailDelivery: { seller: EmailDeliveryResult; internal: EmailDeliveryResult } = {
      seller: { status: 'skipped' },
      internal: { status: 'skipped' },
    };
    try {
      emailDelivery = await sendSubmissionEmails({ email: user?.email || null, tenantId, userId, auditId, submissionId: submission.id, filenames: files.map((file) => file.originalname), note: submission.note });
    } catch (emailError: any) {
      logger.error('[INFORMATION REQUIRED] Notification threw after durable submission', {
        submissionId: submission.id,
        error: emailError?.message || String(emailError),
      });
      emailDelivery = {
        seller: user?.email ? { status: 'failed', error: emailError?.message || String(emailError) } : { status: 'skipped' },
        internal: { status: 'failed', error: emailError?.message || String(emailError) },
      };
    }
    return res.status(201).json({ success: true, submission: { id: submission.id, status: submission.status, submitted_at: submission.submitted_at }, files: saved, emailDelivery, message: 'Files received. Our review team has received your files.' });
  } catch (error: any) {
    logger.error('[INFORMATION REQUIRED] Submission failed', { error: error?.message || String(error) });
    const detail = String(error?.message || '').trim().slice(0, 280);
    return res.status(500).json({
      success: false,
      error: detail
        ? `We could not receive these files. ${detail}`
        : 'We could not receive these files. Please try again.',
    });
  }
});

export default router;
