"use client";

import { LANGUAGES } from "@/lib/languages";

type Props = {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (code: string) => void;
  className?: string;
  "aria-label"?: string;
};

export default function LanguageSelect({ onChange, className = "", ...props }: Props) {
  return (
    <select
      {...props}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      className={`rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 ${className}`}
    >
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.flag} {l.label}
        </option>
      ))}
    </select>
  );
}
