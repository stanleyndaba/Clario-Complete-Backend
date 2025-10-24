"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSecureToken = exports.generateRandomString = exports.verifyPassword = exports.hashPassword = exports.decryptToken = exports.encryptToken = void 0;
const crypto_1 = __importDefault(require("crypto"));
const logger_1 = require("./logger");
const logger = (0, logger_1.getLogger)('Encryption');
const ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
}
if (ENCRYPTION_KEY.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be exactly 32 characters long');
}
const encryptToken = (text) => {
    try {
        const iv = crypto_1.default.randomBytes(16);
        const cipher = crypto_1.default.createCipher(ALGORITHM, ENCRYPTION_KEY);
        cipher.setAutoPadding(true);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
    }
    catch (error) {
        logger.error('Error encrypting token:', error);
        throw new Error('Failed to encrypt token');
    }
};
exports.encryptToken = encryptToken;
const decryptToken = (encryptedText) => {
    try {
        const textParts = encryptedText.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedData = textParts.join(':');
        const decipher = crypto_1.default.createDecipher(ALGORITHM, ENCRYPTION_KEY);
        decipher.setAutoPadding(true);
        let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
    catch (error) {
        logger.error('Error decrypting token:', error);
        throw new Error('Failed to decrypt token');
    }
};
exports.decryptToken = decryptToken;
const hashPassword = async (password) => {
    try {
        const salt = crypto_1.default.randomBytes(16).toString('hex');
        const hash = crypto_1.default.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
        return salt + ':' + hash;
    }
    catch (error) {
        logger.error('Error hashing password:', error);
        throw new Error('Failed to hash password');
    }
};
exports.hashPassword = hashPassword;
const verifyPassword = async (password, hashedPassword) => {
    try {
        const [salt, hash] = hashedPassword.split(':');
        const verifyHash = crypto_1.default.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
        return hash === verifyHash;
    }
    catch (error) {
        logger.error('Error verifying password:', error);
        return false;
    }
};
exports.verifyPassword = verifyPassword;
const generateRandomString = (length = 32) => {
    return crypto_1.default.randomBytes(length).toString('hex');
};
exports.generateRandomString = generateRandomString;
const generateSecureToken = () => {
    return crypto_1.default.randomBytes(32).toString('base64url');
};
exports.generateSecureToken = generateSecureToken;
//# sourceMappingURL=encryption.js.map