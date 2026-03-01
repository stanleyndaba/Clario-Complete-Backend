import 'dotenv/config';
import { Client } from 'pg';
import path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function run() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error("Missing DATABASE_URL");
        process.exit(1);
    }

    const client = new Client({ connectionString });
    try {
        await client.connect();
        console.log("Connected to DB.");

        console.log("Dropping constraints on financial_events.tenant_id...");
        await client.query(`
      ALTER TABLE financial_events DROP CONSTRAINT IF EXISTS fk_financial_events_tenant;
      ALTER TABLE financial_events ALTER COLUMN tenant_id DROP NOT NULL;
    `);
        console.log("Constraints dropped successfully.");

    } catch (error) {
        console.error("Error:", error);
    } finally {
        await client.end();
    }
}

run();
