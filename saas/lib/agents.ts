import type { AgentId } from "./types";

// Client-safe description of each agent (no prompt, no server code).
export interface AgentMeta {
  id: AgentId;
  name: string;
  role: string;
  description: string;
  color: string;
  suggestions: string[];
}

export const AGENTS: AgentMeta[] = [
  {
    id: "webmaster",
    name: "Agent Webmaster",
    role: "Tient votre boutique à jour",
    description: "Réécrit vos fiches, crée vos pages, change vos prix en masse, prépare vos codes promo et votre barre d'annonce.",
    color: "#2563eb",
    suggestions: [
      "Réécris la fiche de l'huile de nigelle pour qu'elle donne envie d'acheter",
      "Baisse de 15 % les prix de la catégorie Huiles, arrondis à ,90",
      "Crée un code promo BIENVENUE10 : -10 % dès 30 € d'achat, une fois par client",
      "Ajoute une barre défilante : livraison offerte dès 49 € d'achat",
      "Crée une page FAQ Livraison et retours",
    ],
  },
  {
    id: "seo",
    name: "Agent SEO",
    role: "Vous rend visible sur Google",
    description: "Audite votre catalogue ou une page, optimise titres et meta descriptions, rédige des articles de blog.",
    color: "#059669",
    suggestions: [
      "Fais un audit SEO complet de mon catalogue",
      "Optimise les balises title et meta des 3 produits prioritaires",
      "Écris un article de blog : comment reconnaître un vrai savon d'Alep",
    ],
  },
  {
    id: "email",
    name: "Agent Emailing",
    role: "Fait revenir vos clients",
    description: "Écrit vos séquences de bienvenue, relances de panier abandonné et newsletters, avec aperçu prêt à envoyer.",
    color: "#d97706",
    suggestions: [
      "Crée une séquence de bienvenue de 3 emails",
      "Écris un email de relance de panier abandonné",
      "Prépare une newsletter qui met en avant le coffret hammam",
    ],
  },
  {
    id: "social",
    name: "Agent Réseaux & Vidéo",
    role: "Nourrit vos réseaux sociaux",
    description: "Écrit vos scripts TikTok et Reels plan par plan (avec ou sans présentateur IA), vos posts et votre calendrier éditorial.",
    color: "#9333ea",
    suggestions: [
      "Écris un script TikTok de 30 secondes pour le miel de sidr",
      "Prépare une vidéo avec présentatrice IA pour l'huile d'argan",
      "Planifie une semaine de contenus Instagram",
      "Propose 2 posts Instagram pour le savon d'Alep",
    ],
  },
];

export function agentById(id: AgentId): AgentMeta {
  return AGENTS.find((a) => a.id === id)!;
}
