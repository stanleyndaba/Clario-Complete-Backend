export type IntentStage =
  | 'COLD'
  | 'INTERESTED'
  | 'ENGAGED'
  | 'HIGH_INTENT'
  | 'RECOVERY_READY'
  | 'CUSTOMER';

export type IntentSignal = {
  reason: string;
  score: number;
};

const SCROLL_PERCENT_KEYS = ['scroll_percent', 'scrollPercent', 'percent', 'depth'];

export function getIntentStage(score: number): IntentStage {
  if (score >= 100) return 'CUSTOMER';
  if (score >= 80) return 'RECOVERY_READY';
  if (score >= 50) return 'HIGH_INTENT';
  if (score >= 25) return 'ENGAGED';
  if (score >= 10) return 'INTERESTED';
  return 'COLD';
}

export function getIntentStageRank(stage: string | null | undefined) {
  switch (stage) {
    case 'CUSTOMER':
      return 5;
    case 'RECOVERY_READY':
      return 4;
    case 'HIGH_INTENT':
      return 3;
    case 'ENGAGED':
      return 2;
    case 'INTERESTED':
      return 1;
    case 'COLD':
    default:
      return 0;
  }
}

export function getHighestIntentStage(currentStage: string | null | undefined, nextStage: IntentStage) {
  return getIntentStageRank(nextStage) > getIntentStageRank(currentStage)
    ? nextStage
    : (currentStage || 'COLD');
}

function getNumericPayloadValue(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function isHomePageEvent(eventName: string, pagePath?: string | null, routeGroup?: string | null) {
  if (eventName === 'homepage_viewed') return true;
  if (eventName === 'page_view' && (routeGroup === 'home' || pagePath === '/')) return true;
  return false;
}

function isEarlyAccessPageEvent(eventName: string, pagePath?: string | null, routeGroup?: string | null) {
  if (eventName === 'early_access_viewed') return true;
  if (eventName === 'page_view' && (routeGroup === 'early_access' || pagePath?.startsWith('/early-access'))) return true;
  return false;
}

export function getRecoveryIntentSignals(input: {
  eventName: string;
  payload: Record<string, unknown>;
  pagePath?: string | null;
  routeGroup?: string | null;
}): IntentSignal[] {
  const { eventName, payload, pagePath, routeGroup } = input;
  const signals: IntentSignal[] = [];

  if (isHomePageEvent(eventName, pagePath, routeGroup)) {
    signals.push({ reason: 'homepage_viewed', score: 1 });
  }

  if (eventName === 'scroll_depth_reached') {
    const scrollPercent = getNumericPayloadValue(payload, SCROLL_PERCENT_KEYS);
    if (scrollPercent !== null && scrollPercent >= 50) {
      signals.push({ reason: 'scroll_50', score: 2 });
    }
    if (scrollPercent !== null && scrollPercent >= 75) {
      signals.push({ reason: 'scroll_75', score: 3 });
    }
  }

  if (eventName === 'early_access_10s_engaged') {
    signals.push({ reason: 'engaged_10_seconds', score: 2 });
  }

  if (eventName === 'early_access_30s_engaged') {
    signals.push({ reason: 'engaged_30_seconds', score: 4 });
  }

  if (eventName === 'demo_video_started') {
    signals.push({ reason: 'demo_started', score: 8 });
  }

  if (eventName === 'demo_video_completed') {
    signals.push({ reason: 'demo_completed', score: 15 });
  }

  if (isEarlyAccessPageEvent(eventName, pagePath, routeGroup)) {
    signals.push({ reason: 'early_access_viewed', score: 10 });
  }

  if ([
    'cta_clicked',
    'early_access_cta_clicked',
    'claim_access_clicked',
    'app_gate_early_access_clicked',
    'payment_button_clicked',
    'paystack_cta_seen',
  ].includes(eventName)) {
    signals.push({ reason: 'cta_clicked', score: 10 });
  }

  if ([
    'checkout_started',
    'checkout_opened',
    'outbound_payment_clicked',
  ].includes(eventName)) {
    signals.push({ reason: 'checkout_started', score: 25 });
  }

  if ([
    'amazon_connect_initiated',
    'oauth_started',
    'oauth_connect_started',
    'provider_connect_started',
  ].includes(eventName)) {
    signals.push({ reason: 'oauth_started', score: 30 });
  }

  if ([
    'oauth_callback_success',
    'oauth_completed',
    'provider_connect_completed',
  ].includes(eventName)) {
    signals.push({ reason: 'oauth_completed', score: 50 });
  }

  if (eventName === 'payment_success') {
    signals.push({ reason: 'payment_success', score: 100 });
  }

  return signals;
}

export function buildIntentSummary(score: number, stage: IntentStage, scoredReasons: Record<string, unknown>) {
  return {
    score,
    stage,
    reasons: Object.keys(scoredReasons || {}).sort(),
  };
}
