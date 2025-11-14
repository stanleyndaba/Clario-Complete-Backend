/**
 * Decode JWT to extract project reference
 */

import 'dotenv/config';

const anonKey = process.env.SUPABASE_ANON_KEY;

if (!anonKey) {
  console.error('SUPABASE_ANON_KEY not found');
  process.exit(1);
}

// JWT has 3 parts: header.payload.signature
const parts = anonKey.split('.');

if (parts.length !== 3) {
  console.error('Invalid JWT format');
  process.exit(1);
}

// Decode payload (base64url)
const payload = parts[1];
const decoded = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
const parsed = JSON.parse(decoded);

console.log('JWT Payload:');
console.log(JSON.stringify(parsed, null, 2));
console.log('\nProject Reference (ref):', parsed.ref);
console.log('Expected URL:', `https://${parsed.ref}.supabase.co`);



