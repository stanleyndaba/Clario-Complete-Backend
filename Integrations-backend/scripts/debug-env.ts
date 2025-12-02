import 'dotenv/config';
import path from 'path';
import fs from 'fs';

console.log('Current directory:', process.cwd());
console.log('Looking for .env in:', path.join(process.cwd(), '.env'));
console.log('.env exists:', fs.existsSync(path.join(process.cwd(), '.env')));

if (fs.existsSync(path.join(process.cwd(), '.env'))) {
    const content = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf-8');
    console.log('.env content length:', content.length);
    console.log('DATABASE_URL present in file:', content.includes('DATABASE_URL'));
    console.log('SUPABASE_URL present in file:', content.includes('SUPABASE_URL'));
}

console.log('process.env.DATABASE_URL:', process.env.DATABASE_URL ? 'Set' : 'Unset');
console.log('process.env.SUPABASE_URL:', process.env.SUPABASE_URL ? 'Set' : 'Unset');
