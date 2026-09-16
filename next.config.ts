import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stripe webhooks must not hit a trailing-slash 308. Keep API paths slash-free.
  trailingSlash: false,
};

export default nextConfig;
