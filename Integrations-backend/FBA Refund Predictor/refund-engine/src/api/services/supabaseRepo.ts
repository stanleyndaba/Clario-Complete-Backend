import fetch from 'node-fetch';

const SUPABASE_URL = process.env['SUPABASE_URL'] as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'] as string;

function headers() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Prefer': 'return=representation'
  } as Record<string, string>;
}

// Stubbed methods for MVP testing - replace with real implementation later
export async function insertProofBundle(payload: any, hash: string, timestamp: string, actor_id: string) {
  // Stub: return fake proof bundle
  return {
    id: "proof-1",
    claim_id: null, // Will be set after claim creation
    payload,
    content_hash: hash,
    created_at: timestamp,
    created_by: actor_id
  };
}

export async function insertEvidenceLink(claim_id: string, ocr_text: string, metadata: any) {
  // Stub: return fake evidence link
  return {
    id: "link-1",
    claim_id,
    link_type: "invoice_text",
    link_value: ocr_text,
    metadata,
    created_at: new Date().toISOString(),
    created_by: "test-user"
  };
}

export async function createClaimWithProof(userId: string, case_number: string, claim_amount: number, claim_type: string, anomaly_score: number, proof_bundle_id: string, certainty_score_id?: string) {
  // Stub: return fake claim
  return {
    id: "claim-1",
    claimNumber: case_number,
    userId,
    status: 'pending',
    amount: claim_amount,
    anomaly_score,
    claim_type,
    proof_bundle_id,
    certainty_score_id
  };
}

export async function getProofBundle(id: string) {
  // Stub: return fake proof bundle with full data
  return {
    id: "proof-1",
    claim_id: "claim-1",
    payload: { source: 'invoice_text', text: 'Vendor: Amazon FBA, Overcharge detected $150.00' },
    content_hash: "fakehash123",
    created_at: new Date().toISOString(),
    created_by: "test-user"
  };
}

export async function getClaimByProofId(proof_bundle_id: string) {
  // Stub: return fake claim
  return {
    id: "claim-1",
    claimNumber: "TEST-001",
    userId: "test-user",
    status: 'pending',
    amount: 150.00,
    anomaly_score: 0.9,
    claim_type: 'invoice_text',
    proof_bundle_id
  };
}

export async function getEvidenceLinksByClaimId(claim_id: string) {
  // Stub: return fake evidence links
  return [{
    id: "link-1",
    claim_id,
    link_type: "invoice_text",
    link_value: "Vendor: Amazon FBA, Overcharge detected $150.00",
    metadata: { vendor: "Amazon FBA", invoice_number: "INV-2024-001", date: "2024-01-15" },
    created_at: new Date().toISOString(),
    created_by: "test-user"
  }];
}

// New methods for integrated flow
export async function updateClaimWithCertaintyScore(claim_id: string, certainty_score_id: string) {
  // Stub: return updated claim
  return {
    id: claim_id,
    certainty_score_id,
    updated_at: new Date().toISOString()
  };
}

export async function getClaimWithFullTraceability(claim_id: string) {
  // Stub: return claim with proof bundle and certainty score
  return {
    id: claim_id,
    claimNumber: "TEST-001",
    userId: "test-user",
    status: 'pending',
    amount: 150.00,
    anomaly_score: 0.9,
    claim_type: 'invoice_text',
    proof_bundle_id: "proof-1",
    certainty_score_id: "certainty-1",
    proof_bundle: {
      id: "proof-1",
      payload: { source: 'invoice_text', text: 'Vendor: Amazon FBA, Overcharge detected $150.00' },
      content_hash: "fakehash123",
      created_at: new Date().toISOString(),
      created_by: "test-user"
    },
    certainty_score: {
      id: "certainty-1",
      claim_id,
      refund_probability: 0.75,
      risk_level: "High",
      created_at: new Date().toISOString()
    }
  };
}

// Real implementation methods (commented out for MVP testing)
/*
export async function insertProofBundle(payload: any, hash: string, timestamp: string, actor_id: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/ProofBundle`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify([{ payload, hash, timestamp, actor_id }])
  });
  if (!res.ok) throw new Error(`ProofBundle insert failed: ${res.statusText}`);
  const data = await res.json();
  return data[0];
}

export async function insertEvidenceLink(claim_id: string, ocr_text: string, metadata: any) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/EvidenceLink`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify([{ claim_id, ocr_text, metadata }])
  });
  if (!res.ok) throw new Error(`EvidenceLink insert failed: ${res.statusText}`);
  const data = await res.json();
  return data[0];
}

export async function createClaimWithProof(userId: string, case_number: string, claim_amount: number, claim_type: string, anomaly_score: number, proof_bundle_id: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/Claim`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify([{ claimNumber: case_number, userId, status: 'pending', amount: claim_amount, anomaly_score, claim_type, proof_bundle_id }])
  });
  if (!res.ok) throw new Error(`Claim insert failed: ${res.statusText}`);
  const data = await res.json();
  return data[0];
}

export async function getProofBundle(id: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/ProofBundle?id=eq.${id}`, {
    headers: headers()
  });
  if (!res.ok) throw new Error(`ProofBundle fetch failed: ${res.statusText}`);
  const data = await res.json();
  return data[0] || null;
}

export async function getClaimByProofId(proof_bundle_id: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/Claim?proof_bundle_id=eq.${proof_bundle_id}`, {
    headers: headers()
  });
  if (!res.ok) throw new Error(`Claim fetch failed: ${res.statusText}`);
  const data = await res.json();
  return data[0] || null;
}

export async function getEvidenceLinksByClaimId(claim_id: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/EvidenceLink?claim_id=eq.${claim_id}`, {
    headers: headers()
  });
  if (!res.ok) throw new Error(`EvidenceLink fetch failed: ${res.statusText}`);
  const data = await res.json();
  return data as any[];
}
*/


