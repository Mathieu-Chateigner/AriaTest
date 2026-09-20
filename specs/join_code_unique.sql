-- Un code de campagne nomme les canaux Ably (aria-rolls-{CODE}, aria-presence-{CODE}...).
-- Deux campagnes qui le partagent ne sont donc pas deux parties : c'est une seule,
-- avec les jets, la presence et les cameras des deux tables melangees. Rien
-- n'empechait ce doublon : generateJoinCode() tirait 5 caracteres au hasard et
-- personne ne regardait si le code existait deja.
--
-- La contrainte unique est la garantie ; join_code_taken() est ce qui permet a
-- l'interface de retirer avant d'ecrire, plutot que de decouvrir la collision au
-- moment de la synchro, ou elle ne serait qu'un avertissement en console.
alter table public.campaigns
    drop constraint if exists campaigns_join_code_key;
alter table public.campaigns
    add constraint campaigns_join_code_key unique (join_code);

-- security definer : sous RLS, un compte ne voit que ses propres campagnes, donc
-- un SELECT ordinaire repondrait toujours "libre" pour le code d'un autre — soit
-- exactement le cas que l'on cherche a eviter.
--
-- ponytail: la fonction dit si un code existe, donc elle permet de les enumerer.
-- Un code ne donne acces a aucune donnee (RLS), seulement au nom d'un canal Ably
-- qu'il faut deja la cle pour joindre. Si cela devient genant, la sortie est un
-- compteur de tentatives par compte.
create or replace function public.join_code_taken (p_code text)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.campaigns where join_code = upper(trim(p_code)));
$$;

revoke all on function public.join_code_taken (text) from public, anon;
grant execute on function public.join_code_taken (text) to authenticated;
