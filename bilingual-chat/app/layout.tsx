import type { Metadata, Viewport } from "next";
import { APP_NAME } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: `${APP_NAME} — Discutez chacun dans votre langue`,
  description:
    "Messagerie bilingue en temps réel : écrivez ou parlez dans votre langue, votre interlocuteur lit la traduction instantanément.",
  applicationName: APP_NAME,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#059669",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-dvh bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
