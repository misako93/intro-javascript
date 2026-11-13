import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRoomBilling } from "@/lib/billing";
import { UUID_RE } from "@/lib/utils";

/** GET /api/billing/room?roomId=… → la conversation est-elle couverte par un abonnement ? */
export async function GET(request: NextRequest) {
  const roomId = request.nextUrl.searchParams.get("roomId") ?? "";
  if (!UUID_RE.test(roomId)) return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non connecté" }, { status: 401 });

  try {
    return NextResponse.json({ billing: await getRoomBilling(supabase, roomId) });
  } catch {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
}
