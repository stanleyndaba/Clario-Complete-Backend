// Global type definitions for the Opsided backend

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: 'development' | 'production' | 'test';
      PORT: string;
      DB_HOST: string;
      DB_PORT: string;
      DB_NAME: string;
      DB_USER: string;
      DB_PASSWORD: string;
      JWT_SECRET: string;
      ENCRYPTION_KEY: string;
      LOG_LEVEL: string;
      AMAZON_CLIENT_ID: string;
      AMAZON_CLIENT_SECRET: string;
      STRIPE_CLIENT_ID: string;
      STRIPE_CLIENT_SECRET: string;
      GMAIL_CLIENT_ID: string;
      GMAIL_CLIENT_SECRET: string;
    }
  }

  interface AuthenticatedRequest extends Request {
    user?: {
      id: string;
      email: string;
      role: string;
    };
  }
}

export {}; 