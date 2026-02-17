# Strategic Shipping Plan: Monolith-First for Revenue Generation

## 🎯 Objective
Ship the existing audited codebase as a "Sturdy Monolith" to achieve a revenue target of **R500,000 per month** before transitioning to a distributed microservices architecture.

## 🏗️ Deployment Architecture: The "Tall Monolith"
To bypass the "Multi-Instance Wall" identified in the scalability audit, we will scale **Vertically** instead of Horizontally for the first 500 sellers.

| Component | Strategy | Justification |
| :--- | :--- | :--- |
| **Compute** | Single High-Spec Instance (e.g., 8 vCPU, 32GB RAM) | Keeps `SSEHub` and `SPAPIRateLimiter` in memory. No Redis Pub/Sub needed yet. |
| **Database** | Managed Supabase (v0.x) | Handles RLS and moderate concurrently natively. |
| **Queue** | BullMQ (using local Redis) | Reliable enough for sequential onboarding of 500 sellers. |

## 📉 Operating Limits & Safeguards
Based on the Feb 2026 Audit, we will operate within the following "Safety Zone":

1.  **Hard Seller Cap**: 500 Sellers. 
    *   *Rationale:* Prevents 90-day lookback data from exhausting the 32GB RAM during peak sync cycles.
2.  **SP-API Guard**: 30 req/min global limit.
    *   *Monitor:* Aggressive logging in `amazonService.ts` to detect throttling before Amazon issues a lockout.
3.  **Real-time Limits**: SSE Hub is stable for ~1,000 concurrent socket connections.

## 💰 Revenue Mapping (Goal: R500,000 / month)
Current capacity (500 sellers) more than covers the revenue goal:
*   **Tier 1 (Pro)**: R1,000 / month × 500 sellers = **R500,000**
*   **Tier 2 (Enterprise)**: R5,000 / month × 100 sellers = **R500,000**

## 🛠️ Operational Maintenance
*   **Automated Cleanups**: Daily purging of `api_logs` and `detection_queue` history to keep DB IOPS low.
*   **Health Shuffling**: Use a "Rolling Restart" at 3:00 AM daily to clear Node.js heap fragmentation.

## 🚀 Future Roadmap (funded by Monolith Revenue)
Once the R500k/month milestone is hit:
1.  **Fund 1**: Migrate `SPAPIRateLimiter` to Redis (Shared State).
2.  **Fund 2**: Implement Redis Pub/Sub for `SSEHub` (Horizontal Scaling).
3.  **Fund 3**: Database Partitioning for million-row tables.

---
**Status:** Ready to Ship 🚀
**Risk Level:** Moderate (Managed)
**Revenue Potential:** High (Immediate)
