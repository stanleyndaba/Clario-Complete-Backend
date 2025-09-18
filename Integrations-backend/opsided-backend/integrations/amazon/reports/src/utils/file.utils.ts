import { getLogger } from '@/shared/utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const logger = getLogger('FileUtils');

export interface FileInfo {
  path: string;
  size: number;
  extension: string;
  mimeType: string;
  checksum: string;
  lastModified: Date;
}

export class FileUtils {
  /**
   * Get file information
   */
  static async getFileInfo(filePath: string): Promise<FileInfo> {
    try {
      const stats = fs.statSync(filePath);
      const extension = path.extname(filePath).toLowerCase();
      const mimeType = this.getMimeType(extension);
      const checksum = await this.calculateChecksum(filePath);

      return {
        path: filePath,
        size: stats.size,
        extension,
        mimeType,
        checksum,
        lastModified: stats.mtime
      };
    } catch (error) {
      logger.error('Failed to get file info:', error);
      throw error;
    }
  }

  /**
   * Calculate file checksum
   */
  static async calculateChecksum(filePath: string, algorithm: string = 'md5'): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash(algorithm);
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => {
        hash.update(data);
      });

      stream.on('end', () => {
        resolve(hash.digest('hex'));
      });

      stream.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Get MIME type based on file extension
   */
  static getMimeType(extension: string): string {
    const mimeTypes: Record<string, string> = {
      '.csv': 'text/csv',
      '.tsv': 'text/tab-separated-values',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.txt': 'text/plain',
      '.zip': 'application/zip',
      '.gz': 'application/gzip',
      '.bz2': 'application/x-bzip2'
    };

    return mimeTypes[extension] || 'application/octet-stream';
  }

  /**
   * Validate file exists and is readable
   */
  static validateFile(filePath: string): boolean {
    try {
      if (!fs.existsSync(filePath)) {
        logger.error('File does not exist:', filePath);
        return false;
      }

      const stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        logger.error('Path is not a file:', filePath);
        return false;
      }

      // Check if file is readable
      fs.accessSync(filePath, fs.constants.R_OK);
      
      return true;
    } catch (error) {
      logger.error('File validation failed:', error);
      return false;
    }
  }

  /**
   * Create directory if it doesn't exist
   */
  static ensureDirectoryExists(dirPath: string): void {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        logger.info('Created directory:', dirPath);
      }
    } catch (error) {
      logger.error('Failed to create directory:', error);
      throw error;
    }
  }

  /**
   * Clean up old files
   */
  static async cleanupOldFiles(dirPath: string, maxAgeHours: number = 24): Promise<number> {
    try {
      logger.info('Cleaning up old files', { dirPath, maxAgeHours });

      if (!fs.existsSync(dirPath)) {
        return 0;
      }

      const files = fs.readdirSync(dirPath);
      const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);
      let deletedCount = 0;

      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = fs.statSync(filePath);

        if (stats.isFile() && stats.mtime.getTime() < cutoffTime) {
          try {
            fs.unlinkSync(filePath);
            deletedCount++;
            logger.debug('Deleted old file:', filePath);
          } catch (error) {
            logger.error('Failed to delete old file:', { filePath, error });
          }
        }
      }

      logger.info('Cleanup completed', { deletedCount });
      return deletedCount;
    } catch (error) {
      logger.error('Failed to cleanup old files:', error);
      throw error;
    }
  }

  /**
   * Get file size in human readable format
   */
  static formatFileSize(bytes: number): string {
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    
    if (bytes === 0) return '0 Bytes';
    
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Check if file is compressed
   */
  static isCompressedFile(filePath: string): boolean {
    const extension = path.extname(filePath).toLowerCase();
    const compressedExtensions = ['.zip', '.gz', '.bz2', '.7z', '.rar'];
    return compressedExtensions.includes(extension);
  }

  /**
   * Get file encoding
   */
  static async detectFileEncoding(filePath: string): Promise<string> {
    try {
      // Read first few bytes to detect encoding
      const buffer = fs.readFileSync(filePath, { encoding: null });
      const sample = buffer.slice(0, 1024);

      // Check for BOM (Byte Order Mark)
      if (sample.length >= 3 && sample[0] === 0xEF && sample[1] === 0xBB && sample[2] === 0xBF) {
        return 'utf8';
      }

      if (sample.length >= 2 && sample[0] === 0xFF && sample[1] === 0xFE) {
        return 'utf16le';
      }

      if (sample.length >= 2 && sample[0] === 0xFE && sample[1] === 0xFF) {
        return 'utf16be';
      }

      // Default to utf8
      return 'utf8';
    } catch (error) {
      logger.error('Failed to detect file encoding:', error);
      return 'utf8';
    }
  }

  /**
   * Validate CSV file structure
   */
  static async validateCSVStructure(filePath: string, expectedColumns?: string[]): Promise<{
    isValid: boolean;
    columns: string[];
    rowCount: number;
    errors: string[];
  }> {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      
      if (lines.length === 0) {
        return {
          isValid: false,
          columns: [],
          rowCount: 0,
          errors: ['File is empty']
        };
      }

      const headerLine = lines[0];
      const columns = headerLine.split(',').map(col => col.trim().replace(/"/g, ''));
      const rowCount = lines.length - 1; // Exclude header
      const errors: string[] = [];

      // Check if expected columns are present
      if (expectedColumns) {
        for (const expectedCol of expectedColumns) {
          if (!columns.includes(expectedCol)) {
            errors.push(`Missing expected column: ${expectedCol}`);
          }
        }
      }

      // Check for consistent column count
      const expectedColumnCount = columns.length;
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const values = line.split(',');
        if (values.length !== expectedColumnCount) {
          errors.push(`Row ${i + 1} has inconsistent column count`);
        }
      }

      return {
        isValid: errors.length === 0,
        columns,
        rowCount,
        errors
      };
    } catch (error) {
      logger.error('Failed to validate CSV structure:', error);
      return {
        isValid: false,
        columns: [],
        rowCount: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      };
    }
  }

  /**
   * Create temporary file
   */
  static createTempFile(prefix: string = 'fba_report', suffix: string = '.tmp'): string {
    const tempDir = process.env.TEMP || process.env.TMP || '/tmp';
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2);
    const fileName = `${prefix}_${timestamp}_${random}${suffix}`;
    const filePath = path.join(tempDir, fileName);

    // Create empty file
    fs.writeFileSync(filePath, '');
    
    logger.debug('Created temp file:', filePath);
    return filePath;
  }

  /**
   * Safely delete file
   */
  static safeDeleteFile(filePath: string): boolean {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.debug('Deleted file:', filePath);
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Failed to delete file:', { filePath, error });
      return false;
    }
  }
} 