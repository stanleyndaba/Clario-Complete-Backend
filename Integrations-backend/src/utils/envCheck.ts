export function validateEnvironment(): void {
  const required = [
    'JWT_SECRET',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
  ];
  // ORCHESTRATOR_JWT_SECRET is required for session exchange specifically
  if (process.env['ENABLE_SESSION_EXCHANGE'] !== 'false') {
    required.push('ORCHESTRATOR_JWT_SECRET');
  }

  const missing = required.filter((k) => !process.env[k] || String(process.env[k]).trim() === '');
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

