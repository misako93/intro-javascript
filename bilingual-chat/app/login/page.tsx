import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { createClient } from "@/lib/supabase/server";
import { APP_NAME } from "@/lib/config";
import { safeNext } from "@/lib/utils";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next: rawNext, error } = await searchParams;
  const next = safeNext(rawNext);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect(next);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-emerald-50 to-slate-50 p-5">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/icon.svg" alt="" className="mx-auto h-16 w-16" />
          <h1 className="mt-4 text-2xl font-bold">{APP_NAME}</h1>
          <p className="mt-2 text-slate-600">Parlez chacun dans votre langue. La traduction est instantanée.</p>
        </div>
        <div className="rounded-3xl bg-white p-6 shadow-xl shadow-emerald-900/5 ring-1 ring-slate-100">
          {error && (
            <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
              Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau ci-dessous.
            </p>
          )}
          <LoginForm next={next} />
        </div>
      </div>
    </main>
  );
}
