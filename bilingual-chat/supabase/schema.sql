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

-- Les clients d'hôtel se connectent en "invité" (session anonyme Supabase, sans e-mail).
create or replace function public.is_anonymous()
returns boolean
language sql stable
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
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
  if public.is_anonymous() then raise exception 'anonymous_not_allowed'; end if;

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

-- État de facturation d'un salon : premium si AU MOINS UN participant est abonné
-- (un membre de la conversation, ou un membre de l'équipe de l'hôtel pour une conversation d'hôtel).
-- Pour un hôtel, le quota gratuit se compte sur l'ensemble de l'hôtel, pas par client.
drop function if exists public.room_billing(uuid);
create or replace function public.room_billing(p_room_id uuid)
returns table (premium boolean, sponsor_name text, message_count int, is_hotel boolean)
language plpgsql stable security definer set search_path = public
as $$
declare v_hotel uuid;
begin
  if not public.is_room_member(p_room_id) then raise exception 'forbidden'; end if;
  select hotel_id into v_hotel from rooms where id = p_room_id;

  return query
  with payers as (
    select m.user_id, m.display_name from room_members m where m.room_id = p_room_id
    union all
    select s.user_id, s.display_name from hotel_staff s where v_hotel is not null and s.hotel_id = v_hotel
  )
  select
    exists (select 1 from payers p where public.has_active_subscription(p.user_id)),
    (select p.display_name from payers p where public.has_active_subscription(p.user_id)
       order by (p.user_id = auth.uid()) desc limit 1),
    case when v_hotel is null
      then (select count(*)::int from messages where room_id = p_room_id and not is_ai)
      else (select count(*)::int from messages ms join rooms r on r.id = ms.room_id where r.hotel_id = v_hotel and not ms.is_ai)
    end,
    v_hotel is not null;
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
alter table public.messages add column if not exists is_ai boolean not null default false;  -- réponse de l'assistant IA

-- ═══════════════════════════════════════════════════════════════════
--  MODE HÔTEL : QR code à l'accueil / dans les chambres
--  Le client scanne, écrit dans sa langue (sans créer de compte) ;
--  TOUTE l'équipe de réception reçoit le message traduit.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.hotels (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  owner_id            uuid not null references auth.users(id) on delete cascade,
  default_lang        text not null default 'fr',   -- langue de la réception
  desk_token          text not null unique default replace(gen_random_uuid()::text, '-', ''),  -- QR de l'accueil
  staff_invite_token  text not null unique default replace(gen_random_uuid()::text, '-', ''),  -- lien pour ajouter un réceptionniste
  created_at          timestamptz not null default now()
);

create table if not exists public.hotel_staff (
  hotel_id      uuid not null references public.hotels(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null default 'staff' check (role in ('owner', 'staff')),
  display_name  text not null default '',
  my_lang       text not null default 'fr',
  joined_at     timestamptz not null default now(),
  primary key (hotel_id, user_id)
);
create index if not exists hotel_staff_user_idx on public.hotel_staff(user_id);

create table if not exists public.hotel_rooms (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  label       text not null,                         -- "204", "Suite Royale"…
  token       text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at  timestamptz not null default now(),
  unique (hotel_id, label)
);

alter table public.rooms add column if not exists hotel_id uuid references public.hotels(id) on delete cascade;
alter table public.rooms add column if not exists room_label text;
create index if not exists rooms_hotel_idx on public.rooms(hotel_id);

create or replace function public.is_hotel_staff(p_hotel_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from hotel_staff where hotel_id = p_hotel_id and user_id = auth.uid()); $$;

create or replace function public.is_hotel_owner(p_hotel_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from hotel_staff where hotel_id = p_hotel_id and user_id = auth.uid() and role = 'owner'); $$;

-- Accès à une conversation : ses membres + toute l'équipe de l'hôtel concerné.
-- (Redéfinition : toutes les règles RLS existantes en profitent automatiquement.)
create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from room_members where room_id = p_room_id and user_id = auth.uid())
      or exists (
        select 1 from rooms r join hotel_staff s on s.hotel_id = r.hotel_id
        where r.id = p_room_id and s.user_id = auth.uid()
      );
$$;

alter table public.hotels      enable row level security;
alter table public.hotel_staff enable row level security;
alter table public.hotel_rooms enable row level security;

drop policy if exists "hotels: staff can read" on public.hotels;
create policy "hotels: staff can read" on public.hotels
  for select to authenticated using (public.is_hotel_staff(id));

drop policy if exists "hotels: owner can update" on public.hotels;
create policy "hotels: owner can update" on public.hotels
  for update to authenticated using (public.is_hotel_owner(id)) with check (public.is_hotel_owner(id));

drop policy if exists "hotel_staff: team can read" on public.hotel_staff;
create policy "hotel_staff: team can read" on public.hotel_staff
  for select to authenticated using (public.is_hotel_staff(hotel_id));

drop policy if exists "hotel_staff: update own profile" on public.hotel_staff;
create policy "hotel_staff: update own profile" on public.hotel_staff
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "hotel_staff: owner removes staff" on public.hotel_staff;
create policy "hotel_staff: owner removes staff" on public.hotel_staff
  for delete to authenticated using (public.is_hotel_owner(hotel_id) and user_id <> auth.uid());

-- On ne peut modifier QUE son prénom et sa langue (pas son rôle, ni l'hôtel).
revoke update on public.hotel_staff from authenticated, anon;
grant  update (display_name, my_lang) on public.hotel_staff to authenticated;
revoke update (name, owner_id, desk_token, staff_invite_token) on public.hotels from authenticated, anon;
revoke update on public.hotels from authenticated, anon;
grant  update (name, default_lang) on public.hotels to authenticated;

drop policy if exists "hotel_rooms: staff can read" on public.hotel_rooms;
create policy "hotel_rooms: staff can read" on public.hotel_rooms
  for select to authenticated using (public.is_hotel_staff(hotel_id));

drop policy if exists "hotel_rooms: owner manages" on public.hotel_rooms;
create policy "hotel_rooms: owner manages" on public.hotel_rooms
  for insert to authenticated with check (public.is_hotel_owner(hotel_id));

drop policy if exists "hotel_rooms: owner deletes" on public.hotel_rooms;
create policy "hotel_rooms: owner deletes" on public.hotel_rooms
  for delete to authenticated using (public.is_hotel_owner(hotel_id));

-- Créer son hôtel (le créateur devient "owner" de l'équipe).
create or replace function public.create_hotel(p_name text, p_lang text, p_display_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_hotel uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if public.is_anonymous() then raise exception 'anonymous_not_allowed'; end if;
  insert into hotels (name, owner_id, default_lang)
  values (left(trim(p_name), 80), auth.uid(), p_lang)
  returning id into v_hotel;
  insert into hotel_staff (hotel_id, user_id, role, display_name, my_lang)
  values (v_hotel, auth.uid(), 'owner', left(coalesce(p_display_name, ''), 60), p_lang);
  return v_hotel;
end $$;

-- Rejoindre l'équipe d'un hôtel avec le lien d'invitation "personnel".
create or replace function public.join_hotel_staff(p_token text, p_display_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_hotel hotels;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if public.is_anonymous() then raise exception 'anonymous_not_allowed'; end if;
  select * into v_hotel from hotels where staff_invite_token = p_token;
  if not found then raise exception 'invalid_invite'; end if;
  insert into hotel_staff (hotel_id, user_id, role, display_name, my_lang)
  values (v_hotel.id, auth.uid(), 'staff', left(coalesce(p_display_name, ''), 60), v_hotel.default_lang)
  on conflict (hotel_id, user_id) do nothing;
  return v_hotel.id;
end $$;

-- Infos publiques derrière un QR code (accueil ou chambre), affichées AVANT toute connexion.
create or replace function public.get_hotel_entry(p_token text)
returns table (hotel_name text, room_label text, hotel_lang text, is_staff boolean)
language sql stable security definer set search_path = public
as $$
  select h.name, null::text, h.default_lang, public.is_hotel_staff(h.id) from hotels h where h.desk_token = p_token
  union all
  select h.name, r.label, h.default_lang, public.is_hotel_staff(h.id)
  from hotel_rooms r join hotels h on h.id = r.hotel_id where r.token = p_token
  limit 1;
$$;

-- Infos publiques d'un lien d'invitation "personnel".
create or replace function public.get_staff_invite(p_token text)
returns table (hotel_name text)
language sql stable security definer set search_path = public
as $$ select name from hotels where staff_invite_token = p_token; $$;

-- Le client scanne le QR → ouvre (ou retrouve) SA conversation avec la réception.
create or replace function public.start_hotel_conversation(p_token text, p_name text, p_lang text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_hotel hotels;
  v_label text;
  v_room  uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;

  select * into v_hotel from hotels where desk_token = p_token;
  if not found then
    -- Pas le QR de l'accueil : peut-être celui d'une chambre.
    select r.label into v_label from hotel_rooms r where r.token = p_token;
    select h.* into v_hotel from hotels h join hotel_rooms r on r.hotel_id = h.id where r.token = p_token;
    if not found then raise exception 'invalid_qr'; end if;
  end if;

  if public.is_hotel_staff(v_hotel.id) then raise exception 'is_staff'; end if;

  -- Le même client qui rescanne retrouve sa conversation.
  select id into v_room from rooms
  where hotel_id = v_hotel.id and created_by = auth.uid() and room_label is not distinct from v_label
  order by created_at desc limit 1;

  if v_room is null then
    insert into rooms (created_by, partner_name, hotel_id, room_label)
    values (auth.uid(), v_hotel.name, v_hotel.id, v_label)
    returning id into v_room;
    insert into room_members (room_id, user_id, display_name, my_lang, target_lang)
    values (v_room, auth.uid(), left(coalesce(nullif(trim(p_name), ''), ''), 60), left(p_lang, 10), v_hotel.default_lang);
  else
    update room_members set my_lang = left(p_lang, 10),
      display_name = coalesce(nullif(left(trim(p_name), 60), ''), display_name)
    where room_id = v_room and user_id = auth.uid();
  end if;

  return v_room;
end $$;

-- Participants d'une conversation : membres + équipe de l'hôtel.
-- Pour un réceptionniste, la "langue de traduction" est automatiquement celle du client.
create or replace function public.room_participants(p_room_id uuid)
returns table (user_id uuid, display_name text, my_lang text, target_lang text, role text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_room_member(p_room_id) then raise exception 'forbidden'; end if;
  return query
  select m.user_id, m.display_name, m.my_lang, m.target_lang, 'member'::text
  from room_members m where m.room_id = p_room_id
  union all
  select s.user_id, s.display_name, s.my_lang,
         coalesce((select g.my_lang from room_members g where g.room_id = p_room_id and g.user_id = r.created_by), s.my_lang),
         'staff'::text
  from rooms r join hotel_staff s on s.hotel_id = r.hotel_id
  where r.id = p_room_id
    and not exists (select 1 from room_members x where x.room_id = p_room_id and x.user_id = s.user_id);
end $$;

-- Contexte "hôtel" d'une conversation (nom de l'hôtel, chambre, suis-je de l'équipe ?).
create or replace function public.room_hotel(p_room_id uuid)
returns table (hotel_id uuid, hotel_name text, room_label text, is_staff boolean)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_room_member(p_room_id) then raise exception 'forbidden'; end if;
  return query
  select h.id, h.name, r.room_label, public.is_hotel_staff(h.id)
  from rooms r join hotels h on h.id = r.hotel_id where r.id = p_room_id;
end $$;

revoke execute on function public.create_hotel(text, text, text)               from public, anon;
revoke execute on function public.join_hotel_staff(text, text)                 from public, anon;
revoke execute on function public.start_hotel_conversation(text, text, text)   from public, anon;
revoke execute on function public.room_participants(uuid)                      from public, anon;
revoke execute on function public.room_hotel(uuid)                             from public, anon;
grant  execute on function public.create_hotel(text, text, text)               to authenticated;
grant  execute on function public.join_hotel_staff(text, text)                 to authenticated;
grant  execute on function public.start_hotel_conversation(text, text, text)   to authenticated;
grant  execute on function public.room_participants(uuid)                      to authenticated;
grant  execute on function public.room_hotel(uuid)                             to authenticated;
grant  execute on function public.get_hotel_entry(text)                        to anon, authenticated;
grant  execute on function public.get_staff_invite(text)                       to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════
--  ASSISTANT IA : répond seul aux questions dont la réponse est dans
--  la fiche "Infos pratiques" de l'hôtel ; transmet le reste à la réception.
-- ═══════════════════════════════════════════════════════════════════
alter table public.hotels add column if not exists assistant_enabled boolean not null default false;
alter table public.hotels add column if not exists assistant_info    text    not null default '';
grant update (name, default_lang, assistant_enabled, assistant_info) on public.hotels to authenticated;

-- Personne ne peut se faire passer pour l'assistant (seul le serveur écrit is_ai = true).
drop policy if exists "messages: members can send" on public.messages;
create policy "messages: members can send" on public.messages
  for insert to authenticated
  with check (sender_id = auth.uid() and public.is_room_member(room_id) and is_ai = false);

-- L'expéditeur ne peut modifier que ces colonnes de son message (pas is_ai, pas la conversation).
revoke update on public.messages from authenticated, anon;
grant  update (original_text, detected_lang, status, error) on public.messages to authenticated;

-- ═══════════════════════════════════════════════════════════════════
--  ESPACE PARTENAIRE (apporteurs d'affaires)
--  Le partenaire inscrit un hôtel → lien/QR d'invitation → le gérant crée
--  son espace → l'hôtel est relié au partenaire. Chaque facture payée par
--  l'hôtel crée une commission ; un versement mensuel les paie (Stripe Connect).
-- ═══════════════════════════════════════════════════════════════════
create table if not exists public.partners (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  display_name        text not null default '',
  phone               text not null default '',
  commission_percent  numeric(5,2) not null default 20 check (commission_percent between 0 and 100),
  stripe_account_id   text unique,            -- compte Stripe Connect (le RIB est chez Stripe, jamais chez nous)
  payouts_enabled     boolean not null default false,
  bank_label          text,                   -- ex. "···· 1234", pour l'affichage
  created_at          timestamptz not null default now()
);

alter table public.hotels add column if not exists partner_id uuid references public.partners(user_id) on delete set null;
create index if not exists hotels_partner_idx on public.hotels(partner_id);

create table if not exists public.hotel_invites (
  id             uuid primary key default gen_random_uuid(),
  partner_id     uuid not null references public.partners(user_id) on delete cascade,
  token          text not null unique default replace(gen_random_uuid()::text, '-', ''),
  hotel_name     text not null,
  contact_name   text not null default '',
  contact_phone  text not null default '',
  hotel_id       uuid references public.hotels(id) on delete set null,
  created_at     timestamptz not null default now(),
  claimed_at     timestamptz
);
create index if not exists hotel_invites_partner_idx on public.hotel_invites(partner_id);

create table if not exists public.partner_payouts (
  id                  uuid primary key default gen_random_uuid(),
  partner_id          uuid not null references public.partners(user_id) on delete cascade,
  amount              integer not null,        -- en centimes
  currency            text not null default 'eur',
  stripe_transfer_id  text,
  status              text not null default 'paid' check (status in ('paid', 'failed')),
  error               text,
  created_at          timestamptz not null default now()
);

create table if not exists public.partner_commissions (
  id                 uuid primary key default gen_random_uuid(),
  partner_id         uuid not null references public.partners(user_id) on delete cascade,
  hotel_id           uuid references public.hotels(id) on delete set null,
  hotel_name         text not null default '',
  stripe_invoice_id  text not null unique,     -- une commission par facture payée (idempotent)
  invoice_amount     integer not null,         -- montant HT payé par l'hôtel, en centimes
  percent            numeric(5,2) not null,
  amount             integer not null,         -- commission, en centimes
  currency           text not null default 'eur',
  status             text not null default 'pending' check (status in ('pending', 'paid', 'canceled')),
  payout_id          uuid references public.partner_payouts(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists partner_commissions_partner_idx on public.partner_commissions(partner_id, status);

-- Montant du forfait, pour afficher "99 € / mois" (prêt pour plusieurs forfaits).
alter table public.subscriptions add column if not exists plan_amount   integer;
alter table public.subscriptions add column if not exists plan_currency text;
alter table public.subscriptions add column if not exists plan_interval text;

alter table public.partners            enable row level security;
alter table public.hotel_invites       enable row level security;
alter table public.partner_commissions enable row level security;
alter table public.partner_payouts     enable row level security;

drop policy if exists "partners: read own" on public.partners;
create policy "partners: read own" on public.partners
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "partners: update own" on public.partners;
create policy "partners: update own" on public.partners
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Le partenaire ne change que son nom et son téléphone (pas son taux, pas son compte bancaire).
revoke insert, update, delete on public.partners from authenticated, anon;
grant  update (display_name, phone) on public.partners to authenticated;

drop policy if exists "hotel_invites: partner reads own" on public.hotel_invites;
create policy "hotel_invites: partner reads own" on public.hotel_invites
  for select to authenticated using (partner_id = auth.uid());
drop policy if exists "hotel_invites: partner creates" on public.hotel_invites;
create policy "hotel_invites: partner creates" on public.hotel_invites
  for insert to authenticated
  with check (partner_id = auth.uid() and hotel_id is null and claimed_at is null
              and exists (select 1 from public.partners where user_id = auth.uid()));
drop policy if exists "hotel_invites: partner deletes unused" on public.hotel_invites;
create policy "hotel_invites: partner deletes unused" on public.hotel_invites
  for delete to authenticated using (partner_id = auth.uid() and claimed_at is null);
revoke update on public.hotel_invites from authenticated, anon;

drop policy if exists "partner_commissions: read own" on public.partner_commissions;
create policy "partner_commissions: read own" on public.partner_commissions
  for select to authenticated using (partner_id = auth.uid());
drop policy if exists "partner_payouts: read own" on public.partner_payouts;
create policy "partner_payouts: read own" on public.partner_payouts
  for select to authenticated using (partner_id = auth.uid());
revoke insert, update, delete on public.partner_commissions, public.partner_payouts from authenticated, anon;

-- Devenir partenaire (compte e-mail obligatoire, pas une session invité).
create or replace function public.become_partner(p_display_name text, p_phone text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if public.is_anonymous() then raise exception 'anonymous_not_allowed'; end if;
  insert into partners (user_id, display_name, phone)
  values (auth.uid(), left(trim(coalesce(p_display_name, '')), 60), left(trim(coalesce(p_phone, '')), 30))
  on conflict (user_id) do update set display_name = excluded.display_name, phone = excluded.phone;
end $$;

-- Les hôtels du partenaire avec leur statut (le partenaire ne voit pas les conversations).
create or replace function public.partner_hotels()
returns table (
  invite_id uuid, token text, hotel_name text, contact_name text, contact_phone text,
  invited_at timestamptz, claimed_at timestamptz, hotel_id uuid,
  sub_status text, plan_amount integer, plan_currency text, plan_interval text, current_period_end timestamptz
)
language sql stable security definer set search_path = public
as $$
  select i.id, i.token, coalesce(h.name, i.hotel_name), i.contact_name, i.contact_phone,
         i.created_at, i.claimed_at, h.id,
         s.status, s.plan_amount, s.plan_currency, s.plan_interval, s.current_period_end
  from hotel_invites i
  left join hotels h on h.id = i.hotel_id
  left join subscriptions s on s.user_id = h.owner_id
  where i.partner_id = auth.uid()
  order by i.created_at desc;
$$;

-- Infos publiques d'une invitation (page vue par le gérant, avant connexion).
create or replace function public.get_hotel_invite(p_token text)
returns table (hotel_name text, partner_name text, claimed boolean, is_partner boolean)
language sql stable security definer set search_path = public
as $$
  select i.hotel_name, p.display_name, i.claimed_at is not null, i.partner_id = auth.uid()
  from hotel_invites i join partners p on p.user_id = i.partner_id
  where i.token = p_token;
$$;

-- Le gérant accepte l'invitation : crée son hôtel relié au partenaire
-- (ou relie l'hôtel qu'il a déjà, s'il n'a pas encore de partenaire).
create or replace function public.claim_hotel_invite(p_token text, p_name text, p_lang text, p_display_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_inv   hotel_invites;
  v_hotel uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if public.is_anonymous() then raise exception 'anonymous_not_allowed'; end if;

  select * into v_inv from hotel_invites where token = p_token for update;
  if not found then raise exception 'invalid_invite'; end if;
  if v_inv.partner_id = auth.uid() then raise exception 'own_invite'; end if;
  if v_inv.claimed_at is not null then
    if exists (select 1 from hotels where id = v_inv.hotel_id and owner_id = auth.uid()) then
      return v_inv.hotel_id;
    end if;
    raise exception 'already_claimed';
  end if;

  select id into v_hotel from hotels where owner_id = auth.uid() order by created_at limit 1;
  if v_hotel is not null then
    update hotels set partner_id = v_inv.partner_id where id = v_hotel and partner_id is null;
    if not found then raise exception 'hotel_has_partner'; end if;
  else
    insert into hotels (name, owner_id, default_lang, partner_id)
    values (left(coalesce(nullif(trim(p_name), ''), v_inv.hotel_name), 80), auth.uid(), left(p_lang, 10), v_inv.partner_id)
    returning id into v_hotel;
    insert into hotel_staff (hotel_id, user_id, role, display_name, my_lang)
    values (v_hotel, auth.uid(), 'owner', left(coalesce(p_display_name, ''), 60), left(p_lang, 10));
  end if;

  update hotel_invites set hotel_id = v_hotel, claimed_at = now() where id = v_inv.id;
  return v_hotel;
end $$;

revoke execute on function public.claim_hotel_invite(text, text, text, text) from public, anon;
revoke execute on function public.become_partner(text, text) from public, anon;
revoke execute on function public.partner_hotels() from public, anon;
grant  execute on function public.claim_hotel_invite(text, text, text, text) to authenticated;
grant  execute on function public.become_partner(text, text) to authenticated;
grant  execute on function public.partner_hotels() to authenticated;
