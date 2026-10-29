import type { NextConfig } from "next";

// Headers sent with every page. These are the ones that can't break the app:
// no content sniffing, no framing (clickjacking), a trimmed Referer, the
// browser features the app never uses switched off, and - in production only,
// since it means nothing over plain http - HSTS. A full Content-Security-Policy
// with script nonces is a bigger change (docs/IDEAS.md); the parts of it that
// don't restrict scripts are included here.
function securityHeaders() {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    {
      key: "Content-Security-Policy",
      value: "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
    },
  ];
  if (process.env.NODE_ENV === "production") {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
  }
  return headers;
}

// Sign-in through this site. The session cookie is set by whichever address answers the /auth
// routes; if that is the API and the API is on a different registrable domain from this app
// (two free platform subdomains are - *.vercel.app, *.onrender.com and the like are each their
// own "public suffix"), the browser treats the cookie as third-party and Safari, Brave and
// private windows throw it away, so people are signed out on every reload. With
// NEXT_PUBLIC_AUTH_VIA_WEB=true the /auth routes are answered at this site's own address, and
// passed on to the API from here, so the cookie is this site's own. The browser-side half is
// src/lib/endpoint.ts. Both are fixed at build time, like NEXT_PUBLIC_API_URL itself.
function authRewrites() {
  if (process.env.NEXT_PUBLIC_AUTH_VIA_WEB !== "true") return [];
  const api = process.env.NEXT_PUBLIC_API_URL;
  let origin: string;
  try {
    origin = new URL(api ?? "").origin;
  } catch {
    // Better to fail the build than ship a site whose sign-in forwards nowhere.
    throw new Error("NEXT_PUBLIC_AUTH_VIA_WEB is on, so NEXT_PUBLIC_API_URL must be set to the API's address");
  }
  return [{ source: "/auth/:path*", destination: `${origin}/auth/:path*` }];
}

const nextConfig: NextConfig = {
  // Don't announce the framework (and version family) to anyone probing for known bugs.
  poweredByHeader: false,
  // Pages win over a rewrite, so the app's own /auth/callback page is unaffected.
  async rewrites() {
    return authRewrites();
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
};

export default nextConfig;
