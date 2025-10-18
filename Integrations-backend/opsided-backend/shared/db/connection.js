"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkDatabaseHealth = exports.closeDatabase = exports.getDatabase = void 0;
const knex_1 = __importDefault(require("knex"));
const logger_1 = require("../utils/logger");
const logger = (0, logger_1.getLogger)('Database');
const getDatabaseConfig = () => ({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'opsided_db',
    user: process.env.DB_USER || 'opsided_user',
    password: process.env.DB_PASSWORD || 'opsided_password',
});
const createConnection = () => {
    const config = getDatabaseConfig();
    logger.info(`Connecting to database: ${config.database} on ${config.host}:${config.port}`);
    return (0, knex_1.default)({
        client: 'postgresql',
        connection: {
            host: config.host,
            port: config.port,
            database: config.database,
            user: config.user,
            password: config.password,
        },
        pool: {
            min: 2,
            max: 10,
        },
        migrations: {
            directory: __dirname + '/migrations',
        },
        seeds: {
            directory: __dirname + '/seeds',
        },
    });
};
// Singleton instance
let db = null;
const getDatabase = () => {
    if (!db) {
        db = createConnection();
    }
    return db;
};
exports.getDatabase = getDatabase;
const closeDatabase = async () => {
    if (db) {
        await db.destroy();
        db = null;
        logger.info('Database connection closed');
    }
};
exports.closeDatabase = closeDatabase;
// Health check
const checkDatabaseHealth = async () => {
    try {
        const database = (0, exports.getDatabase)();
        await database.raw('SELECT 1');
        return true;
    }
    catch (error) {
        logger.error('Database health check failed:', error);
        return false;
    }
};
exports.checkDatabaseHealth = checkDatabaseHealth;
