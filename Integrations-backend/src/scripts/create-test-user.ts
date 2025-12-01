import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function createTestUser() {
    console.log('🔧 Creating test user...');

    const userId = '78fecfc0-5bf7-4387-9084-38d4733b9649';

    // Check if user already exists
    const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('id', userId)
        .maybeSingle();

    if (existingUser) {
        console.log('✅ Test user already exists');
        return;
    }

    // Create the user
    const { data, error } = await supabase
        .from('users')
        .insert({
            id: userId,
            email: 'stress-test@example.com',
            amazon_seller_id: 'TEST_SELLER_ID',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .select();

    if (error) {
        console.error('❌ Error creating test user:', error);
        process.exit(1);
    }

    console.log('✅ Test user created successfully:', data);
}

createTestUser();
