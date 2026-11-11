import * as z from "zod";
import { accessCodeMatches, isDemoMode } from "@/lib/server/env";
import { runMockAgent } from "@/lib/server/mock-agent";
import { friendlyError, runAgent } from "@/lib/server/run-agent";
import { AGENT_IDS, type ChatRequest, type StreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// An agent turn with several tool calls can run for a couple of minutes.
export const maxDuration = 300;

const ProductSchema = z.object({
  id: z.string().max(64),
  handle: z.string().max(200),
  title: z.string().max(300),
  category: z.string().max(100),
  price: z.number(),
  description: z.string().max(8000),
  tags: z.array(z.string().max(80)).max(30),
  seoTitle: z.string().max(300),
  seoDescription: z.string().max(600),
  imageAlt: z.string().max(300),
  emoji: z.string().max(16),
  compareAtPrice: z.number().nullable().optional(),
  updatedByAi: z.boolean().optional(),
});

const DiscountSchema = z.object({
  id: z.string().max(64),
  code: z.string().max(40),
  kind: z.enum(["percentage", "fixed_amount", "free_shipping"]),
  value: z.number(),
  appliesTo: z.string().max(200),
  minimumPurchase: z.number(),
  endsOn: z.string().max(20),
  oncePerCustomer: z.boolean(),
});

const ChatSchema = z.object({
  agentId: z.enum(AGENT_IDS),
  message: z.string().trim().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(30000) }))
    .max(40),
  store: z.object({
    name: z.string().max(120),
    url: z.string().max(300),
    tagline: z.string().max(300),
    products: z.array(ProductSchema).max(60),
    discounts: z.array(DiscountSchema).max(50).default([]),
    announcement: z
      .object({ messages: z.array(z.string().max(200)).max(6), link: z.string().max(500), scrolling: z.boolean() })
      .nullable()
      .default(null),
  }),
  workspace: z.object({
    pendingCount: z.number(),
    deliverables: z
      .array(z.object({ type: z.string().max(40), title: z.string().max(300), status: z.string().max(30).optional() }))
      .max(30),
  }),
});

export async function POST(request: Request) {
  if (!accessCodeMatches(request.headers.get("x-access-code"))) {
    return Response.json({ error: "Code d'accès incorrect." }, { status: 401 });
  }

  let payload: ChatRequest;
  try {
    payload = ChatSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Requête invalide." }, { status: 400 });
  }

  const demo = isDemoMode();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: StreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      try {
        if (demo) await runMockAgent({ request: payload, emit, signal: abort.signal });
        else await runAgent({ request: payload, emit, signal: abort.signal });
        emit({ type: "done", demo });
      } catch (error) {
        if (!abort.signal.aborted) {
          console.error("[chat]", error);
          emit({ type: "error", message: friendlyError(error) });
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // The client already went away.
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
