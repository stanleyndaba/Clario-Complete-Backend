import * as dotenv from 'dotenv';
dotenv.config();
import { supabaseAdmin } from './src/database/supabaseClient';

async function checkColumns() {
  console.log('Checking users table columns...');
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, email, paypal_payment_token, paypal_email')
    .limit(1);

  if (error) {
    console.error('Migration might not be applied:', error.message);
  } else {
    console.log('Columns found successfully!');
    console.log('Sample data:', data);
  }
}

checkColumns();
