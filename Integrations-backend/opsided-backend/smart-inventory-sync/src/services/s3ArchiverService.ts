import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import { getLogger } from '../../../shared/utils/logger';
import { getDatabase } from '../../../shared/db/connection';

const logger = getLogger('S3Archiver');

export interface ArchiveJSONOptions {
  bucket: string;
  region: string;
  prefix: string;
  userId: string;
  dataset: string;
  data: any;
  jobId?: string;
}

export class S3Archiver {
  static async archiveJSON(opts: ArchiveJSONOptions): Promise<{ key: string }> {
    const { bucket, region, prefix, userId, dataset, data, jobId } = opts;

    if (!bucket || !region) throw new Error('Missing S3 configuration');

    const s3 = new S3Client({ region });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const hash = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 12);
    const key = `${prefix}/${userId}/${dataset}/${timestamp}_${hash}.json`;

    const body = JSON.stringify(data);

    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json',
    }));

    // Audit log in Postgres
    const db = getDatabase();
    await db('data_archives').insert({
      user_id: userId,
      dataset,
      storage_type: 's3',
      location: `s3://${bucket}/${key}`,
      job_id: jobId || null,
      created_at: new Date(),
      metadata: { size: Buffer.byteLength(body), region },
    });

    logger.info(`Archived raw dataset to S3: s3://${bucket}/${key}`);
    return { key };
  }
}







