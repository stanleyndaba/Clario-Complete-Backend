# Gmail Ingestion Fix Summary

## Problem Description
The "Ingest Gmail Only" button on the frontend was failing with a "Failed to fetch Gmail emails" error. Despite the user successfully completing the Google OAuth flow and seeing "Gmail Connected", no emails were being ingested.

## Root Causes Identified

### 1. Encryption Key Format Mismatch (Critical)
- **Issue:** The `ENCRYPTION_KEY` environment variable on Render was set in **Base64** format (44 characters).
- **Requirement:** The backend `tokenManager` strictly requires a **Hex** string of at least 64 characters.
- **Consequence:** The backend silently rejected the provided key and fell back to a derived key (from `JWT_SECRET`). When the backend tried to decrypt tokens (or when a new deployment occurred), the keys didn't match, leading to "bad decrypt" errors or silent failures.

### 2. User ID Mismatch
- **Issue:** The Frontend hardcodes `x-user-id: demo-user` for API requests.
- **Backend Behavior:** The backend converts `demo-user` to a deterministic UUID (`07b4f03d-352e-473f-a316-af97d9017d69`).
- **Conflict:** Previous debugging attempts created tokens under different User IDs (e.g., `stress-test-user-...`), causing the frontend to not find the valid token for `demo-user`.

### 3. Silent Failure in OAuth Callback
- **Issue:** The `evidenceSourcesController.ts` was catching errors during `tokenManager.saveToken()` and logging them, but **not** throwing them or notifying the user.
- **Consequence:** The OAuth flow appeared successful to the user (`gmail_connected=true`), masking the underlying database save failure.

## The Solution

### 1. Code Fixes
- **Updated `evidenceSourcesController.ts`:** Modified the OAuth callback to throw an error if token saving fails, ensuring visibility of issues.
- **Added Debug Scripts:** Created scripts to verify token encryption, check database consistency, and validate User ID conversion.

### 2. Infrastructure Fixes
- **Updated Render Environment Variable:** Converted the Base64 `ENCRYPTION_KEY` to its correct **Hex** representation and updated it in the Render dashboard.
  - **Old (Base64):** `c6yA2ltJ...`
  - **New (Hex):** `73ac80da5b49d36e...`
- **Database Cleanup:** Connected to the Render database and deleted invalid/corrupt tokens to ensure a clean state.

## Verification
- **Token Saved:** Confirmed a new token was created in the Render database for the correct `demo-user` UUID.
- **Decryption Success:** Verified that the new token could be successfully decrypted using the corrected Hex encryption key.
- **Ingestion:** The "Ingest Gmail Only" flow now has a valid, readable token to use.

## Future Recommendations
- **Environment Variable Validation:** Add startup checks to ensure `ENCRYPTION_KEY` is in the expected format (Hex) and length.
- **Frontend User ID:** Eventually move away from hardcoded `demo-user` in the frontend to support real multi-user authentication.
