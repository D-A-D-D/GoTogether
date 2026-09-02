# Ideas backlog

Running log of ideas raised in conversation that aren't committed to [ROADMAP.md](ROADMAP.md) yet. When one gets scheduled, move it into ROADMAP.md under the right phase and mark it `→ scheduled` here. When one gets rejected, keep the entry with the reason — it saves re-litigating the same idea later.

Status: `open` (worth considering) · `deferred` (deliberately not now) · `scheduled` (moved to roadmap) · `rejected` (decided against, reason kept)

---

- **[open]** — Elasticsearch/OpenSearch for discovery search — once Postgres GIN/trigram indexes stop being enough for destination/tag/date faceting. *2026-09-02*
- **[open]** — A/B testing framework for matching-algorithm weights — needs real join/accept data first; weights live in config specifically so this is possible later. *2026-09-02*
- **[deferred]** — In-app payments via a licensed processor (Stripe Connect / Razorpay Route) — only if the ledger + external-settle-link approach proves insufficient; deliberately out of v1 to avoid money-transmitter licensing scope. *2026-09-02*
- **[open]** — Native app wrapper (Capacitor) — iOS Web Push needs 16.4+ and a manual "Add to Home Screen" step, which costs activation; revisit once there's retention data to justify App Store overhead. *2026-09-02*
- **[scheduled → Phase 3]** — Collusion-ring detection job over `TrustScoreEvent` (small clusters repeatedly five-starring each other) — anti-gaming for the review system. *2026-09-02*
- **[open]** — Multi-currency budget matching — depends on open decision #5 (launch geography/currency scope) in ROADMAP.md; not designed yet. *2026-09-02*
