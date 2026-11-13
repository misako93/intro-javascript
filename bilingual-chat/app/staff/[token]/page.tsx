import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { createClient } from "@/lib/supabase/server";
import { displayNameOf } from "@/lib/utils";

/** Lien d'invitation pour rejoindre l'équipe de réception d'un hôtel. */
export default async function StaffInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && !user.is_anonymous) {
    const { error } = await supabase.rpc("join_hotel_staff", { p_token: token, p_display_name: displayNameOf(user) });
    if (!error) redirect("/dashboard");
  }

  const { data } = await supabase.rpc("get_staff_invite", { p_token: token });
  const hotelName = ((data ?? []) as { hotel_name: string }[])[0]?.hotel_name;

  if (!hotelName) {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center">
        <p className="text-slate-600">Ce lien d’invitation n’est pas valide. Demandez-en un nouveau au responsable de l’hôtel.</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-emerald-50 to-slate-50 p-5">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-5xl">🏨</p>
          <h1 className="mt-3 text-2xl font-bold">Rejoindre l’équipe de réception</h1>
          <p className="mt-2 text-slate-600">
            <strong>{hotelName}</strong> vous invite à recevoir les messages de ses clients, traduits en français, sur votre
            téléphone.
          </p>
        </div>
        <div className="rounded-3xl bg-white p-6 shadow-xl shadow-emerald-900/5 ring-1 ring-slate-100">
          <LoginForm next={`/staff/${token}`} />
        </div>
      </div>
    </main>
  );
}
