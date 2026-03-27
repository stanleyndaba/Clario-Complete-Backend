import crypto from 'crypto';
import axios from 'axios';
import logger from './logger';

export interface AmazonSnsEnvelope {
  Type?: string;
  MessageId?: string;
  TopicArn?: string;
  Subject?: string;
  Message?: string;
  Timestamp?: string;
  SignatureVersion?: string;
  Signature?: string;
  SigningCertURL?: string;
  SubscribeURL?: string;
  Token?: string;
  [key: string]: any;
}

const CERT_CACHE_TTL_MS = 60 * 60 * 1000;
const certCache = new Map<string, { pem: string; expiresAt: number }>();

function isTrustedAmazonSnsCertUrl(value?: string): boolean {
  if (!value) return false;

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      return false;
    }

    const host = url.hostname.toLowerCase();
    const trustedHost =
      /^sns\.[a-z0-9-]+\.amazonaws\.com$/i.test(host) ||
      /^sns-[a-z0-9-]+\.amazonaws\.com$/i.test(host);

    return trustedHost && url.pathname.endsWith('.pem');
  } catch {
    return false;
  }
}

function isTrustedAmazonSubscribeUrl(value?: string): boolean {
  if (!value) return false;

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      return false;
    }

    const host = url.hostname.toLowerCase();
    return /^sns(\.[a-z0-9-]+|-[a-z0-9-]+)\.amazonaws\.com$/i.test(host);
  } catch {
    return false;
  }
}

function buildStringToSign(envelope: AmazonSnsEnvelope): string {
  const orderedKeys =
    envelope.Type === 'Notification'
      ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
      : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];

  const lines: string[] = [];
  for (const key of orderedKeys) {
    const value = envelope[key];
    if (value === undefined || value === null || value === '') {
      continue;
    }
    lines.push(`${key}\n${value}`);
  }

  return `${lines.join('\n')}\n`;
}

async function getCertificatePem(signingCertUrl: string): Promise<string> {
  const cached = certCache.get(signingCertUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.pem;
  }

  const response = await axios.get(signingCertUrl, {
    responseType: 'text',
    timeout: 10000,
    validateStatus: (status) => status >= 200 && status < 300
  });

  const pem = String(response.data || '');
  certCache.set(signingCertUrl, {
    pem,
    expiresAt: Date.now() + CERT_CACHE_TTL_MS
  });
  return pem;
}

function verifyTopicAllowList(topicArn?: string): boolean {
  const allowed = String(process.env.AMAZON_NOTIFICATION_ALLOWED_TOPIC_ARNS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (!allowed.length) {
    return true;
  }

  return !!topicArn && allowed.includes(topicArn);
}

export async function verifyAmazonSnsEnvelope(envelope: AmazonSnsEnvelope): Promise<{ valid: boolean; reason?: string }> {
  if (!envelope?.Type) {
    return { valid: false, reason: 'missing_type' };
  }

  if (!['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation'].includes(envelope.Type)) {
    return { valid: false, reason: 'unsupported_sns_type' };
  }

  if (!verifyTopicAllowList(envelope.TopicArn)) {
    return { valid: false, reason: 'topic_not_allowed' };
  }

  if (!envelope.Signature || !envelope.SigningCertURL || !envelope.SignatureVersion) {
    return { valid: false, reason: 'missing_signature_fields' };
  }

  if (!['1', '2'].includes(String(envelope.SignatureVersion))) {
    return { valid: false, reason: 'unsupported_signature_version' };
  }

  if (!isTrustedAmazonSnsCertUrl(envelope.SigningCertURL)) {
    return { valid: false, reason: 'untrusted_signing_cert_url' };
  }

  try {
    const pem = await getCertificatePem(envelope.SigningCertURL);
    const algorithm = String(envelope.SignatureVersion) === '1' ? 'RSA-SHA1' : 'RSA-SHA256';
    const verifier = crypto.createVerify(algorithm);
    verifier.update(buildStringToSign(envelope), 'utf8');
    verifier.end();

    const valid = verifier.verify(pem, envelope.Signature, 'base64');
    return valid ? { valid: true } : { valid: false, reason: 'signature_verification_failed' };
  } catch (error: any) {
    logger.warn('[AMAZON NOTIFICATIONS] SNS signature verification failed', {
      error: error?.message || error
    });
    return { valid: false, reason: 'signature_verification_failed' };
  }
}

export async function confirmAmazonSnsSubscription(envelope: AmazonSnsEnvelope): Promise<{ confirmed: boolean; reason?: string }> {
  if (!envelope?.SubscribeURL) {
    return { confirmed: false, reason: 'missing_subscribe_url' };
  }

  if (!isTrustedAmazonSubscribeUrl(envelope.SubscribeURL)) {
    return { confirmed: false, reason: 'untrusted_subscribe_url' };
  }

  try {
    await axios.get(envelope.SubscribeURL, {
      timeout: 10000,
      validateStatus: (status) => status >= 200 && status < 300
    });
    return { confirmed: true };
  } catch (error: any) {
    return {
      confirmed: false,
      reason: error?.message || 'subscription_confirmation_failed'
    };
  }
}
