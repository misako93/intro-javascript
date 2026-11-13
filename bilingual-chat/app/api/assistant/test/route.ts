import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decide } from "@/lib/assistant";
import { getMyHotel } from "@/lib/hotel";
import { isLanguage } from "@/lib/languages";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Tester l'assistant depuis l'espace hôtel : "si un client écrivait ceci, que répondrait l'IA ?" */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  const hotel = await getMyHotel(supabase, user.id);
  if (!hotel) return NextResponse.json({ error: "Aucun hôtel" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { question?: string; guestLang?: string; info?: string } | null;
  const question = String(body?.question ?? "").trim().slice(0, 500);
  const guestLang = isLanguage(body?.guestLang) ? body!.guestLang! : "en";
  const info = typeof body?.info === "string" ? body.info.slice(0, 8000) : hotel.assistant_info;
  if (!question) return NextResponse.json({ error: "Question vide" }, { status: 400 });
  if (!info.trim()) return NextResponse.json({ error: "Remplissez d’abord la fiche « Infos pratiques »." }, { status: 400 });

  const decision = await decide({ hotelName: hotel.name, info, guestLang, staffLang: hotel.default_lang, history: [], question });
  if (!decision) return NextResponse.json({ error: "L’IA ne répond pas (vérifiez la clé OpenAI ou Anthropic)." }, { status: 502 });
  return NextResponse.json({ decision });
}
