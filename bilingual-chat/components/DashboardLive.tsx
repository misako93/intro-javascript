"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { playChime } from "@/lib/sound";

/**
 * Tableau de bord "en direct" pour la réception : dès qu'un client ouvre une conversation
 * ou envoie un message, la liste se met à jour et un carillon retentit.
 * (Les règles RLS garantissent qu'on ne reçoit que les événements de ses propres conversations.)
 */
export default function DashboardLive({ userId }: { userId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 400);
    };
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      channel = supabase
        .channel(`dashboard:${userId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
          if ((payload.new as { sender_id: string }).sender_id !== userId) playChime("message");
          refresh();
        })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "room_members" }, (payload) => {
          if ((payload.new as { user_id: string }).user_id !== userId) playChime("join");
          refresh();
        })
        .subscribe();
    })();

    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (timer.current) clearTimeout(timer.current);
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [router, userId]);

  return null;
}
