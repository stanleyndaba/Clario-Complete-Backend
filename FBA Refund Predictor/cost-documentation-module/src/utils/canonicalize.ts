import { createHash } from 'crypto';

/**
 * Canonicalization utility for consistent object hashing
 * Ensures deterministic output regardless of object property order or ephemeral fields
 */

export interface CanonicalizationOptions {
  removeFields?: string[];
  sortArrays?: boolean;
  normalizeNumbers?: boolean;
}

const DEFAULT_EPHEMERAL_FIELDS = [
  '_generated_at',
  '_temp_id',
  '_session_id',
  '_request_id',
  '_timestamp',
  'created_at',
  'updated_at',
  'modified_at'
];

/**
 * Canonicalizes an object for consistent hashing
 * - Deep sorts object keys
 * - Removes ephemeral fields
 * - Normalizes array ordering
 * - Ensures consistent number formatting
 */
export function canonicalizeObject(
  obj: any,
  options: CanonicalizationOptions = {}
): any {
  const {
    removeFields = DEFAULT_EPHEMERAL_FIELDS,
    sortArrays = true,
    normalizeNumbers = true
  } = options;

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return obj;
  }

  if (typeof obj === 'number') {
    return normalizeNumbers ? Number(obj.toFixed(10)) : obj;
  }

  if (typeof obj === 'boolean') {
    return obj;
  }

  if (obj instanceof Date) {
    return obj.toISOString();
  }

  if (Array.isArray(obj)) {
    const canonicalized = obj.map(item => canonicalizeObject(item, options));
    return sortArrays ? canonicalized.sort(deepCompare) : canonicalized;
  }

  if (typeof obj === 'object') {
    const canonicalized: Record<string, any> = {};
    
    // Get all keys and sort them
    const keys = Object.keys(obj).sort();
    
    for (const key of keys) {
      // Skip ephemeral fields
      if (removeFields.includes(key)) {
        continue;
      }
      
      // Skip undefined values
      if (obj[key] === undefined) {
        continue;
      }
      
      canonicalized[key] = canonicalizeObject(obj[key], options);
    }
    
    return canonicalized;
  }

  return obj;
}

/**
 * Deep comparison function for sorting arrays
 */
function deepCompare(a: any, b: any): number {
  if (a === b) return 0;
  
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  
  if (typeof a === 'string' && typeof b === 'string') {
    return a.localeCompare(b);
  }
  
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return a === b ? 0 : a ? 1 : -1;
  }
  
  if (Array.isArray(a) && Array.isArray(b)) {
    const minLength = Math.min(a.length, b.length);
    for (let i = 0; i < minLength; i++) {
      const comparison = deepCompare(a[i], b[i]);
      if (comparison !== 0) return comparison;
    }
    return a.length - b.length;
  }
  
  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    
    const minLength = Math.min(keysA.length, keysB.length);
    for (let i = 0; i < minLength; i++) {
      const keyComparison = keysA[i].localeCompare(keysB[i]);
      if (keyComparison !== 0) return keyComparison;
      
      const valueComparison = deepCompare(a[keysA[i]], b[keysB[i]]);
      if (valueComparison !== 0) return valueComparison;
    }
    return keysA.length - keysB.length;
  }
  
  // Fallback: convert to string and compare
  return String(a).localeCompare(String(b));
}

/**
 * Computes SHA256 hash of canonicalized object
 */
export function computeEvidenceSha256(canonicalObject: any): string {
  const canonicalized = canonicalizeObject(canonicalObject);
  const jsonString = JSON.stringify(canonicalized);
  return createHash('sha256').update(jsonString).digest('hex');
}

/**
 * Returns first 8 characters of SHA256 hash for short identifiers
 */
export function shortHash(sha256: string): string {
  if (!sha256 || sha256.length < 8) {
    throw new Error('Invalid SHA256 hash provided');
  }
  return sha256.substring(0, 8);
}

/**
 * Computes signature hash from evidence hash, template version, and prepared date
 * signature_sha256 = sha256(evidence_sha256 + '|' + template_version + '|' + prepared_on_iso)
 */
export function computeSignatureHash(
  evidenceSha256: string,
  templateVersion: string,
  preparedOn: string
): string {
  const signatureString = `${evidenceSha256}|${templateVersion}|${preparedOn}`;
  return createHash('sha256').update(signatureString).digest('hex');
}

/**
 * Validates that a hash is a valid SHA256 hash
 */
export function isValidSha256(hash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(hash);
}

/**
 * Creates a deterministic report ID from seller ID, anomaly ID, and template version
 */
export function createReportId(
  sellerId: string,
  anomalyId: string,
  templateVersion: string
): string {
  const base = `${sellerId}-${anomalyId}-v${templateVersion}`;
  const hash = createHash('sha256').update(base).digest('hex');
  return `${base}-${shortHash(hash)}`;
}

/**
 * Canonicalizes evidence data specifically for cost documentation
 */
export function canonicalizeEvidenceData(evidence: any): any {
  return canonicalizeObject(evidence, {
    removeFields: [
      ...DEFAULT_EPHEMERAL_FIELDS,
      'temp_data',
      'cache_key',
      'session_info',
      'debug_info'
    ],
    sortArrays: true,
    normalizeNumbers: true
  });
}

/**
 * Creates a stable fingerprint for evidence comparison
 */
export function createEvidenceFingerprint(evidence: any): string {
  const canonicalized = canonicalizeEvidenceData(evidence);
  return computeEvidenceSha256(canonicalized);
}





