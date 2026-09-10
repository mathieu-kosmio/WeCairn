-- WeRetex : schéma initial
-- Multi-organisation, un profil par utilisateur, retex + votes + commentaires,
-- gamification calculée en vues (aucune table de score à maintenir).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------
-- Organisations et profils
-- ---------------------------------------------------------------
create table public.organisations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  domain      text unique,                 -- ex. "kosm.io" : rattachement automatique par e-mail
  created_at  timestamptz not null default now()
);

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  org_id        uuid not null references public.organisations(id) on delete cascade,
  email         text not null,
  display_name  text not null,
  created_at    timestamptz not null default now()
);
create index profiles_org_idx on public.profiles(org_id);

-- À la création d'un compte : rattachement à l'organisation du domaine e-mail,
-- création de l'organisation si elle n'existe pas encore.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_domain text := lower(split_part(new.email, '@', 2));
  v_org    uuid;
begin
  select id into v_org from public.organisations where domain = v_domain;
  if v_org is null then
    insert into public.organisations(name, domain) values (v_domain, v_domain) returning id into v_org;
  end if;
  insert into public.profiles(id, org_id, email, display_name)
  values (
    new.id, v_org, new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Organisation de l'utilisateur courant (utilisée par toutes les policies)
create or replace function public.my_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from public.profiles where id = auth.uid()
$$;

-- ---------------------------------------------------------------
-- Retex, votes, commentaires
-- ---------------------------------------------------------------
create type public.retex_source as enum ('manual', 'transcript', 'mcp');

create table public.retex (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organisations(id) on delete cascade,
  author_id       uuid not null references public.profiles(id) on delete cascade,
  title           text not null check (char_length(title) between 5 and 140),
  situation       text not null,   -- le contexte : projet, réunion, problème rencontré
  learning        text not null,   -- ce qu'on a appris (le coeur du retex)
  recommendation  text,            -- la bonne pratique à reproduire (ou à éviter)
  tags            text[] not null default '{}',
  source          public.retex_source not null default 'manual',
  source_ref      text,            -- ex. titre + date de la réunion d'origine
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index retex_org_created_idx on public.retex(org_id, created_at desc);
create index retex_tags_idx on public.retex using gin(tags);
create index retex_search_idx on public.retex using gin(
  to_tsvector('french', coalesce(title,'') || ' ' || coalesce(situation,'') || ' ' || coalesce(learning,'') || ' ' || coalesce(recommendation,''))
);

create table public.votes (
  retex_id    uuid not null references public.retex(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (retex_id, user_id)
);

create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  retex_id    uuid not null references public.retex(id) on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index comments_retex_idx on public.comments(retex_id, created_at);

-- ---------------------------------------------------------------
-- Vues : feed et classement (gamification)
-- ---------------------------------------------------------------
-- Barème : 10 pts par retex publié, 2 pts par vote reçu, 1 pt par vote donné,
-- 3 pts par commentaire écrit. Ajustable ici sans toucher au reste.

create or replace view public.retex_feed with (security_invoker = true) as
select
  r.id, r.org_id, r.author_id, p.display_name as author_name,
  r.title, r.situation, r.learning, r.recommendation, r.tags,
  r.source, r.source_ref, r.created_at, r.updated_at,
  (select count(*) from public.votes v where v.retex_id = r.id)::int as vote_count,
  (select count(*) from public.comments c where c.retex_id = r.id)::int as comment_count,
  exists (select 1 from public.votes v where v.retex_id = r.id and v.user_id = auth.uid()) as voted_by_me,
  -- score "hot" façon reddit : votes pondérés par l'ancienneté
  ((select count(*) from public.votes v where v.retex_id = r.id) + 1)
    / power(extract(epoch from (now() - r.created_at)) / 3600 + 2, 1.5) as hot_score
from public.retex r
join public.profiles p on p.id = r.author_id;

create or replace view public.leaderboard with (security_invoker = true) as
select
  p.id as user_id, p.org_id, p.display_name,
  (select count(*) from public.retex r where r.author_id = p.id)::int as retex_count,
  (select count(*) from public.votes v join public.retex r on r.id = v.retex_id where r.author_id = p.id)::int as votes_received,
  (select count(*) from public.votes v where v.user_id = p.id)::int as votes_given,
  (select count(*) from public.comments c where c.author_id = p.id)::int as comments_count,
  (
    10 * (select count(*) from public.retex r where r.author_id = p.id)
    + 2 * (select count(*) from public.votes v join public.retex r on r.id = v.retex_id where r.author_id = p.id)
    + 1 * (select count(*) from public.votes v where v.user_id = p.id)
    + 3 * (select count(*) from public.comments c where c.author_id = p.id)
  )::int as points
from public.profiles p;

-- Recherche plein texte (utilisée par le MCP et l'UI)
create or replace function public.search_retex(q text, max_results int default 20)
returns setof public.retex_feed
language sql stable security invoker set search_path = public as $$
  select f.* from public.retex_feed f
  where to_tsvector('french', coalesce(f.title,'') || ' ' || coalesce(f.situation,'') || ' ' || coalesce(f.learning,'') || ' ' || coalesce(f.recommendation,''))
        @@ plainto_tsquery('french', q)
  order by f.vote_count desc, f.created_at desc
  limit max_results
$$;

-- updated_at automatique
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger retex_touch before update on public.retex for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------
-- Sécurité : chaque organisation ne voit que ses données
-- ---------------------------------------------------------------
alter table public.organisations enable row level security;
alter table public.profiles      enable row level security;
alter table public.retex         enable row level security;
alter table public.votes         enable row level security;
alter table public.comments      enable row level security;

create policy "org: lecture de la sienne" on public.organisations
  for select using (id = public.my_org_id());

create policy "profiles: lecture dans l'org" on public.profiles
  for select using (org_id = public.my_org_id());
create policy "profiles: modifier le sien" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid() and org_id = public.my_org_id());

create policy "retex: lecture dans l'org" on public.retex
  for select using (org_id = public.my_org_id());
create policy "retex: publier dans son org" on public.retex
  for insert with check (org_id = public.my_org_id() and author_id = auth.uid());
create policy "retex: modifier les siens" on public.retex
  for update using (author_id = auth.uid()) with check (author_id = auth.uid() and org_id = public.my_org_id());
create policy "retex: supprimer les siens" on public.retex
  for delete using (author_id = auth.uid());

create policy "votes: lecture dans l'org" on public.votes
  for select using (exists (select 1 from public.retex r where r.id = retex_id and r.org_id = public.my_org_id()));
create policy "votes: voter dans son org" on public.votes
  for insert with check (user_id = auth.uid() and exists (select 1 from public.retex r where r.id = retex_id and r.org_id = public.my_org_id()));
create policy "votes: retirer le sien" on public.votes
  for delete using (user_id = auth.uid());

create policy "comments: lecture dans l'org" on public.comments
  for select using (exists (select 1 from public.retex r where r.id = retex_id and r.org_id = public.my_org_id()));
create policy "comments: écrire dans son org" on public.comments
  for insert with check (author_id = auth.uid() and exists (select 1 from public.retex r where r.id = retex_id and r.org_id = public.my_org_id()));
create policy "comments: supprimer les siens" on public.comments
  for delete using (author_id = auth.uid());

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.retex_feed, public.leaderboard to authenticated;
grant execute on function public.search_retex(text, int) to authenticated;
grant execute on function public.my_org_id() to authenticated;
