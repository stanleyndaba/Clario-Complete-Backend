import crypto from 'crypto';
import { getLogger } from './logger';

const logger = getLogger('Encryption');

const ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY environment variable is required');
}

if (ENCRYPTION_KEY.length !== 32) {
  throw new Error('ENCRYPTION_KEY must be exactly 32 characters long');
}

export const encryptToken = (text: string): string => {
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher(ALGORITHM, ENCRYPTION_KEY);
    cipher.setAutoPadding(true);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
  } catch (error) {
    logger.error('Error encrypting token:', error);
    throw new Error('Failed to encrypt token');
  }
};

export const decryptToken = (encryptedText: string): string => {
  try {
    const textParts = encryptedText.split(':');
    const iv = Buffer.from(textParts.shift()!, 'hex');
    const encryptedData = textParts.join(':');
    
    const decipher = crypto.createDecipher(ALGORITHM, ENCRYPTION_KEY);
    decipher.setAutoPadding(true);
    
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    logger.error('Error decrypting token:', error);
    throw new Error('Failed to decrypt token');
  }
};

export const hashPassword = async (password: string): Promise<string> => {
  try {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return salt + ':' + hash;
  } catch (error) {
    logger.error('Error hashing password:', error);
    throw new Error('Failed to hash password');
  }
};

export const verifyPassword = async (password: string, hashedPassword: string): Promise<boolean> => {
  try {
    const [salt, hash] = hashedPassword.split(':');
    const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
  } catch (error) {
    logger.error('Error verifying password:', error);
    return false;
  }
};

export const generateRandomString = (length: number = 32): string => {
  return crypto.randomBytes(length).toString('hex');
};

export const generateSecureToken = (): string => {
  return crypto.randomBytes(32).toString('base64url');
}; 