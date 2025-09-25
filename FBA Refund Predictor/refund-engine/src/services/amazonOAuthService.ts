import axios from 'axios';

export interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
}

export class AmazonOAuthService {
  private static get clientId(): string {
    const value = process.env.AMAZON_OAUTH_CLIENT_ID || '';
    if (!value) throw new Error('AMAZON_OAUTH_CLIENT_ID not set');
    return value;
  }

  private static get clientSecret(): string {
    const value = process.env.AMAZON_OAUTH_CLIENT_SECRET || '';
    if (!value) throw new Error('AMAZON_OAUTH_CLIENT_SECRET not set');
    return value;
  }

  private static get tokenUrl(): string {
    return process.env.AMAZON_OAUTH_TOKEN_URL || 'https://api.amazon.com/auth/o2/token';
  }

  static async exchangeCodeForTokens(code: string, redirectUri: string): Promise<OAuthTokens> {
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('client_id', this.clientId);
    params.append('client_secret', this.clientSecret);
    params.append('redirect_uri', redirectUri);

    const { data } = await axios.post(this.tokenUrl, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    return data as OAuthTokens;
  }

  static async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken);
    params.append('client_id', this.clientId);
    params.append('client_secret', this.clientSecret);

    const { data } = await axios.post(this.tokenUrl, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    return data as OAuthTokens;
  }
}

