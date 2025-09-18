import knex from 'knex';
import { getLogger } from '../utils/logger';

const logger = getLogger('Database');

interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

const getDatabaseConfig = (): DatabaseConfig => ({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'opsided_db',
  user: process.env.DB_USER || 'opsided_user',
  password: process.env.DB_PASSWORD || 'opsided_password',
});

const createConnection = () => {
  const config = getDatabaseConfig();
  
  logger.info(`Connecting to database: ${config.database} on ${config.host}:${config.port}`);
  
  return knex({
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
let db: knex.Knex | null = null;

export const getDatabase = (): knex.Knex => {
  if (!db) {
    db = createConnection();
  }
  return db;
};

export const closeDatabase = async (): Promise<void> => {
  if (db) {
    await db.destroy();
    db = null;
    logger.info('Database connection closed');
  }
};

// Health check
export const checkDatabaseHealth = async (): Promise<boolean> => {
  try {
    const database = getDatabase();
    await database.raw('SELECT 1');
    return true;
  } catch (error) {
    logger.error('Database health check failed:', error);
    return false;
  }
}; 