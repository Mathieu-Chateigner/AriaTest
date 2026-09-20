-- La cle Ably etait collee a la main par chaque joueur dans le ⚙ de l'accueil, et
-- vivait dans le localStorage de chaque navigateur. C'est un reglage de la table,
-- pas une preference personnelle : une seule cle sert les trois apps.
--
-- Elle vit desormais ici, en une ligne, lisible par tout compte connecte. Les
-- panneaux la recopient dans aria-config au demarrage, donc tout le code qui lit
-- config.ablyKey continue de marcher sans changement.
--
-- PERSONNE NE PEUT L'ECRIRE DEPUIS L'APPLICATION : aucune policy d'ecriture, et
-- il n'y a pas de notion d'administrateur dans ce schema. Elle se renseigne depuis
-- le dashboard Supabase (Table editor > app_config), ou en une commande :
--
--   update public.app_config set ably_key = 'xxxxxxxx:xxxxxxxx' where id = 'default';
--
-- C'est volontaire : une policy d'ecriture ouverte aux comptes connectes laisserait
-- n'importe quel joueur remplacer la cle de toute la table.
--
-- L'overlay OBS ne lit PAS cette table : il n'a pas de session. Il continue de lire
-- saves.ably_key, que les panneaux ecrivent a chaque entree (initRouteChannel).
create table if not exists public.app_config (
    id          text primary key,
    ably_key    text,
    updated_at  timestamptz default now()
);

insert into public.app_config (id) values ('default') on conflict (id) do nothing;

alter table public.app_config enable row level security;

drop policy if exists app_config_read on public.app_config;
create policy app_config_read on public.app_config for select to authenticated
    using (true);

revoke all on public.app_config from anon;
