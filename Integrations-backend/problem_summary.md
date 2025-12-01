# Problem Summary: `convertUserIdToUuid` Export Issue

## The Issue
We are encountering a compilation error when trying to run the Gmail ingestion pipeline:
`Module '"../database/supabaseClient"' has no exported member 'convertUserIdToUuid'.`

## Context
1.  **Goal**: Implement mock attachment processing for Gmail ingestion.
2.  **Blocker**: The `storeEvidenceDocument` function in `gmailIngestionService.ts` fails because the test user ID (`stress-test-user-...`) is not a valid UUID, which the database requires.
3.  **Solution**: We attempted to use the helper function `convertUserIdToUuid` from `supabaseClient.ts` to convert the ID to a valid UUID.
4.  **Root Cause**: The `convertUserIdToUuid` function is defined in `supabaseClient.ts` (around line 140) but is **not exported**, making it inaccessible to other files like `gmailIngestionService.ts`.

## Resolution Plan
1.  Modify `src/database/supabaseClient.ts` to add the `export` keyword to the `convertUserIdToUuid` function definition.
2.  This will make the function available for import in `src/services/gmailIngestionService.ts`.
3.  Once fixed, the ingestion script should compile and run, allowing us to verify that mock attachments are correctly saved to the database.
