import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { supabase, convertUserIdToUuid } from '../database/supabaseClient';

async function createDemoUser() {
    const userId = 'demo-user';
    const userUuid = convertUserIdToUuid(userId);

    console.log('👤 Creating Demo User');
    console.log(`User ID: ${userId}`);
    console.log(`UUID: ${userUuid}\n`);

    try {
        // Check if user already exists
        const { data: existing } = await supabase
            .from('users')
            .select('*')
            .eq('id', userUuid)
            .maybeSingle();

        if (existing) {
            console.log('✅ User already exists!');
            console.log(existing);
            return;
        }

        // Create the user with required fields
        const { data, error } = await supabase
            .from('users')
            .insert({
                id: userUuid,
                email: 'demo@clario.com',
                amazon_seller_id: 'demo-seller-id'
            })
            .select()
            .single();

        if (error) {
            console.error('❌ Error creating user:', error);
            return;
        }

        console.log('✅ Demo user created successfully!');
        console.log(data);

    } catch (error: any) {
        console.error('❌ Fatal error:', error.message);
    }
}

createDemoUser().catch(console.error);
