-- ═══════════════════════════════════════════════════════════════════════════
--  Rendez-vous de campagne — le tableau d'affichage des seances a venir
-- ═══════════════════════════════════════════════════════════════════════════
-- Deux tables, et le meme compromis que campaign_chat : le tableau est PUBLIC
-- pour tout compte connecte. C'est la nature de l'objet — une annonce que des
-- inconnus doivent pouvoir lire pour s'y inscrire. La propriete par saves.owner
-- ne peut donc pas servir ici : elle repond "est-ce ta donnee", la question
-- posee est "peux-tu la voir".
--
-- L'ecriture, elle, est nominative : une seance n'est modifiable que par son
-- hote (host_id = auth.uid()), une inscription que par son inscrit
-- (user_id = auth.uid()). Les deux colonnes ont auth.uid() en defaut, donc le
-- client ne les envoie pas — meme regle que saves.owner.
--
-- `characters` est un jsonb [{ id, name, mandatory }] : les personnages proposes
-- par l'hote. Un personnage obligatoire doit etre pris avant qu'un optionnel ne
-- puisse l'etre (regle appliquee cote client, voir js/aria-sessions.js).
--
-- ponytail: pas de table d'occurrences pour les seances recurrentes. `starts_at`
-- porte la premiere, `recurrence` la cadence, et la prochaine date est calculee
-- a l'affichage ; on s'inscrit a la serie, pas a une date. Si un jour il faut
-- pouvoir manquer une seance sur deux, ajouter session_occurrences (session_id,
-- starts_at) et y deplacer la FK des inscriptions.
create table if not exists public.campaign_sessions (
    id            text primary key,
    join_code     text not null,
    title         text not null,
    description   text,
    host_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
    host_name     text,
    starts_at     timestamptz not null,
    duration_min  integer not null default 180,
    recurrence    text not null default 'once',   -- once | weekly | biweekly | monthly
    max_players   integer not null default 5,
    characters    jsonb not null default '[]'::jsonb,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

-- ponytail: le chevauchement horaire ("pas deux seances a la meme heure") est
-- verifie cote client. Une inscription n'a qu'un seul ecrivain — son propre
-- compte — donc il n'y a pas de course entre comptes a arbitrer ; deux onglets du
-- meme compte peuvent la contourner. Pour fermer : un trigger before insert qui
-- rejoue le meme calcul en SQL.
create table if not exists public.session_signups (
    id           text primary key,                 -- session_id || ':' || user_id
    session_id   text not null references public.campaign_sessions (id) on delete cascade,
    user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
    player_name  text,
    char_id      text,
    char_name    text,
    created_at   timestamptz not null default now(),
    unique (session_id, user_id)
);

create index if not exists campaign_sessions_when_idx on public.campaign_sessions (starts_at);
create index if not exists campaign_sessions_code_idx on public.campaign_sessions (join_code);
create index if not exists session_signups_session_idx on public.session_signups (session_id);
create index if not exists session_signups_user_idx    on public.session_signups (user_id);

alter table public.campaign_sessions enable row level security;
alter table public.session_signups   enable row level security;

-- Lecture : tout compte connecte. C'est un tableau d'affichage.
drop policy if exists campaign_sessions_read on public.campaign_sessions;
create policy campaign_sessions_read on public.campaign_sessions for select to authenticated
    using (true);

-- Ecriture : l'hote et personne d'autre.
drop policy if exists campaign_sessions_host on public.campaign_sessions;
create policy campaign_sessions_host on public.campaign_sessions for all to authenticated
    using (host_id = auth.uid()) with check (host_id = auth.uid());

drop policy if exists session_signups_read on public.session_signups;
create policy session_signups_read on public.session_signups for select to authenticated
    using (true);

drop policy if exists session_signups_own on public.session_signups;
create policy session_signups_own on public.session_signups for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());

-- L'overlay OBS n'a rien a faire ici.
revoke all on public.campaign_sessions from anon;
revoke all on public.session_signups   from anon;
