import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native addon, so it has to stay a real require() at runtime instead of
  // being traced and bundled into the server build.
  serverExternalPackages: ["better-sqlite3"],
  typedRoutes: true,
  output: "standalone",
};

export default nextConfig;
