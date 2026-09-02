# Roadmap

Live tracker for what's built vs. pending. Update this file whenever a task lands or scope changes — don't let it drift from reality. Full rationale for each item lives in [BLUEPRINT.md](BLUEPRINT.md).

Legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Implemented

_(nothing yet — project is pre-code as of 2026-09-02)_

---

## Phase 0 — Foundation

- [ ] Repo scaffold (frontend + backend projects, linting, CI)
- [ ] Auth (email/password + OAuth Google/Apple, JWT + refresh rotation)
- [ ] User profile + preference tags (Tag taxonomy w/ style/identity/dietary/safety categories)
- [ ] Base Postgres schema: `User`, `Tag`, `Trip`, `TripMembership`
- [ ] CI/CD pipeline
- [ ] PWA shell (manifest, service worker skeleton, installability)

## Phase 1 — MVP core

- [ ] Trip creation (host flow, include_tags/exclude_tags, budget, dates, capacity)
- [ ] Discovery feed
- [ ] Matching v1 — hard filters (exclude tags, capacity, overlap, blocks) + weighted score (tag 40 / date 25 / budget 25 / location 10)
- [ ] Request → host-approve flow
- [ ] Overlap constraint — Postgres `daterange` + `GIST EXCLUDE`, partial index on `status='approved'`
- [ ] Basic group chat (Socket.io + Redis adapter), room auto-created on first approval

## Phase 2 — Complete the loop

- [ ] Expense splitting — `Expense`/`ExpenseSplit`, net-balance ledger, external settle links (no in-app money movement)
- [ ] Review window — blind until both submit or 14 days, multi-dimension rating
- [ ] Trust-score engine — ELO-style update, `TrustScoreEvent` audit ledger, anti-gaming caps
- [ ] Push notifications (Web Push / VAPID)
- [ ] PWA installability polish

## Phase 3 — Trust & scale readiness

- [ ] Moderation console (reports, blocks, auto-suspend threshold)
- [ ] Content moderation (text abuse screening, image classifier on photos)
- [ ] Verification tiers — phone OTP required for hosting/joining; optional ID verification via KYC vendor
- [ ] Safety tooling — emergency-contact itinerary share, daily check-ins, in-chat SOS
- [ ] Search scaling (Elasticsearch/OpenSearch) if Postgres GIN/trigram stops being enough
- [ ] Collusion-ring detection job on `TrustScoreEvent`
- [ ] Product analytics

## Phase 4 — Scale-out

- [ ] Extract Chat as its own service
- [ ] Extract Matching as its own service
- [ ] Read replicas / geo-partitioning
- [ ] Multi-region
- [ ] Native app wrapper (Capacitor), if retention data justifies App Store overhead

---

## Open decisions

Confirm or override — see BLUEPRINT.md §13 for full reasoning on each.

| # | Decision | Default | Status |
|---|---|---|---|
| 1 | Exclude-tag policy (style-only exclude vs. identity as visible `trip_type`) | Split — see §01 | **needs your sign-off** |
| 2 | Chat: build vs. buy | Build (Socket.io + Redis) | open |
| 3 | Backend language | TypeScript/NestJS | open |
| 4 | In-app payments | Defer | open |
| 5 | Launch geography & currency scope | — | **blocking §03/§04 schema work** |
| 6 | Native app wrapper | PWA-only through Phase 3 | open |
