import path from 'path';
import dotenv from 'dotenv';
import crypto from 'crypto';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const clientId = process.env.AMAZON_CLIENT_ID || process.env.AMAZON_SPAPI_CLIENT_ID;
const clientSecret = process.env.AMAZON_CLIENT_SECRET || process.env.AMAZON_SPAPI_CLIENT_SECRET;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}
if (!clientId || !clientSecret) {
  throw new Error('Missing Amazon client credentials');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function getEncryptionKey(): Buffer {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (keyHex && keyHex.length >= 64) {
    return Buffer.from(keyHex, 'hex');
  }
  const jwtSecret = process.env.JWT_SECRET || 'fallback-secret-please-set';
  return crypto.pbkdf2Sync(jwtSecret, 'clario-salt', 100000, 32, 'sha256');
}

function decrypt(ivBase64: string, dataBase64: string, key: Buffer): string {
  const iv = Buffer.from(ivBase64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let out = decipher.update(dataBase64, 'base64', 'utf8');
  out += decipher.final('utf8');
  return out;
}

function encrypt(text: string, key: Buffer): { iv: string; data: string } {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let data = cipher.update(text, 'utf8', 'base64');
  data += cipher.final('base64');
  return { iv: iv.toString('base64'), data };
}

async function main(): Promise<void> {
  const key = getEncryptionKey();
  const now = new Date();

  const { data: rows, error } = await supabase
    .from('tokens')
    .select('id, user_id, tenant_id, store_id, provider, expires_at, refresh_token_iv, refresh_token_data')
    .eq('provider', 'amazon')
    .order('expires_at', { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(`Failed loading amazon tokens: ${error.message}`);
  }
  if (!rows || rows.length === 0) {
    console.log('no_amazon_tokens_found');
    return;
  }

  for (const row of rows) {
    const userId = row.user_id as string;
    const tenantId = row.tenant_id as string;
    const rowId = row.id as string;
    const refreshIv = row.refresh_token_iv as string | null;
    const refreshData = row.refresh_token_data as string | null;

    if (!refreshIv || !refreshData) {
      console.log(`skip_no_refresh_token row=${rowId} user=${userId} tenant=${tenantId}`);
      continue;
    }

    let refreshToken = '';
    try {
      refreshToken = decrypt(refreshIv, refreshData, key);
    } catch (e: any) {
      console.log(`skip_decrypt_failed row=${rowId} user=${userId} tenant=${tenantId} reason=${e?.message || String(e)}`);
      continue;
    }

    console.log(`try_refresh row=${rowId} user=${userId} tenant=${tenantId} prev_expires=${row.expires_at}`);

    try {
      const params = new URLSearchParams();
      params.set('grant_type', 'refresh_token');
      params.set('refresh_token', refreshToken);
      params.set('client_id', clientId);
      params.set('client_secret', clientSecret);

      const response = await axios.post(
        'https://api.amazon.com/auth/o2/token',
        params.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 20000,
        }
      );

      const accessToken = response.data?.access_token as string | undefined;
      const expiresIn = Number(response.data?.expires_in || 0);
      const newRefresh = (response.data?.refresh_token as string | undefined) || refreshToken;

      if (!accessToken || !expiresIn) {
        console.log(`refresh_failed_invalid_response row=${rowId} user=${userId} tenant=${tenantId}`);
        continue;
      }

      const encAccess = encrypt(accessToken, key);
      const encRefresh = encrypt(newRefresh, key);
      const newExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      const { error: updateError } = await supabase
        .from('tokens')
        .update({
          access_token_iv: encAccess.iv,
          access_token_data: encAccess.data,
          refresh_token_iv: encRefresh.iv,
          refresh_token_data: encRefresh.data,
          expires_at: newExpiresAt,
          updated_at: new Date().toISOString(),
          is_active: true,
        })
        .eq('id', rowId);

      if (updateError) {
        console.log(`refresh_db_update_failed row=${rowId} user=${userId} tenant=${tenantId} reason=${updateError.message}`);
        continue;
      }

      const { data: verify } = await supabase
        .from('tokens')
        .select('expires_at')
        .eq('id', rowId)
        .maybeSingle();

      const valid = !!verify?.expires_at && new Date(verify.expires_at as string) > now;
      console.log(`refresh_success row=${rowId} user=${userId} tenant=${tenantId} valid=${valid ? 'YES' : 'NO'} expires_at=${verify?.expires_at || 'null'}`);
      if (valid) {
        console.log(`SUCCESS_USER=${userId}`);
        console.log(`SUCCESS_TENANT=${tenantId}`);
        return;
      }
    } catch (e: any) {
      const reason = e?.response?.data?.error_description || e?.response?.data?.error || e?.message || String(e);
      console.log(`refresh_failed row=${rowId} user=${userId} tenant=${tenantId} reason=${reason}`);
    }
  }

  console.log('no_valid_token_obtained');
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
