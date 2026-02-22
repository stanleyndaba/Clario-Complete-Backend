import 'dotenv/config';
import { supabaseAdmin } from '../src/database/supabaseClient';

async function inspectShipments() {
    const userId = '549add91-df29-4fe5-9c1c-526a683a1ba1';
    console.log(`Inspecting shipments for user: ${userId}`);

    const { data: shipments, error } = await supabaseAdmin
        .from('shipments')
        .select('*')
        .eq('user_id', userId)
        .limit(10);

    if (error) {
        console.error('Error fetching shipments:', error);
        return;
    }

    console.log(`Found ${shipments?.length || 0} shipments.`);
    if (shipments && shipments.length > 0) {
        shipments.forEach(s => {
            console.log(`--- Shipment ${s.shipment_id} ---`);
            console.log('Status:', s.status);
            console.log('Shipped:', s.quantity_shipped);
            console.log('Received:', s.quantity_received);
            console.log('Type:', s.shipment_type);
            console.log('Destination:', s.destination_fc);
        });
    }
}

inspectShipments();
