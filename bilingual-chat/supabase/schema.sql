-- ═══════════════════════════════════════════════════════════════════
--  Chat bilingue — schéma Supabase
--  À coller dans Supabase → SQL Editor → New query → Run.
--  Le script est ré-exécutable sans risque (idempotent).
-- ═══════════════════════════════════════════════════════════════════

-- ─── Tables ─────────────────────────────────────────────────────────

create table if not exists public.rooms (
  id            uuid primary key default gen_random_uuid(),
  created_by    uuid not null references auth.users(id) on delete cascade,
  partner_name  text not null default '',
  invite_token  text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at    timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id       uuid not null references public.rooms(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  display_name  text not null default '',
  my_lang       text not null default 'fr',      -- langue que je parle / lis
  target_lang   text not null default 'ar-EG',   -- langue dans laquelle mes messages sont traduits
  joined_at     timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists room_members_user_idx on public.room_members(user_id);

create table if not exists public.messages (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references public.rooms(id) on delete cascade,
  sender_id      uuid not null references auth.users(id) on delete cascade,
  kind           text not null default 'text' check (kind in ('text', 'audio')),
  original_text  text not null default '',
  source_lang    text not null,
  audio_path     text,
  translations   jsonb not null default '{}'::jsonb,   -- { "ar-EG": "...", "fr": "..." }
  status         text not null default 'ready' check (status in ('processing', 'ready', 'error')),
  error          text,
  created_at     timestamptz not null default now()
);
create index if not exists messages_room_created_idx on public.messages(room_id, created_at desc);

-- ─── Helper : l'utilisateur courant est-il membre du salon ? ─────────
-- SECURITY DEFINER pour éviter la récursion infinie dans les règles RLS.
create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.room_members
    where room_id = p_room_id and user_id = auth.uid()
  );
$$;

-- ─── Row Level Security ─────────────────────────────────────────────

alter table public.rooms        enable row level security;
alter table public.room_members enable row level security;
alter table public.messages     enable row level security;

drop policy if exists "rooms: members can read" on public.rooms;
create policy "rooms: members can read" on public.rooms
  for select to authenticated using (public.is_room_member(id));

drop policy if exists "rooms: creator can delete" on public.rooms;
create policy "rooms: creator can delete" on public.rooms
  for delete to authenticated using (created_by = auth.uid());

drop policy if exists "members: members can read" on public.room_members;
create policy "members: members can read" on public.room_members
  for select to authenticated using (public.is_room_member(room_id));

drop policy if exists "members: update own settings" on public.room_members;
create policy "members: update own settings" on public.room_members
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "messages: members can read" on public.messages;
create policy "messages: members can read" on public.messages
  for select to authenticated using (public.is_room_member(room_id));

drop policy if exists "messages: members can send" on public.messages;
create policy "messages: members can send" on public.messages
  for insert to authenticated
  with check (sender_id = auth.uid() and public.is_room_member(room_id));

drop policy if exists "messages: sender can update" on public.messages;
create policy "messages: sender can update" on public.messages
  for update to authenticated
  using (sender_id = auth.uid()) with check (sender_id = auth.uid());

-- ─── Fonctions métier (RPC) ─────────────────────────────────────────

-- Créer un salon + s'y ajouter comme premier membre.
create or replace function public.create_room(
  p_partner_name text, p_my_lang text, p_target_lang text, p_display_name text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_room uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  insert into rooms (created_by, partner_name)
  values (auth.uid(), left(coalesce(trim(p_partner_name), ''), 60))
  returning id into v_room;

  insert into room_members (room_id, user_id, display_name, my_lang, target_lang)
  values (v_room, auth.uid(), left(coalesce(p_display_name, ''), 60), p_my_lang, p_target_lang);

  return v_room;
end $$;

-- Rejoindre un salon grâce au lien d'invitation.
-- Les langues de l'invité sont pré-réglées en miroir de celles du créateur.
create or replace function public.join_room(p_token text, p_display_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_room  rooms;
  v_owner room_members;
  v_count int;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into v_room from rooms where invite_token = p_token;
  if not found then raise exception 'invalid_invite'; end if;

  if exists (select 1 from room_members where room_id = v_room.id and user_id = auth.uid()) then
    return v_room.id;
  end if;

  -- Conversation à 2 personnes (augmentez la limite pour des groupes).
  select count(*) into v_count from room_members where room_id = v_room.id;
  if v_count >= 2 then raise exception 'room_full'; end if;

  select * into v_owner from room_members
  where room_id = v_room.id and user_id = v_room.created_by;

  insert into room_members (room_id, user_id, display_name, my_lang, target_lang)
  values (
    v_room.id, auth.uid(), left(coalesce(p_display_name, ''), 60),
    coalesce(v_owner.target_lang, 'fr'), coalesce(v_owner.my_lang, 'fr')
  );

  return v_room.id;
end $$;

-- Infos publiques d'une invitation (affichées AVANT la connexion).
create or replace function public.get_invite_info(p_token text)
returns table (inviter_name text, inviter_lang text, guest_lang text)
language sql stable security definer set search_path = public
as $$
  select m.display_name, m.my_lang, m.target_lang
  from rooms r
  join room_members m on m.room_id = r.id and m.user_id = r.created_by
  where r.invite_token = p_token;
$$;

-- Ajouter une traduction à un message (fusion JSON atomique, sans écraser les autres langues).
create or replace function public.add_translation(p_message_id uuid, p_lang text, p_text text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update messages
     set translations = translations || jsonb_build_object(p_lang, p_text)
   where id = p_message_id and public.is_room_member(room_id);
  if not found then raise exception 'forbidden'; end if;
end $$;

revoke execute on function public.create_room(text, text, text, text) from public, anon;
revoke execute on function public.join_room(text, text)               from public, anon;
revoke execute on function public.add_translation(uuid, text, text)  from public, anon;
grant  execute on function public.create_room(text, text, text, text) to authenticated;
grant  execute on function public.join_room(text, text)               to authenticated;
grant  execute on function public.add_translation(uuid, text, text)  to authenticated;
grant  execute on function public.get_invite_info(text)              to anon, authenticated;

-- ─── Temps réel ─────────────────────────────────────────────────────

do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.room_members;
exception when duplicate_object then null; end $$;

-- ─── Stockage des messages vocaux (bucket privé) ────────────────────
-- Chemin des fichiers : <room_id>/<fichier>. Seuls les membres du salon y ont accès.

insert into storage.buckets (id, name, public, file_size_limit)
values ('voice-messages', 'voice-messages', false, 10485760)
on conflict (id) do nothing;

drop policy if exists "voice: members can read" on storage.objects;
create policy "voice: members can read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'voice-messages'
    and public.is_room_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "voice: members can upload" on storage.objects;
create policy "voice: members can upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'voice-messages'
    and public.is_room_member(((storage.foldername(name))[1])::uuid)
  );

-- ═══════════════════════════════════════════════════════════════════
--  ABONNEMENTS (Stripe) — un seul abonné suffit pour toute la conversation
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.subscriptions (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id      text unique,
  stripe_subscription_id  text,
  status                  text not null default 'inactive',  -- statut Stripe : active, trialing, past_due, canceled…
  price_id                text,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean not null default false,
  updated_at              timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

-- Chacun ne voit que son propre abonnement. Les écritures passent uniquement
-- par le webhook Stripe (clé service_role, qui contourne RLS).
drop policy if exists "subscriptions: read own" on public.subscriptions;
create policy "subscriptions: read own" on public.subscriptions
  for select to authenticated using (user_id = auth.uid());

create or replace function public.has_active_subscription(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from subscriptions
    where user_id = p_user_id
      and status in ('active', 'trialing')
      and (current_period_end is null or current_period_end > now())
  );
$$;
revoke execute on function public.has_active_subscription(uuid) from public, anon, authenticated;

-- État de facturation d'un salon : premium si AU MOINS UN membre est abonné.
create or replace function public.room_billing(p_room_id uuid)
returns table (premium boolean, sponsor_name text, message_count int)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_room_member(p_room_id) then raise exception 'forbidden'; end if;

  return query
  select
    exists (select 1 from room_members m where m.room_id = p_room_id and public.has_active_subscription(m.user_id)),
    (select m.display_name from room_members m
       where m.room_id = p_room_id and public.has_active_subscription(m.user_id)
       order by (m.user_id = auth.uid()) desc limit 1),
    (select count(*)::int from messages where room_id = p_room_id);
end $$;
revoke execute on function public.room_billing(uuid) from public, anon;
grant  execute on function public.room_billing(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════
--  NOTIFICATIONS PUSH (application mobile / PWA)
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push: manage own" on public.push_subscriptions;
create policy "push: manage own" on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════
--  DÉTECTION DE LANGUE : langue réellement utilisée dans le message
--  (peut différer de la langue du profil ; sert à éviter les traductions inutiles)
-- ═══════════════════════════════════════════════════════════════════
alter table public.messages add column if not exists detected_lang text;
