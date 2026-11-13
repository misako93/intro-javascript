import type { Metadata, Viewport } from "next";
import PwaSetup from "@/components/PwaSetup";
import { APP_NAME } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: `${APP_NAME} — Discutez chacun dans votre langue`,
  description:
    "Messagerie bilingue en temps réel : écrivez ou parlez dans votre langue, votre interlocuteur lit la traduction instantanément.",
  applicationName: APP_NAME,
  icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
  // Plein écran quand l'app est ajoutée à l'écran d'accueil de l'iPhone
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#059669",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-dvh bg-slate-50 text-slate-900 antialiased">
        <PwaSetup />
        {children}
      </body>
    </html>
  );
}
