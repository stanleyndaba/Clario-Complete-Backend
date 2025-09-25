/*
  Seed an encrypted Amazon token for a user using the built-in tokenManager.
  Usage:
    USER_ID=<uuid> REFRESH_TOKEN=<lwa_refresh_token> \
    ACCESS_TOKEN=<optional_access_token> EXPIRES_IN=3600 \
    npm run seed:amazon-token

  Requires env: TOKEN_ENCRYPTION_KEY and optionally SUPABASE/DATABASE_URL if the tokenManager persists to DB.
*/

/* eslint-disable no-console */
import 'dotenv/config';
import tokenManager from '../src/utils/tokenManager';

async function main() {
  const userId = process.env.USER_ID;
  const refreshToken = process.env.REFRESH_TOKEN;
  const accessToken = process.env.ACCESS_TOKEN || 'seeded-access-token';
  const expiresIn = parseInt(process.env.EXPIRES_IN || '3600', 10);

  if (!userId || !refreshToken) {
    console.error('USER_ID and REFRESH_TOKEN are required');
    process.exit(1);
  }

  const expiresAt = new Date(Date.now() + Math.max(60, expiresIn) * 1000);
  console.log('Seeding Amazon token for user:', { userId, expiresAt: expiresAt.toISOString() });

  await tokenManager.saveToken(userId, 'amazon', {
    accessToken,
    refreshToken,
    expiresAt
  });

  console.log('Seed complete.');
}

main().catch((e) => {
  console.error('Seed failed:', e?.message || e);
  process.exit(2);
});

