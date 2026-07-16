import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // An unrelated package-lock.json in a parent directory otherwise confuses
  // Turbopack's workspace-root inference.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
