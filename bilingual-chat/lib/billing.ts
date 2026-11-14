import type { SupabaseClient } from "@supabase/supabase-js";

/** Le paiement n'est actif que si Stripe est configuré (sinon tout est gratuit, pratique en dev). */
export const BILLING_ENABLED = Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);

/** Nombre de messages offerts par conversation avant de devoir s'abonner. */
export const FREE_MESSAGES_PER_ROOM = Math.max(0, Number(process.env.FREE_MESSAGES_PER_ROOM ?? 20) || 0);

/** Messages offerts à un hôtel (toutes conversations confondues) avant de devoir s'abonner. */
export const FREE_MESSAGES_PER_HOTEL = Math.max(0, Number(process.env.FREE_MESSAGES_PER_HOTEL ?? 200) || 0);

export type RoomBilling = {
  /** Conversation d'hôtel : le quota et l'abonnement sont ceux de l'hôtel */
  hotel: boolean;
  enabled: boolean;
  /** Au moins un des participants est abonné */
  premium: boolean;
  /** Prénom de l'abonné qui "offre" la conversation */
  sponsorName: string | null;
  used: number;
  limit: number;
  canSend: boolean;
};

export async function getRoomBilling(db: SupabaseClient, roomId: string): Promise<RoomBilling> {
  if (!BILLING_ENABLED) {
    return { enabled: false, hotel: false, premium: true, sponsorName: null, used: 0, limit: FREE_MESSAGES_PER_ROOM, canSend: true };
  }
  const { data, error } = await db.rpc("room_billing", { p_room_id: roomId });
  if (error) throw error;
  const row = (data as { premium: boolean; sponsor_name: string | null; message_count: number; is_hotel: boolean }[])[0];
  const premium = Boolean(row?.premium);
  const used = row?.message_count ?? 0;
  const hotel = Boolean(row?.is_hotel);
  const limit = hotel ? FREE_MESSAGES_PER_HOTEL : FREE_MESSAGES_PER_ROOM;
  return {
    enabled: true,
    hotel,
    premium,
    sponsorName: row?.sponsor_name ?? null,
    used,
    limit,
    canSend: premium || used < limit,
  };
}

/** État après l'envoi d'un message (évite une requête supplémentaire). */
export function afterSend(b: RoomBilling): RoomBilling {
  const used = b.used + 1;
  return { ...b, used, canSend: b.premium || used < b.limit };
}

export const ACTIVE_STATUSES = ["active", "trialing"];
