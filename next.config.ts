import type { NextConfig } from "next";

// Only YouTube (privacy mode) may be embedded; nobody may frame this site.
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: "frame-src https://www.youtube-nocookie.com https://challenges.cloudflare.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  // Pre-workspace addresses; "/" then opens the right workspace.
  async redirects() {
    return [
      { source: "/trash", destination: "/", permanent: false },
      { source: "/settings/access", destination: "/", permanent: false },
    ];
  },
  // The team database migrations are read at run time by the server (path C).
  outputFileTracingIncludes: {
    "/**": ["./supabase/team/migrations/*.sql"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
