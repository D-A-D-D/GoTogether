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

So buy a domain first, and give both parts a name under it. (*Verified by test:* the cookie flags, in CI's container job. *Not verified:* the cross-subdomain behaviour on a real domain - check it in section 9.)

The API's `WEB_ORIGIN` must be the web app's exact origin (`https://app.example.com`, no trailing slash): it is the one origin allowed to call the API with credentials, and where Google sign-in would redirect back to.

## 3. Accounts to create

- A **domain** and access to its DNS.
- **Neon** (exists). Decide the region - see section 5.
- **Resend**: an API key, and the domain you will send from verified with them (they give you SPF/DKIM DNS records to add).
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

## 5. The database

- **Region.** The Neon project is currently in `us-east-2` (Ohio). If most users are in India, every request pays that round trip, several times over for a page that makes several calls. Run the API in the **same region as the database**, and decide *before launch* whether the database should move closer to your users: moving later means a data migration.
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

Replace the addresses, run these from your own machine, and tick each one. None of this has been run against a real deployment yet.

```bash
API=https://api.example.com

# the process is alive, and can reach the database
curl -fsS $API/health
curl -fsS $API/health/ready

# hardening headers, and no X-Powered-By
curl -sI $API/health | grep -iE 'strict-transport|x-content-type|x-powered-by'

# CORS: only the web origin is allowed, and it is echoed back exactly
curl -s -D - -o /dev/null -X OPTIONS $API/auth/login \
  -H 'Origin: https://app.example.com' -H 'Access-Control-Request-Method: POST' | grep -i access-control-allow
```

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

Tracked in ROADMAP.md under "Launch readiness": a deploy pipeline (CD) that publishes the image and releases it, error tracking, an uptime monitor, structured request logs, legal pages, phone verification, and the moderation decisions. This runbook gets a person from nothing to a running, checked deployment by hand; automating it is the next step once a host is chosen.
