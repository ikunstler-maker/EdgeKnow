import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pre-workspace addresses; "/" then opens the right workspace.
  async redirects() {
    return [
      { source: "/trash", destination: "/", permanent: false },
      { source: "/settings/access", destination: "/", permanent: false },
    ];
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
