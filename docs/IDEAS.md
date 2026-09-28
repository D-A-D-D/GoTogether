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
- **[open]** — Real geocoding for the matching engine's location factor — `Trip.destination` is free text with no lat/lng, so `MatchingService.locationFit` currently does a simplified city-name substring match against `User.homeCity` instead of real distance bands. Needs a geocoding step (Google/Mapbox/Nominatim) on trip creation to populate lat/lng, plus PostGIS wired in for real distance queries. Low priority since this factor is capped at 10% by design either way. *2026-09-28*
- **[scheduled → Phase 1]** — Leave/remove trip membership — done 2026-09-28, see ROADMAP.md Implemented.
- **[open]** — Redis adapter for the Socket.io chat gateway — needed once the API runs as more than one instance (horizontal scaling), so messages sent to a client on gateway node A reach a recipient on node B. Not needed yet (single instance); `docker-compose.yml` already has a local Redis service if testing this sooner is useful. *2026-09-28*
