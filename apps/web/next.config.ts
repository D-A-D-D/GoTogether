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

const nextConfig: NextConfig = {
  // Don't announce the framework (and version family) to anyone probing for known bugs.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
};

export default nextConfig;
