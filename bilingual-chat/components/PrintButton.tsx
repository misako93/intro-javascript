"use client";

export default function PrintButton({ label = "🖨️ Imprimer" }: { label?: string }) {
  return (
    <button onClick={() => window.print()} className="rounded-full bg-emerald-600 px-5 py-3 font-semibold text-white shadow print:hidden">
      {label}
    </button>
  );
}
