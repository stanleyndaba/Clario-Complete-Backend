import { getLogger } from '@/shared/utils/logger';
import { getDatabase } from '@/shared/db/connection';
import { ReportType, ReportStatus } from '@/types';
import * as AWS from 'aws-sdk';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

const logger = getLogger('ReportStorageService');

export interface StorageConfig {
  s3Bucket: string;
  s3Region: string;
  s3Prefix: string;
  localTempDir: string;
}

export interface StorageResult {
  s3Key: string;
  s3Url: string;
  size: number;
  recordCount: number;
}

export class ReportStorageService {
  private s3: AWS.S3;
  private config: StorageConfig;
  private db = getDatabase();

  constructor(config: StorageConfig) {
    this.config = config;
    this.initializeS3();
  }

  /**
   * Initialize S3 client
   */
  private initializeS3(): void {
    this.s3 = new AWS.S3({
      region: this.config.s3Region,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    });

    logger.info('S3 client initialized', { 
      bucket: this.config.s3Bucket, 
      region: this.config.s3Region 
    });
  }

  /**
   * Upload raw report file to S3
   */
  async uploadRawFile(
    localFilePath: string, 
    userId: string, 
    reportType: ReportType,
    reportId: string
  ): Promise<StorageResult> {
    try {
      logger.info('Uploading raw report file to S3', { 
        localFilePath, 
        userId, 
        reportType, 
        reportId 
      });

      if (!fs.existsSync(localFilePath)) {
        throw new Error(`Local file not found: ${localFilePath}`);
      }

      const fileStats = fs.statSync(localFilePath);
      const fileName = path.basename(localFilePath);
      const s3Key = `${this.config.s3Prefix}/raw/${userId}/${reportType}/${reportId}/${fileName}`;

      const fileStream = fs.createReadStream(localFilePath);

      const uploadParams: AWS.S3.PutObjectRequest = {
        Bucket: this.config.s3Bucket,
        Key: s3Key,
        Body: fileStream,
        ContentType: this.getContentType(fileName),
        Metadata: {
          userId,
          reportType,
          reportId,
          originalName: fileName,
          uploadedAt: new Date().toISOString()
        }
      };

      const result = await this.s3.upload(uploadParams).promise();

      logger.info('Raw report file uploaded successfully', {
        s3Key: result.Key,
        s3Url: result.Location,
        size: fileStats.size
      });

      return {
        s3Key: result.Key!,
        s3Url: result.Location,
        size: fileStats.size,
        recordCount: 0 // Raw files don't have record count
      };
    } catch (error) {
      logger.error('Failed to upload raw report file:', error);
      throw error;
    }
  }

  /**
   * Store processed report data in database
   */
  async storeProcessedData(
    userId: string,
    reportId: string,
    reportType: ReportType,
    records: any[],
    tableName: string
  ): Promise<{ recordCount: number; processingTime: number }> {
    try {
      logger.info('Storing processed report data in database', {
        userId,
        reportId,
        reportType,
        recordCount: records.length,
        tableName
      });

      const startTime = Date.now();

      if (records.length === 0) {
        logger.warn('No records to store', { reportId, reportType });
        return { recordCount: 0, processingTime: 0 };
      }

      // Batch insert records
      const batchSize = 1000;
      let totalInserted = 0;

      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        
        // Add metadata to each record
        const recordsWithMetadata = batch.map(record => ({
          ...record,
          user_id: userId,
          report_id: reportId,
          report_type: reportType,
          created_at: new Date(),
          updated_at: new Date()
        }));

        try {
          await this.db(tableName).insert(recordsWithMetadata);
          totalInserted += batch.length;
          
          logger.debug(`Inserted batch ${Math.floor(i / batchSize) + 1}`, {
            batchSize: batch.length,
            totalInserted
          });
        } catch (error) {
          logger.error('Failed to insert batch:', error);
          throw error;
        }
      }

      const processingTime = Date.now() - startTime;

      logger.info('Processed report data stored successfully', {
        reportId,
        reportType,
        totalInserted,
        processingTime
      });

      return { recordCount: totalInserted, processingTime };
    } catch (error) {
      logger.error('Failed to store processed report data:', error);
      throw error;
    }
  }

  /**
   * Store inventory records
   */
  async storeInventoryRecords(
    userId: string,
    reportId: string,
    records: any[]
  ): Promise<{ recordCount: number; processingTime: number }> {
    return this.storeProcessedData(userId, reportId, ReportType.INVENTORY_LEDGER, records, 'fba_inventory');
  }

  /**
   * Store reimbursement records
   */
  async storeReimbursementRecords(
    userId: string,
    reportId: string,
    records: any[]
  ): Promise<{ recordCount: number; processingTime: number }> {
    return this.storeProcessedData(userId, reportId, ReportType.FBA_REIMBURSEMENTS, records, 'fba_reimbursements');
  }

  /**
   * Store returns records
   */
  async storeReturnsRecords(
    userId: string,
    reportId: string,
    records: any[]
  ): Promise<{ recordCount: number; processingTime: number }> {
    return this.storeProcessedData(userId, reportId, ReportType.FBA_RETURNS, records, 'fba_returns');
  }

  /**
   * Store fee records
   */
  async storeFeeRecords(
    userId: string,
    reportId: string,
    records: any[]
  ): Promise<{ recordCount: number; processingTime: number }> {
    return this.storeProcessedData(userId, reportId, ReportType.FEE_PREVIEW, records, 'fba_fees');
  }

  /**
   * Store adjustment records
   */
  async storeAdjustmentRecords(
    userId: string,
    reportId: string,
    records: any[]
  ): Promise<{ recordCount: number; processingTime: number }> {
    return this.storeProcessedData(userId, reportId, ReportType.INVENTORY_ADJUSTMENTS, records, 'fba_adjustments');
  }

  /**
   * Store generic records
   */
  async storeGenericRecords(
    userId: string,
    reportId: string,
    reportType: ReportType,
    records: any[]
  ): Promise<{ recordCount: number; processingTime: number }> {
    const tableName = `fba_${reportType.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    return this.storeProcessedData(userId, reportId, reportType, records, tableName);
  }

  /**
   * Download file from S3
   */
  async downloadFromS3(s3Key: string, localFilePath: string): Promise<{ size: number }> {
    try {
      logger.info('Downloading file from S3', { s3Key, localFilePath });

      // Ensure directory exists
      const dir = path.dirname(localFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const params: AWS.S3.GetObjectRequest = {
        Bucket: this.config.s3Bucket,
        Key: s3Key
      };

      const result = await this.s3.getObject(params).promise();
      
      if (!result.Body) {
        throw new Error('No body in S3 response');
      }

      // Write file to local filesystem
      fs.writeFileSync(localFilePath, result.Body as Buffer);

      const stats = fs.statSync(localFilePath);

      logger.info('File downloaded successfully from S3', {
        s3Key,
        localFilePath,
        size: stats.size
      });

      return { size: stats.size };
    } catch (error) {
      logger.error('Failed to download file from S3:', error);
      throw error;
    }
  }

  /**
   * Delete file from S3
   */
  async deleteFromS3(s3Key: string): Promise<void> {
    try {
      logger.info('Deleting file from S3', { s3Key });

      const params: AWS.S3.DeleteObjectRequest = {
        Bucket: this.config.s3Bucket,
        Key: s3Key
      };

      await this.s3.deleteObject(params).promise();

      logger.info('File deleted successfully from S3', { s3Key });
    } catch (error) {
      logger.error('Failed to delete file from S3:', error);
      throw error;
    }
  }

  /**
   * Get S3 URL for a file
   */
  getS3Url(s3Key: string): string {
    return `https://${this.config.s3Bucket}.s3.${this.config.s3Region}.amazonaws.com/${s3Key}`;
  }

  /**
   * Generate temporary local file path
   */
  generateTempFilePath(userId: string, reportId: string, extension: string = '.csv'): string {
    const fileName = `${reportId}_${Date.now()}${extension}`;
    return path.join(this.config.localTempDir, userId, fileName);
  }

  /**
   * Clean up temporary files
   */
  async cleanupTempFiles(filePaths: string[]): Promise<void> {
    try {
      for (const filePath of filePaths) {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          logger.debug('Cleaned up temp file', { filePath });
        }
      }
    } catch (error) {
      logger.error('Failed to cleanup temp files:', error);
      // Don't throw error for cleanup failures
    }
  }

  /**
   * Get file content type based on extension
   */
  private getContentType(fileName: string): string {
    const extension = path.extname(fileName).toLowerCase();
    
    switch (extension) {
      case '.csv':
        return 'text/csv';
      case '.tsv':
        return 'text/tab-separated-values';
      case '.json':
        return 'application/json';
      case '.xml':
        return 'application/xml';
      case '.txt':
        return 'text/plain';
      default:
        return 'application/octet-stream';
    }
  }

  /**
   * Test S3 connection
   */
  async testS3Connection(): Promise<boolean> {
    try {
      logger.info('Testing S3 connection');

      const params: AWS.S3.HeadBucketRequest = {
        Bucket: this.config.s3Bucket
      };

      await this.s3.headBucket(params).promise();
      
      logger.info('S3 connection test successful');
      return true;
    } catch (error) {
      logger.error('S3 connection test failed:', error);
      return false;
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(userId: string): Promise<{
    totalFiles: number;
    totalSize: number;
    fileTypes: Record<string, number>;
  }> {
    try {
      const prefix = `${this.config.s3Prefix}/raw/${userId}/`;
      
      const params: AWS.S3.ListObjectsV2Request = {
        Bucket: this.config.s3Bucket,
        Prefix: prefix
      };

      const result = await this.s3.listObjectsV2(params).promise();
      
      const files = result.Contents || [];
      let totalSize = 0;
      const fileTypes: Record<string, number> = {};

      files.forEach(file => {
        if (file.Size) {
          totalSize += file.Size;
        }
        
        if (file.Key) {
          const extension = path.extname(file.Key).toLowerCase();
          fileTypes[extension] = (fileTypes[extension] || 0) + 1;
        }
      });

      return {
        totalFiles: files.length,
        totalSize,
        fileTypes
      };
    } catch (error) {
      logger.error('Failed to get storage stats:', error);
      throw error;
    }
  }

  /**
   * Archive old files
   */
  async archiveOldFiles(userId: string, daysOld: number = 90): Promise<number> {
    try {
      logger.info('Archiving old files', { userId, daysOld });

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const prefix = `${this.config.s3Prefix}/raw/${userId}/`;
      
      const params: AWS.S3.ListObjectsV2Request = {
        Bucket: this.config.s3Bucket,
        Prefix: prefix
      };

      const result = await this.s3.listObjectsV2(params).promise();
      const files = result.Contents || [];
      let archivedCount = 0;

      for (const file of files) {
        if (file.LastModified && file.LastModified < cutoffDate) {
          // Move to archive folder
          const archiveKey = file.Key!.replace('/raw/', '/archive/');
          
          await this.s3.copyObject({
            Bucket: this.config.s3Bucket,
            CopySource: `${this.config.s3Bucket}/${file.Key}`,
            Key: archiveKey
          }).promise();

          await this.s3.deleteObject({
            Bucket: this.config.s3Bucket,
            Key: file.Key!
          }).promise();

          archivedCount++;
        }
      }

      logger.info(`Archived ${archivedCount} old files`);
      return archivedCount;
    } catch (error) {
      logger.error('Failed to archive old files:', error);
      throw error;
    }
  }
} 