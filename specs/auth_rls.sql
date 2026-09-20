-- ═══════════════════════════════════════════════════════════════════════════
--  ARIA — schema complet + authentification + RLS  (projet AriaTest)
-- ═══════════════════════════════════════════════════════════════════════════
-- Source de verite du schema : le dossier supabase/ n'est pas suivi, la copie
-- appliquee vit dans supabase/migrations/20260920090000_init_auth.sql.
--
-- Rejoue le schema du projet Aria de production, avec la propriete des donnees
-- et les policies des le depart.
--
-- UNE SEULE colonne de propriete : saves.owner -> auth.users. Tout le reste
-- remonte l'arbre par jointure (characters/campaigns par save_key, les petits-
-- enfants par character_id/campaign_id). Dupliquer `owner` sur les 18 tables
-- aurait demande un backfill par table et rendu possible un enfant dont le
-- proprietaire contredit son parent : ici c'est structurellement impossible.
--
-- ponytail: policies a sous-requete EXISTS, ~400 lignes en prod donc non mesurable.
-- Si une table depasse le million de lignes, denormaliser owner sur cette table.

create extension if not exists pgcrypto;

-- ── Tables ────────────────────────────────────────────────────────────────
create table if not exists public.saves (
    save_key            uuid primary key,
    owner               uuid references auth.users (id) on delete set null,
    data                jsonb not null default '{}'::jsonb,
    type                text,
    ably_key            text,
    player_migrated_at  timestamptz,
    gm_migrated_at      timestamptz,
    updated_at          timestamptz default now()
);

create table if not exists public.characters (
    id              text primary key,
    save_key        uuid references public.saves (save_key) on delete cascade,
    name            text,
    class           text,
    campaign_key    text,
    aria_type       text,
    stats           jsonb,
    physical        jsonb,
    skills          jsonb,
    specials        jsonb,
    weapons         jsonb,
    protection      jsonb,
    inventory       jsonb,
    potions         jsonb,
    potion_recipes  jsonb,
    money           jsonb,
    vials           integer,
    karma           integer,
    stream_id       text,
    updated_at      timestamptz default now()
);

create table if not exists public.character_state (
    character_id  text primary key references public.characters (id) on delete cascade,
    hp            integer,
    cards         jsonb,
    tabs          jsonb,
    map_notes     jsonb,
    updated_at    timestamptz default now()
);

create table if not exists public.character_notes (
    id            text primary key,
    character_id  text references public.characters (id) on delete cascade,
    name          text,
    content       text,
    position      integer,
    updated_at    timestamptz default now()
);

create table if not exists public.character_files (
    id            text primary key,
    character_id  text references public.characters (id) on delete cascade,
    file_id       text,
    name          text,
    type          text,
    url           text,
    updated_at    timestamptz default now()
);

-- Pas de FK vers characters : en prod, 57 lignes d'historique appartiennent a des
-- personnages supprimes (voir specs/child_table_fks.sql). On garde le meme choix
-- pour que la copie des donnees passe a l'identique.
create table if not exists public.character_rolls (
    id            uuid primary key default gen_random_uuid(),
    character_id  text,
    skill_name    text,
    threshold     integer,
    roll          integer,
    success       boolean,
    bonus_malus   integer,
    ts            bigint,
    created_at    timestamptz default now()
);

create table if not exists public.campaigns (
    id                 text primary key,
    save_key           uuid references public.saves (save_key) on delete cascade,
    name               text,
    join_code          text,
    aria_type          text,
    vdo_room           text,
    vdo_room_password  text,
    updated_at         timestamptz default now()
);

create table if not exists public.monsters (
    id           text primary key,
    campaign_id  text references public.campaigns (id) on delete cascade,
    name         text,
    pv           integer,
    max_pv       integer,
    armor        integer,
    stats        jsonb,
    attacks      jsonb,
    updated_at   timestamptz default now()
);

create table if not exists public.campaign_potions (
    id              text primary key,
    campaign_id     text references public.campaigns (id) on delete cascade,
    name            text,
    description     text,
    ingredients     jsonb,
    success_chance  integer,
    updated_at      timestamptz default now()
);

create table if not exists public.campaign_files (
    id           text primary key,
    campaign_id  text references public.campaigns (id) on delete cascade,
    name         text,
    type         text,
    url          text,
    path         text,
    granted_to   jsonb,
    updated_at   timestamptz default now()
);

create table if not exists public.campaign_maps (
    id           text primary key,
    campaign_id  text references public.campaigns (id) on delete cascade,
    name         text,
    image_url    text,
    image_path   text,
    source_url   text,
    pois         jsonb,
    positions    jsonb,
    position     integer,
    updated_at   timestamptz default now()
);

create table if not exists public.campaign_music (
    id           text primary key,
    campaign_id  text references public.campaigns (id) on delete cascade,
    name         text,
    type         text,
    url          text,
    youtube_id   text,
    path         text,
    position     integer,
    updated_at   timestamptz default now()
);

create table if not exists public.campaign_notes (
    id           text primary key,
    campaign_id  text references public.campaigns (id) on delete cascade,
    name         text,
    content      text,
    position     integer,
    updated_at   timestamptz default now()
);

create table if not exists public.campaign_known_players (
    id           text primary key,
    campaign_id  text references public.campaigns (id) on delete cascade,
    char_id      text,
    data         jsonb,
    updated_at   timestamptz default now()
);

-- sbPutKnownPlayer() fait un upsert sur (campaign_id, char_id) — ENT.knownPlayer.onConflict —
-- et PostgREST exige une contrainte unique correspondante, sinon 42P10. La table a par
-- ailleurs sa propre cle primaire texte (charId + ':' + campaignId), ce qui rend l'oubli
-- facile : la spec OpenAPI d'ou ce schema a ete rejoue n'expose pas les contraintes uniques.
alter table public.campaign_known_players
    drop constraint if exists campaign_known_players_campaign_char_key;
alter table public.campaign_known_players
    add constraint campaign_known_players_campaign_char_key unique (campaign_id, char_id);

create table if not exists public.campaign_rolls (
    id           uuid primary key default gen_random_uuid(),
    campaign_id  text references public.campaigns (id) on delete cascade,
    skill_name   text,
    threshold    integer,
    roll         integer,
    success      boolean,
    char_name    text,
    bonus_malus  integer,
    created_at   timestamptz default now()
);

create table if not exists public.campaign_card_history (
    id           uuid primary key default gen_random_uuid(),
    campaign_id  text references public.campaigns (id) on delete cascade,
    card_id      text,
    drawn_at     timestamptz default now()
);

-- Cle = join_code, ecrite par les DEUX camps, dont les save_key different.
-- Rien dans le schema ne prouve l'appartenance a une campagne : voir la policy.
create table if not exists public.campaign_chat (
    id           text primary key,
    join_code    text not null,
    thread       text not null,
    author_id    text,
    author_name  text,
    body         text,
    created_at   timestamptz not null default now()
);

create table if not exists public.overlay_configs (
    id          text primary key,
    owner_type  text,
    owner_id    text,
    config      jsonb,
    updated_at  timestamptz default now()
);

-- ── Index ─────────────────────────────────────────────────────────────────
create index if not exists saves_owner_idx             on public.saves (owner);
create index if not exists characters_save_key_idx     on public.characters (save_key);
create index if not exists campaigns_save_key_idx      on public.campaigns (save_key);
create index if not exists character_notes_parent_idx  on public.character_notes (character_id);
create index if not exists character_files_parent_idx  on public.character_files (character_id);
create index if not exists character_rolls_parent_idx  on public.character_rolls (character_id);
create index if not exists monsters_parent_idx         on public.monsters (campaign_id);
create index if not exists campaign_potions_parent_idx on public.campaign_potions (campaign_id);
create index if not exists campaign_files_parent_idx   on public.campaign_files (campaign_id);
create index if not exists campaign_maps_parent_idx    on public.campaign_maps (campaign_id);
create index if not exists campaign_music_parent_idx   on public.campaign_music (campaign_id);
create index if not exists campaign_notes_parent_idx   on public.campaign_notes (campaign_id);
create index if not exists campaign_known_parent_idx   on public.campaign_known_players (campaign_id);
create index if not exists campaign_rolls_parent_idx   on public.campaign_rolls (campaign_id);
create index if not exists campaign_cards_parent_idx   on public.campaign_card_history (campaign_id);
create index if not exists campaign_chat_lookup        on public.campaign_chat (join_code, thread, created_at);

-- ═══════════════════════════════════════════════════════════════════════════
--  Helpers de propriete
-- ═══════════════════════════════════════════════════════════════════════════
-- stable : Postgres peut memoriser le resultat sur la duree de la requete, sinon
-- la sous-requete serait rejouee pour chaque ligne examinee.

create or replace function public.owns_save (p_key uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from public.saves s
         where s.save_key = p_key and s.owner = auth.uid()
    );
$$;

create or replace function public.owns_character (p_char text)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from public.characters c join public.saves s on s.save_key = c.save_key
         where c.id = p_char and s.owner = auth.uid()
    );
$$;

create or replace function public.owns_campaign (p_camp text)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from public.campaigns c join public.saves s on s.save_key = c.save_key
         where c.id = p_camp and s.owner = auth.uid()
    );
$$;

-- Rattache une cle de sauvegarde existante au compte connecte. C'est le chemin de
-- migration : les cles creees avant l'authentification ont owner is null, donc
-- personne ne les voit, tant que leur porteur ne les reclame pas ici.
--
-- security definer parce que la policy de `saves` cache deja la ligne non reclamee :
-- sans cela, l'UPDATE ne trouverait rien. La cle reste le secret qui autorise la
-- revendication, exactement comme avant l'authentification.
create or replace function public.claim_save_key (p_key uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
    if auth.uid() is null then
        raise exception 'not authenticated';
    end if;

    select owner into v_owner from public.saves where save_key = p_key;
    if not found then
        return false;                       -- cle inconnue
    end if;
    if v_owner is not null then
        return v_owner = auth.uid();        -- deja reclamee : idempotent pour son porteur
    end if;

    update public.saves set owner = auth.uid() where save_key = p_key;
    return true;
end;
$$;

revoke all on function public.claim_save_key (uuid) from public, anon;
grant execute on function public.claim_save_key (uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
--  RLS
-- ═══════════════════════════════════════════════════════════════════════════
-- Les policies sont nominatives par role (`to anon` / `to authenticated`), pas
-- permissives pour tous : l'overlay OBS est le seul consommateur anonyme, et il
-- ne lit que deux tables.

alter table public.saves                  enable row level security;
alter table public.characters             enable row level security;
alter table public.character_state        enable row level security;
alter table public.character_notes        enable row level security;
alter table public.character_files        enable row level security;
alter table public.character_rolls        enable row level security;
alter table public.campaigns              enable row level security;
alter table public.monsters               enable row level security;
alter table public.campaign_potions       enable row level security;
alter table public.campaign_files         enable row level security;
alter table public.campaign_maps          enable row level security;
alter table public.campaign_music         enable row level security;
alter table public.campaign_notes         enable row level security;
alter table public.campaign_known_players enable row level security;
alter table public.campaign_rolls         enable row level security;
alter table public.campaign_card_history  enable row level security;
alter table public.campaign_chat          enable row level security;
alter table public.overlay_configs        enable row level security;

-- ── saves : sa propre ligne ───────────────────────────────────────────────
drop policy if exists saves_owner on public.saves;
create policy saves_owner on public.saves for all to authenticated
    using (owner = auth.uid()) with check (owner = auth.uid());

-- Une ligne fraichement creee porte owner = auth.uid() ; le panneau ne l'envoie
-- pas, donc le defaut doit le faire.
alter table public.saves alter column owner set default auth.uid();

-- ── Enfants de saves ──────────────────────────────────────────────────────
drop policy if exists characters_owner on public.characters;
create policy characters_owner on public.characters for all to authenticated
    using (public.owns_save (save_key)) with check (public.owns_save (save_key));

drop policy if exists campaigns_owner on public.campaigns;
create policy campaigns_owner on public.campaigns for all to authenticated
    using (public.owns_save (save_key)) with check (public.owns_save (save_key));

-- ── Petits-enfants : personnage ───────────────────────────────────────────
do $$
declare t text;
begin
    foreach t in array array['character_state', 'character_notes', 'character_files', 'character_rolls']
    loop
        execute format('drop policy if exists %I on public.%I', t || '_owner', t);
        execute format(
            'create policy %I on public.%I for all to authenticated
                 using (public.owns_character (character_id))
                 with check (public.owns_character (character_id))',
            t || '_owner', t);
    end loop;
end $$;

-- ── Petits-enfants : campagne ─────────────────────────────────────────────
do $$
declare t text;
begin
    foreach t in array array['monsters', 'campaign_potions', 'campaign_files', 'campaign_maps',
                             'campaign_music', 'campaign_notes', 'campaign_known_players',
                             'campaign_rolls', 'campaign_card_history']
    loop
        execute format('drop policy if exists %I on public.%I', t || '_owner', t);
        execute format(
            'create policy %I on public.%I for all to authenticated
                 using (public.owns_campaign (campaign_id))
                 with check (public.owns_campaign (campaign_id))',
            t || '_owner', t);
    end loop;
end $$;

-- ── campaign_chat : le trou connu ─────────────────────────────────────────
-- Joueur et MJ ont des save_key differentes et ecrivent dans le meme fil, repere
-- par un join_code de 5 caracteres. Rien dans le schema ne prouve qu'un compte
-- appartient a une campagne, donc la seule barriere posable ici est "etre
-- authentifie". L'anon, lui, perd l'acces : c'est deja le gros du gain.
--
-- ponytail: tout compte connecte qui devine un join_code lit ce fil. Pour fermer,
-- il faut une table campaign_members (join_code, user_id) alimentee a la liaison
-- du personnage, et remplacer le `true` ci-dessous par un exists dessus.
drop policy if exists campaign_chat_authed on public.campaign_chat;
create policy campaign_chat_authed on public.campaign_chat for all to authenticated
    using (true) with check (true);

-- ── overlay_configs : lecture anonyme (OBS), ecriture au proprietaire ──────
-- L'overlay tourne dans une source navigateur OBS : aucune session, aucun moyen
-- de se connecter. Il lit la mise en page des widgets et rien d'autre.
drop policy if exists overlay_read_anon on public.overlay_configs;
create policy overlay_read_anon on public.overlay_configs for select to anon
    using (true);

drop policy if exists overlay_write_owner on public.overlay_configs;
create policy overlay_write_owner on public.overlay_configs for all to authenticated
    using (
        case owner_type
            when 'player' then public.owns_character (owner_id)
            when 'gm'     then public.owns_campaign (owner_id)
            else false
        end
    )
    with check (
        case owner_type
            when 'player' then public.owns_character (owner_id)
            when 'gm'     then public.owns_campaign (owner_id)
            else false
        end
    );

-- ── saves : la lecture anonyme dont l'overlay a besoin ────────────────────
-- L'URL OBS ne porte que ?s=SAVEKEY. Pour joindre quoi que ce soit, l'overlay doit
-- resoudre la cle Ably depuis cette ligne. On l'autorise, mais au niveau colonne :
-- `data` (le vieux blob JSON) et les horodatages de migration cessent d'etre
-- lisibles anonymement.
--
-- Le modele de menace ne change pas : la cle de sauvegarde est le secret, elle est
-- dans l'URL OBS, et c'était deja vrai avant (voir specs/saves_ably_key.sql).
drop policy if exists saves_read_anon on public.saves;
create policy saves_read_anon on public.saves for select to anon
    using (true);

revoke select on public.saves from anon;
grant select (save_key, ably_key, type) on public.saves to anon;

-- Aucune autre table n'est accessible a anon.
do $$
declare t text;
begin
    foreach t in array array['characters', 'character_state', 'character_notes', 'character_files',
                             'character_rolls', 'campaigns', 'monsters', 'campaign_potions',
                             'campaign_files', 'campaign_maps', 'campaign_music', 'campaign_notes',
                             'campaign_known_players', 'campaign_rolls', 'campaign_card_history',
                             'campaign_chat']
    loop
        execute format('revoke all on public.%I from anon', t);
    end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
--  Storage
-- ═══════════════════════════════════════════════════════════════════════════
-- Deux buckets publics en lecture : les URL de fichiers et de musique sont
-- distribuees telles quelles aux joueurs et a l'overlay, qui n'ont pas de session.
-- L'ecriture demande un compte.
insert into storage.buckets (id, name, public)
values ('campaign-files', 'campaign-files', true),
       ('campaign-music', 'campaign-music', true)
on conflict (id) do update set public = true;

drop policy if exists aria_storage_read on storage.objects;
create policy aria_storage_read on storage.objects for select to anon, authenticated
    using (bucket_id in ('campaign-files', 'campaign-music'));

-- ponytail: tout compte connecte peut ecrire dans les deux buckets. Les chemins
-- sont des UUID, donc rien n'est ecrasable a l'aveugle ; pour cloisonner par
-- campagne il faudrait prefixer les chemins par campaign_id et tester
-- owns_campaign((storage.foldername(name))[1]).
drop policy if exists aria_storage_write on storage.objects;
create policy aria_storage_write on storage.objects for all to authenticated
    using (bucket_id in ('campaign-files', 'campaign-music'))
    with check (bucket_id in ('campaign-files', 'campaign-music'));
