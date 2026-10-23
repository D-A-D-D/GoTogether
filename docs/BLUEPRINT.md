# GoTogether — Product & Architecture Blueprint

Draft v0.1 · prepared 2026-09-02 · status: for review

A companion-matching, trip-hosting, trust-scored PWA. This is the working plan the build follows — every default here is a starting position, not a verdict. See [ROADMAP.md](ROADMAP.md) for what's actually built vs. pending, and [IDEAS.md](IDEAS.md) for things raised but not yet committed to.

Full presentational version (with diagrams): the artifact published 2026-09-02, titled "GoTogether Blueprint" (regenerate/find via the Artifact list if the link is lost — this file is the source of truth going forward).

---

## 01 — Foundations & the exclude-tag risk

The product's core risk isn't churn or growth — it's that GoTogether asks people to travel with strangers. Every downstream decision (verification depth, review design, what a host can and can't filter on) gets weighed against that first, ahead of feature velocity.

Two principles fall out directly:

- **Privacy by design** — exclude tags, precise location, and match-score reasoning are internal signals the matching engine uses. Never returned to a client, never logged somewhere a frontend engineer can query, never reconstructable by a curious user probing the API.
- **Reversible over automatic** — anything that changes a user's ability to travel (suspension, trust penalties, join rejection) needs a human-reviewable trail. An opaque trust system's failure mode is silently locking someone out with no recourse.

> **Flag before you build the schema.** The brief's own example tags — *adventurous, trekking, party, religious* — mix two different kinds of signal. **Trip-style tags** (party/quiet, trekking, budget/luxury, smoking, pets, early-riser/night-owl) describe how a trip runs; excluding on these is filtering for trip compatibility, uncontroversial as a private filter. **Identity tags** (religion, nationality, gender, age-bracket) describe who someone is — a private, invisible filter hiding a trip from people based on these is functionally discrimination by protected characteristic, and in several jurisdictions (US public-accommodation statutes depending on platform classification, UK/EU equality law) that's real legal exposure once it's the matching engine doing the excluding at scale.
>
> **Decision:** split the taxonomy at the schema level. `exclude_tags` only accepts values from a controlled trip-style vocabulary. Identity-based framing (a women-only trip, a trip for a specific faith community — both legitimate) becomes a visible, explicit `trip_type` field the host states openly, never a silent filter. Tracked as open decision 01 in ROADMAP.md.

## 02 — Core user journey

One loop, one piece of state that survives it: the trust score is the only thing that carries from one trip into the next trip's matching.

```
Profile & tags → Discover & match % → Request → Host approves → Chat & travel
   → Expense split → Review window → Trust score Δ ─┐
        ▲                                            │
        └──────────── feeds the next match ──────────┘
```

Every step after "Request" is gated by the previous one — chat and expenses don't exist until the host approves, and reviews don't open until the trip is marked complete.

## 03 — Domain model

Twelve entities in five groups.

**Identity & trust**
- `User` — profile, home location (city-level public, precise geocode server-only), preference tags, `trust_score` (0–100, starts 50), verification tier, account status.
- `TrustScoreEvent` — append-only ledger: user, delta, reason, source review, resulting score. The audit trail behind every reputation change (§05).
- `Tag` — controlled vocabulary, not free text. Carries a `category` (style / identity / dietary / safety) that gates eligibility as an exclude filter (§01).

**Trips & membership**
- `Trip` — host, destination, dates (or flexible range), budget range, capacity, up to three `include_tags` (public), `exclude_tags` (private), status.
- `TripMembership` — user × trip, role, status (requested / approved / rejected / left / removed). The overlap constraint applies only to *approved* rows.

**Interaction**
- `ChatRoom` / `Message` — one room per trip, created on first approval. Membership mirrors approved `TripMembership` exactly.
- `Expense` / `ExpenseSplit` — who paid, who owes what share. Produces a net-balance ledger per trip (§06 on why it doesn't move money itself).
- `Review` — one row per (trip, reviewer, reviewee) pair, only after trip completion, only between two approved members.

**Safety**
- `Report` — reporter, reported user, reason taxonomy, evidence, status. Threshold breaches auto-suspend pending human review.
- `Block` — symmetric hide: blocked pairs disappear from each other's discovery, chat, and trip rosters everywhere.

### The constraint worth enforcing at the database, not the application

"Overlapping trips are not allowed" is easy to violate under concurrent approvals if checked only in application code. Use a `daterange` column on `TripMembership` with a **Postgres `GIST EXCLUDE` constraint** on `(user_id WITH =, trip_daterange WITH &&)`, scoped to `status = 'approved'` via a partial index. Two approvals that would overlap for the same user become a constraint violation the database refuses — race conditions included — rather than a check-then-write that two concurrent host approvals can both sail through.

Pending *requests* are deliberately left unconstrained — a user can request overlapping trips speculatively; the block bites only at approval time, where the host also gets a clear "conflicts with an approved trip" signal.

## 04 — Matching algorithm

Hard filters remove candidates entirely; a weighted score ranks whoever survives. Only the second stage produces the percentage a user sees.

**Stage 1 — hard filters (invisible, binary)**
- User's tags intersect the trip's `exclude_tags` → trip hidden from that user's discovery entirely, not just down-ranked (a low score would still leak the trip's existence).
- Trip at capacity, dates fully elapsed, or either party has blocked the other.
- User already holds an *approved* membership whose dates overlap this trip.

**Stage 2 — weighted score (the percentage shown)**

| Factor | Weight | Computed as |
|---|---|---|
| Tag affinity | 40% | Overlap between user's preference tags and trip's `include_tags` (Jaccard-style similarity) |
| Date fit | 25% | Exact match scores full; partial credit scaled by overlap when either side has flexible dates |
| Budget fit | 25% | Range-overlap between user's stated budget and trip's budget band; falls off with distance from midpoint |
| Location factor | 10% | Coarse distance band, home city → trip origin. Capped low by design |

Weights live in config, not code — the first thing worth A/B testing once there's real join/accept data. What should *not* change without a deliberate decision: only the aggregate percentage is ever returned to a client. The factor breakdown stays server-side.

## 05 — Trust & reputation

**Review mechanics**
- Opens only when `Trip.status = completed`, and only between two users who both held approved membership.
- Multi-dimension rating (reliability, friendliness, communication, cleanliness) + optional free text, collapsed into one delta.
- **Blind window:** submitted reviews stay hidden from both sides until both submit, or 14 days elapse — prevents anchoring and retaliatory ratings.

**Score update — ELO-inspired, not a flat average**

`delta = K × (rating_normalized − expected)`, where `K` starts high (≈6) for a user's first five completed trips and shrinks (≈3, then lower) as trip count grows — fast signal while the score is uncertain, stability once it's earned.

**Anti-gaming**
- A reviewer's own trust score weights how much their review moves someone else's — low-trust accounts can't swing scores as hard.
- Cap total movement per trip regardless of group size.
- Reviews from trips shorter than a floor duration (e.g. under one night) count at reduced weight.
- **A trip must actually have happened before it can open reviews.** A trip can't start in the past, can't be marked complete until its last day (UTC, inclusive) is over, and needs at least one other approved member besides the host. Without these, someone could create an already-ended trip, approve friends, complete it, and trade five-star reviews with no trip at all (found while testing, 2026-10-23). This closes the no-trip version only — people who run many *real* trips together are still the collusion job's problem, next bullet.
- Offline job flags small clusters that repeatedly five-star each other across trips (collusion rings) for manual review — needs `TrustScoreEvent` to exist from day one to ever be possible.

## 06 — Chat & expense splitting

**Group chat** — one room per trip, membership mirroring approved `TripMembership` exactly, created the moment the first member is approved. WebSocket gateway, stateless enough to run multiple instances behind a Redis pub/sub backplane. Message history writes to Postgres asynchronously (write-behind) so send never blocks on the durable store.

**Expenses — a ledger, not a payment rail.** Expense/split rows produce a per-member net-balance view. "Settle up" records a claim, not a transfer — a deep link into the payer's own UPI app / PayPal.me, or a manual "mark as paid" the other party confirms.

> **Regulatory scope flag.** The moment the app moves funds between users — even briefly holding a balance — it starts to look like a money transmitter in most jurisdictions, a licensing regime, not a feature. Keep v1 strictly a ledger with external settlement links. If in-app settlement becomes a real need, route through a licensed processor built for marketplace payouts (Stripe Connect, Razorpay Route).

## 07 — System architecture

A modular monolith behind two entry points (REST for reads/writes, WebSocket for chat), with slow work pushed onto a queue so the request path never blocks on it.

```
PWA Client (service worker, IndexedDB offline queue)
   │ HTTPS/REST              │ WSS
   ▼                         ▼
API / BFF               Realtime Gateway (horizontally scaled)
   │                         │
   └──────────► Core Modules (modular monolith) ◄──────┘
                Users · Trips & Discovery · Matching
                Expenses · Reviews & Trust · Notifications
                        │            │            │
                        ▼            ▼            ▼
                 PostgreSQL      Redis        Object storage
                 + PostGIS    (cache, pub/sub)   + CDN
                (source of truth,
                 daterange EXCLUDE)

Core Modules ──publishes events──► Event queue (SQS/RabbitMQ)
                                          │ consumes
                                          ▼
                                       Workers (trust score, match precompute)
                                          │ async writes         │ triggers
                                          ▼                      ▼
                                   Postgres / Redis        Web Push (VAPID) ──► Client
```

Module boundaries inside Core Modules are the seams to cut along if Chat or Matching ever need to become independent services (§10).

## 08 — Trust & safety

**Verification tiers**
- Email — required to create an account.
- Phone (SMS OTP) — required before hosting or joining a trip. The floor that makes reporting/suspension meaningful.
- Government ID — optional, unlocks a "verified" badge via third-party KYC (Persona, Onfido, IDfy). Never store the raw ID image beyond the vendor's vaulted reference.

**Reporting & blocking** — typed reason taxonomy, not free text alone. A block is symmetric and total. Reports crossing a threshold auto-suspend pending human review.

**Content moderation** — automated text screening for abuse patterns; image classifier on profile/chat photos before they're servable. Commodity APIs, not built from scratch.

**Travel-specific safety (post-MVP differentiator)** — itinerary sharing with an emergency contact outside the app, optional daily check-ins during an active trip, in-chat SOS. Not launch-blocking, but worth reserving data-model space for (a trip-scoped "safety contact" / "check-in" concept) even before the UI exists.

## 09 — Privacy & compliance

- **Location minimization** — only city/region-level location ever returned to a client; precise geocode is server-side only, collapsed to a distance band before leaving the matching service.
- **Exclude-tag leakage is a test to write, not just a policy** — assert in CI that `exclude_tags` never appears in any API response reachable by a non-host user.
- **Right to export/delete** — GDPR/CCPA-style export and deletion. Chat/expense records tied to *other* users' trips can't simply vanish on one member's deletion — anonymize the departing user's identity in those rows instead.
- **Retention for disputes** — expense/membership records need an explicit retention window past a delete request, long enough to resolve open disputes.

## 10 — Scalability by stage

| Concern | MVP | Growth | Scale |
|---|---|---|---|
| Compute | Single modular-monolith service, containerized | Horizontally scaled behind a load balancer | Chat & Matching extracted as independent services |
| Database | Managed Postgres, single primary | Read replicas for discovery queries | Partition trips/messages by region; consider geo-sharding |
| Realtime | Socket.io + Redis adapter, one region | Multiple gateway nodes, Redis pub/sub fanout | Dedicated realtime service (Centrifugo) or managed (Ably/Stream) |
| Discovery/search | Postgres + GIN/trigram index | Precomputed match scores, cached per user | Elasticsearch/OpenSearch, faceted + geo-aware |
| Caching | Redis for sessions + hot reads | Cached discovery feed, short TTL | Edge caching for public trip pages via CDN |
| Background work | In-process job runner | Dedicated queue + worker pool | Event bus (Kafka) decoupling every module |
| Media | S3-compatible + CDN | Image resize pipeline on upload | Multi-region storage replication |

## 11 — Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js + TypeScript + Tailwind | PWA via a small hand-rolled service worker (not Workbox — see below); SSR for crawlable/shareable public trip pages |
| Backend | NestJS (TypeScript) | Modular monolith maps to NestJS modules; shared types w/ frontend |
| Primary DB | PostgreSQL + PostGIS | Relational integrity for memberships/constraints; geo queries |
| Cache/pub-sub | Redis | Sessions, hot reads, chat fanout backplane |
| Realtime | Socket.io + Redis adapter | Build for MVP; managed (Ably/Stream) is the buy-side alt |
| Queue | SQS or RabbitMQ | Decouples trust-score recompute, notification fanout |
| Object storage | S3-compatible + CDN | Photos, receipts |
| Auth | JWT + rotating refresh, OAuth (Google/Apple) | httpOnly cookies on web to reduce XSS token theft |
| Infra | Docker → Fly.io/Railway (MVP) → ECS/EKS (scale) | Terraform once >1 environment |
| Observability | Sentry + OpenTelemetry/Grafana | Audit trail matters for a trust-scored marketplace |

**Service worker policy** (settled in implementation, 2026-10-17): the worker is hand-rolled and deliberately narrow — Workbox's route-matching is more machinery than an app-shell cache needs, and the first version's blanket "cache every GET" approach shows how easily a broad rule goes wrong. It ignores every cross-origin request (the API is on its own origin and must always hit the network, so live data is never served stale), caches only content-hashed `/_next/static/` and `/icons/` assets cache-first, and handles page navigations network-first with the cached shell as the offline fallback. It is registered in production only; in development it is unregistered on load. Workbox, or a bespoke background-sync queue, becomes worth reconsidering when the IndexedDB offline queue (§ architecture diagram) is actually built.

The same worker handles Web Push. A push carries `{ title, body, url }`; the notification is tagged by destination so a newer chat message replaces the last rather than stacking, and `url` is resolved against the app's own origin only, since it arrives over the wire and must never be able to send someone elsewhere. A push subscription belongs to a *device*, not an account, so it is removed on logout (and an explicit "Turn off") — otherwise the next person on a shared device would keep receiving the previous user's notifications.

**Auth session handling** (client): the access token lives only in memory; the httpOnly refresh cookie is the one thing that survives a reload. The refresh token rotates on every use, so concurrent refreshes from one tab are collapsed into a single request (single-flight) — two requests carrying the same cookie would race and could sign out a valid session.

## 12 — Delivery roadmap

See [ROADMAP.md](ROADMAP.md) for the live, checkable version. Phase summary:

0. **Foundation** (wks 1–4) — auth, profile+tags, base schema, CI/CD, PWA shell.
1. **MVP core** (wks 5–10) — trips, discovery, matching v1, request→approve, overlap constraint, basic chat.
2. **Complete the loop** (wks 11–16) — expenses, review+trust engine, push notifications, PWA polish.
3. **Trust & scale readiness** (post-launch) — moderation console, safety tooling, search scaling, analytics.
4. **Scale-out** (as traffic demands) — extract Chat/Matching, multi-region, native wrapper if justified.

## 13 — Open decisions

Tracked live in [ROADMAP.md](ROADMAP.md#open-decisions). Summary:

1. **Exclude-tag policy** — split style vs. identity tags (§01). Legal exposure attached; needs a deliberate yes.
2. **Chat: build vs. buy** — default build (Socket.io+Redis); managed (Stream/Ably) trades cost for engineering time.
3. **Backend language** — default TypeScript/NestJS; Go if the team has depth or chat/matching throughput bottlenecks.
4. **In-app payments** — default defer; licensing decision, not a sprint.
5. **Launch geography & currency scope** — not yet defaulted; changes the data model more than anything else here.
6. **Native app wrapper** — default PWA-only through Phase 3; iOS Web Push needs 16.4+ and manual "Add to Home Screen."
7. **Refresh-token rotation grace window** — default strict (a rotated token is rejected immediately). A refresh whose response never reaches the browser leaves the cookie holding a revoked token and forces a re-login; a short grace window fixes that at the cost of a few seconds of replay tolerance. A security-policy tradeoff, so it's an explicit call rather than a quiet change.
