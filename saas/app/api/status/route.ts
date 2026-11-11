import { accessCodeMatches, isDemoMode, requiresAccessCode } from "@/lib/server/env";
import { settingsFromEnv } from "@/lib/server/run-agent";
import type { StatusResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const body: StatusResponse & { codeValid: boolean } = {
    demo: isDemoMode(),
    requiresCode: requiresAccessCode(),
    model: settingsFromEnv().model,
    codeValid: accessCodeMatches(request.headers.get("x-access-code")),
  };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
