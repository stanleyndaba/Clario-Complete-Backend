import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import amazonService from '../services/amazonService';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main(): Promise<void> {
  const { data: tokens, error } = await supabase
    .from('tokens')
    .select('user_id, tenant_id, expires_at, provider')
    .eq('provider', 'amazon')
    .order('expires_at', { ascending: false })
    .limit(10);

  if (error) {
    throw new Error(`Failed loading tokens: ${error.message}`);
  }

  if (!tokens || tokens.length === 0) {
    console.log('no_amazon_tokens_found');
    return;
  }

  const now = new Date();
  for (const token of tokens) {
    const userId = token.user_id as string;
    const tenantId = token.tenant_id as string;
    const expiresAt = token.expires_at as string;
    console.log(`try_refresh user=${userId} tenant=${tenantId} prev_expires=${expiresAt}`);

    try {
      await amazonService.getAccessTokenForService(userId);

      const { data: fresh } = await supabase
        .from('tokens')
        .select('expires_at')
        .eq('provider', 'amazon')
        .eq('user_id', userId)
        .order('expires_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const newExpiry = fresh?.expires_at ? new Date(fresh.expires_at as string) : null;
      const valid = !!newExpiry && newExpiry > now;
      console.log(`refresh_result user=${userId} tenant=${tenantId} valid=${valid ? 'YES' : 'NO'} new_expires=${fresh?.expires_at || 'null'}`);

      if (valid) {
        console.log(`SUCCESS_USER=${userId}`);
        console.log(`SUCCESS_TENANT=${tenantId}`);
        return;
      }
    } catch (e: any) {
      console.log(`refresh_failed user=${userId} tenant=${tenantId} reason=${e?.message || String(e)}`);
    }
  }

  console.log('no_valid_token_obtained');
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
