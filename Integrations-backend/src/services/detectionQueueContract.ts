export type DetectionQueueSourceType = 'sp_api' | 'csv_upload';

export type DetectionQueueTriggerType =
  | 'sp_api_sync'
  | 'csv_upload'
  | 'manual'
  | 'inventory'
  | 'financial'
  | 'product';

export interface DetectionQueuePayloadCore {
  tenant_id: string;
  sync_id: string;
  source_type: DetectionQueueSourceType;
  trigger_type: DetectionQueueTriggerType;
  seller_id: string;
}

export function buildDetectionQueuePayload(
  core: DetectionQueuePayloadCore,
  extras: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    tenant_id: core.tenant_id,
    sync_id: core.sync_id,
    source_type: core.source_type,
    source: core.source_type,
    trigger_type: core.trigger_type,
    seller_id: core.seller_id,
    ...extras,
  };
}

