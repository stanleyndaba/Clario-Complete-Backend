import AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

// Configure AWS SDK
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
});

const s3 = new AWS.S3();
const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'opside-cost-documents';

export interface UploadResult {
  fileKey: string;
  originalName: string;
  fileSize: number;
  fileType: string;
  url: string;
}

export interface DownloadResult {
  url: string;
  expiresIn: number;
}

export class S3Service {
  /**
   * Upload file to S3
   */
  static async uploadFile(
    file: Express.Multer.File,
    claimId: string,
    skuId: string
  ): Promise<UploadResult> {
    try {
      const fileKey = this.generateFileKey(claimId, skuId, file.originalname);
      
      const uploadParams = {
        Bucket: BUCKET_NAME,
        Key: fileKey,
        Body: file.buffer,
        ContentType: file.mimetype,
        Metadata: {
          'original-name': file.originalname,
          'claim-id': claimId,
          'sku-id': skuId,
          'uploaded-by': 'cost-documentation-module',
        },
        ServerSideEncryption: 'AES256', // or 'aws:kms' for KMS encryption
      };

      const result = await s3.upload(uploadParams).promise();
      
      logger.info('File uploaded to S3', {
        fileKey,
        originalName: file.originalname,
        fileSize: file.size,
        claimId,
        skuId,
      });

      return {
        fileKey,
        originalName: file.originalname,
        fileSize: file.size,
        fileType: file.mimetype,
        url: result.Location,
      };
    } catch (error) {
      logger.error('S3 upload failed', { error, claimId, skuId });
      throw new Error(`Failed to upload file to S3: ${error}`);
    }
  }

  /**
   * Generate presigned URL for file download
   */
  static async generateDownloadUrl(fileKey: string, expiresIn: number = 3600): Promise<DownloadResult> {
    try {
      const params = {
        Bucket: BUCKET_NAME,
        Key: fileKey,
        Expires: expiresIn,
      };

      const url = await s3.getSignedUrlPromise('getObject', params);
      
      logger.info('Generated download URL', { fileKey, expiresIn });
      
      return { url, expiresIn };
    } catch (error) {
      logger.error('Failed to generate download URL', { error, fileKey });
      throw new Error(`Failed to generate download URL: ${error}`);
    }
  }

  /**
   * Delete file from S3
   */
  static async deleteFile(fileKey: string): Promise<void> {
    try {
      const params = {
        Bucket: BUCKET_NAME,
        Key: fileKey,
      };

      await s3.deleteObject(params).promise();
      
      logger.info('File deleted from S3', { fileKey });
    } catch (error) {
      logger.error('Failed to delete file from S3', { error, fileKey });
      throw new Error(`Failed to delete file from S3: ${error}`);
    }
  }

  /**
   * Check if file exists in S3
   */
  static async fileExists(fileKey: string): Promise<boolean> {
    try {
      const params = {
        Bucket: BUCKET_NAME,
        Key: fileKey,
      };

      await s3.headObject(params).promise();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get file metadata from S3
   */
  static async getFileMetadata(fileKey: string): Promise<AWS.S3.HeadObjectOutput> {
    try {
      const params = {
        Bucket: BUCKET_NAME,
        Key: fileKey,
      };

      const metadata = await s3.headObject(params).promise();
      return metadata;
    } catch (error) {
      logger.error('Failed to get file metadata', { error, fileKey });
      throw new Error(`Failed to get file metadata: ${error}`);
    }
  }

  /**
   * Generate unique file key for S3
   */
  private static generateFileKey(claimId: string, skuId: string, originalName: string): string {
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const uniqueId = uuidv4();
    const fileExtension = originalName.split('.').pop() || '';
    const sanitizedName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
    
    return `cost-documents/${timestamp}/${claimId}/${skuId}/${uniqueId}_${sanitizedName}`;
  }

  /**
   * Validate file type and size
   */
  static validateFile(file: Express.Multer.File): void {
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/gif',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv',
    ];

    const maxSize = 10 * 1024 * 1024; // 10MB

    if (!allowedTypes.includes(file.mimetype)) {
      throw new Error(`File type ${file.mimetype} is not allowed`);
    }

    if (file.size > maxSize) {
      throw new Error(`File size ${file.size} exceeds maximum allowed size of ${maxSize}`);
    }
  }
} 