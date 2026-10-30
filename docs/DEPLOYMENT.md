# Deploying GoTogether

A runbook for putting the app in production. It is written against what the code
actually needs, but **nothing here has been run on a real host yet** - the
pieces marked *verified* were checked by the project's CI or by hand on the
development machine, and everything else is a plan to be confirmed on the first
real deploy. Keep this file honest: when a step turns out different, fix it here.

Related: [ROADMAP.md](ROADMAP.md) ("Launch readiness" is the checklist this
supports), [BLUEPRINT.md](BLUEPRINT.md) (§07 architecture, §10 scalability).

---

## 1. What runs where

| Part | What it is | Suggested host | Notes |
|---|---|---|---|
| **Web** | Next.js app (`apps/web`) | Vercel (or any Node/static host) | Set the project's *Root Directory* to `apps/web`. |
| **API** | NestJS app (`apps/api`), HTTP + WebSocket | Any host that runs a container: Fly.io, Render, Railway, ... | Image: `apps/api/Dockerfile`. **Run exactly one instance** (section 8). |
| **Database** | Postgres | Neon (already in use) | Needs the `btree_gist` extension (migrations create it). |
| **Email** | Password reset, address verification | Resend | Needs a verified sending domain. |
| **Push** | Web Push | none - uses the browsers' own services | Needs a VAPID key pair (section 4). |

Hosting choices are suggestions, not requirements: any host that can run a
container and terminate TLS will do for the API.

## 2. The domain layout matters

The login session lives in a cookie called `gt_refresh`: `HttpOnly; Secure;
SameSite=Lax; Path=/auth`, set by the API. `SameSite=Lax` means the browser only
sends it when the web app and the API are on the **same registrable domain**.

- Good: `app.example.com` (web) and `api.example.com` (API). Or `example.com` + `api.example.com`.
- **Broken, silently:** web on `something.vercel.app` and API on `something.fly.dev`. Sign-in would appear to work, but every page reload would log the person out, because the browser would refuse to send the cookie.

So either put both parts under one domain you own (best, and needed for real email anyway), or - if you have no domain of your own yet - build the web app so that sign-in goes through its own address (section 2a). (*Verified by test:* the cookie flags, in CI's container job. *Not verified:* the cross-subdomain behaviour on a real domain - check it in section 9.)

The API's `WEB_ORIGIN` must be the web app's exact origin (`https://app.example.com`, no trailing slash): it is the one origin allowed to call the API with credentials, and where Google sign-in would redirect back to.

## 2a. No domain of your own: sign-in through the web app

Free hosting gives each project a subdomain of the platform's own domain (`yourapp.vercel.app`, `yourapp.onrender.com`). Browsers treat each platform domain as a *public suffix*, so two projects on different ones are unrelated sites - the broken case above. For that situation the web app can carry the sign-in calls itself:

- Build the web app with **both** `NEXT_PUBLIC_AUTH_VIA_WEB=true` and `NEXT_PUBLIC_API_URL=https://<your API address>`. Its `/auth/...` routes are then answered at the web app's own address and passed on to the API (`apps/web/next.config.ts`; the browser side is `apps/web/src/lib/endpoint.ts`). The session cookie is set on the web app's address, so it is first-party and survives reloads in every browser. Everything else (trips, profile, ...) still goes to the API directly with the access token, and chat connects straight to the API with its token, so only the small sign-in calls pass through the web host.
- A build with the setting on but no usable API address **fails**, rather than ship a site whose sign-in goes nowhere.
- `WEB_ORIGIN` on the API stays the web app's exact origin, as always.
- *Verified (2026-10-29, on a development machine):* with the web app on `localhost` and the API on `127.0.0.1` - different sites to a browser - and the setting **off**, sign-in worked but a reload logged the person out (`/auth/refresh` answered 401: the cookie was never sent). With it **on**, the same steps stayed signed in after a reload, and logging out then reloading signed out. `scripts/smoke.mjs --auth-via-web --write` passed all 17 checks against that setup, and correctly failed against a web app with no `/auth` route. *Not verified:* any real host.

Things to know:

- **Rate limits see the web host.** For the relayed `/auth` calls the API sees the address of whatever relays them, not the person's. With `TRUST_PROXY=1` those calls (sign-in 10 a minute, sign-up 10 a minute) then share one allowance among *everyone* - fine for an alpha, a bottleneck past a few dozen people. `TRUST_PROXY=2` would use each person's real address (if the platforms forward it - unverified), but lets someone who calls the API directly forge theirs and dodge the per-address limits (the per-account sign-in lock still holds). Start with `1`.
- **Waking a sleeping API.** On a free tier that sleeps, the first call after a quiet spell can take most of a minute, and the web host's relay may give up sooner: the first sign-in of the day can fail and then succeed on a retry. Calls that go straight to the API simply wait.
- **Email.** Sending real email needs a domain you own, with SPF/DKIM records added; you cannot add DNS records to a platform subdomain. Until you have one, password-reset and verification emails will not reach other people. That is tolerable for an alpha among friends (reset a password by hand) and not for strangers.
- **Google sign-in** (the API has it; the web app does not offer it yet): set `GOOGLE_CALLBACK_URL` to `https://<web address>/auth/google/callback` and register that same address with Google, so the cookie it sets also lands on the web app's address.
- **Moving to a real domain later:** drop the setting (rebuild the web app without it) or keep it. Either way everyone is signed in again once, at the switch.

## 2b. What free hosting actually gives you

*Researched 2026-10-29 from third-party comparison articles that disagree on details, plus Vercel's own policy page. Confirm every figure on the provider's pricing page before relying on it.*

- **No free tier reliably runs an always-on WebSocket server.** The API needs one for live chat.
- **Render** free web service: sleeps after about 15 minutes without traffic, so the first request is slow and live chat connections do not survive it. One source reports a plan change in April 2026 that cut free bandwidth sharply. A paid always-on instance is reported at about US$7 a month. Render offers a Singapore region (confirm), which matches the database region below.
- **Vercel** Hobby (free): restricted by Vercel's fair-use rules to personal, **non-commercial** use. Fine for an alpha among friends; a public product needs Pro (or another host for the web app).
- **Fly.io**: no free tier for new accounts. **Koyeb**: sources conflict; reportedly a card is now required.

So, in practice: **a $0 setup is a private alpha** - API on Render free, web on Vercel Hobby, database on Neon free, sign-in through the web app (2a). **A public launch costs a little:** an always-on API instance, a domain you own (for email and a clean URL), and a plan for the web app that allows commercial use.

## 3. Accounts to create

- A **domain** and access to its DNS. (Optional for a private alpha - see 2a - but needed for real email and before inviting strangers.)
- **Neon** (exists). Decide the region - see section 5.
- **Resend**: an API key, and the domain you will send from verified with them (they give you SPF/DKIM DNS records to add). (The API's Resend adapter has been pointed at Resend's real service with a deliberately fake key and was answered "API key is invalid" (401) - so its address, method and authorisation header are understood. The message body format is still unproven until a real key sends a real email.)
- **Vercel** (web) and a **container host** (API).
- Optionally an error tracker (Sentry or similar) and an uptime monitor - not wired up yet.

Turn on two-factor authentication on every one of these accounts. Anyone who can reach them can reach your users' data.

## 4. Configuration

All configuration is environment variables. In production the API **refuses to start** - and says exactly what is wrong, never printing a value - unless the required ones below are sound (`apps/api/src/config/env.ts`; *verified*).

### API

| Variable | Required in production | What it is |
|---|---|---|
| `DATABASE_URL` | yes | The **pooled** Neon connection string (host contains `-pooler`). Used for all app traffic. |
| `DATABASE_URL_DIRECT` | yes, for migrations | The **direct** (unpooled) string. Prisma's migration engine cannot use a pooler. |
| `JWT_ACCESS_SECRET` | yes | 32+ characters, random. Different from the refresh secret. |
| `JWT_REFRESH_SECRET` | yes | 32+ characters, random. |
| `WEB_ORIGIN` | yes | `https://app.example.com` - an https origin, not localhost. |
| `TRUST_PROXY` | yes | How many reverse proxies sit in front of the API. `1` on most platforms; `0` if none. Wrong values break rate limiting (section 6). |
| `EMAIL_PROVIDER` | yes: `resend` | `log` (development) prints reset links into the logs and is refused in production. |
| `RESEND_API_KEY` | yes | From Resend. |
| `EMAIL_FROM` | yes | e.g. `GoTogether <no-reply@example.com>`, on the verified domain. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | yes | Web Push keys (below). |
| `VAPID_SUBJECT` | yes | `mailto:you@example.com` or an `https://` address. |
| `PORT` | no | Defaults to 3001. |
| `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL` | no | Default `15m` and `30d`. |
| `GOOGLE_*`, `APPLE_*` | no | Social sign-in is not switched on. **Read IDEAS.md ("Password reset and email verification follow-ups", item g) before enabling Google.** |

`REDIS_URL` appears in `.env.example` but nothing uses it yet.

Generate secrets with a real random source, for example:

```bash
openssl rand -base64 48 | tr '+/' '-_' | tr -d '='
```

Generate the push keys **once** and keep them - changing them later invalidates every existing push subscription:

```bash
cd apps/api && node -e "console.log(require('web-push').generateVAPIDKeys())"
```

The development secrets in your local `.env` are too short and are rejected in production. Do not reuse them.

### Web

| Variable | When | What it is |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | **at build time** | The API's public address, e.g. `https://api.example.com`. It is baked into the build, so changing it means rebuilding. |
| `NEXT_PUBLIC_AUTH_VIA_WEB` | at build time, optional | `true` when the web app and API are on unrelated domains (free platform subdomains): sign-in then goes through the web app's own address. Needs `NEXT_PUBLIC_API_URL` too. See section 2a. |

The web app's trip screens are static pages made on demand (that is what makes opening a trip instant), so the host must run the Next server - Vercel does, or `next start` - and not a plain static export.

## 5. The database

- **Region.** Decided 2026-10-29: the first market is India, so create the **production** database in Singapore (`aws-ap-southeast-1`) - Neon's regions page, as read that day, lists no Mumbai region (recheck). Production is a *new, empty* Neon project: the migrations build it from nothing (CI proves exactly that against an empty Postgres), so there is no data to move. The Ohio (`us-east-2`) project stays for development. Run the API in the **same region as the database** (Singapore); a page makes several calls, and each one pays the distance.
- **Pooled vs direct.** App traffic uses the pooled URL; migrations use the direct one. Using the pooled URL for migrations fails.
- **Cold starts.** On Neon's free tier the database suspends when idle and the first requests after a wake-up can fail with `Can't reach database server` (seen repeatedly during development). `/health/ready` reports it (503). For production use a plan that does not suspend the compute, or accept that the first visitor after quiet periods will see errors.
- **Backups.** Neon provides point-in-time restore, with a retention window that depends on the plan. Find out what yours is, and **practise one restore** before launch: a backup you have never restored is a hope, not a backup.
- **Migrations are additive.** Every migration so far only adds (columns, tables, enum values, indexes). Keep it that way: it is what makes rolling back the application safe (section 7).

## 6. The API container

`apps/api/Dockerfile`, built from the repository root:

```bash
docker build -f apps/api/Dockerfile -t gotogether-api .
```

CI builds and exercises this image on every push, against a real Postgres 16 (*verified*, `container` job in `.github/workflows/ci.yml`): a production start with no configuration is refused; **all migrations apply to an empty database** from inside the image; the API becomes ready; hardening headers are present; register, sign-in and the profile work; the session cookie is `HttpOnly; Secure; SameSite=Lax`; the process runs as an unprivileged user (uid 1000); it stops cleanly on SIGTERM (exit code 0). The image is about 570 MB uncompressed (see IDEAS.md for slimming it). The job's registration sends a verification email with a deliberately fake Resend key, which must fail quietly without failing sign-up.

Things the host must do:

- **Run migrations on each release, before the new version takes traffic**, from the same image: `npx prisma migrate deploy`, with `DATABASE_URL_DIRECT` set. Most platforms call this a release command or pre-deploy command.
- **Health checks.** Liveness: `GET /health` (never touches the database). Readiness: `GET /health/ready` (503 when the database cannot be reached). Neither is rate limited. The image also carries a Docker `HEALTHCHECK` on `/health`.
- **TLS** must terminate at the platform, and `TRUST_PROXY` must say how many proxies there are. Rate limits are per client address; if `TRUST_PROXY` is too low everyone shares the platform's address (one person's allowance is everyone's), and if it is too high a caller can forge theirs.
- **WebSockets** (chat) must be supported and sticky routing is unnecessary with one instance. Confirm the platform's proxy allows long-lived upgrades and does not idle them out too aggressively.
- **Resources.** There is no measured baseline yet; start small (256-512 MB) and watch.

## 6a. Logs and request ids

In production the API writes **one JSON object per line** to standard output (in development it keeps the readable, coloured format). Every HTTP request gets a **request id**, returned in an `X-Request-Id` response header, and one line when it finishes:

```json
{"level":"log","pid":1,"timestamp":1793279566445,"message":{"message":"request","requestId":"127a9e22-1ddc-42a4-9a31-bf6a91c51c54","method":"GET","path":"/tags","status":200,"durationMs":793,"ip":"203.0.113.9"},"context":"HTTP"}
```

- When someone reports a problem, ask for the id from the response header (or the time and the page) and search the logs for it.
- A request id sent by a proxy or load balancer is kept if it is a sane shape (8-64 letters, digits, `.`, `_`, `-`), so a request can be followed across hops; anything else is replaced.
- 5xx responses are logged at `error` level, requests of 2 seconds or more as `slow request` warnings. Healthy `/health` and `/health/ready` checks are not logged (the platform polls them constantly); failing ones are.
- **Never logged**: the query string, headers, cookies, request bodies. The client address *is* logged (`ip`), which is personal data under most privacy laws: mention it in the privacy policy and keep log retention short.
- Unexpected errors are logged with their stack. Clients never see them: HTTP responses say only "Internal server error", and the chat gateway tells a client something generic rather than the error's text (which could contain a file path or the database host).

Your host's log viewer or a log service (anything that can search JSON) will do; none is wired up yet.

## 6b. Render, using the blueprint

`render.yaml` at the repository root describes the API service for Render (Docker, Singapore, one instance, health check on `/health/ready`, the two JWT secrets generated by Render). **Not yet run on Render - the first deploy is its test.** To use it:

1. In Render: New > Blueprint > choose this repository. It lists the variables it needs.
2. Fill in `WEB_ORIGIN`, the two Neon strings, `RESEND_API_KEY` and `EMAIL_FROM` (without a domain: `onboarding@resend.dev`, which only delivers to your own Resend address), and the three `VAPID_*` values (`npx web-push generate-vapid-keys`; keep them - changing them orphans every notification subscription).
3. **Apply the migrations yourself before the first start** (the free plan has no pre-deploy step): `cd apps/api && DATABASE_URL_DIRECT="<direct string>" npx prisma migrate deploy`. Repeat after any release that adds one.
4. Run the smoke script (section 9).

## 7. Releasing and rolling back

1. Merge to `main`; CI must be green (lint, build, unit, e2e, dependency audit, container smoke test).
2. Build and publish the image (the host does this, or CI later will).
3. Run `npx prisma migrate deploy` from the new image.
4. Start the new version, wait for `/health/ready`, then shift traffic.
5. Deploy the web app (it is independent of the API image).

**Rollback** is: run the previous image. This is safe *because migrations only add*: the old code ignores new columns and tables. Never write a migration that drops or renames something in the same release as the code that stops using it; do it in a later release, once the old code is gone.

## 8. Limits to know about

- **One API instance only, for now.** Chat is a single-process WebSocket gateway with no shared backplane, and the rate limiters, failed-sign-in counts, account-status cache and email caps are in memory. Two instances would each keep separate counts, and a chat message sent on one would not reach a member connected to the other. The fix (Redis for the chat adapter and the limiters) is logged in IDEAS.md; until then, scale the instance *up*, not out.
- **A restart drops live chat connections** (clients reconnect on their own) and resets the in-memory counters.
- **Emails are fire-and-forget.** A failed send is logged, not retried.

## 9. First deploy: verify it, in this order

First let the script do the mechanical part (`scripts/smoke.mjs`, no dependencies, run from a checkout on your own machine). CI runs this same script against the container on every push, so it is exercised constantly - but it has not yet been run against a real deployment.

```bash
# read-only: health, readiness, headers, CORS, that the web app was built pointing at this API
node scripts/smoke.mjs --api https://api.example.com --web https://app.example.com

# the same, plus a throwaway account's whole lifecycle: sign up, sign in (session cookie flags), a wrong
# password, the profile, renewing the session, a reset request - then it deletes the account.
# Use a mailbox you control: the verification email goes there. Leaves one anonymous "Deleted user" row.
node scripts/smoke.mjs --api https://api.example.com --web https://app.example.com   --write --email you+smoke@example.com

# when the web app was built with NEXT_PUBLIC_AUTH_VIA_WEB=true (section 2a), add --auth-via-web: the sign-in
# calls are then sent to the web app's address, as its pages do, which also checks the relay and the cookie through it
node scripts/smoke.mjs --api https://yourapi.onrender.com --web https://yourapp.vercel.app --auth-via-web --write --email you+smoke@example.com
```

It exits non-zero and says what is wrong in plain words ("the API does not allow the web origin ... is WEB_ORIGIN set to exactly that?", "the web app's scripts do not mention the API address ... was it built with NEXT_PUBLIC_API_URL set?", "the database cannot be reached"). It checks: the API is alive and **ready** (it can reach the database); security headers and a request id on every response, and no `X-Powered-By`; CORS allows the web origin with credentials and nobody else; a protected route refuses a caller with no session; the web pages load, carry their security headers, and serve the manifest and service worker; the web build points at this API; and (with `--write`) the session cookie is `HttpOnly; Secure; SameSite=Lax`, a wrong password is refused, the profile never includes the password hash, the session can be renewed, a reset request gets the neutral answer, and the deleted account can no longer sign in.

What it **cannot** check is the part that most often goes wrong, because it depends on the browser's own same-site rules: whether a browser on the real web address keeps you signed in. That is the first item below.

Then in a browser, on the real web address:

- [ ] Register an account; you are signed in and land on your profile.
- [ ] **Reload the page.** You are still signed in. (This is the cookie / same-domain check from section 2. If you are logged out, the domains do not share a registrable domain, or `WEB_ORIGIN` is wrong.)
- [ ] The verification email arrives from your domain (not in spam), and its link confirms the address.
- [ ] "Forgot your password?" email arrives; the link resets the password and signs you out.
- [ ] Open the chat for a trip with two accounts: messages arrive live in both directions (WebSockets through the platform's proxy).
- [ ] Profile -> turn on notifications; a join request on one of your trips produces a notification on your phone (the real-device push check in ROADMAP.md).
- [ ] Make yourself an administrator and open `/admin` (below).
- [ ] Ten wrong passwords for one account lock it, and more than ten sign-in attempts in a minute from one address get a 429 (rate limits, with the right `TRUST_PROXY` - test from two different networks to confirm people are not sharing one allowance).

**Making someone an administrator** is deliberately not possible from the app. From a trusted machine with the production `DATABASE_URL` in the environment:

```bash
cd apps/api && npm run set-role -- you@example.com ADMIN
```

## 10. Not done yet

Tracked in ROADMAP.md under "Launch readiness": a deploy pipeline (CD) that publishes the image and releases it, error tracking, an uptime monitor, a log service to search the (now structured) logs, legal pages, phone verification, and the moderation decisions. This runbook gets a person from nothing to a running, checked deployment by hand; automating it is the next step once a host is chosen.
