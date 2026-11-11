// Types shared by the server (agents, tools) and the client (UI state).

export const AGENT_IDS = ["webmaster", "seo", "email", "social"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export interface Product {
  id: string;
  handle: string;
  title: string;
  category: string;
  price: number;
  description: string;
  tags: string[];
  seoTitle: string;
  seoDescription: string;
  imageAlt: string;
  emoji: string;
  /** Former price shown struck through next to the current one. */
  compareAtPrice?: number | null;
  /** Set once an approved AI proposal has been applied to this product. */
  updatedByAi?: boolean;
}

export interface Discount {
  id: string;
  code: string;
  kind: "percentage" | "fixed_amount" | "free_shipping";
  /** Percent or euros, depending on the kind. 0 for free shipping. */
  value: number;
  /** Human-readable scope, e.g. « Toute la boutique » or « Catégorie Huiles ». */
  appliesTo: string;
  /** Minimum basket in euros. 0 means none. */
  minimumPurchase: number;
  /** ISO date (YYYY-MM-DD). Empty means no end date. */
  endsOn: string;
  oncePerCustomer: boolean;
}

export interface AnnouncementBar {
  messages: string[];
  link: string;
  scrolling: boolean;
}

export interface StoreState {
  name: string;
  url: string;
  tagline: string;
  products: Product[];
  discounts: Discount[];
  announcement: AnnouncementBar | null;
}

export type ProductField =
  | "title"
  | "description"
  | "tags"
  | "seoTitle"
  | "seoDescription"
  | "imageAlt";

export const PRODUCT_FIELD_LABELS: Record<ProductField, string> = {
  title: "Titre",
  description: "Description",
  tags: "Tags",
  seoTitle: "Titre SEO (balise title)",
  seoDescription: "Meta description",
  imageAlt: "Texte alternatif de l'image",
};

interface DeliverableBase {
  id: string;
  agentId: AgentId;
  createdAt: number;
}

export type ChangeStatus = "pending" | "approved" | "rejected";

export interface ProductUpdateDeliverable extends DeliverableBase {
  type: "product_update";
  productId: string;
  productTitle: string;
  reason: string;
  changes: { field: ProductField; before: string; after: string }[];
  status: ChangeStatus;
}

export interface PriceUpdateDeliverable extends DeliverableBase {
  type: "price_update";
  label: string;
  reason: string;
  changes: { productId: string; productTitle: string; before: number; after: number; compareAtAfter: number | null }[];
  status: ChangeStatus;
}

export interface DiscountDeliverable extends DeliverableBase {
  type: "discount";
  reason: string;
  discount: Omit<Discount, "id">;
  status: ChangeStatus;
}

export interface AnnouncementDeliverable extends DeliverableBase {
  type: "announcement";
  reason: string;
  bar: AnnouncementBar;
  status: ChangeStatus;
}

export interface PageDeliverable extends DeliverableBase {
  type: "page";
  title: string;
  slug: string;
  metaTitle: string;
  metaDescription: string;
  markdown: string;
}

export interface ArticleDeliverable extends DeliverableBase {
  type: "article";
  title: string;
  slug: string;
  keyword: string;
  metaTitle: string;
  metaDescription: string;
  markdown: string;
}

export type CheckStatus = "ok" | "warn" | "error";

export interface AuditCheck {
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface SeoAuditDeliverable extends DeliverableBase {
  type: "seo_audit";
  scope: "catalog" | "page";
  target: string;
  score: number;
  /** Page audit: one line per check. Catalog audit: empty. */
  checks: AuditCheck[];
  /** Catalog audit: one row per product. Page audit: empty. */
  rows: { productId: string; title: string; score: number; issues: AuditCheck[] }[];
}

export interface EmailDeliverable extends DeliverableBase {
  type: "email";
  name: string;
  sequence: string;
  sendTiming: string;
  subject: string;
  preheader: string;
  headline: string;
  paragraphs: string[];
  ctaLabel: string;
  ctaUrl: string;
  ps: string;
  products: { title: string; price: number; emoji: string }[];
}

export interface SocialPostDeliverable extends DeliverableBase {
  type: "social_post";
  platform: string;
  format: string;
  caption: string;
  hashtags: string[];
  visualIdea: string;
}

export interface VideoScriptDeliverable extends DeliverableBase {
  type: "video_script";
  platform: string;
  title: string;
  durationSeconds: number;
  /** Brief of the AI-generated presenter. Empty for a product-only video. */
  presenter: string;
  hook: string;
  scenes: { visual: string; voiceover: string; onScreenText: string; seconds: number }[];
  caption: string;
  hashtags: string[];
  cta: string;
}

export interface CalendarDeliverable extends DeliverableBase {
  type: "calendar";
  title: string;
  entries: { day: string; platform: string; format: string; topic: string; goal: string }[];
}

export type Deliverable =
  | ProductUpdateDeliverable
  | PriceUpdateDeliverable
  | DiscountDeliverable
  | AnnouncementDeliverable
  | PageDeliverable
  | ArticleDeliverable
  | SeoAuditDeliverable
  | EmailDeliverable
  | SocialPostDeliverable
  | VideoScriptDeliverable
  | CalendarDeliverable;

/** A change to the shop that waits for the owner's approval before it applies. */
export type StoreChange =
  | ProductUpdateDeliverable
  | PriceUpdateDeliverable
  | DiscountDeliverable
  | AnnouncementDeliverable;

export function isStoreChange(d: Deliverable): d is StoreChange {
  return d.type === "product_update" || d.type === "price_update" || d.type === "discount" || d.type === "announcement";
}

export function pendingChanges(deliverables: Deliverable[]): StoreChange[] {
  return deliverables.filter((d): d is StoreChange => isStoreChange(d) && d.status === "pending");
}

/** Distributive Omit, so each member of the union keeps its own fields. */
export type DeliverableDraft = Deliverable extends infer D
  ? D extends Deliverable
    ? Omit<D, "id" | "agentId" | "createdAt">
    : never
  : never;

// ---- Chat protocol (NDJSON stream from /api/chat) -------------------------

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; name: string; label: string }
  | { type: "tool_progress"; id: string; chars: number }
  | { type: "tool_end"; id: string; ok: boolean; summary: string }
  | { type: "deliverable"; deliverable: Deliverable }
  | { type: "done"; demo: boolean }
  | { type: "error"; message: string };

export interface HistoryTurn {
  role: "user" | "assistant";
  text: string;
}

export interface WorkspaceSummary {
  pendingCount: number;
  deliverables: { type: string; title: string; status?: string }[];
}

export interface ChatRequest {
  agentId: AgentId;
  message: string;
  history: HistoryTurn[];
  store: StoreState;
  workspace: WorkspaceSummary;
}

export interface StatusResponse {
  demo: boolean;
  requiresCode: boolean;
  model: string;
}

// ---- Client-side chat state ------------------------------------------------

export type MessagePart =
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      label: string;
      status: "running" | "ok" | "error";
      chars: number;
      summary: string;
    }
  | { kind: "deliverable"; id: string };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  /** Text, tool activity and deliverables, in the order they happened. */
  parts: MessagePart[];
  error?: string;
  streaming?: boolean;
}

export function messageText(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.kind === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

export function deliverableTitle(d: Deliverable): string {
  switch (d.type) {
    case "product_update":
      return `Fiche « ${d.productTitle} »`;
    case "price_update":
      return d.label;
    case "discount":
      return `Code promo ${d.discount.code}`;
    case "announcement":
      return d.bar.scrolling ? "Barre d'annonce défilante" : "Barre d'annonce";
    case "page":
    case "article":
    case "calendar":
    case "video_script":
      return d.title;
    case "seo_audit":
      return d.scope === "catalog" ? "Audit SEO du catalogue" : `Audit SEO — ${d.target}`;
    case "email":
      return d.name;
    case "social_post":
      return `Post ${d.platform} (${d.format})`;
  }
}

export const DELIVERABLE_TYPE_LABELS: Record<Deliverable["type"], string> = {
  product_update: "Modification de fiche",
  price_update: "Modification de prix",
  discount: "Code promo",
  announcement: "Barre d'annonce",
  page: "Page",
  article: "Article de blog",
  seo_audit: "Audit SEO",
  email: "Email",
  social_post: "Post",
  video_script: "Script vidéo",
  calendar: "Calendrier éditorial",
};

export function describeDiscount(d: Omit<Discount, "id">): string {
  const amount =
    d.kind === "percentage"
      ? `-${d.value} %`
      : d.kind === "fixed_amount"
        ? `-${d.value.toLocaleString("fr-FR")} €`
        : "Livraison offerte";
  const parts = [amount, d.appliesTo];
  if (d.minimumPurchase > 0) parts.push(`dès ${d.minimumPurchase.toLocaleString("fr-FR")} € d'achat`);
  if (d.oncePerCustomer) parts.push("une fois par client");
  if (d.endsOn) parts.push(`jusqu'au ${d.endsOn.split("-").reverse().join("/")}`);
  return parts.join(" · ");
}
