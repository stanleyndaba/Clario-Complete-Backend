import { convertUserIdToUuid } from '../src/database/supabaseClient';

function summarizeFallbackBehavior(userId: string) {
  const dbUserId = convertUserIdToUuid(userId);

  return {
    inputUserId: userId,
    dbUserId,
    expectations: [
      'evidence_sources.user_id should store the UUID-safe value',
      'Gmail OAuth callback should persist access_token, refresh_token, and expires_at into evidence_sources.metadata',
      'gmailService should be able to read source metadata tokens when tokenManager is empty',
      'Agent 4 worker should attempt Gmail ingestion when a connected source exists'
    ]
  };
}

const userId = process.argv[2] || 'demo-user';
const result = summarizeFallbackBehavior(userId);

console.log(JSON.stringify(result, null, 2));
