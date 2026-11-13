import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/config";

// Permet "Ajouter à l'écran d'accueil" sur mobile : l'app s'ouvre comme WhatsApp.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: "Chat bilingue avec traduction instantanée",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#059669",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
