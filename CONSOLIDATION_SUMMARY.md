perfect! we now fix Agent 1; we have a problem with Agent 1; 

1. **CALLBACK FLOW**
Exact live callback order in [amazonController.ts](/c:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/controllers/amazonController.ts):
1. Amazon callback received
2. OAuth `state` is read from `oauthStateStore`
3. auth code is exchanged for LWA tokens
4. seller profile is requested from SP-API
5. if seller profile fails, fallback seller identity is created:
   - `sellerId = UNRESOLVED_{userId || anonymous}`
6. user is found or created in `users`
7. tenant is found or created
8. tenant membership is upserted
9. store is looked up / created
10. encrypted Amazon tokens are saved with `tokenManager.saveToken(...)`
11. Amazon `evidence_sources` row is attempted
12. Agent 2 enqueue is attempted through BullMQ:
   - `isQueueHealthy()`
   - `addSyncJob(...)`
13. enqueue fails
14. controller redirects to `/auth/success?status=error...`
So the failure happened after token persistence, not before it.
2. **TOKEN PERSISTENCE TRUTH**
`TOKEN SAVE = YES`
Live DB proof:
- latest Amazon token row exists in `tokens`
- `user_id = 003ac512-8d15-4b5a-98a0-42fcb2647a0a`
- `tenant_id = 31a6d9a6-eb7c-422f-bd1b-a25697616de6`
- `provider = amazon`
- `updated_at = 2026-03-20T18:28:49.891994+00:00`
- `expires_at = 2026-03-20T19:28:49.816+00:00`
- encrypted fields present:
- `access_token_iv`: yes
  - `access_token_data`: yes
  - `refresh_token_iv`: yes
  - `refresh_token_data`: yes
So tokens were actually stored.
3. **CONNECTION RECORD TRUTH**
`CONNECTION SAVE = PARTIAL`
What exists:
- real Amazon token row in `tokens`
- real user row
- real tenant membership row
What does not exist for this newest OAuth save:
- no Amazon `evidence_sources` row for:
  - `user_id = 003ac512-8d15-4b5a-98a0-42fcb2647a0a`
- no Amazon `evidence_sources` row for:
  - `seller_id = UNRESOLVED_anonymous`
Store truth:
- live query shows `stores` relation does not exist in this DB
- token row therefore has:
  - `store_id = null`
So the token-level connection saved, but the broader integration/account record did not save cleanly.
4. **TENANT / USER / SELLER LINKAGE**
`LINKAGE = PARTIAL`
Live linked records:
- user:
  - `id = 003ac512-8d15-4b5a-98a0-42fcb2647a0a`
  - `email = UNRESOLVED_anonymous@amazon.seller`
  - `seller_id = UNRESOLVED_anonymous`
  - `amazon_seller_id = UNRESOLVED_anonymous`
  - `tenant_id = 31a6d9a6-eb7c-422f-bd1b-a25697616de6`
- tenant:
  - `id = 31a6d9a6-eb7c-422f-bd1b-a25697616de6`
  - `slug = seller-unresolved_anonymous`
- membership:
  - owner membership exists for that same user/tenant
Why partial:
- token is attached to a real user and real tenant
- but seller linkage is fallback/unresolved, not a real Amazon seller id
- no evidence-source record exists for this saved connection
- no store linkage exists
5. **QUEUE FAILURE ROOT CAUSE**
Queue system:
- BullMQ over Redis in [ingestionQueue.ts](/c:/Users/Student/Contacts/Clario-Complete-Backend/Integrations-backend/src/queues/ingestionQueue.ts)
Exact failing step:
- `isQueueHealthy()` before `addSyncJob(...)`
Live root cause:
- Redis hostname in `REDIS_URL` is not resolving
- live check failed with:
  - `getaddrinfo ENOTFOUND modest-lionfish-66636.upstash.io`
- queue health therefore returns false
- controller throws:
  - `Sync queue unavailable. Amazon connection saved, but Agent 2 ingestion was not started.`
This is a real queue availability / config failure, not an OAuth failure.
6. **AGENT 2 START STATUS**
`INGESTION STARTED = NO`
Why:
- enqueue never happened because `isQueueHealthy()` failed first
- no current sync job was created for this OAuth attempt
Live corroboration:
- the only `sync_progress` row for this user is older:
  - created `2026-03-18`
   - status `failed`
  - error includes SP-API `403`
- there is no new `sync_progress` row at the current OAuth timestamp (`2026-03-20T18:28:49...`)
So this new OAuth attempt did not start Agent 2.
7. **CURRENT PARTIAL STATE**
Exact current truth:
- OAuth code exchange succeeded
- encrypted Amazon tokens were saved
- user/tenant membership exists
- seller identity fell back to `UNRESOLVED_anonymous`
- no Amazon evidence-source connection row exists for this saved attempt
- no store record exists in live DB
- Agent 2 ingestion did not start
- queue failed before enqueue because Redis host resolution failed
So this is not a clean full save, but it is not a total failure either.
8. **MINIMAL SAFE RECOVERY ACTION**
`restore queue service first, then retrigger Agent 2 ingestion`
Not reconnect Amazon.
Because:
- tokens already exist
- tenant/user linkage already exists
- the blocking failure is the queue
- the smallest safe next step is:
  1. fix Redis / BullMQ connectivity
  2. re-enqueue Agent 2 sync for this saved user/tenant
9. **FINAL VERDICT**
 ⚠️ PARTIAL / CORRUPTED STATE`
**FINAL STATEMENT**
Did Amazon OAuth actually save successfully, and what exactly must be done next to recover from this failure?
**PARTIAL** — OAuth token persistence succeeded, but the save is not fully clean because the seller identity is unresolved, no Amazon `evidence_sources` connection row exists, and Agent 2 never started. The exact next step is: **restore Redis queue connectivity, then retrigger the Agent 2 sync job for user `003ac512-8d15-4b5a-98a0-42fcb2647a0a` / tenant `31a6d9a6-eb7c-422f-bd1b-a25697616de6`.**

Ingestion does NOT persists through. WHY? 