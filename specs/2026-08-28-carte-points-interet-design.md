# Carte et points d'intérêt — design

Date : 2026-08-28
Statut : validé, prêt pour le plan d'implémentation

## Objectif

Donner au MJ une carte par campagne sur laquelle il place des points d'intérêt
(POI), et aux joueurs une vue de cette carte limitée à ce qu'ils ont découvert.
Les joueurs peuvent noter des choses sur les POI qu'ils connaissent et demander à
s'y déplacer. La carte est aussi posable sur l'overlay OBS.

Source : `idees_aria.txt`, retours de table du 25/06/2026.

## Décisions

Sept choix ont été arrêtés pendant la conception. Ils sont listés ici avec leur
raison, parce que chacun exclut une alternative qui paraît raisonnable.

1. **La découverte est individuelle, par personnage**, et le MJ peut en plus
   révéler ou retirer un POI à la main. Une découverte partagée par tout le
   groupe aurait été plus simple, mais elle interdit qu'un joueur parte en
   éclaireur.

2. **Un joueur voit les jetons des autres sur les POI qu'il connaît.** Pas
   seulement ceux au même endroit que lui, mais jamais sur un lieu qu'il ignore —
   sinon la présence d'un jeton trahirait l'existence du lieu.

3. **Trois couches de texte par POI** : note MJ privée, description publique
   rédigée par le MJ et visible des joueurs ayant découvert le POI, et note
   privée de chaque joueur. C'est la description publique qui permet au MJ de
   déléguer : un joueur arrive quelque part et lit ce qu'il y a.

4. **Pas de note générée dans l'onglet Notes.** Le regroupement des notes de POI
   est une vue dans l'onglet Carte. Zéro duplication, zéro synchronisation, la
   liste est juste par construction.

5. **Le déplacement d'un joueur passe par une demande que le MJ valide.** Le MJ
   garde le contrôle. Contrepartie assumée et traitée : une file de demandes
   visible côté MJ, et un bouton désactivé côté joueur quand le MJ est absent.

6. **La carte est posable sur l'overlay OBS**, comme widget de l'éditeur.

7. **Le widget overlay montre la vue de son propriétaire.** Overlay joueur → ce
   que ce personnage a découvert. Overlay MJ → l'union de ce que la table
   connaît. Les notes MJ ne partent jamais sur le flux.

Trois décisions visuelles ont été arrêtées ensuite sur maquettes, dans les deux
panneaux :

8. **Carte plein cadre et fiche flottante**, des deux côtés, plutôt qu'un panneau
   latéral fixe ou un tiroir bas. Seule disposition qui reste utilisable dans un
   volet étroit du moteur de volets. La fiche s'ancre à côté de la punaise
   sélectionnée, jamais par-dessus.

9. **Les jetons sont des pastilles nommées** posées sous la punaise, plutôt que
   des initiales en couronne ou un compteur dépliable. Pour une table de trois à
   quatre joueurs, lire « qui est où » sans aucun geste vaut plus que la
   compacité.

10. **Côté joueur, la fiche flottante lit et le tiroir écrit.** La note privée
    s'édite uniquement dans le tiroir « Mes notes de carte ». Une fiche flottante
    se ferme au clic extérieur ; on ne fait pas taper dans un conteneur volatil.

11. **Les zones sont des polygones SVG, tracés entièrement par le MJ**, et le
    brouillard est **par zone** : seul un quartier que le MJ a pris la peine de
    tracer peut s'assombrir, le reste du plan demeure visible. Le brouillard
    global — tout noir sauf le découvert — a été écarté : il oblige à découper la
    carte entière, faute de quoi un quartier oublié reste noir pour toujours.
    Tracer relève de la préparation de campagne, donc du MJ seul ; rien n'est
    déduit automatiquement et aucun joueur ne trace. Livré en phase séparée,
    après que la carte à punaises fonctionne.

    La 3D (Three.js ou équivalent) a été écartée : le projet n'a pas de contenu
    3D à afficher, la scène tournerait à côté de celle de dddice pendant
    l'encodage OBS, et ce serait la plus grosse dépendance d'un projet qui n'en a
    aucune. Si le besoin revient, c'est un projet à part avec sa propre spec.

12. **La carte se fabrique dehors et s'importe.** Aria n'a pas d'éditeur de
    carte : ni éditeur de sprites, ni éditeur de tuiles. Elle offre des
    **raccourcis vers des générateurs**, un champ `sourceUrl` pour y revenir, et
    un habillage CSS qui fait entrer n'importe quelle image dans la charte.

    Un éditeur de sprites a été envisagé et écarté sur trois points : il
    transformerait `imageUrl` — une chaîne — en un tilemap que **les trois apps**
    devraient savoir rendre, dont le widget overlay en 1920×1080 à côté de dddice
    et des flux WebRTC ; il exigerait un jeu de tuiles cohérent qui n'existe pas
    et qui est un projet d'illustration, pas de code ; et le résultat serait
    en-dessous de ce que Watabou ou Azgaar produisent gratuitement en deux
    minutes. Le tout pour plus de travail que les six phases réunies.

    **La ligne de partage est générateur contre éditeur.** Un générateur produit
    la carte à partir de paramètres et d'une graine : il se paramètre par URL,
    « régénérer » a un sens, l'intégration a de la valeur. Un éditeur — Inkarnate,
    Wonderdraft — se pilote à la main : il n'a ni graine ni paramètres, et rien à
    pré-remplir. Pour ceux-là, **le bouton d'import est déjà l'intégration
    complète** ; aucune ligne de code ne l'améliorera. Wonderdraft est de surcroît
    une application de bureau : il n'y a ni page, ni iframe, ni API.

## Architecture

### Contrainte de départ

Joueurs et MJ ont des clés de sauvegarde différentes. Un joueur ne peut pas lire
`campaign_maps` dans Supabase. **La carte doit atteindre les joueurs par Ably.**

### Acheminement : canal dédié, état complet rediffusé

Le MJ est source unique de vérité. À chaque changement il publie une projection
publique complète de la carte active sur `aria-map-{JOINCODE}`. Joueurs et
overlay reçoivent le même message et filtrent à l'affichage.

Deux alternatives ont été écartées :

- **Messages ciblés par `charId` sur `aria-damage`** (comme `file-grant`) :
  fan-out de N messages par changement, et surtout chaque client maintiendrait un
  état patché par deltas. C'est le motif qui a déjà produit dans ce projet les
  jumeaux `gm*` divergents et les filtres de jets contradictoires.
- **Tout dans les données de présence du MJ** : la charge de présence est relue
  par les trois apps à chaque mouvement de roster. Une carte dedans, c'est du
  re-render de caméras à chaque punaise déplacée.

Le principe qui fait tenir le choix retenu : **`state` remplace, il ne patche
jamais.** Un client qui le reçoit jette son état et prend celui-là. Aucune
dérive n'est possible.

## Données

### Côté MJ

Deux entrées dans `CAMP_KEYS` (`js/aria-gm.js:284`) :

```
aria-gm-maps-{campaignId}        [{ id, name, imageUrl, imagePath, sourceUrl, pois, positions }]
aria-gm-active-map-{campaignId}  id de la carte affichée à la table
```

```js
poi       = { id, name, x, y, publicDesc, gmNote, discoveredBy: [charId], zone }
positions = { charId: poiId }
```

`zone` est un tableau de sommets en pourcentages — `[[x, y], …]` — ou vide. Vide,
le POI n'est qu'une punaise. Rempli, il porte en plus un quartier tracé qui
s'assombrit tant qu'il n'est pas découvert. Voir *Zones et brouillard*.

`x` et `y` sont des pourcentages de l'image (0–100), comme les widgets
d'overlay : la carte reste juste à toute taille d'affichage.

**`positions` et `discoveredBy` appartiennent à la carte, pas à la campagne.**
Chaque carte a ses propres jetons et son propre brouillard. Changer de carte
active ne déplace donc rien : les jetons de la ville restent sur la ville, et le
groupe réapparaît là où il en était en y revenant. Un `charId` resté dans
`positions` alors que le personnage a quitté la campagne est ignoré au rendu — il
n'est pas dans `players`, donc aucun jeton n'est dessiné pour lui.

### Supabase — une seule table

`campaign_maps`, une ligne par carte, `pois` et `positions` en jsonb.

```sql
create table campaign_maps (
  id text primary key, campaign_id text, name text,
  image_url text, image_path text, source_url text,
  pois jsonb, positions jsonb, position int, updated_at timestamptz
);
```

Entrée dans `ENT` (`js/aria-supabase.js:140`) :

```js
map: {
    table: 'campaign_maps', parent: 'campaign_id',
    fields: {
        id: 'id', name: 'name',
        imageUrl:  { col: 'image_url',  to: _str, def: '' },
        imagePath: { col: 'image_path', to: _str, def: '' },
        sourceUrl: { col: 'source_url', to: _str, def: '' },
        pois:      { col: 'pois',       to: _orNull, def: _arr },
        positions: { col: 'positions',  to: _orNull, def: _obj },
    },
},
```

Le parent étant `campaign_id`, `childTables()` ramasse la table automatiquement
dans la cascade de `deleteCampaign()`. Rien à câbler.

Écriture par `sbPutAll(ENT.map, gmMaps, currentCampaignId)` en débounce, comme
les monstres et les fichiers.

### Image de la carte

Passe par `uploadFileToSupabase()` (`js/aria-gm.js:2941`), bucket
`campaign-files` déjà en place. Elle n'est **pas** ajoutée à `gmFiles`, donc elle
n'apparaît pas dans l'onglet Fichiers. Aucun nouveau bucket, aucun nouveau code
d'upload.

### Provenance de la carte — `sourceUrl`

L'image reste l'unique source de vérité du fond de carte ; `sourceUrl` note
seulement **d'où elle vient**, sous forme d'une URL opaque qu'Aria n'interprète
jamais. Un bouton `Rouvrir la source` l'ouvre dans un onglet.

Une poignée de raccourcis vers des **générateurs** accompagne l'import, définis
dans un petit tableau pour qu'en ajouter un soit une ligne :

```js
const MAP_GENERATORS = [
    { label: 'Ville médiévale', url: s => `https://watabou.github.io/city-generator/?size=15&seed=${s}` },
    { label: 'Village',         url: s => `https://watabou.github.io/village-generator/?seed=${s}` },
    { label: 'Royaume',         url: () => 'https://azgaar.github.io/Fantasy-Map-Generator/' },
];
```

Cliquer un raccourci ouvre le générateur avec une graine fraîche et **pré-remplit
`sourceUrl` avec l'URL ouverte**. Le MJ exporte son PNG depuis le générateur et
l'importe ; plus tard, `Rouvrir la source` le ramène sur la même ville, aux mêmes
réglages, pour l'ajuster et ré-exporter. **La graine vit dans l'URL** — il n'y a
donc pas de champ graine séparé, ce serait la même information stockée deux fois.

Limite connue et assumée : si le MJ modifie des options *à l'intérieur* du
générateur, Aria l'ignore — elle a mémorisé l'URL qu'elle a ouverte, pas celle où
il a atterri. Le champ est donc **éditable** : un copier-coller de la barre
d'adresse le remet d'aplomb, et seulement dans ce cas.

Le champ étant opaque, il accepte aussi bien l'URL d'un projet Inkarnate ou
n'importe quel autre lien. Il reste vide pour une carte scannée ou faite sous
Wonderdraft, et c'est très bien : il est optionnel.

### Habillage — faire entrer n'importe quelle carte dans la charte

Une carte importée est un fichier étranger posé dans une fenêtre. Quatre règles
CSS suffisent à l'intégrer, sans toucher au fichier :

```css
.aria-map          { filter: sepia(.45) saturate(.75) contrast(1.08) brightness(.92); }
.aria-map::after   { background: radial-gradient(ellipse at 50% 45%,
                                 transparent 52%, rgba(9,8,4,.72) 100%); }  /* vignettage */
.aria-map::before  { background-image: url("data:image/svg+xml,…feTurbulence…");
                     mix-blend-mode: overlay; opacity: .16; }               /* grain */
.aria-frame        { box-shadow: inset 0 0 0 1px rgba(236,164,86,.4),
                                 inset 0 0 26px rgba(9,8,4,.85); }          /* liseré */
```

Aucune image, aucune dépendance, et ça vaut pour n'importe quelle carte importée.
Le vignettage a un effet secondaire utile : il assombrit les bords, là où les
zones de brouillard de la phase 6 iront — les deux se renforcent.

L'accent du liseré suit le panneau : braise côté joueur, violet côté MJ.

### Côté joueur

Deux entrées dans `CHAR_KEYS` (`js/aria-player.js:271`) :

```
aria-map-{charId}        dernier état public reçu (cache d'affichage au rechargement)
aria-map-notes-{charId}  { poiId: texte }  — notes privées du joueur
```

Les notes joueur partent dans Supabase via **une colonne jsonb ajoutée à
`character_state`** :

```sql
alter table character_state add column map_notes jsonb;
```

Elle est remplie dans `_charStateRow()` (`js/aria-player.js:188`) et relue dans
`loadFromSupabase()`. Aucune nouvelle table côté joueur.

## Protocole

Canal `campaignChannel('aria-map')` → `aria-map-{JOINCODE}`, scopé campagne comme
les cinq autres canaux de jeu.

| message | sens | charge |
|---|---|---|
| `state` | MJ → tous | `{ mapId, name, imageUrl, pois: [{ id, name, x, y, publicDesc, discoveredBy, zone }], fog: [{ id, zone }], positions, players: { charId: name } }` |
| `request` | joueur / overlay → MJ | `{}` — le MJ republie `state` |
| `move-request` | joueur → MJ | `{ charId, charName, poiId }` |
| `move-denied` | MJ → joueur | `{ charId, poiId }` |

**`fog` est le seul endroit où un POI non découvert laisse une trace dans le
payload**, et il n'y met que `{ id, zone }` : ni nom, ni description, ni
coordonnées de punaise. C'est ce qui permet au joueur de dessiner un quartier
noir sans rien apprendre de ce qu'il contient. Un POI non découvert **sans** zone
n'apparaît nulle part — ni dans `pois`, ni dans `fog`. Tracer une zone est donc
un choix éditorial du MJ : la zone tracée dit « il y a quelque chose ici », le
POI sans zone reste un secret entier.

`players` ne porte que les noms d'affichage, pris dans la Map `players` que le MJ
dérive déjà de la présence. Le payload ne transporte aucune autre donnée de
personnage : les PV, les compétences et le reste passent par `aria-presence`, qui
les diffuse déjà.

Trois règles :

- **`gmNote` n'est jamais dans un payload.** C'est la seule règle de sécurité du
  protocole, et elle tient parce qu'une seule fonction construit le message.
- **Pas de message d'acceptation.** Le MJ accepte → il republie `state`, le jeton
  bouge. Seul le refus a besoin d'être dit.
- **`request` couvre l'arrivée tardive**, y compris le redémarrage d'une source
  navigateur OBS en pleine partie.

`state` est publié en débounce (~150 ms) après tout changement.

### Le filtre, écrit une seule fois

Dans `js/aria-supabase.js` — le seul fichier chargé par les quatre pages
(`aria-shared.js` est réservé aux panneaux) :

```js
// Ce qui se dessine en clair : punaise, nom, description.
function visiblePois(state, charId) {
    return state.pois.filter(p => charId ? p.discoveredBy.includes(charId)
                                         : p.discoveredBy.length > 0);
}

// Ce qui se dessine en noir : géométrie seule, aucun texte.
function fogZones(state, charId) {
    const mine = new Set(visiblePois(state, charId).map(p => p.id));
    return [...state.fog, ...state.pois.filter(p => p.zone?.length && !mine.has(p.id))]
           .map(p => ({ id: p.id, zone: p.zone }));
}
```

Panneau joueur et overlay joueur passent leur `charId` ; onglet MJ et overlay MJ
passent `null` pour la vue table. Vu le nombre de jumeaux divergents que ce
projet a déjà payés, ces deux règles ne doivent exister qu'à un seul endroit.

`state.pois` porte les POI découverts par **au moins un** joueur et `state.fog`
ceux que personne n'a découverts mais qui ont une zone. C'est `fogZones()` qui
recompose, pour chaque spectateur, l'ensemble des quartiers noirs : ceux que
personne n'a trouvés, plus ceux que d'autres ont trouvés mais pas lui.

### Ce que le filtre garantit, et ce qu'il ne garantit pas

Une seule diffusion pour tous implique que le fil transporte **l'union de ce que
la table peut voir**. Le filtre décide de l'affichage, pas de la transmission :
un joueur qui ouvre les outils de développement verra le nom et la description
publique d'un lieu qu'un autre a découvert avant lui.

Ce qui reste garanti, sans condition : **`gmNote` n'est jamais publié**, et les
notes privées des joueurs ne quittent jamais leur `character_state`. Ces deux-là
sont des limites réelles, pas des conventions d'affichage.

Le brouillard est donc un confort de jeu, pas une frontière de sécurité — ce qui
est cohérent avec le reste du projet, où la clé Ably est partagée par tout le
monde et collée dans les URL d'overlay. Si une vraie frontière devenait
nécessaire, c'est le modèle des messages ciblés par `charId` qu'il faudrait
reprendre ; il se substituerait à la diffusion sans changer une ligne des deux
filtres ci-dessus.

## UI — MJ

Nouvel onglet `Carte` entre `Monstres` et `Jets` : bouton `data-tab="tab-map"` et
`<div class="tab-content" id="tab-map">` dans `views/aria-gm.html`. Il entre dans
le moteur de volets comme n'importe quel autre onglet.

**Disposition retenue : carte plein cadre, fiche flottante.** La carte occupe
tout le volet ; l'éditeur de POI n'apparaît qu'au clic sur une punaise, ancré à
côté d'elle — **jamais par-dessus la punaise sélectionnée**. Deux dispositions
concurrentes ont été maquettées et écartées : un panneau latéral fixe, qui mange
un tiers de la largeur en permanence, et un tiroir bas, qui vole de la hauteur.
Le facteur décisif est le moteur de volets : un onglet peut se retrouver dans un
volet étroit, et la fiche flottante est la seule des trois qui y reste utilisable.

```
┌─ Ville de Karthis · Donjon des brumes · +            [Image] [Vue table] ⚑2 ┐
│                                                                             │
│      ● Taverne du Cerf ┌──────────────────────────┐                         │
│        [Alice · Bob]   │ Taverne du Cerf          │        ○ Crypte         │
│                        │ Description publique     │                         │
│                        │ Note MJ (privée)         │                         │
│                        │ Découvert par            │                         │
│                        │ [x] Alice [x] Bob [ ] Carl│                        │
│      ○ Ruines          │ Amener ici : Alice  Carl │   ● Marché              │
│                        └──────────────────────────┘     [Carl]              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**La file de demandes est un badge chiffré `⚑` dans la barre de cartes**, qui
déroule la liste au clic avec un couple valider / refuser par ligne, plus le même
badge sur le bouton d'onglet `Carte`. En disposition plein cadre il n'y a pas de
bandeau bas où la loger, mais l'exigence tient : un badge persistant survit au
fait que le MJ regarde ailleurs pendant dix minutes, là où un toast disparaît.

**Barre de cartes.** `_renderGroupBar()` (`js/aria-gm.js:1582`) est déjà un
ternaire à deux branches (groupes de monstres, groupes de fichiers). On y ajoute
une troisième branche `map` et un drapeau `noTous` — une carte est toujours
active, il n'y a pas d'état « toutes ». Créer / renommer / supprimer une carte
vient gratuitement, avec le compteur de POI à la place du compteur de membres.

**Quatre gestes :**

1. Clic sur le fond → nouveau POI à ce pourcentage, nommé à la volée.
2. Glisser une punaise → met à jour son `x`/`y`.
3. Clic sur une punaise → la sélectionne, la fiche flottante s'ouvre à côté avec
   les trois couches de texte.
4. `Amener ici : [Alice]` → pose le jeton d'Alice sur ce POI. Un bouton par
   joueur, pas de glisser-déposer : c'est l'action la plus fréquente en pleine
   partie, elle doit être à un clic et sans viser.

**Un déplacement découvre le POI** pour le joueur déplacé. Les cases
`Découvert par` servent à la révélation à distance et à corriger une erreur.

Le bouton `Vue table` bascule sur ce que voit la table via
`visiblePois(state, null)` — la même fonction que l'overlay, donc l'aperçu ne
peut pas mentir.

**Rendu** : `el()` et `reconcile()`, aucun `on*=` en dur, aucune concaténation de
chaînes — les noms de joueurs arrivent par présence, donc c'est de la donnée
télécommandée.

## Vocabulaire visuel

Commun aux deux panneaux et à l'overlay. Le panneau MJ le rend en violet
(`--violet`), le panneau joueur en braise (`--ember`) — les accents existants,
via les alias `--gold` / `--accent-rgb` déjà en place.

**Punaises**, trois états qui se composent :

| état | rendu | sens |
|---|---|---|
| pleine | disque plein accentué, halo diffus | découverte par au moins un joueur |
| creuse | cercle en pointillé, gris `--parchment-dim` | connue du MJ seul (vue MJ uniquement) |
| sélectionnée | anneau clair + halo net | fiche ouverte sur ce POI |

Le nom du POI est posé sous la punaise en Cinzel : parchemin plein s'il est
découvert, `--parchment-dim` s'il est secret.

**Jetons : une pastille nommée sous la punaise**, arrondie, fond sombre, une ou
deux pastilles empilées quand plusieurs joueurs partagent un POI. Le jeton du
joueur qui regarde porte l'accent braise et la mention `Vous`.

Deux alternatives ont été maquettées et écartées : des initiales en couronne
autour de la punaise (compact, mais deux personnages de même initiale deviennent
ambigus) et un compteur groupé dépliable au survol (encombrement constant, mais
« qui est où » cesse de se lire d'un coup d'œil, ce qui est précisément
l'information voulue en pleine partie). Avec une table de trois à quatre joueurs,
lire les noms sans geste vaut plus que la compacité, et le chevauchement de deux
POI très proches est sous le contrôle du MJ qui les place.

## Zones et brouillard

**Un `<svg>` posé sur l'image**, en `viewBox` 0–100 sur les deux axes pour coller
aux coordonnées en pourcentage déjà utilisées par les punaises. Un `<polygon>`
par zone.

Le survol, le contour et le remplissage sont **natifs** : `polygon:hover` en CSS
suffit pour allumer une bordure et éclaircir un quartier, sans une ligne de
JavaScript, sans calcul de collision, sans canvas. La révélation d'une zone est
une `transition` sur `fill` et `opacity` — c'est de là que vient l'impression de
modernité, pas d'un moteur 3D.

Deux détails à ne pas rater :

- **`vector-effect="non-scaling-stroke"` sur chaque polygone.** Sans lui,
  l'épaisseur des contours se déforme dès que la carte change de taille, et elle
  change de taille en permanence dans le moteur de volets.
- **Les zones se dessinent sous les punaises et les jetons**, dans un `<g>`
  antérieur, sinon un quartier noir avale les pastilles posées dessus.

**Rendu d'une zone selon l'observateur :**

| observateur | zone découverte | zone non découverte |
|---|---|---|
| MJ | contour accentué, remplissage très léger | contour pointillé gris, remplissage sombre translucide (le MJ voit à travers) |
| joueur / overlay | contour accentué, remplissage très léger | **noir opaque, sans nom ni punaise** |

**L'éditeur de tracé est côté MJ uniquement** : clic pour poser un sommet, clic
sur le premier sommet pour fermer, glisser un sommet pour le corriger, `Suppr`
pour l'enlever. C'est le vrai coût de cette fonctionnalité — le rendu est presque
gratuit, le tracé ne l'est pas. D'où sa phase séparée.

Une zone appartient à un POI (`poi.zone`) et non l'inverse : il n'y a pas d'objet
zone indépendant, pas de table supplémentaire, et supprimer un POI emporte sa
zone.

## UI — joueur

Nouvel onglet `Carte`.

Même disposition que le MJ : carte plein cadre, fiche flottante au clic sur une
punaise.

```
┌─ Ville de Karthis ──────────────────────────────────────────┐
│                                                             │
│    ● Taverne du Cerf ┌────────────────────────┐             │
│      [Vous · Bob]    │ Taverne du Cerf        │             │
│                      │ Une salle enfumée où   │  ● Marché   │
│                      │ l'on parle bas.        │    [Carl]   │
│                      │ Ma note (lecture)      │             │
│                      │ le barman louche       │             │
│                      │ [Demander à s'y rendre]│             │
│                      └────────────────────────┘             │
├─────────────────────────────────────────────────────────────┤
│ ▾ Mes notes de carte                                        │
│    Taverne du Cerf  [le barman louche              ]        │
│    Marché           [acheter des cordes            ]        │
└─────────────────────────────────────────────────────────────┘
```

**Auto-affichage** de l'onglet quand un état de carte est arrivé, masquage sinon
— le motif de `Fichiers` dans `applyTabVisibility()` (`js/aria-player.js:665`),
avec le repli sur `tab-skills` si l'onglet actif vient d'être masqué.

**Un POI non découvert sans zone n'est pas dessiné du tout.** Pas de silhouette
grisée, pas de point d'interrogation. Une punaise fantôme dit qu'il y a quelque
chose là, et c'est ce que le brouillard doit taire.

**Un POI non découvert avec zone est dessiné en noir, et rien d'autre** — pas de
punaise, pas de nom, pas de description. Ce n'est pas une exception à la règle
précédente mais son pendant délibéré : tracer une zone est le geste par lequel le
MJ décide de montrer qu'il y a quelque chose là. Un POI sans zone reste un secret
entier, un POI avec zone est une invitation.

**Les jetons des autres tombent gratuitement** : le joueur ne rend que les POI
qu'il connaît, un joueur posé ailleurs n'a nulle part où s'afficher.

**La fiche flottante est en lecture seule ; on écrit dans le tiroir.** La note
privée s'affiche dans la fiche mais ne s'y édite pas : cliquer une punaise
déroule et met le focus sur la ligne correspondante du tiroir « Mes notes de
carte », qui est la seule zone d'écriture. Motif : une fiche flottante se ferme
au clic extérieur, et on ne fait pas taper un joueur dans un conteneur volatil.
Les deux alternatives — rendre la fiche non-fermante dès qu'on touche la note, ou
la rendre épinglable — ajoutent toutes deux un état au comportement de la fiche.
Écrire dans le tiroir en **supprime** un, et le tiroir existe déjà pour le
regroupement.

**La note s'auto-enregistre** en débounce vers `aria-map-notes-{charId}` puis
`debouncedSyncState()` — le chemin des PV et des onglets.

**Le bouton de déplacement a quatre états** : *Demander à s'y rendre* → *Demande
envoyée…* → normal quand le `state` suivant montre le jeton arrivé, ou *Refusé*
sur `move-denied`. Il est **désactivé quand le MJ n'est pas dans l'ensemble de
présence** : sans ça, une demande part dans le vide et le joueur attend une
réponse que personne n'a reçue.

**« Mes notes de carte »** est à la fois le regroupement de la décision 4 et la
zone d'écriture : un tiroir dépliable en bas de l'onglet, une ligne par POI
**découvert**, avec son champ de saisie. Il est filtré par `visiblePois()` — si
le MJ retire une découverte, la note reste stockée mais disparaît de la liste,
sinon le nom du lieu fuiterait par sa propre note.

**Au rechargement**, `aria-map-{charId}` peint la dernière carte connue tout de
suite, puis le `request` ramène l'état frais qui la remplace.

## UI — widget overlay

**Éditeur : une ligne.** `WIDGET_DEFS.persistent`
(`js/aria-overlay-editor.js:18`) reçoit
`{ type: 'map', label: 'Carte', defaultW: 40, defaultH: 45 }`, sans `gmOnly`.
`WIDGET_LABELS` en dérive (ligne 48) et l'éditeur dessine déjà une boîte
étiquetée pour n'importe quel type (ligne 182).

**Le widget Carte se traite comme le widget Caméra, pas comme les autres.**
`updateWidgetData()` (`js/aria-overlay.js:877`) réassigne `innerHTML` à chaque
changement de présence, donc à chaque PV qui bouge, sur une sortie qui tourne des
heures. Le widget contient une `<img>` : la reconstruire à ce rythme la fait
scintiller, pour la raison exacte qui a valu au widget Caméra son `return`
anticipé ligne 881.

```js
// renderWidgetLayer()
if (widget.type === 'map')         syncMapWidget(el, widget);
else if (widget.type === 'camera') syncCameraWidget(el, widget, live);
else                               el.innerHTML = renderWidgetContent(widget);

// updateWidgetData()
if (widget.type === 'map') return;   // se met à jour sur aria-map, pas sur la présence
```

`syncMapWidget()` crée l'`<img>` une seule fois et ne réassigne `src` que s'il
diffère — le garde-fou de `setFrameSrc()`. Seule la couche de punaises et de
jetons est reconstruite, à l'arrivée d'un `state`.

**Qui voit quoi**, l'overlay connaissant déjà son propriétaire :

```js
const MAP_CHAR_ID = OVERLAY_ID.startsWith('player_') ? OVERLAY_ID.slice(7) : null;
visiblePois(mapState, MAP_CHAR_ID)
```

**Abonnement** à `campaignChannel('aria-map')` et `request` publié à la
connexion, ce qui fait qu'une source OBS redémarrée retrouve la carte.

**Échappement** : `aria-overlay.js` construit des chaînes et a son propre
`esc()`. Chaque champ interpolé y passe.

Le widget ne peut afficher ni les notes MJ (jamais dans le payload), ni les notes
privées des joueurs (jamais hors de leur `character_state`), ni les POI non
découverts.

## Phases

**Phase 0 — SQL**, à passer à la main dans le tableau de bord Supabase : les deux
commandes de la section Données.

**Phase 1 — La carte côté MJ, hors ligne.** `CAMP_KEYS`, `ENT.map`, upload
d'image, `sourceUrl` avec ses raccourcis de générateurs et son bouton `Rouvrir la
source`, l'habillage CSS, l'onglet, la barre de cartes, le placement et l'édition
des POI. Aucun Ably.
Vérifiable seul : poser des POI, rafraîchir, changer de campagne, revenir ;
supprimer la campagne ne laisse pas de ligne orpheline.

**Phase 2 — Diffusion et vue joueur.** Canal `aria-map`, `state`, `request`,
`visiblePois()`, onglet joueur, punaises, jetons, et côté MJ `Amener ici` et les
cases `Découvert par`. C'est déjà le produit jouable.

**Phase 3 — Notes joueur et regroupement.** `aria-map-notes-{charId}`, colonne
`map_notes`, vue dépliable.

**Phase 4 — Demandes de déplacement.** `move-request`, `move-denied`, file et
badge côté MJ, quatre états du bouton côté joueur, verrouillage quand le MJ est
absent.

**Phase 5 — Widget overlay.** Ligne dans `WIDGET_DEFS`, `syncMapWidget()`,
abonnement, `request` au démarrage.

**Phase 6 — Zones et brouillard.** Le champ `poi.zone`, l'éditeur de tracé côté
MJ, la couche `<svg>` dans les trois rendus (panneau MJ, panneau joueur, widget
overlay), `state.fog` et `fogZones()`. Volontairement en dernier : la carte est
pleinement jouable sans, et l'éditeur de polygones est le morceau le plus lourd
de tout le lot.

Les phases 3 et 4 sont interchangeables. La phase 6 vient après la 2 au plus tôt,
puisqu'elle a besoin de la diffusion et des deux rendus.

## Vérification

Deux choses ici sont de la logique pure et ne doivent pas dériver :
`visiblePois()` et `fogZones()`. Elles sont couvertes dans
`js/aria-shared.selfcheck.js`, qui chargera aussi `aria-supabase.js`.

Sur `visiblePois()` :

1. Un joueur ne voit que les POI dont `discoveredBy` le contient.
2. La vue table (`charId` nul) voit l'union des découvertes.
3. Un POI que personne n'a découvert n'apparaît dans aucune des deux vues.
4. Un `pois` vide ne fait pas planter.

Sur `fogZones()` (phase 6) :

5. Un POI que personne n'a découvert et qui a une zone est dans le brouillard.
6. Un POI découvert par Bob et pas par Alice est dans le brouillard d'Alice et
   pas dans celui de Bob.
7. Un POI non découvert **sans** zone n'apparaît ni en clair ni en brouillard.
8. Aucune entrée de `fogZones()` ne porte de `name` ni de `publicDesc` — c'est
   l'assertion qui protège la règle « géométrie seule ».

Le reste demande un vrai DOM et deux onglets, mode de test habituel du projet.

## Hors périmètre

- Lier un POI à une autre carte (une ville sur une carte du monde). Non demandé.
- Persistance du regroupement des cartes entre appareils au-delà de ce que
  `campaign_maps` porte déjà.
- Dessin ou annotation libre sur la carte : seuls les POI et leurs zones
  existent.
- Rendu 3D. Écarté en décision 11 ; ce serait une spec à part.
- Éditeur de carte intégré, en sprites ou en tuiles. Écarté en décision 12.
- **Générateur en iframe dans Aria.** Techniquement possible — vérifié le
  2026-08-28, ni `X-Frame-Options` ni CSP `frame-ancestors` sur
  `watabou.github.io` et `azgaar.github.io` — mais sans intérêt : la politique
  d'origine unique interdit de lire le contenu d'une iframe d'une autre origine,
  et aucun de ces outils n'expose d'API `postMessage`. Leur
  `Access-Control-Allow-Origin: *` ne change rien, il gouverne le `fetch()` de
  ressources, pas l'accès au DOM. L'export/import resterait donc obligatoire :
  l'iframe n'économiserait qu'un changement d'onglet, contre une dépendance à la
  page d'un tiers qui peut changer ou bloquer le cadrage à tout moment.
- **Vendoriser Azgaar** dans le dépôt. C'est le seul chemin vers une vraie
  automatisation : copié localement il devient même origine et son SVG devient
  lisible. Écarté pour le prix — une grosse base tierce, sa licence, son
  attribution et sa maintenance, dans un dépôt qui n'a aujourd'hui aucune
  dépendance et aucun build.
- Intégration d'Inkarnate ou de Wonderdraft au-delà du champ `sourceUrl`. Voir
  décision 12.
- Brouillard progressif ou à rayon de vision : une zone est découverte ou elle ne
  l'est pas, il n'y a pas d'état intermédiaire.

## Reste à traiter séparément

L'autre idée du fichier source — **une liste des substances identifiées pour
l'alchimie** — est un ajout borné à l'onglet Alchimie existant. Elle ne fait pas
partie de cette spec et sera traitée à part.
