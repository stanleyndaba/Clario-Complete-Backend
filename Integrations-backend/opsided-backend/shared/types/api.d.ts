// API response interfaces for Opsided backend

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
  timestamp: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    role: string;
  };
  token: string;
  refreshToken: string;
  expiresIn: number;
}

export interface OAuthResponse {
  success: boolean;
  authUrl?: string;
  message: string;
  error?: string;
}

export interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

export interface ClaimResponse {
  id: string;
  status: string;
  amount: number;
  description: string;
  source: string;
  external_id?: string;
  created_at: string;
  updated_at: string;
}

export interface InventoryResponse {
  id: string;
  sku: string;
  quantity: number;
  location: string;
  source: string;
  external_id?: string;
  last_synced_at?: string;
  created_at: string;
  updated_at: string;
}

export interface SyncResponse {
  success: boolean;
  synced_items: number;
  errors: string[];
  message: string;
}

export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  services: {
    database: boolean;
    [key: string]: boolean;
  };
  version: string;
}

export interface ErrorResponse {
  success: false;
  error: string;
  message: string;
  timestamp: string;
  code?: string;
  details?: any;
}

// Request interfaces
export interface CreateClaimRequest {
  amount: number;
  description: string;
  source: string;
  external_id?: string;
}

export interface UpdateClaimRequest {
  status?: string;
  amount?: number;
  description?: string;
}

export interface CreateInventoryRequest {
  sku: string;
  quantity: number;
  location: string;
  source: string;
  external_id?: string;
}

export interface UpdateInventoryRequest {
  quantity?: number;
  location?: string;
  source?: string;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface FilterQuery extends PaginationQuery {
  status?: string;
  source?: string;
  location?: string;
  date_from?: string;
  date_to?: string;
} 