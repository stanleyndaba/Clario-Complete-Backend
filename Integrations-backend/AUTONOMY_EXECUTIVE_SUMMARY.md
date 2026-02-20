# Autonomy Executive Summary

**Platform:** Opside — 11-Agent Autonomous Audit Engine  
**Assessment Date:** February 19, 2026  
**Verdict:** ✅ **Fully Hands-Off**

---

## Is It Really Autonomous?

**Yes.** After the seller connects their Amazon account and evidence sources, every step from data ingestion to money recovery operates without human intervention.

The pipeline runs on a continuous loop:

```
Amazon Data → Detection → Evidence → Matching → Filing → Recovery → Billing → Notifications
      ↑                                                                              |
      └──────────────────── Learning (Agent 11) ─────────────────────────────────────┘
```

**No buttons to press. No queues to monitor. No manual approvals.**

---

## How It Works

| Agent | Role | Trigger | Human Needed? |
|:-----:|------|---------|:-------------:|
| 2 | Data Sync | Cron (every 30 min) | ❌ |
| 3 | Claim Detection | Auto after sync | ❌ |
| 4 | Evidence Ingestion | Cron (every 15 min) | ❌ |
| 5 | Document Parsing | Cron (every 2 min) | ❌ |
| 6 | Evidence Matching | Direct trigger + cron backup | ❌ |
| 7 | Refund Filing | Auto when matched | ❌ |
| 8 | Recovery Tracking | Cron (every 10 min) | ❌ |
| 9 | Billing | Cron (every 5 min) | ❌ |
| 10 | Notifications | Event-driven | ❌ |
| 11 | Learning | Continuous analysis | ❌ |

---

## Failure Resilience

The system does not silently fail. Every handoff between agents is protected:

- **Retry logic** — Critical handoffs retry 3× with exponential backoff before giving up
- **DB queue fallback** — Failed jobs persist to `pending_jobs` for later pickup
- **Cron safety nets** — Every event-driven trigger has a polling backup
- **Overlap guards** — All workers use `isRunning` locks to prevent duplicate processing
- **Agent 11 alerting** — Failures are logged to the learning loop for pattern analysis

---

## What The Seller Experiences

1. **Connect** Amazon account + email/document sources
2. **Wait** — the platform runs autonomously
3. **Get notified** when claims are detected, filed, approved, and paid
4. **Receive funds** — recovered money is deposited after 20% platform fee

The seller never files a claim, uploads evidence, or checks a status page. Everything is push-notified.

---

## Autonomy Scorecard

| Metric | Value |
|--------|:-----:|
| Inter-agent handoffs | 9/9 Harmonic |
| Agents feeding learning loop | 10/10 |
| Silent failure points | 0 |
| Human intervention required | **None** |
| Overall autonomy score | **100%** |

---

*This assessment is based on a code-level audit of all 9 inter-agent handoffs, trigger mechanisms, error handling paths, and learning loop integrations.*
