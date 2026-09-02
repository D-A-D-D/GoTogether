# Roadmap

Live tracker for what's built vs. pending. Update this file whenever a task lands or scope changes — don't let it drift from reality. Full rationale for each item lives in [BLUEPRINT.md](BLUEPRINT.md).

Legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Implemented

- **2026-09-02** — Repo scaffold: npm workspaces monorepo (`apps/web` Next.js 16 + Tailwind, `apps/api` NestJS 12 + Prisma 6), shared root scripts, GitHub Actions CI (lint/build/unit-test/e2e-test on push+PR).
- **2026-09-02** — Base Postgres schema drafted in `apps/api/prisma/schema.prisma`: `User`, `Tag`, `Trip`, `TripMembership`, plus `TrustScoreEvent`, `RefreshToken`, `OAuthAccount`, `Report`, `Block`. Validated with `prisma generate` — **not yet migrated against a live database** (no Postgres available in this environment yet; see note below).
- **2026-09-02** — Auth: email/password register/login, JWT access token + rotating hashed refresh token (httpOnly cookie), logout/revoke, Google OAuth scaffold (needs real client credentials to actually work — see Open decisions/`.env.example`), Apple OAuth left unscaffolded (needs Sign in with Apple's cert-based flow, more setup than Google — follow-up). Verified via NestJS e2e test + manual boot; **login/register flows themselves are untested against a real database**.
- **2026-09-02** — User profile: `GET/PATCH /users/me`, tag taxonomy seed script (`prisma/seed.ts`) covering style/identity/dietary/safety categories from BLUEPRINT §01.
- **2026-09-02** — PWA shell: `app/manifest.ts`, placeholder icons, service worker (`public/sw.js`, app-shell caching) + registration component. Manifest/icons/link-tags verified live in-browser; **service worker registration itself couldn't be confirmed in this sandboxed preview browser** (the registration call never even reached the network — looks like the preview tool blocks SW registration, not an app bug) — worth a quick check in a real Chrome tab.

---

## Phase 0 — Foundation

- [x] Repo scaffold (frontend + backend projects, linting, CI)
- [~] Auth — email/password + JWT/refresh rotation done; Google OAuth scaffolded but unconfigured; Apple OAuth not started
- [x] User profile + preference tags (Tag taxonomy w/ style/identity/dietary/safety categories)
- [~] Base Postgres schema — drafted and schema-validated; **not yet migrated against a real database** (see below)
- [x] CI/CD pipeline — GitHub Actions workflow added, passing locally with CI-equivalent env vars; not yet confirmed green on an actual push
- [~] PWA shell — manifest/icons/shell done; service worker registration unverified (tooling limitation, see above)

**Blocking Phase 0 completion:** there's no Postgres instance available in this dev environment. `apps/api/prisma/migrations-manual/001_trip_membership_overlap.sql` and the very first `prisma migrate dev --name init` are both still pending. Options: (a) I install Docker Desktop and run `docker-compose.yml` locally — needs enabling WSL2/Hyper-V, a system-level change I'd want your go-ahead on; (b) point `DATABASE_URL` at a free cloud Postgres (Neon, Supabase, Railway) instead — no system changes needed, works immediately.

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
