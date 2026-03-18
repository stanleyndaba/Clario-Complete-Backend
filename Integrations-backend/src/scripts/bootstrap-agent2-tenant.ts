import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48) || 'seller';
}

function arg(name: string, fallback?: string): string | undefined {
  const key = `--${name}=`;
  const fromArg = process.argv.find((v) => v.startsWith(key));
  if (fromArg) return fromArg.slice(key.length);
  return fallback;
}

async function main() {
  const email = arg('email', process.env.BOOTSTRAP_EMAIL || 'owner@clario.local')!;
  const companyName = arg('company', process.env.BOOTSTRAP_COMPANY || 'Clario Seller');
  const sellerId = arg('seller', process.env.BOOTSTRAP_SELLER_ID || `SELLER_${Date.now()}`);
  const tenantSlugBase = arg('tenant', process.env.BOOTSTRAP_TENANT_SLUG || slugify(companyName || 'seller'));
  const tenantSlug = `${tenantSlugBase}-${Math.random().toString(36).slice(2, 6)}`;

  console.log('Bootstrapping tenant/user...');

  let tenantId: string;
  const { data: existingTenant } = await supabase
    .from('tenants')
    .select('id, slug')
    .eq('slug', tenantSlugBase)
    .maybeSingle();

  if (existingTenant?.id) {
    tenantId = existingTenant.id;
    console.log(`Using existing tenant: ${existingTenant.slug} (${tenantId})`);
  } else {
    const { data: createdTenant, error: tenantError } = await supabase
      .from('tenants')
      .insert({
        name: companyName,
        slug: tenantSlug,
        status: 'active',
        plan: 'enterprise',
      })
      .select('id, slug')
      .single();

    if (tenantError || !createdTenant?.id) {
      throw new Error(`Failed creating tenant: ${tenantError?.message || 'unknown'}`);
    }
    tenantId = createdTenant.id;
    console.log(`Created tenant: ${createdTenant.slug} (${tenantId})`);
  }

  let userId: string;
  const { data: existingUser } = await supabase
    .from('users')
    .select('id, email')
    .eq('email', email)
    .maybeSingle();

  if (existingUser?.id) {
    userId = existingUser.id;
    const { error: patchUserError } = await supabase
      .from('users')
      .update({
        tenant_id: tenantId,
        company_name: companyName,
        amazon_seller_id: sellerId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);
    if (patchUserError) throw new Error(`Failed updating user tenant context: ${patchUserError.message}`);
    console.log(`Using existing user: ${email} (${userId})`);
  } else {
    userId = crypto.randomUUID();
    const { error: userError } = await supabase
      .from('users')
      .insert({
        id: userId,
        email,
        tenant_id: tenantId,
        company_name: companyName,
        amazon_seller_id: sellerId,
        seller_id: sellerId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (userError) throw new Error(`Failed creating user: ${userError.message}`);
    console.log(`Created user: ${email} (${userId})`);
  }

  const { error: membershipError } = await supabase
    .from('tenant_memberships')
    .upsert(
      {
        tenant_id: tenantId,
        user_id: userId,
        role: 'owner',
        is_active: true,
        accepted_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,user_id' }
    );

  if (membershipError) throw new Error(`Failed creating membership: ${membershipError.message}`);

  console.log('\nBootstrap complete:');
  console.log(`tenant_id=${tenantId}`);
  console.log(`user_id=${userId}`);
  console.log(`email=${email}`);
  console.log(`seller_id=${sellerId}`);
  console.log('\nNext: connect Amazon through OAuth for this tenant/user to mint a valid DB token.');
}

main().catch((e) => {
  console.error(`Bootstrap failed: ${e.message}`);
  process.exit(1);
});

