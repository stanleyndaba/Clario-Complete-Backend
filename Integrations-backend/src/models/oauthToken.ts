/**
 * @deprecated This file is deprecated. Use tokenManager from '../utils/tokenManager' instead.
 * The new tokens table (migration 020) uses encrypted IV+data format and is managed by tokenManager.
 * 
 * Migration path:
 * 1. Use tokenManager.saveToken() and tokenManager.getToken() instead of these functions
 * 2. Old oauth_tokens table data should be migrated to the new tokens table
 * 3. This file will be removed in a future version
 */

import { encrypt, decrypt } from '../lib/crypto';
import knex from 'knex';
import logger from '../utils/logger';

// Simple Knex client (replace with your existing shared connection if available)
const db = knex({
  client: 'pg',
  connection: process.env.DATABASE_URL || {
    host: process.env.DB_HOST || 'localhost',
    port: +(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'opside'
  }
});

const TABLE = 'oauth_tokens';

export async function ensureSchema(): Promise<void> {
  const exists = await db.schema.hasTable(TABLE);
  if (!exists) {
    await db.schema.createTable(TABLE, (t) => {
      t.increments('id').primary();
      t.string('amazon_seller_id').notNullable().unique();
      t.text('encrypted_refresh_token').notNullable();
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.timestamp('updated_at').defaultTo(db.fn.now());
    });
    logger.info(`Created table ${TABLE}`);
  }
}

export async function storeOAuthToken(amazonSellerId: string, refreshToken: string): Promise<void> {
  await ensureSchema();
  const encryptedRefreshToken = encrypt(refreshToken);
  const existing = await db(TABLE).where({ amazon_seller_id: amazonSellerId }).first();
  if (existing) {
    await db(TABLE)
      .where({ amazon_seller_id: amazonSellerId })
      .update({ encrypted_refresh_token: encryptedRefreshToken, updated_at: db.fn.now() });
  } else {
    await db(TABLE).insert({ amazon_seller_id: amazonSellerId, encrypted_refresh_token: encryptedRefreshToken });
  }
}

export async function getOAuthToken(amazonSellerId: string): Promise<string | null> {
  await ensureSchema();
  const row = await db(TABLE).where({ amazon_seller_id: amazonSellerId }).first();
  if (!row) return null;
  return decrypt(row.encrypted_refresh_token);
}






