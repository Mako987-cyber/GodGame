import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships a WASM Postgres build that must be loaded from node_modules at runtime, not bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
