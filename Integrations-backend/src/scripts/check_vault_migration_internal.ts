import * as dotenv from 'dotenv';
dotenv.config();
import { supabaseAdmin } from '../database/supabaseClient';

async function checkVaultColumns() {
  console.log('--- Verifying Database Schema for PayPal Vaulting ---');
  try {
    const { data: users, error } = await supabaseAdmin
      .from('users')
      .select('id, email, paypal_payment_token, paypal_email')
      .limit(1);

    if (error) {
      if (error.code === '42703') { // Undefined column
        console.error('❌ MIGRATION PENDING: Columns "paypal_payment_token" or "paypal_email" do not exist.');
        console.log('You need to run migrations/070_add_paypal_vault_id_to_users.sql');
      } else {
        console.error('❌ Error checking users table:', error.message);
      }
      return;
    }

    console.log('✅ SUCCESS: PayPal Vaulting columns found in "users" table.');
    if (users && users.length > 0) {
      console.log('Sample data check:', users[0]);
    } else {
      console.log('Table is empty, but schema is correct.');
    }
  } catch (err: any) {
    console.error('❌ Unexpected error:', err.message);
  }
}

checkVaultColumns();
