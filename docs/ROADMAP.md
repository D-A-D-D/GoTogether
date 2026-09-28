# Roadmap

Live tracker for what's built vs. pending. Update this file whenever a task lands or scope changes — don't let it drift from reality. Full rationale for each item lives in [BLUEPRINT.md](BLUEPRINT.md).

Legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Implemented

- **2026-09-02** — Repo scaffold: npm workspaces monorepo (`apps/web` Next.js 16 + Tailwind, `apps/api` NestJS 12 + Prisma 6), shared root scripts, GitHub Actions CI. **Confirmed green on an actual push** (lint + build + unit + e2e, ~1min).
- **2026-09-02** — Database: Neon Postgres (free tier) provisioned, `DATABASE_URL`/`DATABASE_URL_DIRECT` wired (pooled for app traffic, direct for migrations — see `schema.prisma` and `.env.example`). Both migrations applied — `20260902094040_init` (base schema) and `20260902094145_trip_membership_overlap` (the GIST exclusion constraint + sync triggers). Verified live: `trip_membership_no_overlap` constraint and both triggers confirmed present via `pg_constraint`/`pg_trigger`.
- **2026-09-02** — Auth: email/password register/login, JWT access token + rotating hashed refresh token (httpOnly cookie), logout/revoke, Google OAuth scaffold (needs real client credentials — see Open decisions/`.env.example`), Apple OAuth left unscaffolded (cert-based flow, more setup than Google — follow-up). **Full flow smoke-tested against the real database**: register → login → `GET/PATCH /users/me` (incl. tag assignment) → cookie refresh rotation → logout → post-logout refresh correctly rejected.
- **2026-09-02** — User profile: `GET/PATCH /users/me`, tag taxonomy seeded (24 tags across style/identity/dietary/safety from BLUEPRINT §01) and confirmed queryable via `GET /tags`.
- **2026-09-02** — PWA shell: `app/manifest.ts`, placeholder icons, service worker (`public/sw.js`, app-shell caching) + registration component. Manifest/icons/link-tags verified live in-browser; **service worker registration itself couldn't be confirmed in this sandboxed preview browser** (the registration call never even reached the network — looks like the preview tool blocks SW registration, not an app bug) — worth a quick check in a real Chrome tab.
- **2026-09-28** — Trips module (`apps/api/src/trips/`): create (host flow, up to 3 include tags, STYLE-only exclude tags enforced server-side, auto-creates the host's own APPROVED membership), `GET /trips/hosted`, `GET /trips/discover` (hard filters + weighted match score), `GET /trips/:id`, request-to-join, host list/approve/reject requests. **Fully smoke-tested against the real database**: exclude-tag hard filter confirmed to hide a trip from discovery AND block a direct join attempt (403); the Postgres overlap exclusion constraint confirmed to fire correctly through the API at approval time (409, membership stays REQUESTED, trip stays OPEN); capacity correctly flips a trip to FULL and blocks further requests; self-join, duplicate-request, and non-host-lists-requests all correctly rejected. Matching v1 implemented per BLUEPRINT §04 with one documented deviation: budget/dates are query-time search intent (`DiscoverTripsDto`), not a stored User preference — see `matching.service.ts` doc comment and `docs/IDEAS.md`.
- **2026-09-28** — Leave/remove membership: `POST /trips/:id/leave` (self-service — deletes a REQUESTED row so the user can request again later, marks an APPROVED row LEFT since re-joining after leaving is deliberately final) and `DELETE /trips/:id/members/:membershipId` (host-only, marks REMOVED). Both reopen a FULL trip back to OPEN when the departure drops approved count below capacity. Smoke-tested: host-can't-leave-own-trip blocked, withdraw-then-re-request works, leave-after-approve blocks re-joining (unique constraint), host removal confirmed to reopen the trip.
- **2026-09-28** — Basic group chat (`apps/api/src/chat/`): new `ChatRoom`/`Message` models, one room created per trip in the same transaction as trip creation (the host's own auto-approval is the trip's first approval, so "created on first approval" and "created with the trip" are the same moment here). `ChatGateway` (Socket.io, `/chat` namespace) handles JWT auth at connection time, `joinRoom`/`sendMessage` events gated on APPROVED `TripMembership`; `GET /trips/:id/messages` (REST, cursor-paginated) for history. **Fully smoke-tested with a real socket.io-client**: invalid token confirmed disconnected by the server; a non-member confirmed blocked from both joining the room and sending directly (bypassing join); a message sent by the host confirmed to broadcast live to the other approved member and NOT to the non-member; REST history confirmed to persist and return the message, and to 403 a non-member. **Deliberate deviation from the roadmap's "Socket.io + Redis adapter"**: no Redis adapter wired in yet — fine for a single API instance (our current reality), needed only once there's more than one; logged as a Phase 4 follow-up rather than provisioning Redis now for a feature that doesn't need it yet.
- **2026-09-28** — Expense splitting (`apps/api/src/expenses/`): new `Expense`/`ExpenseSplit` models (a ledger, not a payment rail — BLUEPRINT §06). `POST /trips/:id/expenses` supports equal-split (default: all approved members) and custom per-person splits (validated to sum exactly to the total); `GET /trips/:id/expenses` for history; `GET /trips/:id/balances` returns **pairwise** net balances from the caller's perspective (not a minimized settlement graph — every number traces to a real unsettled split row, which matters more for a financial feature); `PATCH .../splits/:splitId/settle` is the manual "mark as paid," settable by either the debtor or the payer. **Fully smoke-tested against the real database**: non-member blocked from every endpoint (403); `paidById` validated as an approved member; custom-split sum mismatch and duplicate-userId both rejected (400); a two-expense scenario (host paid 300 split 3 ways, member B paid 150 split 3 ways) produced the exact expected net balances (B owes host net 50, C owes host 100); an uninvolved third member blocked from settling a split they're not party to (403); settling correctly recomputes the payer's balance; double-settle rejected (409).
- **2026-09-28** — Review window & trust-score engine (`apps/api/src/reviews/`): `Trip.complete()` gate (host-only, only after `endDate`); `Review` model, one row per (trip, reviewer, reviewee); `POST /trips/:id/reviews`, `GET .../pending`, `GET .../received`, `GET /users/me/trust-events`. Blind window (BLUEPRINT §05) resolves a pair the moment BOTH have reviewed each other (mutual trigger) or after 14 days via a **lazy sweep** run opportunistically on the next relevant request — no scheduled-job infra exists yet, logged as a Phase 3/4 follow-up. Score update is ELO-inspired: `delta = K × reviewerWeight × durationWeight × (rating − expected)`, `expected` = the reviewee's own current score (so a rating that merely confirms it barely moves the needle; one that contradicts it moves it more), `K` shrinks from 6 to 3 after a reviewee's first 5 completed trips, `reviewerWeight` = the reviewer's own trust/100 (the anti-gaming lever), capped at ±15 total per trip via an order-independent incremental clamp. **Fully smoke-tested against the real database, including the trickiest parts**: completion gate (host-only, pre-endDate blocked), review validation (self/non-member/duplicate/pre-completion all blocked), the blind window confirmed to hide an unmatched review from both `listReceived` and the counterpart's dashboard until the mutual trigger fires (verified 50→52 for both sides, matching the formula's hand-computed value exactly); **anti-gaming confirmed twice** — a trust-10 reviewer's perfect review of another user produced a delta of 0 (rounds away under the tiny reviewerWeight), and the same effect independently showed up on a harsh 1-star review from a similarly low-trust reviewer; the **±15 per-trip cap confirmed** to fully suppress a further review's delta to 0 once a trip's cumulative movement hit the ceiling; the **14-day timeout sweep confirmed** to process a backdated, un-reciprocated review on the next fetch.

---

## Phase 0 — Foundation

- [x] Repo scaffold (frontend + backend projects, linting, CI)
- [~] Auth — email/password + JWT/refresh rotation done and DB-verified; Google OAuth scaffolded but unconfigured; Apple OAuth not started
- [x] User profile + preference tags (Tag taxonomy w/ style/identity/dietary/safety categories)
- [x] Base Postgres schema — migrated and verified against a real (Neon) database
- [x] CI/CD pipeline — GitHub Actions, confirmed green on push
- [~] PWA shell — manifest/icons/shell done; service worker registration unverified (tooling limitation, see above — not blocking)

Phase 0 is functionally done pending: a real Chrome check of the service worker, and real Google/Apple OAuth credentials whenever social login matters (§ Open decisions doesn't block this — email/password already works end to end).

## Phase 1 — MVP core

- [x] Trip creation (host flow, include_tags/exclude_tags, budget, dates, capacity)
- [x] Discovery feed
- [x] Matching v1 — hard filters (exclude tags, capacity, overlap, blocks) + weighted score (tag 40 / date 25 / budget 25 / location 10)
- [x] Request → host-approve flow
- [x] Overlap constraint — Postgres `daterange` + `GIST EXCLUDE`, scoped to `status='approved'` (landed early, alongside the base schema — see Phase 0)
- [x] Leave/remove trip membership
- [x] Basic group chat (Socket.io), room auto-created on first approval — Redis adapter deferred to Phase 4 (single instance doesn't need it yet)

**Phase 1 is complete.**

## Phase 2 — Complete the loop

- [x] Expense splitting — `Expense`/`ExpenseSplit`, net-balance ledger, external settle links (no in-app money movement)
- [x] Review window — blind until both submit or 14 days, multi-dimension rating
- [x] Trust-score engine — ELO-style update, `TrustScoreEvent` audit ledger, anti-gaming caps
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
| 1 | Exclude-tag policy (style-only exclude vs. identity as visible `trip_type`) | Split — see §01 | implemented as recommended (Tag.category) |
| 2 | Chat: build vs. buy | Build (Socket.io + Redis) | open |
| 3 | Backend language | TypeScript/NestJS | **confirmed** 2026-09-02 |
| 4 | In-app payments | Defer | open |
| 5 | Launch geography & currency scope | Single market, single currency | **confirmed** 2026-09-02 |
| 6 | Native app wrapper | PWA-only through Phase 3 | open |
