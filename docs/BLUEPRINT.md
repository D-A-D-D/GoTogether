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
- `Expense` / `ExpenseSplit` — who paid, who logged it, who owes what share. Produces a net-balance ledger per trip (§06 on why it doesn't move money itself).
- `Review` — one row per (trip, reviewer, reviewee) pair, only after trip completion, only between two approved members.

**Safety**
- `Report` — reporter, reported user, reason taxonomy, optional details, and a status that moves OPEN → REVIEWING → ACTIONED or DISMISSED, with who closed it, when, and the note they wrote. Reports take no automatic action: the original "threshold breaches auto-suspend" is not built (§08).
- `ModerationAction` — the audit trail: every change to an account's status (who, from → to, why, and the report it came from).
- `User.role` — `USER` or `ADMIN`. Not settable through the app; only an operator with database access can grant it (§08).
- `Block` — symmetric hide: blocked pairs disappear from each other's discovery, chat, and trip rosters everywhere.

### The constraint worth enforcing at the database, not the application

"Overlapping trips are not allowed" is easy to violate under concurrent approvals if checked only in application code. Use a `daterange` column on `TripMembership` with a **Postgres `GIST EXCLUDE` constraint** on `(user_id WITH =, trip_daterange WITH &&)`, scoped to `status = 'approved'` via a partial index. Two approvals that would overlap for the same user become a constraint violation the database refuses — race conditions included — rather than a check-then-write that two concurrent host approvals can both sail through.

Pending *requests* are deliberately left unconstrained — a user can request overlapping trips speculatively; the block bites only at approval time, where the host also gets a clear "conflicts with an approved trip" signal.

**Editing and cancelling a trip** (implemented 2026-10-23) lean on the same machinery. A host can edit an OPEN or FULL trip; if a date change would put an approved member on two trips at once, the database refuses it (the date-sync trigger re-checks every member) and the host gets a clear "one of the approved members is already on another trip then" message — without naming the other trip. Cancelling declines pending requests and *releases every member's date hold* by nulling `TripMembership.period` (the column is nullable and the exclusion constraint ignores nulls); without that, a cancelled trip's approved members would stay blocked from joining anything else that week. Approved members keep their membership, so chat and expenses stay open for settling up. Cancelling is irreversible, and approving a request needs a trip that's still OPEN or FULL.

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

**Ordering and paging.** Results are ordered by score, then sooner start date, then id — a *total* order, so the feed never reshuffles between requests and walking its pages (`limit` + `offset`) shows every trip exactly once. This is not cosmetic: many trips genuinely tie (same tags, same dates), and sorting by score alone leaves ties in whatever order the database returned them, which differs between requests — so a trip could be shown twice or skipped as someone paged through (demonstrated and fixed 2026-10-24). The same discipline applies to chat history, which pages by `(createdAt, id)` for the same reason: with `createdAt` alone, messages sharing a timestamp were silently lost or repeated at page boundaries.

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
- **A trip must actually have happened before it can open reviews.** A trip can't start in the past, can't be marked complete until its last day (UTC, inclusive) is over, needs at least one other approved member besides the host, and can't take new members once it's completed or cancelled (otherwise a friend who requested earlier could be approved *after* completion and review without having gone). Without these, someone could create an already-ended trip, approve friends, complete it, and trade five-star reviews with no trip at all (found while testing, 2026-10-23). This closes the no-trip version only — people who run many *real* trips together are still the collusion job's problem, next bullet.
- Offline job flags small clusters that repeatedly five-star each other across trips (collusion rings) for manual review — needs `TrustScoreEvent` to exist from day one to ever be possible.

## 06 — Chat & expense splitting

**Group chat** — one room per trip, membership mirroring approved `TripMembership` exactly, created the moment the first member is approved. WebSocket gateway, stateless enough to run multiple instances behind a Redis pub/sub backplane. Message history writes to Postgres asynchronously (write-behind) so send never blocks on the durable store.

**Expenses — a ledger, not a payment rail.** Expense/split rows produce a per-member net-balance view. "Settle up" records a claim, not a transfer — a deep link into the payer's own UPI app / PayPal.me, or a manual "mark as paid" the other party confirms.

*As built (2026-10-25).* An expense can be edited or deleted by the person who logged it or the person who paid it, until any share is marked paid — after that the "settled" markers would no longer mean what their setters thought, so the fix is a correcting expense. An edit replaces the expense wholesale; people who have since left the trip may stay on an expense they were already part of, but nobody new from outside can be added. Adding, changing or deleting an expense, and marking a share paid, notifies the other people involved (never the actor). "Mark as paid" is currently unilateral by either side, not the other-party confirmation described above (IDEAS.md), and the payer cannot settle their own share.

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

*Abuse protection and production configuration, as built (2026-10-25).* Limits are layered by what they can fairly be keyed on. **Per address** (a generous default, tighter for sign-in, registration, session refresh and account export/delete) catches one machine hammering the API, but is kept loose because many people in the launch market share one public IP. **Per account** is the tight one: ten failed sign-ins in fifteen minutes lock that account for the window, whatever address they come from. **Per person** in chat, fifteen messages in ten seconds, because the HTTP throttler cannot see socket events. All three are in-process counters — correct for one instance, and to be moved to Redis with the chat backplane (§10). Behind a reverse proxy the client address is only trustworthy if the number of proxies is declared (`TRUST_PROXY`), so production refuses to start without it, and also without strong distinct JWT secrets, an https `WEB_ORIGIN` and the push keys. `/health` is liveness; `/health/ready` also checks the database. The session cookie is `HttpOnly; Secure; SameSite=Lax`, which is why the web app and the API must share a registrable domain. CI fails on any critical advisory in production dependencies.

*Deployment, as built (2026-10-29).* The API ships as a container image (`apps/api/Dockerfile`) that CI builds and runs against a real Postgres on every push — checking that production configuration is enforced, that migrations apply to an empty database, and that sign-in, the cookie flags, a non-root user and a clean shutdown all hold. Web and API must sit under one registrable domain because the session cookie is `SameSite=Lax`; where they cannot (free platform subdomains are each their own public suffix), the web build can instead carry the `/auth` routes itself (`NEXT_PUBLIC_AUTH_VIA_WEB`, a rewrite to the API), so the cookie is the web app's own. The first market is India, so the production database goes in Singapore. Releases run `prisma migrate deploy` from the same image before taking traffic, and migrations only ever add, so rolling back the application is just running the previous image. One API instance until the Redis backplane (§10) exists. In production the API logs one JSON object per line, with a request id on every request (returned in `X-Request-Id`) and never the query string, headers, cookies or bodies. A smoke-check script (`scripts/smoke.mjs`) runs the first-deploy checklist against any address, and is the same script CI runs against the container. The step-by-step runbook is [DEPLOYMENT.md](DEPLOYMENT.md).
*Interface and speed, as built (2026-10-30).* The app is designed phone-first and works for the whole age range: 17px body type, 48px controls, labelled tabs, and every text and border colour measured against WCAG AA (light *warm sand* and dark *night forest* themes from one set of tokens). The recognisable pieces are the **generated trip cover** (a palette gradient with contour lines drawn from the destination, until trips have photos) and the **route mark** logo. Navigation is a labelled bottom tab bar on a phone and a left rail on a computer, with a Back button on every screen that is not a tab. Speed comes from two places. *Server*: a request should cost as few **dependent** database round trips as it can (independent lookups run together; relations load in one joined query), and live chat must never wait on anything but saving and delivering — push notifications go out afterwards. *Browser*: a small stale-while-revalidate cache shows a screen's last data at once and refreshes it quietly, a trip's data starts loading when a pointer or finger reaches its card, and trip screens are on-demand static pages so they are prefetched rather than costing a server trip per click. With the database in Singapore (above) each remaining round trip is a few tens of milliseconds.

## 08 — Trust & safety

**Verification tiers**
- Email — required to create an account. *As built (2026-10-25):* an address is *confirmed* by following a link we email (single-use, 24 hours, only a hash stored; or implicitly when signing up with Google), and the app shows a reminder until it is. Confirmation is not yet a gate on anything. The same mechanism carries password reset: a one-hour, single-use link whose request answers identically — and takes the same time — whether or not the address has an account, and whose use signs the account out everywhere. Links carry their token in the URL fragment, so it never reaches a server log.
- Phone (SMS OTP) — required before hosting or joining a trip. The floor that makes reporting/suspension meaningful.
- Government ID — optional, unlocks a "verified" badge via third-party KYC (Persona, Onfido, IDfy). Never store the raw ID image beyond the vendor's vaulted reference.

**Reporting & blocking** — typed reason taxonomy, not free text alone. A block is symmetric and total. Reports crossing a threshold auto-suspend pending human review.

*As built (2026-10-24).* **Blocks** are enforced in discovery, in joining or viewing each other's trips (answered with the same "not found" as a trip that doesn't exist, so a block can't be detected), in the travellers list, in chat history, in *live* chat (decided per recipient — a room-wide broadcast can't honour it) and in chat push notifications; pending join requests between the pair are withdrawn silently. A block is deliberately **not** applied to reviews (it shouldn't be a way to dodge, or prevent, a review of a bad experience), to approved memberships (blocking someone doesn't remove them from a trip; that's an explicit, separate act) or to expenses. It hides rather than deletes, so messages sent during a block reappear on unblock. **Reports** use a closed reason taxonomy and are guarded against becoming a harassment tool: only people who were on the same trip can report each other, one open report per person, five a day. They are *collected only*. The blueprint's auto-suspend is still **not built**: it needs a decided threshold and a way to weight it so a pile-on can't suspend someone, which is a product decision — see below and IDEAS.md.

*Moderation as built (2026-10-24).* Humans decide; nothing is automatic. **Who**: an `ADMIN` role on `User`, granted only by an operator script (`npm run set-role`) — admins can close accounts, so becoming one must not be reachable from any request — and read from the database on each request (through a 30-second in-process cache), not from the token, so a demotion needn't wait for a token to expire. **Console** (`/admin`): a queue of reports with the context to judge a pile-on (open reports against the person, from how many different people, how many have blocked them), and the decisions dismiss, resolve, suspend, ban and reinstate; each requires a written note, which is stored (as the report's resolution, and as the reason on a `ModerationAction` audit row). An admin can't act on themselves or another admin, or review a report they're a party to; closed reports are final. **Enforcement**: a suspended or closed account is refused at login (403, with a message that says why — a wrong password does not), at refresh, on every authenticated API call (401, so the web client's existing "session over" path takes the person to the login page, where the explanation is) and in chat (on connect, on send, and mid-broadcast — authentication runs as socket.io namespace middleware so a client can never act before it has completed). Restricting also revokes refresh tokens. A restricted account is also kept out of anything new: their trips leave discovery and answer outsiders with the same "not found" as a trip that doesn't exist, new join requests to those trips are refused the same way, their own pending requests drop out of hosts' lists and can't be approved, and no push notification is sent to them. People already on a trip keep their place — as with blocks, restricting removes nobody — and nothing is deleted, so reinstating restores it all. The cache is per process and dropped the instant a moderator acts, so on one API instance the effect is immediate; across instances it lags by up to 30 seconds until there's a shared invalidation. **Still open** (needs decisions): the auto-suspend threshold and weighting, a softer "restricted" state, an appeal path, and what should happen to a restricted host's trip itself (it stays alive for its members with nobody able to run it).

**Content moderation** — automated text screening for abuse patterns; image classifier on profile/chat photos before they're servable. Commodity APIs, not built from scratch.

**Travel-specific safety (post-MVP differentiator)** — itinerary sharing with an emergency contact outside the app, optional daily check-ins during an active trip, in-chat SOS. Not launch-blocking, but worth reserving data-model space for (a trip-scoped "safety contact" / "check-in" concept) even before the UI exists.

## 09 — Privacy & compliance

- **Location minimization** — only city/region-level location ever returned to a client; precise geocode is server-side only, collapsed to a distance band before leaving the matching service.
- **Exclude-tag leakage is a test to write, not just a policy** — assert in CI that `exclude_tags` never appears in any API response reachable by a non-host user.
- **Right to export/delete** — GDPR/CCPA-style export and deletion. Chat/expense records tied to *other* users' trips can't simply vanish on one member's deletion — anonymize the departing user's identity in those rows instead.
- **Retention for disputes** — expense/membership records need an explicit retention window past a delete request, long enough to resolve open disputes.

*As built (2026-10-25).* **Export** is `GET /users/me/export`: a person's own data as one JSON document — profile, trips hosted, memberships, messages sent, each expense with only their own share, reviews they wrote, reviews about them only once revealed (the blind window holds for exports), trust history, reports they filed and blocks they made — leaving out the password hash, tokens, the precise geocode, other people's shares, reports about them and moderators' notes. **Deletion** follows the "anonymise, don't remove" line above: the account row is kept but scrubbed (name "Deleted user", a placeholder `@deleted.invalid` email, no location, password or role) and marked `DELETED`, so messages, expenses and reviews in other people's trips remain intact and every suspension check applies to it automatically. Their place on trips still open or under way is given up, a trip that was full because of them reopens, pending requests are withdrawn, and sessions, device notifications, blocks and trust history are deleted; finished trips keep their membership. It needs the password again (or the typed email, for a Google-only account) and is refused while the person hosts a trip that hasn't finished. **Retention for disputes**: none beyond the ledger rows themselves — no identity is kept after deletion — which is a default pending a legal view (ROADMAP Open decisions #12–#13).

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

The same worker handles Web Push. A push carries `{ title, body, url }`; the notification is tagged by destination so a newer chat message replaces the last rather than stacking, and `url` is resolved against the app's own origin only, since it arrives over the wire and must never be able to send someone elsewhere. A push subscription belongs to a *device*, not an account, so it is removed on logout (and an explicit "Turn off") — otherwise the next person on a shared device would keep receiving the previous user's notifications. The browser also remembers *which account* opted in on a device: a different account logging in never inherits the subscription (it's dropped), while the owner logging back in gets it restored quietly — logout removing it shouldn't mean re-enabling push every time.

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
5. **Launch geography & currency scope** — confirmed 2026-09-02: a single market and a single currency (amounts are whole units, no minor units). It changes the data model more than anything else here, so revisiting it later is expensive.
6. **Native app wrapper** — default PWA-only through Phase 3; iOS Web Push needs 16.4+ and manual "Add to Home Screen."
7. **Refresh-token rotation grace window** — default strict (a rotated token is rejected immediately). A refresh whose response never reaches the browser leaves the cookie holding a revoked token and forces a re-login; a short grace window fixes that at the cost of a few seconds of replay tolerance. A security-policy tradeoff, so it's an explicit call rather than a quiet change.
