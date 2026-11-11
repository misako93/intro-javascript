import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import * as z from "zod";
import { auditCatalog } from "../audit";
import { type AgentId, type Deliverable, type DeliverableDraft, describeDiscount, type Product, type ProductField, type StoreState } from "../types";
import { analyzeHtml, fetchPublicHtml, PageAuditError } from "./seo-page";

export interface ToolContext {
  agentId: AgentId;
  store: StoreState;
}

interface ToolOutcome {
  /** What the model reads back. */
  content: string;
  /** One short line for the activity chip in the interface. */
  summary: string;
  isError?: boolean;
  deliverable?: DeliverableDraft;
}

interface ToolSpec<S extends z.ZodType = z.ZodType> {
  name: string;
  /** Shown in the interface while the tool runs. */
  label: string;
  description: string;
  schema: S;
  run: (input: z.infer<S>, ctx: ToolContext) => ToolOutcome | Promise<ToolOutcome>;
}

function tool<S extends z.ZodType>(spec: ToolSpec<S>): ToolSpec {
  return spec as unknown as ToolSpec;
}

const fail = (message: string): ToolOutcome => ({ content: message, summary: message, isError: true });

const SEO_TITLE_MAX = 65;
const SEO_DESCRIPTION_MAX = 165;

const ScopeSchema = z.object({
  type: z.enum(["all", "category", "products"]).describe("all : toute la boutique ; category : une catégorie ; products : une liste de produits"),
  category: z.string().optional().describe("Nom de la catégorie, si type = category"),
  product_ids: z.array(z.string()).optional().describe("Identifiants des produits, si type = products"),
});

/** Turns a scope chosen by the model into the products it covers. */
function resolveScope(
  scope: z.infer<typeof ScopeSchema> | undefined,
  store: StoreState,
): { products: Product[]; label: string } | { error: string } {
  if (!scope || scope.type === "all") return { products: store.products, label: "Toute la boutique" };
  if (scope.type === "category") {
    const wanted = (scope.category ?? "").trim().toLowerCase();
    const products = store.products.filter((p) => p.category.toLowerCase() === wanted);
    if (products.length === 0) {
      const categories = [...new Set(store.products.map((p) => p.category))].join(", ");
      return { error: `Catégorie introuvable : « ${scope.category ?? ""} ». Catégories existantes : ${categories}.` };
    }
    return { products, label: `Catégorie ${products[0].category}` };
  }
  const ids = scope.product_ids ?? [];
  if (ids.length === 0) return { error: "product_ids est vide : indique les produits concernés." };
  const unknown = ids.filter((id) => !store.products.some((p) => p.id === id));
  if (unknown.length) return { error: `Produits introuvables : ${unknown.join(", ")}. Appelle list_products pour obtenir les identifiants.` };
  const products = store.products.filter((p) => ids.includes(p.id));
  return { products, label: products.length === 1 ? products[0].title : `${products.length} produits` };
}

type Rounding = "none" | "0.90" | "0.99" | "0.00";

/** Prices are computed here, never by the model, so the arithmetic is always right. */
export function roundPrice(price: number, rounding: Rounding): number {
  if (rounding === "none") return Math.round(price * 100) / 100;
  if (rounding === "0.00") return Math.max(1, Math.round(price));
  const ending = rounding === "0.90" ? 0.9 : 0.99;
  const base = Math.floor(price);
  const lower = base - 1 + ending;
  const upper = base + ending;
  const chosen = lower > 0 && price - lower <= upper - price ? lower : upper;
  return Math.round(chosen * 100) / 100;
}

const euros = (value: number) => `${value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const SPECS: ToolSpec[] = [
  tool({
    name: "list_products",
    label: "Lecture du catalogue",
    description:
      "Liste tous les produits de la boutique avec leur identifiant, prix et un résumé de l'état de leur fiche. À appeler avant de parler du catalogue ou pour trouver l'identifiant d'un produit.",
    schema: z.object({}),
    run: (_input, { store }) => ({
      summary: `${store.products.length} produits lus`,
      content: JSON.stringify(
        store.products.map((p) => ({
          id: p.id,
          title: p.title,
          category: p.category,
          price_eur: p.price,
          compare_at_price_eur: p.compareAtPrice ?? null,
          description_words: p.description.split(/\s+/).filter(Boolean).length,
          has_seo_title: Boolean(p.seoTitle.trim()),
          has_meta_description: Boolean(p.seoDescription.trim()),
          tags: p.tags,
        })),
      ),
    }),
  }),

  tool({
    name: "get_product",
    label: "Lecture d'une fiche produit",
    description:
      "Renvoie la fiche complète d'un produit (titre, description, tags, champs SEO). À appeler avant de modifier une fiche ou d'écrire un contenu sur ce produit.",
    schema: z.object({ product_id: z.string().describe("Identifiant renvoyé par list_products") }),
    run: ({ product_id }, { store }) => {
      const p = store.products.find((x) => x.id === product_id);
      if (!p) return fail(`Produit introuvable : ${product_id}. Appelle list_products pour obtenir les identifiants.`);
      return {
        summary: `Fiche « ${p.title} » lue`,
        content: JSON.stringify({
          id: p.id,
          url: `${store.url}/products/${p.handle}`,
          title: p.title,
          category: p.category,
          price_eur: p.price,
          description: p.description,
          tags: p.tags,
          seo_title: p.seoTitle,
          seo_description: p.seoDescription,
          image_alt: p.imageAlt,
        }),
      };
    },
  }),

  tool({
    name: "audit_catalog",
    label: "Audit du catalogue",
    description:
      "Analyse toutes les fiches produits selon des règles SEO fixes (longueur des titres, descriptions, balises title et meta, textes alternatifs, tags) et crée le livrable « Audit SEO du catalogue » avec un score par produit. À appeler quand on demande un audit, un état des lieux ou les fiches prioritaires.",
    schema: z.object({}),
    run: (_input, { store }) => {
      const { score, rows } = auditCatalog(store);
      return {
        summary: `Score du catalogue : ${score}/100`,
        content: JSON.stringify({ score, products: rows }),
        deliverable: { type: "seo_audit", scope: "catalog", target: store.name, score, checks: [], rows },
      };
    },
  }),

  tool({
    name: "audit_page",
    label: "Audit de la page",
    description:
      "Télécharge une page web publique et vérifie ses éléments SEO on-page (title, meta description, H1/H2, images sans alt, canonique, indexation, données structurées). Crée le livrable d'audit. À appeler quand l'utilisateur donne l'URL d'une page à analyser.",
    schema: z.object({ url: z.string().describe("URL complète, par exemple https://www.maboutique.fr/produit") }),
    run: async ({ url }) => {
      try {
        const { html, finalUrl } = await fetchPublicHtml(url);
        const { score, checks } = analyzeHtml(html, finalUrl);
        return {
          summary: `Score de la page : ${score}/100`,
          content: JSON.stringify({ url: finalUrl, score, checks }),
          deliverable: { type: "seo_audit", scope: "page", target: finalUrl, score, checks, rows: [] },
        };
      } catch (error) {
        if (error instanceof PageAuditError) return fail(error.message);
        throw error;
      }
    },
  }),

  tool({
    name: "propose_product_update",
    label: "Proposition de modification",
    description:
      "Propose une modification d'une fiche produit. Rien n'est publié : la proposition apparaît dans l'espace du client, qui la valide ou la refuse. Ne renseigne que les champs à changer. Un appel par produit.",
    schema: z.object({
      product_id: z.string(),
      reason: z.string().describe("Pourquoi ce changement, en une phrase simple destinée au client"),
      title: z.string().optional().describe("Nouveau titre de la fiche, 30 à 65 caractères"),
      description: z
        .string()
        .optional()
        .describe("Nouvelle description en texte brut : paragraphes courts séparés par une ligne vide, puces possibles avec « • ». Ni HTML ni Markdown."),
      tags: z.array(z.string()).optional().describe("Liste complète des tags, 4 à 8"),
      seo_title: z.string().optional().describe("Balise title, 50 à 60 caractères, mot-clé principal au début"),
      seo_description: z.string().optional().describe("Meta description, 140 à 155 caractères, avec un bénéfice concret"),
      image_alt: z.string().optional().describe("Texte alternatif de l'image principale, descriptif, moins de 125 caractères"),
    }),
    run: (input, { store }) => {
      const p = store.products.find((x) => x.id === input.product_id);
      if (!p) return fail(`Produit introuvable : ${input.product_id}.`);
      if (input.seo_title && input.seo_title.length > SEO_TITLE_MAX) {
        return fail(`seo_title fait ${input.seo_title.length} caractères : raccourcis-le à 60 maximum puis rappelle l'outil.`);
      }
      if (input.seo_description && input.seo_description.length > SEO_DESCRIPTION_MAX) {
        return fail(`seo_description fait ${input.seo_description.length} caractères : raccourcis-la à 155 maximum puis rappelle l'outil.`);
      }
      const candidates: [ProductField, string | undefined, string][] = [
        ["title", input.title, p.title],
        ["description", input.description, p.description],
        ["tags", input.tags?.join(", "), p.tags.join(", ")],
        ["seoTitle", input.seo_title, p.seoTitle],
        ["seoDescription", input.seo_description, p.seoDescription],
        ["imageAlt", input.image_alt, p.imageAlt],
      ];
      const changes = candidates
        .filter(([, after, before]) => after !== undefined && after.trim() !== "" && after.trim() !== before.trim())
        .map(([field, after, before]) => ({ field, before, after: (after as string).trim() }));
      if (changes.length === 0) return fail("Aucun champ ne change par rapport à la fiche actuelle.");
      return {
        summary: `${changes.length} ${changes.length > 1 ? "champs proposés" : "champ proposé"} pour « ${p.title} »`,
        content: JSON.stringify({
          status: "en_attente_de_validation",
          fields: changes.map((c) => c.field),
          note: "Proposition enregistrée. Elle ne sera appliquée à la boutique qu'après validation par le client.",
        }),
        deliverable: {
          type: "product_update",
          productId: p.id,
          productTitle: p.title,
          reason: input.reason,
          changes,
          status: "pending",
        },
      };
    },
  }),

  tool({
    name: "get_store_settings",
    label: "Lecture des réglages de la boutique",
    description:
      "Renvoie les codes promo actifs et la barre d'annonce actuelle de la boutique. À appeler avant de créer un code promo ou une barre d'annonce, et avant de citer un code promo dans un email ou un post : n'utilise que les codes renvoyés ici.",
    schema: z.object({}),
    run: (_input, { store }) => ({
      summary: `${store.discounts.length} code${store.discounts.length > 1 ? "s" : ""} promo actif${store.discounts.length > 1 ? "s" : ""}`,
      content: JSON.stringify({
        discount_codes: store.discounts.map((d) => ({ code: d.code, rule: describeDiscount(d) })),
        announcement_bar: store.announcement,
      }),
    }),
  }),

  tool({
    name: "propose_price_rule",
    label: "Calcul des nouveaux prix",
    description:
      "Propose une modification de prix en masse à partir d'une règle (pourcentage, montant ou prix fixe) sur toute la boutique, une catégorie ou une liste de produits. L'outil calcule lui-même les nouveaux prix et renvoie le détail : ne fais jamais ce calcul à la main. Rien n'est appliqué sans validation du client.",
    schema: z.object({
      label: z.string().describe("Nom court de l'opération, par exemple « -15 % sur les Huiles »"),
      reason: z.string().describe("Pourquoi ce changement, en une phrase simple destinée au client"),
      scope: ScopeSchema,
      operation: z.enum(["percent", "amount", "set"]).describe("percent : variation en % ; amount : variation en euros ; set : prix fixe"),
      value: z.number().describe("-15 pour baisser de 15 %, 2 pour augmenter de 2 €, 19.9 pour fixer le prix à 19,90 €"),
      rounding: z.enum(["none", "0.90", "0.99", "0.00"]).optional().describe("Terminaison des prix après calcul. none par défaut."),
      show_compare_at: z.boolean().optional().describe("En cas de baisse, afficher l'ancien prix barré. true par défaut."),
    }),
    run: (input, { store }) => {
      const scope = resolveScope(input.scope, store);
      if ("error" in scope) return fail(scope.error);
      if (input.operation === "percent" && (input.value < -90 || input.value > 300)) {
        return fail("Variation en pourcentage hors limites : elle doit rester entre -90 % et +300 %.");
      }
      if (input.operation === "set" && input.value <= 0) return fail("Un prix fixe doit être supérieur à 0.");
      const changes = [];
      for (const p of scope.products) {
        const raw =
          input.operation === "percent" ? p.price * (1 + input.value / 100) : input.operation === "amount" ? p.price + input.value : input.value;
        if (raw <= 0) return fail(`La règle donnerait un prix nul ou négatif pour « ${p.title} ».`);
        const after = roundPrice(raw, input.rounding ?? "none");
        if (after === p.price) continue;
        const lowered = after < p.price;
        changes.push({
          productId: p.id,
          productTitle: p.title,
          before: p.price,
          after,
          compareAtAfter: lowered && input.show_compare_at !== false ? Math.max(p.price, p.compareAtPrice ?? 0) : null,
        });
      }
      if (changes.length === 0) return fail("Cette règle ne change aucun prix.");
      return {
        summary: `${changes.length} prix calculé${changes.length > 1 ? "s" : ""} (${scope.label})`,
        content: JSON.stringify({
          status: "en_attente_de_validation",
          scope: scope.label,
          prices: changes.map((c) => ({
            product: c.productTitle,
            before: euros(c.before),
            after: euros(c.after),
            real_variation: `${c.after > c.before ? "+" : ""}${Math.round(((c.after - c.before) / c.before) * 100)} %`,
          })),
          note: "Proposition enregistrée. Les prix ne changeront qu'après validation par le client. Si un arrondi est appliqué, la variation réelle diffère un peu de la règle : donne au client la variation réelle de chaque produit. Tu ne connais pas les coûts d'achat : rappelle-lui de vérifier sa marge.",
        }),
        deliverable: { type: "price_update", label: input.label, reason: input.reason, changes, status: "pending" },
      };
    },
  }),

  tool({
    name: "propose_discount_code",
    label: "Préparation du code promo",
    description:
      "Propose la création d'un code promo (pourcentage, montant fixe ou livraison offerte) avec ses conditions. À appeler quand le client demande un code de réduction. Utilise les conditions données par le client ; n'en invente pas. Rien n'est créé sans validation du client.",
    schema: z.object({
      code: z.string().describe("Code en majuscules, sans espace ni accent, 3 à 20 caractères, par exemple BIENVENUE10"),
      kind: z.enum(["percentage", "fixed_amount", "free_shipping"]),
      value: z.number().describe("10 pour -10 %, 5 pour -5 €, 0 pour la livraison offerte"),
      scope: ScopeSchema.optional().describe("Produits concernés. Absent : toute la boutique."),
      minimum_purchase: z.number().optional().describe("Montant minimum du panier en euros. Absent ou 0 : aucun minimum."),
      ends_on: z.string().optional().describe("Date de fin au format AAAA-MM-JJ. Absent : pas de date de fin."),
      once_per_customer: z.boolean().optional().describe("true pour limiter à une utilisation par client"),
      reason: z.string().describe("À quoi sert ce code, en une phrase simple destinée au client"),
    }),
    run: (input, { store }) => {
      const code = input.code.trim().toUpperCase();
      if (!/^[A-Z0-9_-]{3,20}$/.test(code)) {
        return fail("Code invalide : 3 à 20 caractères, lettres majuscules sans accent, chiffres, tiret ou underscore.");
      }
      if (store.discounts.some((d) => d.code === code)) return fail(`Le code ${code} existe déjà. Propose un autre nom.`);
      if (input.kind === "percentage" && (input.value < 1 || input.value > 90)) {
        return fail("Un code en pourcentage doit être compris entre 1 et 90 %.");
      }
      if (input.kind === "fixed_amount" && input.value <= 0) return fail("Le montant de la réduction doit être supérieur à 0.");
      const endsOn = input.ends_on?.trim() ?? "";
      if (endsOn && (!/^\d{4}-\d{2}-\d{2}$/.test(endsOn) || Number.isNaN(Date.parse(endsOn)))) {
        return fail("ends_on doit être une date au format AAAA-MM-JJ.");
      }
      const scope = resolveScope(input.scope, store);
      if ("error" in scope) return fail(scope.error);
      const discount = {
        code,
        kind: input.kind,
        value: input.kind === "free_shipping" ? 0 : input.value,
        appliesTo: scope.label,
        minimumPurchase: Math.max(0, input.minimum_purchase ?? 0),
        endsOn,
        oncePerCustomer: Boolean(input.once_per_customer),
      };
      return {
        summary: `Code ${code} préparé`,
        content: JSON.stringify({
          status: "en_attente_de_validation",
          code,
          rule: describeDiscount(discount),
          note: "Proposition enregistrée. Le code ne sera actif qu'après validation par le client.",
        }),
        deliverable: { type: "discount", reason: input.reason, discount, status: "pending" },
      };
    },
  }),

  tool({
    name: "propose_announcement_bar",
    label: "Préparation de la barre d'annonce",
    description:
      "Propose le contenu de la barre d'annonce affichée tout en haut du site, fixe ou défilante. À appeler quand le client demande une barre défilante, un bandeau ou une annonce en haut du site. N'annonce que ce que le client t'a dit (livraison offerte, délai, offre) ou un code promo actif. Rien n'est affiché sans validation du client.",
    schema: z.object({
      messages: z.array(z.string()).describe("1 à 4 messages courts, 70 caractères maximum chacun"),
      scrolling: z.boolean().describe("true pour une barre défilante, false pour une barre fixe"),
      link: z.string().optional().describe("Adresse ouverte au clic. Absent : pas de lien."),
      reason: z.string().describe("Pourquoi cette annonce, en une phrase simple destinée au client"),
    }),
    run: (input) => {
      const messages = input.messages.map((m) => m.trim()).filter(Boolean);
      if (messages.length === 0 || messages.length > 4) return fail("Il faut entre 1 et 4 messages.");
      const tooLong = messages.find((m) => m.length > 90);
      if (tooLong) return fail(`Message trop long (${tooLong.length} caractères) : raccourcis-le à 70 maximum.`);
      return {
        summary: `Barre d'annonce préparée (${messages.length} message${messages.length > 1 ? "s" : ""})`,
        content: JSON.stringify({
          status: "en_attente_de_validation",
          note: "Proposition enregistrée. La barre n'apparaîtra sur le site qu'après validation par le client.",
        }),
        deliverable: {
          type: "announcement",
          reason: input.reason,
          bar: { messages, scrolling: input.scrolling, link: input.link?.trim() ?? "" },
          status: "pending",
        },
      };
    },
  }),

  tool({
    name: "create_page",
    label: "Rédaction de la page",
    description:
      "Rédige une page de la boutique (À propos, FAQ, Livraison et retours, guide…) et l'enregistre comme livrable. Le contenu complet va ici, pas dans le chat.",
    schema: z.object({
      title: z.string(),
      slug: z.string().describe("Fin d'URL en minuscules avec tirets, par exemple livraison-retours"),
      meta_title: z.string().describe("50 à 60 caractères"),
      meta_description: z.string().describe("140 à 155 caractères"),
      content_markdown: z.string().describe("Contenu en Markdown avec des titres ## et des paragraphes courts. Ne répète pas le titre H1."),
    }),
    run: (input) => ({
      summary: `Page « ${input.title} » rédigée`,
      content: JSON.stringify({ status: "livrable_cree" }),
      deliverable: {
        type: "page",
        title: input.title,
        slug: input.slug,
        metaTitle: input.meta_title,
        metaDescription: input.meta_description,
        markdown: input.content_markdown,
      },
    }),
  }),

  tool({
    name: "create_article",
    label: "Rédaction de l'article",
    description:
      "Rédige un article de blog optimisé SEO et l'enregistre comme livrable. Le contenu complet va ici, pas dans le chat.",
    schema: z.object({
      title: z.string().describe("Titre H1 de l'article"),
      slug: z.string(),
      target_keyword: z.string().describe("Requête principale visée"),
      meta_title: z.string().describe("50 à 60 caractères"),
      meta_description: z.string().describe("140 à 155 caractères"),
      content_markdown: z
        .string()
        .describe("Article de 600 à 900 mots en Markdown : introduction, 3 à 5 parties en ##, conclusion avec lien vers un produit. Ne répète pas le H1."),
    }),
    run: (input) => ({
      summary: `Article « ${input.title} » rédigé`,
      content: JSON.stringify({ status: "livrable_cree" }),
      deliverable: {
        type: "article",
        title: input.title,
        slug: input.slug,
        keyword: input.target_keyword,
        metaTitle: input.meta_title,
        metaDescription: input.meta_description,
        markdown: input.content_markdown,
      },
    }),
  }),

  tool({
    name: "create_email",
    label: "Rédaction de l'email",
    description:
      "Rédige un email marketing et l'enregistre comme livrable avec son aperçu. Un appel par email. Pour une séquence, appelle l'outil une fois par email avec le même sequence_name.",
    schema: z.object({
      name: z.string().describe("Nom interne, par exemple « Bienvenue 1 — Notre histoire »"),
      sequence_name: z.string().optional().describe("Nom de la séquence si l'email en fait partie"),
      send_timing: z.string().optional().describe("Moment d'envoi, par exemple « J+0, à l'inscription » ou « 1 h après l'abandon »"),
      subject: z.string().describe("Objet, 45 caractères maximum"),
      alt_subject: z.string().optional().describe("Second objet à tester face au premier, sur un autre ressort (bénéfice ou curiosité), 45 caractères maximum"),
      preheader: z.string().describe("Texte d'aperçu, 40 à 90 caractères, qui complète l'objet sans le répéter"),
      headline: z.string().describe("Titre affiché en haut de l'email"),
      paragraphs: z.array(z.string()).describe("2 à 5 paragraphes courts, en texte brut"),
      cta_label: z.string().describe("Texte du bouton, 2 à 5 mots"),
      cta_url: z.string().optional().describe("Lien du bouton. Laisse vide pour pointer vers la boutique."),
      featured_product_ids: z.array(z.string()).optional().describe("Jusqu'à 3 produits à afficher dans l'email"),
      ps: z.string().optional().describe("Post-scriptum facultatif"),
    }),
    run: (input, { store }) => {
      const ids = (input.featured_product_ids ?? []).slice(0, 3);
      const unknown = ids.filter((id) => !store.products.some((p) => p.id === id));
      if (unknown.length) return fail(`Produits introuvables : ${unknown.join(", ")}. Appelle list_products pour obtenir les identifiants.`);
      return {
        summary: `Email « ${input.name} » rédigé`,
        content: JSON.stringify({ status: "livrable_cree" }),
        deliverable: {
          type: "email",
          name: input.name,
          sequence: input.sequence_name ?? "",
          sendTiming: input.send_timing ?? "",
          subject: input.subject,
          altSubject: input.alt_subject?.trim() ?? "",
          preheader: input.preheader,
          headline: input.headline,
          paragraphs: input.paragraphs,
          ctaLabel: input.cta_label,
          ctaUrl: input.cta_url?.trim() || store.url,
          ps: input.ps ?? "",
          products: ids.map((id) => {
            const p = store.products.find((x) => x.id === id)!;
            return { title: p.title, price: p.price, emoji: p.emoji };
          }),
        },
      };
    },
  }),

  tool({
    name: "create_video_script",
    label: "Écriture du script vidéo",
    description:
      "Écrit le script d'une vidéo courte (TikTok, Reels, Shorts) plan par plan et l'enregistre comme livrable. Un appel par vidéo.",
    schema: z.object({
      platform: z.enum(["TikTok", "Instagram Reels", "YouTube Shorts"]),
      title: z.string().describe("Nom interne de la vidéo"),
      duration_seconds: z.number().describe("Durée totale visée, entre 15 et 60"),
      presenter: z
        .string()
        .optional()
        .describe("Si la vidéo est présentée par un personnage généré par IA : qui il est, son allure, son ton, le décor. Absent pour une vidéo produit sans personne."),
      hook: z.string().describe("Phrase ou image d'accroche des 2 premières secondes"),
      scenes: z
        .array(
          z.object({
            visual: z.string().describe("Ce qu'on filme, faisable au smartphone"),
            voiceover: z.string().describe("Ce qui est dit. Vide si le plan est muet."),
            on_screen_text: z.string().describe("Texte affiché à l'écran. Vide s'il n'y en a pas."),
            seconds: z.number(),
          }),
        )
        .describe("3 à 7 plans"),
      caption: z.string().describe("Légende de publication"),
      hashtags: z.array(z.string()).describe("5 à 8 hashtags sans le #"),
      cta: z.string().describe("Appel à l'action final"),
    }),
    run: (input) => ({
      summary: `Script « ${input.title} » écrit`,
      content: JSON.stringify({ status: "livrable_cree" }),
      deliverable: {
        type: "video_script",
        platform: input.platform,
        title: input.title,
        durationSeconds: input.duration_seconds,
        presenter: input.presenter?.trim() ?? "",
        hook: input.hook,
        scenes: input.scenes.map((s) => ({
          visual: s.visual,
          voiceover: s.voiceover,
          onScreenText: s.on_screen_text,
          seconds: s.seconds,
        })),
        caption: input.caption,
        hashtags: input.hashtags.map(stripHash),
        cta: input.cta,
      },
    }),
  }),

  tool({
    name: "create_social_post",
    label: "Rédaction du post",
    description: "Rédige un post pour un réseau social et l'enregistre comme livrable. Un appel par post.",
    schema: z.object({
      platform: z.enum(["Instagram", "Facebook", "TikTok", "Pinterest", "LinkedIn"]),
      format: z.enum(["Image", "Carrousel", "Story", "Reel"]),
      caption: z.string().describe("Légende prête à publier, avec retours à la ligne"),
      hashtags: z.array(z.string()).describe("5 à 10 hashtags sans le #"),
      visual_idea: z.string().describe("Le visuel à produire, décrit concrètement"),
    }),
    run: (input) => ({
      summary: `Post ${input.platform} rédigé`,
      content: JSON.stringify({ status: "livrable_cree" }),
      deliverable: {
        type: "social_post",
        platform: input.platform,
        format: input.format,
        caption: input.caption,
        hashtags: input.hashtags.map(stripHash),
        visualIdea: input.visual_idea,
      },
    }),
  }),

  tool({
    name: "create_content_calendar",
    label: "Construction du calendrier",
    description:
      "Construit un calendrier éditorial (une ligne par publication) et l'enregistre comme livrable. À appeler quand on demande un planning de contenus.",
    schema: z.object({
      title: z.string().describe("Par exemple « Semaine du 17 novembre — Instagram »"),
      entries: z.array(
        z.object({
          day: z.string().describe("Jour, par exemple « Lundi »"),
          platform: z.string(),
          format: z.string().describe("Reel, Carrousel, Story, Image…"),
          topic: z.string().describe("Sujet précis de la publication"),
          goal: z.string().describe("Objectif : notoriété, engagement, vente…"),
        }),
      ),
    }),
    run: (input) => ({
      summary: `Calendrier de ${input.entries.length} publications`,
      content: JSON.stringify({ status: "livrable_cree" }),
      deliverable: { type: "calendar", title: input.title, entries: input.entries },
    }),
  }),
];

function stripHash(tag: string): string {
  return tag.replace(/^#+/, "").trim();
}

const BY_NAME = new Map(SPECS.map((spec) => [spec.name, spec]));

const AGENT_TOOLS: Record<AgentId, string[]> = {
  webmaster: [
    "list_products",
    "get_product",
    "get_store_settings",
    "audit_catalog",
    "propose_product_update",
    "propose_price_rule",
    "propose_discount_code",
    "propose_announcement_bar",
    "create_page",
  ],
  seo: ["list_products", "get_product", "audit_catalog", "audit_page", "propose_product_update", "create_article"],
  email: ["list_products", "get_product", "get_store_settings", "create_email"],
  social: ["list_products", "get_product", "get_store_settings", "create_video_script", "create_social_post", "create_content_calendar"],
};

export function toolLabel(name: string): string {
  return BY_NAME.get(name)?.label ?? name;
}

/** Tool definitions sent to Claude for one agent, in a fixed order (cache-friendly). */
export function toolParamsFor(agentId: AgentId): Anthropic.Beta.BetaTool[] {
  return AGENT_TOOLS[agentId].map((name) => {
    const spec = BY_NAME.get(name)!;
    const { $schema: _ignored, ...schema } = z.toJSONSchema(spec.schema) as Record<string, unknown>;
    return {
      name: spec.name,
      description: spec.description,
      input_schema: schema as Anthropic.Beta.BetaTool["input_schema"],
      // Long inputs (articles, emails) stream as they are written, so the
      // interface can show progress. The API no longer validates them, which
      // is why executeTool() checks every input against the Zod schema.
      eager_input_streaming: true,
    };
  });
}

export interface ToolResult {
  content: string;
  summary: string;
  isError: boolean;
  deliverable?: Deliverable;
}

export async function executeTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
  const spec = BY_NAME.get(name);
  if (!spec || !AGENT_TOOLS[ctx.agentId].includes(name)) {
    return { content: `Outil inconnu : ${name}`, summary: "Outil inconnu", isError: true };
  }
  const parsed = spec.schema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      content: JSON.stringify({
        INVALID_JSON: JSON.stringify(rawInput),
        problems: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      }),
      summary: "Entrée invalide, nouvel essai",
      isError: true,
    };
  }
  let outcome: ToolOutcome;
  try {
    outcome = await spec.run(parsed.data, ctx);
  } catch (error) {
    console.error(`[tool:${name}]`, error);
    return { content: "L'outil a échoué de façon inattendue.", summary: "Échec de l'outil", isError: true };
  }
  return {
    content: outcome.content,
    summary: outcome.summary,
    isError: Boolean(outcome.isError),
    deliverable: outcome.deliverable
      ? ({ ...outcome.deliverable, id: randomUUID().slice(0, 8), agentId: ctx.agentId, createdAt: Date.now() } as Deliverable)
      : undefined,
  };
}
