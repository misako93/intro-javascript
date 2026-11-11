import { randomUUID } from "node:crypto";
import type { AgentId, ChatRequest, StreamEvent } from "../types";
import { executeTool, toolLabel } from "./tools";

// Demo mode: a scripted run per agent, used when no API key is configured.
// The steps go through the real tools, so deliverables, validation and the
// approval flow behave exactly as with Claude. The texts are written for the
// demo shop; the interface shows a « Mode démo » badge while this is active.

type Step = { say: string } | { tool: string; input: Record<string, unknown> };

const SCRIPTS: Record<AgentId, Step[]> = {
  webmaster: [
    { say: "Je lis votre catalogue pour repérer la fiche qui vous fait perdre le plus de ventes." },
    { tool: "list_products", input: {} },
    { tool: "get_product", input: { product_id: "p1" } },
    {
      tool: "propose_product_update",
      input: {
        product_id: "p1",
        reason: "La fiche actuelle tient en une ligne : un acheteur ne sait ni à quoi sert le produit, ni comment l'utiliser.",
        title: "Huile de nigelle pure pressée à froid – flacon 100 ml",
        description:
          "Une huile de nigelle 100 % pure, obtenue par première pression à froid des graines, sans additif ni parfum ajouté.\n\nSa couleur ambrée et son parfum épicé, légèrement poivré, sont les signes d'une huile non raffinée. On l'utilise depuis des générations dans les rituels de soin : quelques gouttes sur le visage le soir, en massage sur le cuir chevelu avant le shampoing, ou mélangée à votre huile habituelle.\n\n• Flacon en verre teinté de 100 ml, qui protège l'huile de la lumière\n• Bouchon doseur pour ne pas gaspiller\n• À conserver au frais, à l'abri du soleil\n\nÀ compléter de votre côté : le pays d'origine des graines et la date de pression, deux informations qui rassurent beaucoup sur ce type de produit.",
        tags: ["huile de nigelle", "habba sawda", "pressée à froid", "soin visage", "soin cheveux", "100 ml"],
        image_alt: "Flacon en verre teinté d'huile de nigelle pure 100 ml",
      },
    },
    {
      say: "J'ai préparé une nouvelle version de la fiche **Huile de nigelle**, la plus pauvre du catalogue (5 mots de description).\n\n- **Titre** précis : type de produit, méthode de pression, format\n- **Description** qui répond aux trois questions de l'acheteur : ce que c'est, comment l'utiliser, comment le conserver\n- **6 tags** et un **texte alternatif** pour l'image\n\nLa proposition vous attend à droite : validez-la pour l'appliquer à la boutique. Il me manque l'origine des graines, à compléter de votre côté. Prochaine étape conseillée : les fiches Savon d'Alep et Ghassoul, presque aussi courtes.",
    },
  ],
  seo: [
    { say: "Je lance un audit complet du catalogue pour savoir où agir en premier." },
    { tool: "audit_catalog", input: {} },
    {
      tool: "propose_product_update",
      input: {
        product_id: "p1",
        reason: "Aucune balise title ni meta description : Google compose lui-même l'extrait, rarement à votre avantage.",
        seo_title: "Huile de nigelle pure pressée à froid 100 ml | Maison Nour",
        seo_description:
          "Huile de nigelle 100 % pure, première pression à froid, sans additif. Flacon en verre teinté de 100 ml avec doseur. Expédition soignée par Maison Nour.",
      },
    },
    {
      tool: "propose_product_update",
      input: {
        product_id: "p3",
        reason: "Le produit le plus cher du catalogue n'a aucune balise SEO : c'est la page où un clic vaut le plus.",
        seo_title: "Miel de sidr du Yémen 250 g – miel rare | Maison Nour",
        seo_description:
          "Miel de sidr du Yémen en pot de 250 g : un miel rare à la texture dense et au goût de caramel. Idéal à offrir ou à savourer nature. Livraison soignée.",
      },
    },
    {
      say: "L'audit est prêt : votre catalogue obtient un score moyen faible, tiré vers le bas par **7 fiches sur 8 sans meta description**. Seule l'huile d'argan est correctement optimisée, elle peut servir de modèle.\n\nJ'ai préparé les balises title et meta description des deux pages prioritaires :\n\n- **Huile de nigelle**, la fiche la plus vide\n- **Miel de sidr**, votre produit le plus cher\n\nElles attendent votre validation à droite. Je n'ai pas accès aux volumes de recherche : ces balises sont construites sur l'intention d'achat. Prochaine étape : je traite les 5 fiches restantes si vous me dites « continue ».",
    },
  ],
  email: [
    { say: "Je regarde vos produits pour choisir ceux à mettre en avant, puis j'écris la séquence." },
    { tool: "list_products", input: {} },
    {
      tool: "create_email",
      input: {
        name: "Bienvenue 1 — Merci et notre histoire",
        sequence_name: "Séquence de bienvenue",
        send_timing: "J+0, dès l'inscription",
        subject: "Bienvenue chez Maison Nour",
        preheader: "Ce que vous trouverez chez nous, et pourquoi nous l'avons choisi.",
        headline: "Ravis de vous compter parmi nous",
        paragraphs: [
          "Merci de nous avoir rejoints. Maison Nour, c'est une petite sélection de soins naturels et de produits d'épicerie fine que nous utilisons nous-mêmes au quotidien.",
          "Pas de catalogue à rallonge : chaque produit est là parce qu'il est simple, bien fait, et qu'on sait d'où il vient.",
          "Dans les prochains jours, nous vous montrerons comment nos clients les utilisent. En attendant, voici par où beaucoup commencent.",
        ],
        cta_label: "Découvrir la sélection",
        featured_product_ids: ["p7", "p2"],
        ps: "Une question sur un produit ? Répondez simplement à cet email, nous lisons tout.",
      },
    },
    {
      tool: "create_email",
      input: {
        name: "Bienvenue 2 — Le rituel hammam à la maison",
        sequence_name: "Séquence de bienvenue",
        send_timing: "J+2",
        subject: "Le hammam à la maison, en 3 gestes",
        preheader: "Savon noir, gant kessa, ghassoul : dans quel ordre et pourquoi.",
        headline: "Le rituel hammam, pas à pas",
        paragraphs: [
          "On nous demande souvent par où commencer. Notre réponse tient en trois gestes, à faire une fois par semaine.",
          "D'abord le savon noir sur peau humide, qu'on laisse poser quelques minutes. Ensuite le gant kessa, en mouvements longs. Enfin le ghassoul en masque, qu'on rince à l'eau tiède.",
          "Nous avons réuni les trois dans un coffret, pour ne rien avoir à chercher.",
        ],
        cta_label: "Voir le coffret hammam",
        featured_product_ids: ["p8"],
      },
    },
    {
      say: "Les deux premiers emails de votre **séquence de bienvenue** sont prêts, avec leur aperçu à droite :\n\n- **J+0** — remerciement et présentation de la maison, avec l'huile d'argan et le savon d'Alep\n- **J+2** — un contenu utile (le rituel hammam) qui amène naturellement au coffret\n\nJe n'ai inclus aucun code promo, puisque je ne connais pas votre politique d'offres. Un code de bienvenue dans un troisième email à J+5 est ce qui convertit le mieux : donnez-moi le montant et je l'écris.",
    },
  ],
  social: [
    { say: "Je relis la fiche du miel de sidr, puis j'écris le script et le post qui l'accompagne." },
    { tool: "get_product", input: { product_id: "p3" } },
    {
      tool: "create_video_script",
      input: {
        platform: "TikTok",
        title: "Miel de sidr — le test de la cuillère",
        duration_seconds: 30,
        hook: "« Ce miel ne coule presque pas. Regardez. »",
        scenes: [
          { visual: "Gros plan : une cuillère en bois plonge dans le pot et remonte lentement, le miel s'étire sans tomber", voiceover: "Ce miel ne coule presque pas. Regardez.", on_screen_text: "Il ne coule (presque) pas", seconds: 4 },
          { visual: "Le pot posé sur une table en bois, lumière naturelle, on tourne le pot pour montrer l'étiquette", voiceover: "C'est du miel de sidr. Il vient du Yémen, et sa texture est aussi dense que ça.", on_screen_text: "Miel de sidr du Yémen", seconds: 7 },
          { visual: "Une main étale le miel sur une tranche de pain chaud", voiceover: "Le goût ? Entre le caramel et la datte. Rien à voir avec un miel de supermarché.", on_screen_text: "Caramel + datte", seconds: 7 },
          { visual: "Plan serré : une cuillère de miel dans une tasse de lait chaud, on remue", voiceover: "Chez nous, c'est une cuillère le matin, ou dans un lait chaud le soir.", on_screen_text: "", seconds: 7 },
          { visual: "Le pot face caméra, une main le pousse doucement vers l'objectif", voiceover: "Le pot de 250 grammes est sur notre boutique. Lien en bio.", on_screen_text: "Lien en bio", seconds: 5 },
        ],
        caption: "Le test de la cuillère ne ment pas 🍯 Miel de sidr du Yémen, pot de 250 g. Vous l'avez déjà goûté ?",
        hashtags: ["mieldesidr", "miel", "epiceriefine", "produitsnaturels", "petitdejeuner", "decouverte"],
        cta: "Lien en bio pour le pot de 250 g",
      },
    },
    {
      tool: "create_social_post",
      input: {
        platform: "Instagram",
        format: "Carrousel",
        caption:
          "Tous les miels ne se ressemblent pas.\n\nLe miel de sidr se reconnaît à trois choses : une texture dense qui s'étire, une couleur ambrée profonde, un goût entre le caramel et la datte.\n\nFaites défiler pour voir la différence en images ➡️\n\nEt vous, vous le préférez nature ou dans un lait chaud ?",
        hashtags: ["mieldesidr", "miel", "epiceriefine", "produitsnaturels", "faitmaison", "gourmandise", "maisonnour"],
        visual_idea:
          "Carrousel de 4 images : 1) la cuillère qui s'étire avec le texte « Il ne coule presque pas » ; 2) gros plan sur la couleur à contre-jour ; 3) le miel sur une tranche de pain chaud ; 4) le pot avec le prix et « Lien en bio ».",
      },
    },
    {
      say: "Voici de quoi lancer le **miel de sidr** sur vos réseaux :\n\n- un **script TikTok de 30 secondes** en 5 plans, filmable seul au smartphone, avec une accroche visuelle (la cuillère qui ne coule pas)\n- un **carrousel Instagram** qui reprend la même idée pour ceux qui ne regardent pas les vidéos\n\nTout est dans vos livrables à droite. Je n'ai mentionné aucune vertu santé, uniquement le goût et la texture. Prochaine étape : je peux décliner ce duo vidéo + post pour le savon d'Alep, ou planifier votre semaine complète.",
    },
  ],
};

// The Webmaster handles several everyday jobs: the demo picks a script from the request.
const WEBMASTER_VARIANTS: { match: RegExp; steps: Step[] }[] = [
  {
    match: /code promo|coupon|code de r[ée]duction/i,
    steps: [
      { say: "Je vérifie les codes déjà actifs, puis je prépare le vôtre." },
      { tool: "get_store_settings", input: {} },
      {
        tool: "propose_discount_code",
        input: {
          code: "BIENVENUE10",
          kind: "percentage",
          value: 10,
          minimum_purchase: 30,
          once_per_customer: true,
          reason: "Un code de bienvenue pour transformer un premier visiteur en client, sans rogner la marge sur les petits paniers.",
        },
      },
      {
        say: "Le code **BIENVENUE10** est prêt :\n\n- **-10 %** sur toute la boutique\n- à partir de **30 € d'achat**\n- **une seule utilisation** par client\n\nIl ne sera actif qu'après votre validation. Je n'ai pas mis de date de fin puisque vous n'en avez pas donné : dites-le-moi si vous voulez le limiter dans le temps. Prochaine étape : l'Agent Emailing peut l'annoncer dans un email de bienvenue.",
      },
    ],
  },
  {
    match: /barre|bandeau|d[ée]filant/i,
    steps: [
      { say: "Je regarde ce qui est déjà affiché en haut du site, puis je prépare la barre." },
      { tool: "get_store_settings", input: {} },
      {
        tool: "propose_announcement_bar",
        input: {
          messages: ["Livraison offerte dès 49 € d'achat"],
          scrolling: true,
          reason: "Rappeler le seuil de livraison offerte sur toutes les pages incite à compléter son panier.",
        },
      },
      {
        say: "La **barre défilante** est prête, avec votre message : « Livraison offerte dès 49 € d'achat ».\n\nElle s'affichera en haut de toutes les pages une fois validée : vous pourrez la voir dans **Aperçu du site**. Je n'ai rien ajouté d'autre, pour ne pas annoncer une offre que vous n'avez pas confirmée. Si vous voulez faire défiler un deuxième message (délai d'expédition, code promo), donnez-le-moi.",
      },
    ],
  },
  {
    match: /prix|tarif/i,
    steps: [
      { say: "Je lis le catalogue pour repérer les produits concernés, puis je calcule les nouveaux prix." },
      { tool: "list_products", input: {} },
      {
        tool: "propose_price_rule",
        input: {
          label: "-15 % sur les Huiles",
          reason: "Une baisse ciblée sur la catégorie Huiles, avec l'ancien prix barré pour rendre la remise visible.",
          scope: { type: "category", category: "Huiles" },
          operation: "percent",
          value: -15,
          rounding: "0.90",
          show_compare_at: true,
        },
      },
      {
        say: "Voici la baisse de **15 % sur la catégorie Huiles**, arrondie à ,90 :\n\n- **Huile de nigelle** : 14,90 € → **12,90 €** (-13 %)\n- **Huile d'argan bio** : 16,90 € → **13,90 €** (-18 %)\n\nL'arrondi à ,90 fait que la baisse réelle s'écarte un peu des 15 % demandés. L'ancien prix restera affiché barré. Rien ne change tant que vous n'avez pas validé. Je ne connais pas vos coûts d'achat : vérifiez que la marge reste correcte à ces prix.",
      },
    ],
  },
];

const SEO_REPORT: Step[] = [
  { say: "Je lis vos données Search Console, puis j'établis le rapport." },
  { tool: "get_search_performance", input: {} },
  {
    tool: "create_seo_report",
    input: {
      title: "Rapport SEO — 3 derniers mois",
      summary:
        "Ces chiffres sont des données de démonstration. La boutique est vue (51 830 impressions) mais peu cliquée : 1,5 % de taux de clic, pour une position moyenne de 12,7. Un clic sur quatre vient de recherches sur le nom « Maison Nour » : hors marque, la visibilité reste à construire. Le gain le plus rapide est sur trois requêtes très recherchées, classées en bas de première page ou en haut de deuxième : « savon d'alep », « huile de nigelle » et « ghassoul cheveux ».",
      actions: [
        {
          priority: "haute",
          action: "Enrichir la fiche et retravailler son title autour de la requête exacte",
          target: "savon d'alep — /products/savon-alep",
          reason: "8 200 impressions en position 14,6 : c'est la requête la plus recherchée, et la fiche tient en deux phrases.",
        },
        {
          priority: "haute",
          action: "Réécrire la fiche (description, title, meta description)",
          target: "huile de nigelle — /products/huile-nigelle",
          reason: "5 400 impressions en position 11,2, aux portes de la première page, avec une description de 5 mots.",
        },
        {
          priority: "haute",
          action: "Réécrire le title et la meta description pour donner une raison de cliquer",
          target: "miel de sidr — /products/miel-sidr",
          reason: "Déjà en position 4,3, mais 3,3 % de taux de clic seulement : le classement est là, pas l'envie de cliquer.",
        },
        {
          priority: "moyenne",
          action: "Soutenir la fiche par un article lié et des liens internes : elle est déjà bien rédigée",
          target: "huile d'argan bio — /products/huile-argan-bio",
          reason: "6 100 impressions en position 15,8, juste derrière la première page.",
        },
        {
          priority: "moyenne",
          action: "Ajouter à la fiche une partie « comment l'utiliser sur les cheveux »",
          target: "ghassoul cheveux — /products/ghassoul",
          reason: "3 600 impressions en position 12,9, et une seconde requête proche (« ghassoul comment utiliser ») en 17,4.",
        },
        {
          priority: "moyenne",
          action: "Écrire un article de blog qui répond à la question",
          target: "comment reconnaître un vrai savon d'alep",
          reason: "950 impressions en position 13,2 sur une question : c'est un article qu'il faut, pas une fiche produit.",
        },
        {
          priority: "basse",
          action: "Créer une page dédiée, ou étoffer le coffret hammam",
          target: "savon noir hammam, gant kessa",
          reason: "5 500 impressions à elles deux, mais au-delà de la 19e position : la boutique n'a pas de page qui y réponde vraiment.",
        },
      ],
    },
  },
  {
    say: "Votre **rapport SEO** est prêt, à partir des données Search Console (ici, des données de démonstration).\n\n- La boutique est vue mais peu cliquée : **1,5 %** de taux de clic, position moyenne **12,7**\n- **Un clic sur quatre** vient du nom de la marque : hors marque, tout reste à gagner\n- Trois priorités hautes : les fiches **savon d'Alep** et **huile de nigelle** à enrichir, le title du **miel de sidr** à réécrire\n\nLe plan d'action complet est dans le rapport, classé du plus rentable au moins rentable. Prochaine étape : dites-moi « optimise les 3 priorités hautes » et je prépare les propositions à valider.",
  },
];

function scriptFor(request: ChatRequest): Step[] {
  if (request.agentId === "seo" && /rapport|search console|bilan/i.test(request.message)) return SEO_REPORT;
  if (request.agentId === "webmaster") {
    const variant = WEBMASTER_VARIANTS.find((v) => v.match.test(request.message));
    if (variant) return variant.steps;
  }
  return SCRIPTS[request.agentId];
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runMockAgent({
  request,
  emit,
  signal,
  speed = 1,
}: {
  request: ChatRequest;
  emit: (event: StreamEvent) => void;
  signal?: AbortSignal;
  /** 0 disables the artificial delays (tests). */
  speed?: number;
}): Promise<void> {
  const ctx = { agentId: request.agentId, store: request.store };
  let wroteText = false;
  for (const step of scriptFor(request)) {
    if (signal?.aborted) return;
    if ("say" in step) {
      if (wroteText) emit({ type: "text", delta: "\n\n" });
      for (const chunk of step.say.match(/\S+\s*/g) ?? []) {
        emit({ type: "text", delta: chunk });
        await pause(18 * speed);
      }
      wroteText = true;
      continue;
    }
    const id = `demo_${randomUUID().slice(0, 8)}`;
    emit({ type: "tool_start", id, name: step.tool, label: toolLabel(step.tool) });
    const size = JSON.stringify(step.input).length;
    for (let chars = 150; chars < size; chars += 150) {
      emit({ type: "tool_progress", id, chars });
      await pause(35 * speed);
    }
    await pause(350 * speed);
    const result = await executeTool(step.tool, step.input, ctx);
    if (result.deliverable) emit({ type: "deliverable", deliverable: result.deliverable });
    emit({ type: "tool_end", id, ok: !result.isError, summary: result.summary });
  }
}
