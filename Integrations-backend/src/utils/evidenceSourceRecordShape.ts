export function getManagedTokenSourceFields(hasRefreshToken: boolean = true) {
  return {
    encrypted_access_token: 'managed-by-token-manager',
    encrypted_refresh_token: hasRefreshToken ? 'managed-by-token-manager' : 'refresh-token-unavailable'
  };
}
