-- ========================================
-- Initial Seed Data for Integrations Backend
-- Seed: 001_initial_seed_data.sql
-- ========================================

-- ========================================
-- SAMPLE USERS
-- ========================================
INSERT INTO users (id, email, password_hash, first_name, last_name, company_name, role, is_active, email_verified) VALUES
(
    '550e8400-e29b-41d4-a716-446655440001',
    'admin@opsided.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj4J/HS.iKGi', -- password: admin123
    'Admin',
    'User',
    'Opsided Inc',
    'admin',
    true,
    true
),
(
    '550e8400-e29b-41d4-a716-446655440002',
    'john.doe@example.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj4J/HS.iKGi', -- password: admin123
    'John',
    'Doe',
    'E-commerce Store',
    'user',
    true,
    true
),
(
    '550e8400-e29b-41d4-a716-446655440003',
    'jane.smith@example.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj4J/HS.iKGi', -- password: admin123
    'Jane',
    'Smith',
    'Online Retailer',
    'manager',
    true,
    true
);

-- ========================================
-- SAMPLE OAUTH TOKENS
-- ========================================
INSERT INTO oauth_tokens (id, user_id, provider, access_token, refresh_token, token_type, expires_at, scope) VALUES
(
    '550e8400-e29b-41d4-a716-446655440010',
    '550e8400-e29b-41d4-a716-446655440002',
    'amazon',
    'encrypted_amazon_access_token_here',
    'encrypted_amazon_refresh_token_here',
    'Bearer',
    NOW() + INTERVAL '1 hour',
    'sellingpartnerapi::migration:read,reports:read,inventory:read'
),
(
    '550e8400-e29b-41d4-a716-446655440011',
    '550e8400-e29b-41d4-a716-446655440002',
    'gmail',
    'encrypted_gmail_access_token_here',
    'encrypted_gmail_refresh_token_here',
    'Bearer',
    NOW() + INTERVAL '1 hour',
    'https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/gmail.send'
),
(
    '550e8400-e29b-41d4-a716-446655440012',
    '550e8400-e29b-41d4-a716-446655440002',
    'stripe',
    'encrypted_stripe_access_token_here',
    'encrypted_stripe_refresh_token_here',
    'Bearer',
    NOW() + INTERVAL '1 hour',
    'read_write'
);

-- ========================================
-- SAMPLE INTEGRATION ACCOUNTS
-- ========================================
INSERT INTO integration_accounts (id, user_id, provider, account_id, account_name, account_email, account_status, is_primary, metadata) VALUES
(
    '550e8400-e29b-41d4-a716-446655440020',
    '550e8400-e29b-41d4-a716-446655440002',
    'amazon',
    'A1B2C3D4E5F6G7',
    'John Doe Amazon Store',
    'john.doe@example.com',
    'active',
    true,
    '{"marketplace_id": "ATVPDKIKX0DER", "region": "us-east-1", "business_type": "individual"}'
),
(
    '550e8400-e29b-41d4-a716-446655440021',
    '550e8400-e29b-41d4-a716-446655440002',
    'gmail',
    'john.doe@gmail.com',
    'John Doe Gmail',
    'john.doe@gmail.com',
    'active',
    true,
    '{"labels": ["INBOX", "SENT", "DRAFT"], "quota": "15GB"}'
),
(
    '550e8400-e29b-41d4-a716-446655440022',
    '550e8400-e29b-41d4-a716-446655440002',
    'stripe',
    'acct_1234567890abcdef',
    'John Doe Stripe Account',
    'john.doe@example.com',
    'active',
    true,
    '{"country": "US", "currencies_supported": ["usd"], "charges_enabled": true}'
);

-- ========================================
-- SAMPLE AMAZON INTEGRATIONS
-- ========================================
INSERT INTO amazon_integrations (id, user_id, marketplace_id, seller_id, region, api_access, reports_access, inventory_access, orders_access, last_sync_at, sync_status) VALUES
(
    '550e8400-e29b-41d4-a716-446655440030',
    '550e8400-e29b-41d4-a716-446655440002',
    'ATVPDKIKX0DER',
    'A1B2C3D4E5F6G7',
    'us-east-1',
    true,
    true,
    true,
    true,
    NOW() - INTERVAL '2 hours',
    'completed'
);

-- ========================================
-- SAMPLE GMAIL INTEGRATIONS
-- ========================================
INSERT INTO gmail_integrations (id, user_id, gmail_address, labels_access, emails_access, send_access, last_sync_at, sync_status) VALUES
(
    '550e8400-e29b-41d4-a716-446655440040',
    '550e8400-e29b-41d4-a716-446655440002',
    'john.doe@gmail.com',
    true,
    true,
    true,
    NOW() - INTERVAL '1 hour',
    'completed'
);

-- ========================================
-- SAMPLE STRIPE INTEGRATIONS
-- ========================================
INSERT INTO stripe_integrations (id, user_id, stripe_account_id, account_name, account_type, charges_access, customers_access, subscriptions_access, last_sync_at, sync_status) VALUES
(
    '550e8400-e29b-41d4-a716-446655440050',
    '550e8400-e29b-41d4-a716-446655440002',
    'acct_1234567890abcdef',
    'John Doe Stripe Account',
    'express',
    true,
    true,
    true,
    NOW() - INTERVAL '30 minutes',
    'completed'
);

-- ========================================
-- SAMPLE INVENTORY ITEMS
-- ========================================
INSERT INTO inventory_items (id, user_id, sku, title, description, category, brand, supplier, cost_price, selling_price, quantity_available, quantity_reserved, quantity_shipped, reorder_point, reorder_quantity, weight, dimensions, tags) VALUES
(
    '550e8400-e29b-41d4-a716-446655440060',
    '550e8400-e29b-41d4-a716-446655440002',
    'PROD-001',
    'Wireless Bluetooth Headphones',
    'High-quality wireless headphones with noise cancellation',
    'Electronics',
    'AudioTech',
    'AudioTech Supplier',
    45.00,
    89.99,
    150,
    25,
    75,
    30,
    100,
    0.25,
    '{"length": 7.5, "width": 3.2, "height": 2.1}',
    ARRAY['wireless', 'bluetooth', 'noise-cancelling', 'electronics']
),
(
    '550e8400-e29b-41d4-a716-446655440061',
    '550e8400-e29b-41d4-a716-446655440002',
    'PROD-002',
    'Smartphone Case - iPhone 13',
    'Durable protective case for iPhone 13 with raised edges',
    'Accessories',
    'CaseGuard',
    'CaseGuard Supplier',
    8.50,
    19.99,
    200,
    15,
    85,
    25,
    75,
    0.08,
    '{"length": 5.8, "width": 2.8, "height": 0.4}',
    ARRAY['case', 'iphone', 'protective', 'accessories']
),
(
    '550e8400-e29b-41d4-a716-446655440062',
    '550e8400-e29b-41d4-a716-446655440002',
    'PROD-003',
    'USB-C Charging Cable',
    'Fast charging USB-C cable with braided design',
    'Accessories',
    'PowerTech',
    'PowerTech Supplier',
    3.25,
    12.99,
    300,
    20,
    130,
    40,
    120,
    0.05,
    '{"length": 6.0, "width": 0.3, "height": 0.3}',
    ARRAY['usb-c', 'charging', 'cable', 'accessories']
);

-- ========================================
-- SAMPLE INVENTORY SYNC LOGS
-- ========================================
INSERT INTO inventory_sync_logs (id, user_id, provider, sync_type, status, items_processed, items_updated, items_created, items_deleted, discrepancies_found, started_at, completed_at) VALUES
(
    '550e8400-e29b-41d4-a716-446655440070',
    '550e8400-e29b-41d4-a716-446655440002',
    'amazon',
    'full',
    'completed',
    3,
    2,
    1,
    0,
    0,
    NOW() - INTERVAL '2 hours',
    NOW() - INTERVAL '1 hour 55 minutes'
),
(
    '550e8400-e29b-41d4-a716-446655440071',
    '550e8400-e29b-41d4-a716-446655440002',
    'manual',
    'incremental',
    'completed',
    1,
    1,
    0,
    0,
    0,
    NOW() - INTERVAL '1 hour',
    NOW() - INTERVAL '55 minutes'
);

-- ========================================
-- SAMPLE DISCREPANCIES
-- ========================================
INSERT INTO discrepancies (id, user_id, item_id, sku, discrepancy_type, source_system, source_value, target_system, target_value, severity, status, notes) VALUES
(
    '550e8400-e29b-41d4-a716-446655440080',
    '550e8400-e29b-41d4-a716-446655440002',
    '550e8400-e29b-41d4-a716-446655440060',
    'PROD-001',
    'quantity',
    'amazon',
    '145',
    'internal',
    '150',
    'low',
    'open',
    'Amazon shows 5 fewer items than internal system'
);

-- ========================================
-- SAMPLE CLAIMS
-- ========================================
INSERT INTO claims (id, user_id, claim_type, provider, reference_id, amount, currency, status, reason, evidence, submitted_at) VALUES
(
    '550e8400-e29b-41d4-a716-446655440090',
    '550e8400-e29b-41d4-a716-446655440002',
    'reimbursement',
    'amazon',
    'AMZ-REF-001',
    25.50,
    'USD',
    'pending',
    'Damaged inventory during Amazon fulfillment',
    ARRAY['damage_photo_1.jpg', 'damage_photo_2.jpg', 'inspection_report.pdf'],
    NOW() - INTERVAL '3 days'
);

-- ========================================
-- SAMPLE NOTIFICATIONS
-- ========================================
INSERT INTO notifications (id, user_id, type, title, message, priority, status, metadata) VALUES
(
    '550e8400-e29b-41d4-a716-446655440100',
    '550e8400-e29b-41d4-a716-446655440002',
    'inapp',
    'Inventory Sync Completed',
    'Amazon inventory sync completed successfully. 3 items processed, 2 updated, 1 created.',
    'normal',
    'unread',
    '{"sync_id": "550e8400-e29b-41d4-a716-446655440070", "provider": "amazon", "items_processed": 3}'
),
(
    '550e8400-e29b-41d4-a716-446655440101',
    '550e8400-e29b-41d4-a716-446655440002',
    'email',
    'Low Stock Alert',
    'Product PROD-002 (Smartphone Case) is running low on stock. Current quantity: 25, Reorder point: 25',
    'high',
    'unread',
    '{"sku": "PROD-002", "current_quantity": 25, "reorder_point": 25}'
);

-- ========================================
-- SAMPLE API LOGS
-- ========================================
INSERT INTO api_logs (id, user_id, endpoint, method, status_code, response_time_ms, ip_address, user_agent, request_body, response_body) VALUES
(
    '550e8400-e29b-41d4-a716-446655440110',
    '550e8400-e29b-41d4-a716-446655440002',
    '/api/v1/amazon/inventory',
    'GET',
    200,
    245,
    '192.168.1.100',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    '{"marketplace_id": "ATVPDKIKX0DER"}',
    '{"success": true, "data": {"items": 3, "total_value": 1250.00}}'
),
(
    '550e8400-e29b-41d4-a716-446655440111',
    '550e8400-e29b-41d4-a716-446655440002',
    '/api/v1/sync/start',
    'POST',
    200,
    1890,
    '192.168.1.100',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    '{"provider": "amazon", "sync_type": "full"}',
    '{"success": true, "sync_id": "550e8400-e29b-41d4-a716-446655440070"}'
);

-- ========================================
-- SAMPLE WEBHOOK EVENTS
-- ========================================
INSERT INTO webhook_events (id, user_id, provider, event_type, event_id, payload, processed, created_at) VALUES
(
    '550e8400-e29b-41d4-a716-446655440120',
    '550e8400-e29b-41d4-a716-446655440002',
    'amazon',
    'inventory.updated',
    'evt_amazon_inv_001',
    '{"marketplace_id": "ATVPDKIKX0DER", "sku": "PROD-001", "quantity": 145, "timestamp": "2024-01-15T10:30:00Z"}',
    false,
    NOW() - INTERVAL '30 minutes'
),
(
    '550e8400-e29b-41d4-a716-446655440121',
    '550e8400-e29b-41d4-a716-446655440002',
    'stripe',
    'charge.succeeded',
    'evt_stripe_charge_001',
    '{"account_id": "acct_1234567890abcdef", "charge_id": "ch_1234567890abcdef", "amount": 8999, "currency": "usd"}',
    false,
    NOW() - INTERVAL '15 minutes'
);

-- ========================================
-- COMMIT TRANSACTION
-- ========================================
COMMIT;


-- Initial Seed Data for Integrations Backend
-- Seed: 001_initial_seed_data.sql
-- ========================================

-- ========================================
-- SAMPLE USERS
-- ========================================
INSERT INTO users (id, email, password_hash, first_name, last_name, company_name, role, is_active, email_verified) VALUES
(
    '550e8400-e29b-41d4-a716-446655440001',
    'admin@opsided.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj4J/HS.iKGi', -- password: admin123
    'Admin',
    'User',
    'Opsided Inc',
    'admin',
    true,
    true
),
(
    '550e8400-e29b-41d4-a716-446655440002',
    'john.doe@example.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj4J/HS.iKGi', -- password: admin123
    'John',
    'Doe',
    'E-commerce Store',
    'user',
    true,
    true
),
(
    '550e8400-e29b-41d4-a716-446655440003',
    'jane.smith@example.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj4J/HS.iKGi', -- password: admin123
    'Jane',
    'Smith',
    'Online Retailer',
    'manager',
    true,
    true
);

-- ========================================
-- SAMPLE OAUTH TOKENS
-- ========================================
INSERT INTO oauth_tokens (id, user_id, provider, access_token, refresh_token, token_type, expires_at, scope) VALUES
(
    '550e8400-e29b-41d4-a716-446655440010',
    '550e8400-e29b-41d4-a716-446655440002',
    'amazon',
    'encrypted_amazon_access_token_here',
    'encrypted_amazon_refresh_token_here',
    'Bearer',
    NOW() + INTERVAL '1 hour',
    'sellingpartnerapi::migration:read,reports:read,inventory:read'
),
(
    '550e8400-e29b-41d4-a716-446655440011',
    '550e8400-e29b-41d4-a716-446655440002',
    'gmail',
    'encrypted_gmail_access_token_here',
    'encrypted_gmail_refresh_token_here',
    'Bearer',
    NOW() + INTERVAL '1 hour',
    'https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/gmail.send'
),
(
    '550e8400-e29b-41d4-a716-446655440012',
    '550e8400-e29b-41d4-a716-446655440002',
    'stripe',
    'encrypted_stripe_access_token_here',
    'encrypted_stripe_refresh_token_here',
    'Bearer',
    NOW() + INTERVAL '1 hour',
    'read_write'
);

-- ========================================
-- SAMPLE INTEGRATION ACCOUNTS
-- ========================================
INSERT INTO integration_accounts (id, user_id, provider, account_id, account_name, account_email, account_status, is_primary, metadata) VALUES
(
    '550e8400-e29b-41d4-a716-446655440020',
    '550e8400-e29b-41d4-a716-446655440002',
    'amazon',
    'A1B2C3D4E5F6G7',
    'John Doe Amazon Store',
    'john.doe@example.com',
    'active',
    true,
    '{"marketplace_id": "ATVPDKIKX0DER", "region": "us-east-1", "business_type": "individual"}'
),
(
    '550e8400-e29b-41d4-a716-446655440021',
    '550e8400-e29b-41d4-a716-446655440002',
    'gmail',
    'john.doe@gmail.com',
    'John Doe Gmail',
    'john.doe@gmail.com',
    'active',
    true,
    '{"labels": ["INBOX", "SENT", "DRAFT"], "quota": "15GB"}'
),
(
    '550e8400-e29b-41d4-a716-446655440022',
    '550e8400-e29b-41d4-a716-446655440002',
    'stripe',
    'acct_1234567890abcdef',
    'John Doe Stripe Account',
    'john.doe@example.com',
    'active',
    true,
    '{"country": "US", "currencies_supported": ["usd"], "charges_enabled": true}'
);

-- ========================================
-- SAMPLE AMAZON INTEGRATIONS
-- ========================================
INSERT INTO amazon_integrations (id, user_id, marketplace_id, seller_id, region, api_access, reports_access, inventory_access, orders_access, last_sync_at, sync_status) VALUES
(
    '550e8400-e29b-41d4-a716-446655440030',
    '550e8400-e29b-41d4-a716-446655440002',
    'ATVPDKIKX0DER',
    'A1B2C3D4E5F6G7',
    'us-east-1',
    true,
    true,
    true,
    true,
    NOW() - INTERVAL '2 hours',
    'completed'
);

-- ========================================
-- SAMPLE GMAIL INTEGRATIONS
-- ========================================
INSERT INTO gmail_integrations (id, user_id, gmail_address, labels_access, emails_access, send_access, last_sync_at, sync_status) VALUES
(
    '550e8400-e29b-41d4-a716-446655440040',
    '550e8400-e29b-41d4-a716-446655440002',
    'john.doe@gmail.com',
    true,
    true,
    true,
    NOW() - INTERVAL '1 hour',
    'completed'
);

-- ========================================
-- SAMPLE STRIPE INTEGRATIONS
-- ========================================
INSERT INTO stripe_integrations (id, user_id, stripe_account_id, account_name, account_type, charges_access, customers_access, subscriptions_access, last_sync_at, sync_status) VALUES
(
    '550e8400-e29b-41d4-a716-446655440050',
    '550e8400-e29b-41d4-a716-446655440002',
    'acct_1234567890abcdef',
    'John Doe Stripe Account',
    'express',
    true,
    true,
    true,
    NOW() - INTERVAL '30 minutes',
    'completed'
);

-- ========================================
-- SAMPLE INVENTORY ITEMS
-- ========================================
INSERT INTO inventory_items (id, user_id, sku, title, description, category, brand, supplier, cost_price, selling_price, quantity_available, quantity_reserved, quantity_shipped, reorder_point, reorder_quantity, weight, dimensions, tags) VALUES
(
    '550e8400-e29b-41d4-a716-446655440060',
    '550e8400-e29b-41d4-a716-446655440002',
    'PROD-001',
    'Wireless Bluetooth Headphones',
    'High-quality wireless headphones with noise cancellation',
    'Electronics',
    'AudioTech',
    'AudioTech Supplier',
    45.00,
    89.99,
    150,
    25,
    75,
    30,
    100,
    0.25,
    '{"length": 7.5, "width": 3.2, "height": 2.1}',
    ARRAY['wireless', 'bluetooth', 'noise-cancelling', 'electronics']
),
(
    '550e8400-e29b-41d4-a716-446655440061',
    '550e8400-e29b-41d4-a716-446655440002',
    'PROD-002',
    'Smartphone Case - iPhone 13',
    'Durable protective case for iPhone 13 with raised edges',
    'Accessories',
    'CaseGuard',
    'CaseGuard Supplier',
    8.50,
    19.99,
    200,
    15,
    85,
    25,
    75,
    0.08,
    '{"length": 5.8, "width": 2.8, "height": 0.4}',
    ARRAY['case', 'iphone', 'protective', 'accessories']
),
(
    '550e8400-e29b-41d4-a716-446655440062',
    '550e8400-e29b-41d4-a716-446655440002',
    'PROD-003',
    'USB-C Charging Cable',
    'Fast charging USB-C cable with braided design',
    'Accessories',
    'PowerTech',
    'PowerTech Supplier',
    3.25,
    12.99,
    300,
    20,
    130,
    40,
    120,
    0.05,
    '{"length": 6.0, "width": 0.3, "height": 0.3}',
    ARRAY['usb-c', 'charging', 'cable', 'accessories']
);

-- ========================================
-- SAMPLE INVENTORY SYNC LOGS
-- ========================================
INSERT INTO inventory_sync_logs (id, user_id, provider, sync_type, status, items_processed, items_updated, items_created, items_deleted, discrepancies_found, started_at, completed_at) VALUES
(
    '550e8400-e29b-41d4-a716-446655440070',
    '550e8400-e29b-41d4-a716-446655440002',
    'amazon',
    'full',
    'completed',
    3,
    2,
    1,
    0,
    0,
    NOW() - INTERVAL '2 hours',
    NOW() - INTERVAL '1 hour 55 minutes'
),
(
    '550e8400-e29b-41d4-a716-446655440071',
    '550e8400-e29b-41d4-a716-446655440002',
    'manual',
    'incremental',
    'completed',
    1,
    1,
    0,
    0,
    0,
    NOW() - INTERVAL '1 hour',
    NOW() - INTERVAL '55 minutes'
);

-- ========================================
-- SAMPLE DISCREPANCIES
-- ========================================
INSERT INTO discrepancies (id, user_id, item_id, sku, discrepancy_type, source_system, source_value, target_system, target_value, severity, status, notes) VALUES
(
    '550e8400-e29b-41d4-a716-446655440080',
    '550e8400-e29b-41d4-a716-446655440002',
    '550e8400-e29b-41d4-a716-446655440060',
    'PROD-001',
    'quantity',
    'amazon',
    '145',
    'internal',
    '150',
    'low',
    'open',
    'Amazon shows 5 fewer items than internal system'
);

-- ========================================
-- SAMPLE CLAIMS
-- ========================================
INSERT INTO claims (id, user_id, claim_type, provider, reference_id, amount, currency, status, reason, evidence, submitted_at) VALUES
(
    '550e8400-e29b-41d4-a716-446655440090',
    '550e8400-e29b-41d4-a716-446655440002',
    'reimbursement',
    'amazon',
    'AMZ-REF-001',
    25.50,
    'USD',
    'pending',
    'Damaged inventory during Amazon fulfillment',
    ARRAY['damage_photo_1.jpg', 'damage_photo_2.jpg', 'inspection_report.pdf'],
    NOW() - INTERVAL '3 days'
);

-- ========================================
-- SAMPLE NOTIFICATIONS
-- ========================================
INSERT INTO notifications (id, user_id, type, title, message, priority, status, metadata) VALUES
(
    '550e8400-e29b-41d4-a716-446655440100',
    '550e8400-e29b-41d4-a716-446655440002',
    'inapp',
    'Inventory Sync Completed',
    'Amazon inventory sync completed successfully. 3 items processed, 2 updated, 1 created.',
    'normal',
    'unread',
    '{"sync_id": "550e8400-e29b-41d4-a716-446655440070", "provider": "amazon", "items_processed": 3}'
),
(
    '550e8400-e29b-41d4-a716-446655440101',
    '550e8400-e29b-41d4-a716-446655440002',
    'email',
    'Low Stock Alert',
    'Product PROD-002 (Smartphone Case) is running low on stock. Current quantity: 25, Reorder point: 25',
    'high',
    'unread',
    '{"sku": "PROD-002", "current_quantity": 25, "reorder_point": 25}'
);

-- ========================================
-- SAMPLE API LOGS
-- ========================================
INSERT INTO api_logs (id, user_id, endpoint, method, status_code, response_time_ms, ip_address, user_agent, request_body, response_body) VALUES
(
    '550e8400-e29b-41d4-a716-446655440110',
    '550e8400-e29b-41d4-a716-446655440002',
    '/api/v1/amazon/inventory',
    'GET',
    200,
    245,
    '192.168.1.100',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    '{"marketplace_id": "ATVPDKIKX0DER"}',
    '{"success": true, "data": {"items": 3, "total_value": 1250.00}}'
),
(
    '550e8400-e29b-41d4-a716-446655440111',
    '550e8400-e29b-41d4-a716-446655440002',
    '/api/v1/sync/start',
    'POST',
    200,
    1890,
    '192.168.1.100',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    '{"provider": "amazon", "sync_type": "full"}',
    '{"success": true, "sync_id": "550e8400-e29b-41d4-a716-446655440070"}'
);

-- ========================================
-- SAMPLE WEBHOOK EVENTS
-- ========================================
INSERT INTO webhook_events (id, user_id, provider, event_type, event_id, payload, processed, created_at) VALUES
(
    '550e8400-e29b-41d4-a716-446655440120',
    '550e8400-e29b-41d4-a716-446655440002',
    'amazon',
    'inventory.updated',
    'evt_amazon_inv_001',
    '{"marketplace_id": "ATVPDKIKX0DER", "sku": "PROD-001", "quantity": 145, "timestamp": "2024-01-15T10:30:00Z"}',
    false,
    NOW() - INTERVAL '30 minutes'
),
(
    '550e8400-e29b-41d4-a716-446655440121',
    '550e8400-e29b-41d4-a716-446655440002',
    'stripe',
    'charge.succeeded',
    'evt_stripe_charge_001',
    '{"account_id": "acct_1234567890abcdef", "charge_id": "ch_1234567890abcdef", "amount": 8999, "currency": "usd"}',
    false,
    NOW() - INTERVAL '15 minutes'
);

-- ========================================
-- COMMIT TRANSACTION
-- ========================================
COMMIT;


