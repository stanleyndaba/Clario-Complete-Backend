import axios, { AxiosInstance } from 'axios';

export type ExternalStatus = 'pending' | 'submitted' | 'acknowledged' | 'paid' | 'failed' | 'rejected' | 'partial';

export interface SubmitClaimPayload {
  caseId: string;
  userId: string;
  caseNumber: string;
  amountCents: number;
  currency: string;
  description?: string;
}

export interface SubmitClaimResponse {
  submissionId: string;
  status: ExternalStatus;
}

export interface SubmissionStatusResponse {
  submissionId: string;
  status: ExternalStatus;
  updatedAt?: string;
}

/**
 * Headless Amazon submission client.
 * Uses an external service that automates claim creation and returns submission IDs and statuses.
 */
export class AmazonSubmissionClient {
  private http: AxiosInstance;

  constructor(baseUrl: string, apiKey?: string, timeoutMs: number = 30000) {
    this.http = axios.create({
      baseURL: baseUrl,
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
    });
  }

  async submitClaim(payload: SubmitClaimPayload): Promise<SubmitClaimResponse> {
    const res = await this.http.post('/submit-claim', payload);
    return {
      submissionId: res.data.submission_id || res.data.submissionId,
      status: res.data.status as ExternalStatus,
    };
  }

  async getSubmissionStatus(submissionId: string): Promise<SubmissionStatusResponse> {
    const res = await this.http.get(`/submission-status/${submissionId}`);
    return {
      submissionId,
      status: res.data.status as ExternalStatus,
      updatedAt: res.data.updated_at || res.data.updatedAt,
    };
  }
}


