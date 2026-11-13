import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div>
        <p className="text-5xl">🤷</p>
        <h1 className="mt-4 text-xl font-semibold">Page introuvable</h1>
        <p className="mt-2 text-slate-500">Cette conversation n’existe pas ou vous n’y avez pas accès.</p>
        <Link href="/dashboard" className="mt-6 inline-block rounded-full bg-emerald-600 px-5 py-3 font-medium text-white">
          Retour à mes conversations
        </Link>
      </div>
    </main>
  );
}
