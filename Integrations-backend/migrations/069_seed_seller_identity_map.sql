-- Seeding Script for v1_seller_identity_map
-- This script links existing Amazon Seller IDs to internal User IDs

INSERT INTO v1_seller_identity_map (user_id, merchant_token)
SELECT id, amazon_seller_id 
FROM users 
WHERE amazon_seller_id IS NOT NULL
ON CONFLICT (merchant_token) DO NOTHING;

-- Verification query
SELECT COUNT(*) as mapped_count FROM v1_seller_identity_map;
