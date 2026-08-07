import '../src/config/env';
import { supabaseAdmin } from '../src/database/supabaseClient';
import { TokenCredentialError, tokenEnvelopeCrypto } from '../src/utils/tokenEnvelopeCrypto';

type Provider = 'amazon' | 'gmail' | 'stripe' | 'outlook' | 'gdrive' | 'dropbox';

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const provider = argValue('provider') as Provider | null;
  const userId = argValue('user');
  const tenantId = argValue('tenant');
  const onlyInvalid = hasFlag('only-invalid');

  let query = supabaseAdmin
    .from('tokens')
    .select('id, user_id, tenant_id, store_id, provider, access_token_iv, access_token_data, refresh_token_iv, refresh_token_data, credential_status, credential_error_code, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(500);

  if (provider) query = query.eq('provider', provider);
  if (userId) query = query.eq('user_id', userId);
  if (tenantId) query = query.eq('tenant_id', tenantId);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load token metadata: ${error.message}`);

  const rows = (data || []).flatMap((row: any) => {
    const tokenParts = [
      { kind: 'access_token', iv: row.access_token_iv, data: row.access_token_data },
      { kind: 'refresh_token', iv: row.refresh_token_iv, data: row.refresh_token_data },
    ];

    return tokenParts.map((part) => {
      const inspection = tokenEnvelopeCrypto.inspect({ iv: part.iv, data: part.data });
      let decryptability = inspection.result;
      if (inspection.result === 'valid_current_format' || inspection.result === 'valid_legacy_format') {
        try {
          tokenEnvelopeCrypto.decrypt({ iv: part.iv, data: part.data });
        } catch (decryptError) {
          decryptability = decryptError instanceof TokenCredentialError ? decryptError.code : 'decrypt_failed';
        }
      }

      return {
        token_row_id: row.id,
        user_id: row.user_id,
        tenant_id: row.tenant_id,
        store_id: row.store_id,
        provider: row.provider,
        token_kind: part.kind,
        credential_status: row.credential_status || 'active',
        credential_error_code: row.credential_error_code || null,
        detected_version: inspection.detectedVersion,
        component_count: inspection.componentCount,
        encoded_length: inspection.encodedLength,
        iv_decoded_bytes: inspection.ivDecodedByteLength,
        auth_tag_decoded_bytes: inspection.authTagDecodedByteLength,
        ciphertext_decoded_bytes: inspection.ciphertextDecodedByteLength,
        decryptability,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });
  }).filter((row) => !onlyInvalid || !['valid_current_format', 'valid_legacy_format', 'missing_value'].includes(row.decryptability));

  console.log(JSON.stringify({
    dry_run: true,
    mutated: false,
    filters: { provider, user_id: userId, tenant_id: tenantId, only_invalid: onlyInvalid },
    checked_token_parts: rows.length,
    results: rows,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    dry_run: true,
    mutated: false,
    error: error?.message || 'Credential diagnostic failed',
  }));
  process.exit(1);
});

