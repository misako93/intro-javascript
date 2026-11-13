import Link from "next/link";
import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { createClient } from "@/lib/supabase/server";
import { getLanguage } from "@/lib/languages";
import { APP_NAME } from "@/lib/config";
import { displayNameOf } from "@/lib/utils";

const ERRORS: Record<string, string> = {
  invalid_invite: "Ce lien d’invitation n’est pas valide ou a été supprimé.",
  room_full: "Cette conversation a déjà deux participants.",
};

function InviteError({ code }: { code: string }) {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="max-w-sm">
        <p className="text-5xl">🔗</p>
        <h1 className="mt-4 text-xl font-semibold">Invitation impossible</h1>
        <p className="mt-2 text-slate-600">{ERRORS[code] ?? "Une erreur est survenue. Réessayez dans un instant."}</p>
        <Link href="/dashboard" className="mt-6 inline-block rounded-full bg-emerald-600 px-5 py-3 font-medium text-white">
          Aller à mes conversations
        </Link>
      </div>
    </main>
  );
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Déjà connecté·e → on rejoint directement le salon.
  if (user) {
    const { data: roomId, error } = await supabase.rpc("join_room", {
      p_token: token,
      p_display_name: displayNameOf(user),
    });
    if (error || !roomId) {
      const code = Object.keys(ERRORS).find((k) => error?.message.includes(k)) ?? "unknown";
      return <InviteError code={code} />;
    }
    redirect(`/chat/${roomId}`);
  }

  // Pas encore de compte → page d'accueil de l'invitation + connexion en 1 clic.
  const { data } = await supabase.rpc("get_invite_info", { p_token: token });
  const invite = (data as { inviter_name: string; inviter_lang: string; guest_lang: string }[] | null)?.[0];
  if (!invite) return <InviteError code="invalid_invite" />;

  const inviterLang = getLanguage(invite.inviter_lang);
  const guestLang = getLanguage(invite.guest_lang);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-emerald-50 to-slate-50 p-5">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <img src="/icon.svg" alt="" className="mx-auto h-14 w-14" />
          <h1 className="mt-4 text-2xl font-bold">
            {invite.inviter_name || "Quelqu’un"} vous invite à discuter
          </h1>
          <p className="mt-3 text-slate-600">
            Écrivez ou parlez en <strong>{guestLang.flag} {guestLang.label}</strong>.<br />
            {invite.inviter_name || "Votre contact"} lira en <strong>{inviterLang.flag} {inviterLang.label}</strong>.
          </p>
          <p className="mt-2 text-sm text-slate-500">La traduction est automatique et instantanée.</p>
        </div>
        <div className="rounded-3xl bg-white p-6 shadow-xl shadow-emerald-900/5 ring-1 ring-slate-100">
          <LoginForm next={`/invite/${token}`} />
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">{APP_NAME} · Messagerie bilingue</p>
      </div>
    </main>
  );
}
