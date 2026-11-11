import { createHash, timingSafeEqual } from "node:crypto";

/** Demo mode: no Claude credentials configured, or explicitly forced. */
export function isDemoMode(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.DEMO_MODE === "1" || env.DEMO_MODE === "true") return true;
  return !env.ANTHROPIC_API_KEY?.trim() && !env.ANTHROPIC_AUTH_TOKEN?.trim();
}

export function requiresAccessCode(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ACCESS_CODE?.trim());
}

export function accessCodeMatches(provided: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = env.ACCESS_CODE?.trim();
  if (!expected) return true;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided?.trim() ?? ""), digest(expected));
}
