This repository uses a single root-level .env with namespaced keys. Services should map namespaced keys to their local expectations or load via compose env_file.

- REFUND_ENGINE_* → FBA Refund Predictor/refund-engine
- COST_DOC_* → FBA Refund Predictor/cost-documentation-module
- INTEGRATIONS_* → Integrations-backend
- PAYMENTS_* → stripe-payments
- ML_* → Python ML APIs (e.g., predictor, mcde)

Important:
- MCDE_CORS_ORIGINS: set to frontend domain(s), e.g. https://coruscating-cranachan-9b3ee7.netlify.app

Examples:
- REFUND_ENGINE_PORT maps to PORT inside refund-engine.
- PAYMENTS_STRIPE_SECRET_KEY maps to STRIPE_SECRET_KEY inside stripe-payments.

For local development, copy .env.example to .env and fill secrets.


