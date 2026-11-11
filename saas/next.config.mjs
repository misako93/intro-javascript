import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The app lives in a sub-folder of the repository: pin the root so Next
  // does not try to infer it from a parent directory.
  turbopack: { root: appDir },
  outputFileTracingRoot: appDir,
};

export default nextConfig;
