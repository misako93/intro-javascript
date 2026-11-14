import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/config";

// Rend l'application installable sur Android et iPhone (écran d'accueil, plein écran, notifications).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: `${APP_NAME} — Chat bilingue`,
    short_name: APP_NAME,
    description: "Discutez chacun dans votre langue, la traduction est instantanée.",
    lang: "fr",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f8fafc",
    theme_color: "#059669",
    categories: ["communication", "social", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
