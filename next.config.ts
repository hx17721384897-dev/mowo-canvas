import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.MOWO_NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["better-sqlite3"],
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        condition: { not: { path: /\.module\.css$/ } },
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
