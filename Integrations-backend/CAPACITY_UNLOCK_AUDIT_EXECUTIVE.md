# Capacity Unlock Audit

Date: 2026-04-24
Audience: Backend Engineering Team
Scope: `Integrations-backend` runtime, queues, workers, deployment shape, and practical seller capacity

## Executive Summary

This backend is not capacity-blocked by product logic anymore, but it is still capacity-governed by a mix of conservative admission control, monolith deployment, Redis-backed worker dependencies, and filing throttles.

The most important repo-truth findings are:

1. The only explicit user-count gate in code is **5 active onboarding users** by default via `MAX_ACTIVE_ONBOARDING_USERS` in `src/services/onboardingCapacityService.ts`.
2. The checked-in deployment shape is still **2 Render free-tier services** in `../render.yaml`, with the Node service starting the **monolith runtime** via `npm start`.
3. In monolith mode, the Node API process can also start background sync, evidence ingestion, document parsing, evidence matching, refund filing, recoveries, billing, onboarding, and scheduled jobs in the same runtime.
4. The system already contains the beginnings of a cleaner scale path:
   - `npm run start:api`
   - `npm run worker:recoveries-lane`
   - `npm run worker:billing-lane`
5. Redis is not optional for healthy queue-backed operations. Some flows degrade gracefully without it, but filing and onboarding durability are materially weaker when Redis is unavailable.

My honest current read, based on checked-in defaults and deployment config:

- **Current enforced capacity:** 5 onboarding users
- **Current practical safe active-seller capacity on the checked-in shape:** roughly 25-75 active Amazon-connected sellers
- **Current architecture potential after operational unlocks:** 200+ without deep redesign
- **Not yet honest to claim today:** 1000 active processing sellers on the current checked-in deployment shape

## AI-Assisted Delivery Reality

AI can speed up the implementation work substantially, but the bottleneck for higher seller capacity is not just writing code.

For this backend, the real time sinks are:

- verifying queue and Redis behavior under load
- confirming the API runtime is not competing with worker load
- validating database indexes and query paths in the live environment
- deploying dedicated runtimes safely
- observing backlog depth, queue age, and runtime alerts after rollout

So the honest rule is:

- **AI can compress authoring time**
- **AI does not compress production truth to zero**

Practical estimate with AI assistance:

- **5 -> 50 sellers:** mostly ops/config, can be prepared in less than a day, but should still be rolled out and observed over 1-3 days
- **50 -> 200 sellers:** mostly ops plus light backend tuning, likely 1-3 days of implementation work and several more days of validation
- **200 -> 1000 sellers:** not a one-day coding task; AI can help draft a large share of the changes quickly, but trustworthy readiness is still a scaling project measured in days to weeks, not hours

If someone asks "can AI write the code in a day?", the fair answer is:

- **some of the code, yes**
- **a trustworthy 1000-seller unlock, no**

## What "Capacity" Means Here

This repo has more than one capacity ceiling:

1. **Admission capacity**: how many users can onboard at once
2. **Processing capacity**: how much sync / parsing / matching / filing / recovery work the workers can absorb
3. **Operational capacity**: how much load can be observed, controlled, and recovered safely during launch

Most optimistic docs in the repo speak to architectural potential. This audit speaks to the checked-in runtime and the concrete defaults that are active unless env overrides say otherwise.

## Current Repo Truth

### 1. User admission gate

File: `src/services/onboardingCapacityService.ts`

- `MAX_ACTIVE_ONBOARDING_USERS` default: `5`
- `ONBOARDING_SLOT_TTL_MINUTES` default: `1440`
- `ONBOARDING_NEXT_BATCH_HOURS` default: `24`

This is the current hard gate deciding how many onboarding slots are open at once.

### 2. Deployment topology

File: `../render.yaml`

Checked-in deployment shape:

- `opside-python-api` on `free`
- `opside-node-api` on `free`

Node start command:

- `cd Integrations-backend && npm start`

That means Render is booting `dist/index.js`, not `dist/startApiRuntime.js`.

### 3. Monolith runtime behavior

Files:

- `src/index.ts`
- `src/startApiRuntime.ts`

The repo already supports cleaner runtime separation, but the checked-in deployment still defaults to `RUNTIME_ROLE=monolith`.

In monolith mode:

- recoveries worker runs
- billing worker runs
- background sync can run
- evidence ingestion can run
- document parsing can run
- evidence matching can run
- refund filing can run
- onboarding worker can run
- scheduled sync can run
- scheduled ingestion can run

This is workable at small scale, but it is not the shape we should trust for serious concurrent growth.

### 4. Dedicated worker lanes already exist

Files:

- `src/workers/startRecoveriesLane.ts`
- `src/workers/startBillingLane.ts`
- `package.json`

Scripts already available:

- `npm run start:api`
- `npm run worker:recoveries-lane`
- `npm run worker:billing-lane`

This is important: the path from "current small monolith" to "cleaner multi-runtime deployment" is already partially implemented.

### 5. Queue and Redis dependency

Files:

- `src/queues/ingestionQueue.ts`
- `src/workers/onboardingWorker.ts`
- `src/workers/refundFilingWorker.ts`
- `src/utils/redisClient.ts`

Observations:

- onboarding queue is BullMQ-backed
- onboarding worker needs Redis
- refund filing queue needs Redis
- some flows fall back if queue infra is unavailable
- filing queue infrastructure can disable itself when Redis runtime health fails

Conclusion:

- Redis outage does not always hard-kill the app
- Redis outage does reduce durability, worker reliability, and queue governance
- healthy Redis is a launch requirement once onboarding volume rises

## Processing Limits Found in Code

### Intake governance

File: `src/services/capacityGovernanceService.ts`

Per-tenant limits by default:

- max concurrent syncs: `2`
- parsing backlog: `400`
- matching backlog: `400`
- filing backlog: `120`
- recovery backlog: `120`
- billing backlog: `120`

Age-based SLO breakers:

- parsing oldest-item cap: `30 min`
- matching oldest-item cap: `30 min`
- recovery oldest-item cap: `60 min`
- billing oldest-item cap: `60 min`

These are good safety rails. They also show the system is tuned conservatively.

### Onboarding worker

File: `src/workers/onboardingWorker.ts`

- worker concurrency: `10`
- limiter: `10 jobs / minute`

This is fine for controlled early-stage rollout. It is not a "throw thousands at it" setup.

### Scheduled sync

Files:

- `src/jobs/scheduledSyncJob.ts`
- `src/jobs/backgroundSyncWorker.ts`

Defaults found:

- one scheduled sync path runs every `1 hour`
- another background sync path defaults to every `6 hours`
- syncs are intentionally staggered between users

This is good for rate limiting, but it means growing the user base also grows steady-state background load, not just onboarding spikes.

### Evidence ingestion

File: `src/workers/evidenceIngestionWorker.ts`

- schedule: every `5 min`

### Document parsing

File: `src/workers/documentParsingWorker.ts`

- schedule: every `2 min`
- batch size: `75`

### Evidence matching

File: `src/workers/evidenceMatchingWorker.ts`

- schedule: every `3 min`
- user batch size: `60`
- claim batch size: `10`
- user stagger: `1000 ms`

### Refund filing

File: `src/workers/refundFilingWorker.ts`

Defaults:

- queue concurrency: `6`
- queue global rate limit: `6 / minute`
- max waiting backlog: `150`
- max queue age: `20 min`
- max per run: `12`
- max per hour: `60`
- max per day: `300`
- max per seller per day: `20`

This worker is intentionally conservative, which is the right instinct for Amazon-facing automation. It is also one of the most obvious throughput governors in the platform.

### Recoveries

File: `src/workers/recoveriesWorker.ts`

- batch size: `75`
- work batch size: `25`

### Billing

File: `src/workers/billingWorker.ts`

- execution lane schedule defaults to every `20 seconds`
- backstop sweep defaults to every `5 minutes`

## Observability That Already Exists

Files:

- `src/services/runtimeCapacityService.ts`
- `src/routes/adminQueueRoutes.ts`

The repo already has:

- worker snapshots
- queue/backlog thresholds
- Redis health tracking
- circuit breaker visibility
- `/api/admin/queue-stats`

This is good. It means the backend is not blind. What it still lacks is production-grade operational discipline around these signals.

## Main Bottlenecks, Ranked

### 1. Artificial onboarding cap

The system is still literally closed at `5` active onboarding users by default.

### 2. Monolith Node runtime on free-tier deployment

The checked-in deployment starts `npm start`, which keeps too many responsibilities in one runtime for anything beyond modest traffic.

### 3. Redis is effectively required for healthy growth

Queue-backed onboarding, filing, and some operational governance depend on Redis behaving well.

### 4. Filing is deliberately throttled

This is good for Amazon safety, but it means case throughput does not scale linearly with seller count.

### 5. Cron-heavy worker model

Many workers are schedule-driven. That is manageable at small scale, but it becomes noisy and less predictable as tenant count grows.

### 6. Runtime split exists but is not used in checked-in deployment

This is not a code gap. It is an operational gap.

### 7. Database index verification should be treated as a launch gate

The repo contains many tenant and workflow indexes in migrations, including large combined migration files. Given migration-path ambiguity in this codebase history, live index verification should happen before materially increasing load.

## Capacity Bands and Unlock Plan

## Band A: 5 -> 50 Active Sellers

### Goal

Move from invite-only caution to controlled live usage.

### Verdict

**Achievable without redesign.**

### Required changes

1. Raise `MAX_ACTIVE_ONBOARDING_USERS`
   - Suggested first move: `25`
   - Then `50` after 1-2 weeks of stable queue health

2. Stop running the API in monolith mode
   - Use `npm run start:api` for the primary Node runtime
   - Keep recoveries and billing out of the main API process

3. Confirm healthy managed Redis
   - no free/fragile setup
   - verify queue health in `/api/admin/queue-stats`

4. Stay conservative on filing throughput
   - do not raise filing caps yet
   - let Amazon-facing automation remain cautious

5. Verify production indexes exist
   - `sync_progress`
   - `detection_results`
   - `dispute_cases`
   - `evidence_documents`
   - `recovery_work_items`

6. Turn on launch monitoring discipline
   - review queue stats daily
   - watch runtime alerts
   - watch oldest-item age and waiting depth

### Estimated delivery effort

- code/config work: same day to 1 day
- deployment and verification: 1-3 days
- confidence to raise the cap further: only after stable observation

### Recommended env posture for Band A

- `MAX_ACTIVE_ONBOARDING_USERS=25` or `50`
- `REDIS_URL=<managed provider>`
- API runtime via `npm run start:api`
- keep:
  - `RUN_RECOVERIES_LANE_IN_API_PROCESS=false`
  - `RUN_BILLING_LANE_IN_API_PROCESS=false`

### Risks if we skip the above

- onboarding succeeds but work backs up invisibly
- API latency becomes erratic under worker pressure
- filing and onboarding behavior become less durable under Redis trouble

## Band B: 50 -> 200 Active Sellers

### Goal

Support a meaningful live seller base without the platform feeling brittle.

### Verdict

**Achievable with operational changes and modest infra spend.**

### Required changes

1. Deploy three Node runtimes
   - API runtime: `npm run start:api`
   - recoveries lane: `npm run worker:recoveries-lane`
   - billing lane: `npm run worker:billing-lane`

2. Move off free-tier web instances
   - the checked-in Render free plan is not the right baseline for 200 active sellers

3. Keep Redis managed and monitored
   - Redis becomes part of platform safety, not a convenience

4. Re-tune selected throughput knobs carefully
   - onboarding concurrency
   - document parsing batch size
   - evidence matching user batch size
   - scheduled sync interval

5. Add full-pipeline load testing
   - not just evidence ingestion
   - include onboarding, sync, evidence, matching, filing, recoveries

6. Add DB verification step
   - confirm query plans for the main tenant-scoped tables
   - confirm indexes exist in live DB, not just in migration files

### Estimated delivery effort

- implementation and infra changes: 1-3 focused days with AI assistance
- validation and rollout confidence: several additional days
- this is still realistic without redesign

### Suggested posture for Band B

- `MAX_ACTIVE_ONBOARDING_USERS=100` initially
- gradual move to `200` only after stable metrics
- consider `AUTO_SYNC_INTERVAL_HOURS=2` or `4` depending seller expectations and load
- only raise filing limits after Amazon-safety review

### What should still stay conservative

- filing quotas
- per-tenant sync concurrency
- queue backlogs before opening more onboarding slots

## Band C: 200 -> 1000 Active Sellers

### Goal

Become genuinely scalable, not just carefully stretched.

### Verdict

**Not honest to promise on the current checked-in deployment shape.**

**Possible, but requires a real backend scaling program.**

### Required changes

1. Split additional worker responsibilities out of the API runtime
   - document parsing
   - evidence matching
   - potentially filing dispatch

2. Introduce dedicated queue-first execution for heavy work
   - fewer cron-heavy all-tenant sweeps
   - more explicit queue consumers and work ownership

3. Add horizontal scaling and load balancing strategy
   - API runtime should be stateless and scaled separately from workers

4. Treat Redis and database tiers as first-class infrastructure
   - paid managed Redis
   - database performance monitoring
   - connection and query plan review

5. Revisit filing throughput and seller fairness strategy
   - current defaults are safe, but they cap total automation velocity

6. Complete the "50K readiness" gaps that still matter
   - large-batch processing verification
   - end-to-end performance tests
   - memory / timeout validation

7. Add production SLOs
   - sync freshness
   - document parse age
   - evidence match age
   - filing queue age
   - recovery reconciliation lag

### Recommendation for Band C

Do not unlock to 1000 active sellers by only changing env vars.

That would be the wrong lesson from this repo.

Treat the 1000-seller target as a scaling project, not a prompt.

AI can help write and refactor the necessary code quickly, but the real work at this band is:

- runtime separation
- queue-first work ownership
- load testing
- database verification
- rollout safety
- production observation

### Estimated delivery effort

- initial code authoring with AI: possibly 1-3 days depending on scope
- meaningful verification and rollout: more than 1 day
- honest production readiness: likely a focused multi-day push, and potentially 1-2 weeks if infra changes, testing, and staged rollout are included

## Recommended Rollout Sequence

1. **Now**
   - keep the 5-user gate until the API runtime is split from recoveries/billing

2. **Next unlock**
   - move API to `npm run start:api`
   - deploy dedicated recoveries lane
   - deploy dedicated billing lane
   - confirm managed Redis health

3. **Then**
   - raise onboarding cap to `25`
   - observe queue stats and backlog age for several days

4. **Then**
   - raise to `50`
   - keep filing caps conservative

5. **After stable operation**
   - move to `100`
   - then `200`

6. **Only after dedicated worker split and load testing**
   - plan for `1000`

## Recommended Immediate Actions for the Backend Team

### This week

1. Change the primary Node runtime to `npm run start:api`
2. Add dedicated recoveries lane runtime
3. Add dedicated billing lane runtime
4. Verify `REDIS_URL` is healthy and durable
5. Verify live DB indexes for core tenant tables
6. Set up queue-stat review as a launch ritual

### Before raising onboarding cap beyond 25

1. Confirm no critical runtime alerts
2. Confirm filing queue waiting depth stays healthy
3. Confirm parsing / matching oldest-item age stays inside SLO
4. Confirm sync jobs are not piling up across tenants

## Bottom Line

The backend is already more scalable than the current `5-user` gate suggests.

But the current checked-in deployment is still a **carefully managed small-scale system**, not a "throw 1000 active sellers at it" system.

The good news is that the unlock path is mostly visible in the repo already:

- dedicated API runtime exists
- dedicated recoveries lane exists
- dedicated billing lane exists
- queue and runtime observability exist
- capacity governance exists

So the right move is not a redesign. It is a disciplined backend scaling pass.

And importantly: this is **not** a case where "AI-written code means 1000 users in one day."

The better framing is:

- AI can make the implementation phase much faster
- the platform still has to earn the higher capacity through deployment, testing, and live operational proof

## Source Files Used

- `src/services/onboardingCapacityService.ts`
- `src/services/capacityGovernanceService.ts`
- `src/services/runtimeCapacityService.ts`
- `src/index.ts`
- `src/startApiRuntime.ts`
- `src/queues/ingestionQueue.ts`
- `src/workers/onboardingWorker.ts`
- `src/workers/documentParsingWorker.ts`
- `src/workers/evidenceIngestionWorker.ts`
- `src/workers/evidenceMatchingWorker.ts`
- `src/workers/refundFilingWorker.ts`
- `src/workers/recoveriesWorker.ts`
- `src/workers/billingWorker.ts`
- `src/workers/startRecoveriesLane.ts`
- `src/workers/startBillingLane.ts`
- `src/routes/adminQueueRoutes.ts`
- `package.json`
- `../render.yaml`
- `../docker-compose.yml`
