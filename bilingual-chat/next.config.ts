import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tests sur téléphone en développement via un tunnel Cloudflare temporaire (https).
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
