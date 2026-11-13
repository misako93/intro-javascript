import { notFound, redirect } from "next/navigation";
import ChatRoom from "@/components/ChatRoom";
import { createClient } from "@/lib/supabase/server";
import { UUID_RE } from "@/lib/utils";
import { getRoomBilling } from "@/lib/billing";
import { PRICE_LABEL } from "@/lib/config";
import type { Member, Message, Room } from "@/lib/types";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/chat/${id}`);

  // Les règles RLS garantissent qu'on ne voit que ses propres salons.
  const [{ data: room }, { data: members }, { data: messages }] = await Promise.all([
    supabase.from("rooms").select("*").eq("id", id).maybeSingle(),
    supabase.from("room_members").select("*").eq("room_id", id),
    supabase.from("messages").select("*").eq("room_id", id).order("created_at", { ascending: false }).limit(100),
  ]);

  if (!room || !members?.some((m) => m.user_id === user.id)) notFound();

  const billing = await getRoomBilling(supabase, id);

  return (
    <ChatRoom
      room={room as Room}
      initialMembers={members as Member[]}
      initialMessages={((messages ?? []) as Message[]).reverse()}
      userId={user.id}
      initialBilling={billing}
      priceLabel={PRICE_LABEL}
    />
  );
}
