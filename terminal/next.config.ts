import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Hides the floating Next.js dev-mode indicator badge.
  devIndicators: false,
  // "localhost" has its own separate flakiness in this dev environment's browser
  // tooling, so testing goes through 127.0.0.1 instead — but Next.js 16 treats that
  // as a distinct, non-allowlisted origin and silently 503s some dev-only static
  // chunks requested from it (breaks client hydration with no console error). See
  // https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
