import { supabase } from '../database/supabaseClient';

export class IngestionStorageFailureError extends Error {
  readonly documentId?: string;

  constructor(message: string, documentId?: string) {
    super(message);
    this.name = 'IngestionStorageFailureError';
    this.documentId = documentId;
  }
}

function normalizeMetadata(metadata: any): Record<string, any> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }

  return metadata;
}

function truncateErrorMessage(message: string): string {
  return message.substring(0, 500);
}

export function buildInitialStorageMetadata(metadata: any, hasSourceContent: boolean): Record<string, any> {
  return {
    ...normalizeMetadata(metadata),
    has_content: false,
    source_content_available: hasSourceContent,
    storage_upload_status: hasSourceContent ? 'pending' : 'not_required',
    storage_upload_error: null,
    storage_upload_failed_at: null
  };
}

export function buildStoredStorageMetadata(
  metadata: any,
  bucketName: string,
  filePath: string,
  contentSize: number
): Record<string, any> {
  return {
    ...normalizeMetadata(metadata),
    has_content: true,
    source_content_available: true,
    content_size: contentSize,
    storage_path: filePath,
    storage_bucket: bucketName,
    storage_upload_status: 'stored',
    storage_upload_error: null,
    storage_upload_failed_at: null
  };
}

export function buildStorageFailureMetadata(metadata: any, errorMessage: string): Record<string, any> {
  return {
    ...normalizeMetadata(metadata),
    has_content: false,
    source_content_available: true,
    storage_path: null,
    storage_bucket: null,
    storage_upload_status: 'failed',
    storage_upload_error: truncateErrorMessage(errorMessage),
    storage_upload_failed_at: new Date().toISOString()
  };
}

export function hasFailedStorageUpload(document: any): boolean {
  return normalizeMetadata(document?.metadata).storage_upload_status === 'failed';
}

export function isStorageReadyEvidenceDocument(document: any): boolean {
  const metadata = normalizeMetadata(document?.metadata);

  if (metadata.storage_upload_status === 'failed') {
    return false;
  }

  if (metadata.source_content_available === true) {
    return Boolean(document?.storage_path) || metadata.storage_upload_status === 'stored';
  }

  return true;
}

export async function markDocumentStorageFailure(
  documentId: string,
  metadata: any,
  errorMessage: string
): Promise<void> {
  const now = new Date().toISOString();

  await supabase
    .from('evidence_documents')
    .update({
      file_url: null,
      storage_path: null,
      processing_status: 'failed',
      parser_status: 'failed',
      parser_error: truncateErrorMessage(errorMessage),
      updated_at: now,
      metadata: buildStorageFailureMetadata(metadata, errorMessage)
    })
    .eq('id', documentId);
}

export async function markDocumentStorageSuccess(
  documentId: string,
  metadata: any,
  bucketName: string,
  filePath: string,
  fileUrl: string,
  contentSize: number
): Promise<void> {
  await supabase
    .from('evidence_documents')
    .update({
      file_url: fileUrl,
      storage_path: filePath,
      processing_status: 'pending',
      parser_status: 'pending',
      parser_error: null,
      metadata: buildStoredStorageMetadata(metadata, bucketName, filePath, contentSize)
    })
    .eq('id', documentId);
}
