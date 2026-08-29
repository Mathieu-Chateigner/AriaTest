# Carte et points d'intérêt — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner au MJ une carte par campagne avec des points d'intérêt qu'il révèle,
aux joueurs une vue limitée à ce qu'ils ont découvert, et un widget carte sur l'overlay OBS.

**Architecture:** Le MJ est source unique de vérité. Les cartes vivent en localStorage
scopé campagne et se synchronisent vers une table `campaign_maps` par le mécanisme `ENT`
existant. Les joueurs et l'overlay ne lisent jamais Supabase : le MJ publie une projection
publique complète sur `aria-map-{JOINCODE}` à chaque changement, et un client qui la reçoit
**jette son état et prend celui-là** — jamais de patch, donc jamais de dérive. Deux fonctions
pures dans `js/aria-supabase.js` (le seul fichier chargé par les quatre pages) décident de
ce que chaque spectateur voit.

**Tech Stack:** HTML/CSS/JS vanilla, sans build, sans npm. Ably (Realtime), Supabase (REST +
Storage), SVG natif pour les zones. Aucune dépendance nouvelle.

**Spec:** `specs/2026-08-28-carte-points-interet-design.md`

---

## Contraintes globales

Ces règles s'appliquent à **toutes** les tâches. Elles viennent de `CLAUDE.md` et de la spec ;
les violer casse quelque chose ailleurs dans le projet.

- **Ne jamais committer ni pousser.** L'utilisateur commit à la main. À la place, la dernière
  étape de chaque tâche réécrit le fichier `commits` à la racine (texte brut, pas de markdown),
  au format :
  ```
  type: ligne de résumé courte (devient le titre du commit GitHub)

  Changes:

  - fichier : ce qui a changé et pourquoi
  ```
  Le contenu précédent est **écrasé** : `commits` ne décrit que le dernier lot.
- **Aucun framework, aucun npm, aucune étape de build.** Pas de nouvelle dépendance.
- **Construire le DOM avec `el()` / `fill()` / `reconcile()`** dans `aria-gm.js`, `aria-player.js`
  et `aria-shared.js`. Jamais de concaténation de chaînes, jamais d'attribut `on*=` généré.
  Les noms de POI et de joueurs sont de la donnée télécommandée (n'importe qui ayant la clé
  Ably peut en publier). `aria-overlay.js` construit des chaînes et garde son `esc()` : **tout
  champ interpolé y passe.**
- **Jamais `innerHTML = ''` ni `parent.innerHTML = …` sur un conteneur qui porte une iframe**
  (overlay). Utiliser `reconcile()` et `setFrameSrc()`.
- **Pas de `type="number"`.** `type="text" inputmode="numeric"` + filtre `oninput`.
- **Pas de `display:none` pour un élément qui décale la mise en page** — `visibility:hidden`.
- **Toujours des variables CSS**, jamais de couleur en dur. Le mode clair vit dans le bloc
  `body.light-mode` en bas de chaque feuille. L'accent est `--gold` / `--accent-rgb` : braise
  côté joueur, violet côté MJ, résolus par les alias déjà en place.
- **Une clé scopée s'ajoute dans `CAMP_KEYS` / `CHAR_KEYS` et nulle part ailleurs.**
  `_dropCampaignKeys` / `_dropCharacterKeys` en dérivent.
- **Une colonne s'ajoute dans `ENT` et nulle part ailleurs.** `toRow` / `fromRow` /
  `sbPutAll` / `childTables()` en dérivent, cascade de suppression comprise.
- **Un nom déclaré en top-level dans `aria-supabase.js` ou `aria-shared.js` ne doit pas être
  redéclaré dans un panneau** — les scripts classiques partagent un seul environnement lexical
  global et un doublon est une `SyntaxError` qui tue le fichier. `mapState` est donc déclaré
  dans `aria-player.js` **et** dans `aria-overlay.js` (deux pages différentes) mais jamais dans
  `aria-supabase.js`.
- **`gmNote` ne part jamais dans un payload.** Une seule fonction construit le message `state` ;
  c'est la seule règle de sécurité du protocole et elle tient parce qu'il n'y a qu'un endroit.
- **Les coordonnées `x`/`y` d'un POI sont des pourcentages de l'image (0–100)**, comme les widgets
  d'overlay. Idem pour les sommets de `zone`.
- **Test :** le projet n'a ni framework ni suite de tests. La logique pure va dans
  `js/aria-shared.selfcheck.js`, lancé par `node js/aria-shared.selfcheck.js`. Tout le reste se
  vérifie en ouvrant les pages dans Chrome et en rechargeant fort (`Ctrl+Shift+R`).
  Pour tester le MJ et le joueur ensemble il faut deux onglets ; pour la caméra et les uploads
  il faut servir en HTTP (`python -m http.server 8080`), sinon `file://` suffit.

---

## Structure des fichiers

| fichier | responsabilité ajoutée |
|---|---|
| `js/aria-supabase.js` | `ENT.map` (une entrée), et les **deux fonctions pures partagées** `visiblePois()` / `fogZones()` — c'est le seul fichier chargé par les quatre pages. |
| `js/aria-shared.selfcheck.js` | charge aussi `aria-supabase.js` et couvre les deux fonctions ci-dessus. |
| `js/aria-gm.js` | état des cartes, onglet Carte, édition des POI, diffusion `state`, file de demandes, éditeur de zones. |
| `js/aria-player.js` | réception de `state`, onglet Carte, notes de carte, demandes de déplacement. |
| `js/aria-overlay.js` | `syncMapWidget()` + abonnement `aria-map`. |
| `js/aria-overlay-editor.js` | une ligne dans `WIDGET_DEFS.persistent`. |
| `views/aria-gm.html` | bouton d'onglet + `<div class="tab-content" id="tab-map">`. |
| `views/aria-player.html` | idem, masqué par défaut. |
| `css/aria-gm.css`, `css/aria-player.css`, `css/aria-overlay.css` | habillage de la carte, punaises, jetons, fiche flottante, zones. |
| `css/aria-panel.css` | **rien**, sauf si une règle finit rigoureusement identique des deux côtés. Y toucher change les deux panneaux. |

`aria-gm.js` (3111 lignes) et `aria-player.js` (3014 lignes) sont déjà gros. Le code carte y va
quand même : le projet range par app, pas par fonctionnalité, et `aria-shared.js` est réservé à
ce que **les deux panneaux** partagent — ici les deux vues sont différentes (le MJ édite, le
joueur lit). Ce qui est vraiment commun aux quatre pages (les deux filtres) va dans
`aria-supabase.js`, comme la spec le prévoit.

---

## Phase 0 — SQL

### Task 1: Créer la table `campaign_maps` et la colonne `map_notes`

**Files:**
- Aucun fichier du dépôt. Deux commandes à passer à la main dans le tableau de bord Supabase
  (projet `npybuksklkvdmbhyzdjs`, éditeur SQL).

**Interfaces:**
- Consomme : rien.
- Produit : la table `campaign_maps` (colonnes `id, campaign_id, name, image_url, image_path,
  source_url, pois, positions, position, updated_at`) et la colonne `character_state.map_notes`,
  dont dépendent les tâches 2 et 10.

- [ ] **Step 1: Créer la table**

Dans l'éditeur SQL Supabase :

```sql
create table campaign_maps (
  id text primary key,
  campaign_id text,
  name text,
  image_url text,
  image_path text,
  source_url text,
  pois jsonb,
  positions jsonb,
  position int,
  updated_at timestamptz
);
```

- [ ] **Step 2: Ajouter la colonne de notes joueur**

```sql
alter table character_state add column map_notes jsonb;
```

- [ ] **Step 3: Vérifier depuis l'application**

Ouvrir `views/aria-gm.html`, console :

```js
await sbSelect('campaign_maps', 'select=id&limit=1')
```

Attendu : `[]` (tableau vide). Un `[]` accompagné d'un `[ARIA] sbSelect failed:` dans la console
signifie que la table n'existe pas — le message d'erreur nomme la table ou la colonne fautive.

```js
await sbSelect('character_state', 'select=map_notes&limit=1')
```

Attendu : `[]` ou `[{ map_notes: null }]`, **sans** avertissement `sbSelect failed`.

- [ ] **Step 4: Ne pas toucher `commits`**

Aucun fichier du dépôt n'a changé. `commits` décrit le dernier lot de changements de code ;
le prochain lot l'écraserait de toute façon.

---

## Phase 1 — La carte côté MJ, hors ligne

### Task 2: Modèle de données et persistance des cartes

**Files:**
- Modify: `js/aria-supabase.js` — `ENT.map`, après l'entrée `campaignFile`
- Modify: `js/aria-gm.js` — `CAMP_KEYS`, globales, accesseurs, `loadCampaignState`, `saveMaps`,
  `debouncedSyncMaps`, `loadFromSupabase`, `_syncAllGMData`

**Interfaces:**
- Consomme : `ENT`, `toRow`, `fromRow`, `sbPutAll`, `childTables()` (`js/aria-supabase.js`) ;
  `CAMP_KEYS`, `campKey()`, `_debouncedListSync()`, `loadCampaignState()`, `loadFromSupabase()`,
  `uid()` (`js/aria-shared.js`).
- Produit, pour les tâches 3 à 15 :
  - `ENT.map` — entité de la table `campaign_maps`
  - `let gmMaps = []` — `[{ id, name, imageUrl, imagePath, sourceUrl, pois, positions }]`
  - `let activeMapId = null` — id de la carte affichée à la table (local, non synchronisé)
  - `function mapsKey(): string` / `function activeMapKey(): string`
  - `function _activeMap(): object | null`
  - `function saveMaps(): void`
  - `const debouncedSyncMaps: () => void`

Forme d'un POI, fixée ici et utilisée par toutes les tâches suivantes :

```js
poi       = { id, name, x, y, publicDesc, gmNote, discoveredBy: [charId], zone: [[x, y], …] }
positions = { charId: poiId }
```

`x`, `y` et les sommets de `zone` sont des pourcentages de l'image (0–100).

- [ ] **Step 1: Ajouter `ENT.map`**

Dans `js/aria-supabase.js`, juste après l'entrée `campaignFile` :

```js
    // pois/positions are jsonb: a map carries its own tokens and its own fog, so
    // switching the active map moves nothing. The parent being campaign_id, the
    // delete cascade picks the table up from childTables() with nothing to wire.
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

- [ ] **Step 2: Ajouter les deux clés scopées campagne**

Dans `js/aria-gm.js`, dans `CAMP_KEYS`, après `fileGroups` :

```js
    maps:          'aria-gm-maps-',
    activeMap:     'aria-gm-active-map-',
```

Rien d'autre : `_CAMPAIGN_KEY_PREFIXES` est `Object.values(CAMP_KEYS)`, donc `_dropCampaignKeys()`
et `deleteCampaign()` couvrent les deux clés immédiatement.

- [ ] **Step 3: Déclarer les globales et les accesseurs**

Dans `js/aria-gm.js`, près de `let gmFiles = []` :

```js
let gmMaps = [];          // [{ id, name, imageUrl, imagePath, sourceUrl, pois, positions }]
let activeMapId = null;   // map shown to the table (local: campaign_maps has no flag for it)
```

Près de `monstersKey()` / `filesKey()` :

```js
// Return the campaign-scoped localStorage key for maps.
function mapsKey()      { return campKey('maps'); }
// Return the campaign-scoped localStorage key for the active map id.
function activeMapKey() { return campKey('activeMap'); }

// The map currently shown to the table, or null when the campaign has none.
function _activeMap() { return gmMaps.find(m => m.id === activeMapId) || null; }
```

- [ ] **Step 4: Ajouter la synchronisation débouncée et `saveMaps()`**

Près de `debouncedSyncFiles` :

```js
const debouncedSyncMaps = _debouncedListSync(ENT.map, () => gmMaps, true);
```

Près de `saveMonsters()` :

```js
// Persist maps and push them to Supabase. Every map mutation goes through here, so the
// broadcast added in Task 7 has exactly one place to hang off.
function saveMaps() {
    localStorage.setItem(mapsKey(), JSON.stringify(gmMaps));
    localStorage.setItem(activeMapKey(), activeMapId || '');
    debouncedSyncMaps();
}
```

- [ ] **Step 5: Charger à l'entrée dans la campagne**

Dans `loadCampaignState()`, à côté de `gmFiles = JSON.parse(…)` :

```js
    gmMaps      = JSON.parse(localStorage.getItem(mapsKey()) || '[]');
    activeMapId = localStorage.getItem(activeMapKey()) || null;
    // The active map is a local preference (campaign_maps has no flag for it), so a
    // fresh device falls back to the first map rather than showing nothing.
    if (!_activeMap()) activeMapId = gmMaps[0] ? gmMaps[0].id : null;
```

Ajouter `'| maps:', gmMaps.length` au `console.log` de fin de fonction.

- [ ] **Step 6: Relire depuis Supabase**

Dans `loadFromSupabase()` (côté MJ), ajouter `sbSelect(ENT.map.table, byPos)` au `Promise.all`
et `maps` au tableau destructuré, puis, à côté des autres `store(…)` :

```js
            store('maps', maps.map(m => fromRow(ENT.map, m)));
```

**Ne pas** l'entourer d'un `if (maps.length)` : les tables enfants du MJ se restaurent
inconditionnellement — une table vide veut dire « supprimé sur un autre appareil », et un garde
ressusciterait les cartes supprimées à la synchro suivante.

`_syncAllGMData()` est le seul endroit du fichier où la liste des entités campagne-scopées est
maintenue à la main plutôt que dérivée de `ENT` — elle tourne à chaque `loadFromSupabase()` réussi
et à la création d'une clé de sauvegarde (`confirmNewKey()`). Une nouvelle entité doit donc y être
ajoutée explicitement, sinon elle reste locale-only dès que sa synchro par-champ existe. Dans
`_syncAllGMData()`, à côté des autres `sbPutAll` de la boucle par campagne (après celui de
`ENT.campaignFile`) :

```js
        await sbPutAll(ENT.map, _campJSON('maps', cid, []), cid, true);
```

- [ ] **Step 7: Vérifier**

Ouvrir `views/aria-gm.html`, entrer dans une campagne, console :

```js
gmMaps.push({ id: uid(), name: 'Test', imageUrl: '', imagePath: '', sourceUrl: '', pois: [], positions: {} });
activeMapId = gmMaps[0].id;
saveMaps();
```

Attendu, dans l'ordre :
1. `localStorage.getItem(mapsKey())` renvoie le JSON de la carte.
2. Après ~1 s, `await sbSelect('campaign_maps', 'campaign_id=eq.' + currentCampaignId)` renvoie
   une ligne, avec `pois: []` et `positions: {}`.
3. `Ctrl+Shift+R`, rentrer dans la campagne : `gmMaps.length === 1` et `activeMapId === gmMaps[0].id`.
4. Noter l'id de campagne, supprimer la campagne depuis l'écran de sélection, puis
   `await sbSelect('campaign_maps', 'campaign_id=eq.<ancien id>')` → `[]`. C'est la cascade
   dérivée de `ENT` : ce point vérifie qu'il n'y avait effectivement rien à câbler.

- [ ] **Step 8: Mettre à jour `commits`**

Écraser `commits`, première ligne `feat: modele de donnees des cartes de campagne`, puis un tiret
par fichier touché (`js/aria-supabase.js`, `js/aria-gm.js`) disant quoi et pourquoi.

---

### Task 3: Onglet Carte et barre de cartes (MJ)

**Files:**
- Modify: `views/aria-gm.html` — bouton d'onglet entre `Monstres` et `Jets`, et le
  `<div class="tab-content map-tab" id="tab-map">`
- Modify: `js/aria-gm.js` — troisième branche de `_renderGroupBar()`, gestion des cartes,
  `renderMapTab()`
- Modify: `css/aria-gm.css` — mise en page de l'onglet

**Interfaces:**
- Consomme : `gmMaps`, `activeMapId`, `_activeMap()`, `saveMaps()` (Task 2) ; `_renderGroupBar()`,
  `_groupChip()`, `el()`, `fill()`, `uid()`, `switchTab()`, `renderTabLayout()`.
- Produit :
  - `function renderMapTab(): void` — rendu complet de l'onglet, appelé par `switchTab` et par
    toute mutation de carte
  - `function addMap(): void` / `selectMap(id)` / `renameMap(id)` / `deleteMap(id)`
  - la branche `'map'` de `_renderGroupBar()` et son drapeau `noTous`

- [ ] **Step 1: Ajouter le bouton d'onglet et le conteneur**

Dans `views/aria-gm.html`, entre les boutons `Monstres` et `Jets` (ligne 115) :

```html
                <button class="tab-btn" data-tab="tab-map" onclick="switchTab('tab-map',this)">Carte</button>
```

Et, après le `</div>` du bloc `id="tab-monsters"` :

```html
            <div class="tab-content map-tab" id="tab-map">
                <div class="map-bar" id="map-group-bar"></div>
                <div class="map-toolbar" id="map-toolbar"></div>
                <div class="map-stage" id="map-stage"></div>
            </div>
```

- [ ] **Step 2: Ajouter la troisième branche de `_renderGroupBar()`**

Dans `js/aria-gm.js`, remplacer le ternaire à deux branches en tête de `_renderGroupBar(type)`
par une table à trois entrées, et gérer le drapeau `noTous` — une carte est toujours active,
il n'y a pas d'état « toutes » :

```js
function _renderGroupBar(type) {
    const cfgs = {
        monster: { barId: 'monster-group-bar', groups: monsterGroups, activeId: activeMonsterGroupId, total: monsters.length,
            countOf: id => monsters.reduce((n, m) => n + (monsterGroupAssign[m.id] === id ? 1 : 0), 0),
            select: selectMonsterGroup, add: addMonsterGroup, rename: renameMonsterGroup, del: deleteMonsterGroup },
        file: { barId: 'file-group-bar', groups: fileGroups, activeId: activeFileGroupId, total: gmFiles.length,
            countOf: id => gmFiles.reduce((n, f) => n + (fileGroupAssign[f.id] === id ? 1 : 0), 0),
            select: selectFileGroup, add: addFileGroup, rename: renameFileGroup, del: deleteFileGroup },
        // A map is always active: there is no "all maps" state, so no Tous chip, and the
        // count is the map's POIs rather than a membership tally.
        map: { barId: 'map-group-bar', groups: gmMaps, activeId: activeMapId, noTous: true, total: 0,
            countOf: id => (gmMaps.find(m => m.id === id)?.pois || []).length,
            select: selectMap, add: addMap, rename: renameMap, del: deleteMap },
    };
    const cfg = cfgs[type];
    const bar = document.getElementById(cfg.barId);
    if (!bar) return;
    bar.innerHTML = '';
    if (!cfg.noTous)
        bar.appendChild(_groupChip({ id: '', name: 'Tous', count: cfg.total, isTous: true, active: cfg.activeId === null, type, cfg }));
    cfg.groups.forEach(g => bar.appendChild(_groupChip({ id: g.id, name: g.name, count: cfg.countOf(g.id), isTous: false, active: cfg.activeId === g.id, type, cfg })));
    const add = document.createElement('button');
    add.className = 'group-chip-add'; add.title = type === 'map' ? 'Nouvelle carte' : 'Nouveau groupe'; add.textContent = '＋';
    add.addEventListener('click', cfg.add);
    bar.appendChild(add);
}
```

- [ ] **Step 3: Écrire la gestion des cartes**

Dans `js/aria-gm.js`, dans une nouvelle section `CARTE` en fin de fichier :

```js
// ═══════════════════════════════════════════
//  CARTE
// ═══════════════════════════════════════════

function addMap() {
    const name = prompt('Nom de la nouvelle carte :', 'Carte ' + (gmMaps.length + 1));
    if (name === null) return;
    const m = { id: uid(), name: name.trim() || ('Carte ' + (gmMaps.length + 1)),
                imageUrl: '', imagePath: '', sourceUrl: '', pois: [], positions: {} };
    gmMaps.push(m);
    activeMapId = m.id;
    saveMaps();
    renderMapTab();
}

function selectMap(id) { activeMapId = id; saveMaps(); renderMapTab(); }

function renameMap(id) {
    const m = gmMaps.find(x => x.id === id); if (!m) return;
    const name = prompt('Nouveau nom de la carte :', m.name);
    if (name === null) return;
    const t = name.trim(); if (!t || t === m.name) return;
    m.name = t; saveMaps(); renderMapTab();
}

// Delete a map, its Supabase row and its stored image. The image lives in the
// campaign-files bucket but was never added to gmFiles, so nothing else references it.
async function deleteMap(id) {
    const m = gmMaps.find(x => x.id === id); if (!m) return;
    if (!confirm(`Supprimer la carte « ${m.name} » et ses ${m.pois.length} point(s) d'intérêt ?`)) return;
    if (m.imagePath) await deleteFileFromStorage(m.imagePath);
    sbDelete(ENT.map.table, 'id=eq.' + encodeURIComponent(id));
    gmMaps = gmMaps.filter(x => x.id !== id);
    if (activeMapId === id) activeMapId = gmMaps[0] ? gmMaps[0].id : null;
    saveMaps();
    renderMapTab();
}
```

- [ ] **Step 4: Écrire `renderMapTab()` (squelette)**

Toujours dans la section `CARTE`. Le contenu de `#map-stage` et de `#map-toolbar` est complété
par les tâches 4, 5 et 9 ; ici on rend la barre et l'état vide.

```js
// Render the whole Carte tab. Every map mutation calls this; there is no partial render,
// the tab holds at most one image and a handful of pins.
function renderMapTab() {
    // Drop a stale active id (map deleted on another device), then render the chips.
    if (activeMapId && !_activeMap()) activeMapId = gmMaps[0] ? gmMaps[0].id : null;
    _renderGroupBar('map');
    const stage = document.getElementById('map-stage');
    const bar   = document.getElementById('map-toolbar');
    if (!stage || !bar) return;
    const m = _activeMap();
    if (!m) {
        fill(bar);
        fill(stage, el('div', { className: 'map-empty', textContent: 'Aucune carte. Créez-en une avec ＋.' }));
        return;
    }
    fill(bar);    // Task 4 fills the toolbar
    fill(stage, el('div', { className: 'map-empty', textContent: 'Aucune image. Importez-en une.' }));
}
```

- [ ] **Step 5: Appeler `renderMapTab()` au bon moment**

`switchTab()` (dans `aria-shared.js`) ne rend aucun onglet : le panneau MJ rend tout à l'entrée
dans la campagne. Ajouter donc `renderMapTab();` dans `initApp()` de `js/aria-gm.js`, juste
après `renderMonsters();`. Toute mutation de carte rappelle `renderMapTab()` elle-même.

- [ ] **Step 6: Styler l'onglet**

Dans `css/aria-gm.css`, en fin de fichier, avant le bloc `body.light-mode` :

Le sélecteur qui pilote `display` doit rester basé sur la classe `.map-tab`, jamais sur
l'id `#tab-map` : un sélecteur d'ID l'emporterait sur `.tab-content.active:not(.split-primary)
{ display: none; }` (le repli du moteur de volets sous 900px), laissant un volet Carte non
prioritaire visible en permanence au lieu de se cacher.

```css
/* ─── Carte ─── */
/* display lives on the .map-tab class, not the #tab-map id: an ID selector would
   also outrank .tab-content.active:not(.split-primary){display:none} at <900px
   split-mode, leaving a non-primary Carte pane stuck visible. */
.tab-content.active.map-tab { display: flex; flex-direction: column; gap: 8px; height: 100%; min-height: 0; }
.map-bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.map-toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
/* The stage centres the frame and scrolls if the pane is smaller than the minimum. */
.map-stage { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: auto; }
.map-empty { color: var(--parchment-dim); font-style: italic; padding: 24px; text-align: center; }
```

- [ ] **Step 7: Vérifier**

`Ctrl+Shift+R` sur `views/aria-gm.html`, entrer dans une campagne, onglet `Carte`.

1. L'onglet apparaît entre `Monstres` et `Jets`, et il n'y a **pas** de pastille `Tous`.
2. `＋` crée « Carte 1 », qui devient la pastille active avec un compteur `0`.
3. `✎` sur la pastille active la renomme ; `✕` demande confirmation et la supprime.
4. Créer deux cartes, cliquer l'une puis l'autre : la pastille active suit.
5. `Ctrl+Shift+R` : les cartes et la carte active sont retrouvées.
6. Détacher l'onglet dans un volet étroit (moteur de volets) : la barre passe à la ligne, rien
   ne déborde horizontalement.

- [ ] **Step 8: Mettre à jour `commits`**

Première ligne : `feat: onglet Carte et barre de cartes cote MJ`.

---

### Task 4: Fond de carte — import, provenance, habillage

**Files:**
- Modify: `js/aria-gm.js` — `MAP_GENERATORS`, `handleMapImageUpload()`, barre d'outils,
  rendu du cadre dans `renderMapTab()`
- Modify: `views/aria-gm.html` — `<input type="file">` caché dans `#tab-map`
- Modify: `css/aria-panel.css` — `.aria-frame`, `.aria-map`, vignettage, grain, liseré,
  `.map-stage`, `.map-empty` : **identiques des deux côtés**, l'accent passe par
  `var(--accent-rgb)`, donc une seule règle rend violet ici et braise chez le joueur
- Modify: `css/aria-gm.css` — la barre d'outils, qui est propre au MJ

**Interfaces:**
- Consomme : `_activeMap()`, `saveMaps()`, `renderMapTab()` (tâches 2–3) ;
  `uploadFileToStorage()`, `deleteFileFromStorage()` (`js/aria-gm.js`), `el()`, `fill()`.
- Produit :
  - `const MAP_GENERATORS` — `[{ label, url: seed => string }]`
  - `function _mapFrame(m, layers): HTMLElement` — le cadre `.aria-frame` + `<img class="aria-map">`,
    réutilisé tel quel par les tâches 5, 9 et 15 en lui passant des couches supplémentaires
  - `async function handleMapImageUpload(input): Promise<void>`

**Correction assumée du croquis de la spec.** La spec pose `filter`, `::before` et `::after`
sur `.aria-map`. Ce n'est pas rendable tel quel : les pseudo-éléments ne s'affichent pas sur un
`<img>` (élément remplacé), et un `filter` sur un ancêtre teinterait aussi les punaises et les
jetons. On garde donc les quatre effets, répartis : `filter` sur l'`<img class="aria-map">`,
vignettage et grain sur `.aria-frame::after` / `::before`, liseré sur `.aria-frame`.

- [ ] **Step 1: Ajouter l'input fichier**

Dans `views/aria-gm.html`, dans `#tab-map`, avant `#map-stage` :

```html
                <input type="file" id="map-image-input" accept="image/*" style="display:none"
                       onchange="handleMapImageUpload(this)">
                <span class="map-upload-status" id="map-upload-status"></span>
```

Le statut est un `<span>` **statique** dans le HTML, pas construit dans le `fill(bar, ...)` de
l'étape 5 : ce `fill` fait un `replaceChildren()` sur la barre d'outils à chaque rendu, donc un
nœud créé à l'intérieur serait détaché du document au rendu suivant et une écriture différée
dans `status.textContent` (le cas de `handleMapImageUpload`, qui écrit après un `await`) n'atteindrait
plus l'écran — le même raisonnement qui place déjà `#file-upload-progress` hors de ce que
`renderGmFiles()` reconstruit côté Fichiers.

- [ ] **Step 2: Déclarer les générateurs**

Dans la section `CARTE` de `js/aria-gm.js` :

```js
// Shortcuts to map GENERATORS — tools that take parameters and a seed in their URL, so
// opening one pre-filled is worth code. Hand-driven editors (Inkarnate, Wonderdraft) have
// nothing to pre-fill: for those the import button is already the whole integration.
// Adding one is one line.
const MAP_GENERATORS = [
    { label: 'Ville médiévale', url: s => `https://watabou.github.io/city-generator/?size=15&seed=${s}` },
    { label: 'Village',         url: s => `https://watabou.github.io/village-generator/?seed=${s}` },
    { label: 'Royaume',         url: () => 'https://azgaar.github.io/Fantasy-Map-Generator/' },
];

// Open a generator with a fresh seed and remember the URL we opened as the map's source,
// so `Rouvrir la source` comes back to the same town at the same settings. The seed lives
// in the URL — storing it separately would be the same information twice.
function openMapGenerator(gen) {
    const m = _activeMap(); if (!m) return;
    const url = gen.url(Math.floor(Math.random() * 1e9));
    m.sourceUrl = url;
    saveMaps();
    renderMapTab();
    window.open(url, '_blank', 'noopener');
}
```

- [ ] **Step 3: Écrire l'import d'image**

```js
// Upload a map background. It goes to the campaign-files bucket like any GM file but is
// NOT added to gmFiles, so it never shows up in the Fichiers tab. Replacing an image
// deletes the previous object rather than leaking it in storage.
async function handleMapImageUpload(input) {
    const file = input.files[0];
    input.value = '';
    const m = _activeMap();
    if (!file || !m) return;
    if (file.size > 20 * 1024 * 1024) { alert('Image trop volumineuse (max 20 Mo).'); return; }
    const status = document.getElementById('map-upload-status');
    if (status) status.textContent = 'Envoi en cours…';
    try {
        const old = m.imagePath;
        const { path, url } = await uploadFileToStorage(file);
        m.imagePath = path;
        m.imageUrl  = url;
        saveMaps();
        renderMapTab();
        if (old) deleteFileFromStorage(old);
        if (status) { status.textContent = '✓ Image importée.'; setTimeout(() => { status.textContent = ''; }, 2500); }
    } catch (e) {
        if (status) status.textContent = `Erreur : ${e.message}`;
        console.warn('[GM] map image upload failed:', e);
    }
}
```

- [ ] **Step 4: Écrire le cadre réutilisable**

```js
// The map frame: a shrink-wrapping container around the image, plus whatever layers the
// caller passes. Frame and image both cap at 100% of the stage, so the frame is exactly the
// rendered image — which is what makes the percentage coordinates land on the right pixel
// whatever the pane's aspect ratio.
function _mapFrame(m, ...layers) {
    return el('div', { className: 'aria-frame', id: 'map-frame' },
        el('img', { className: 'aria-map', src: m.imageUrl, alt: m.name, draggable: false }),
        ...layers);
}
```

- [ ] **Step 5: Remplir la barre d'outils et le cadre dans `renderMapTab()`**

Remplacer les deux `fill(...)` de fin de `renderMapTab()` (Task 3, Step 4) par :

```js
    fill(bar,
        el('button', { className: 'gm-btn', textContent: m.imageUrl ? 'Remplacer l’image' : 'Importer une image',
            onclick: () => document.getElementById('map-image-input').click() }),
        el('span', { className: 'map-gen-label', textContent: 'Générer :' }),
        MAP_GENERATORS.map(g => el('button', { className: 'gm-btn ghost', textContent: g.label,
            onclick: () => openMapGenerator(g) })),
        el('input', { className: 'map-source-input', value: m.sourceUrl || '', placeholder: 'URL source (optionnel)',
            // Editable on purpose: options changed inside the generator land on a URL Aria
            // never saw, and pasting the address bar back is the only way to fix that.
            oninput: e => { m.sourceUrl = e.target.value; saveMaps(); } }),
        m.sourceUrl && el('button', { className: 'gm-btn ghost', textContent: 'Rouvrir la source',
            onclick: () => window.open(m.sourceUrl, '_blank', 'noopener') }));

    if (!m.imageUrl) {
        fill(stage, el('div', { className: 'map-empty', textContent: 'Aucune image. Importez-en une ou générez-en une.' }));
        return;
    }
    fill(stage, _mapFrame(m));
```

`sourceUrl` est **opaque** : Aria ne l'interprète jamais, elle l'ouvre. Elle accepte donc aussi
bien un projet Inkarnate qu'un lien quelconque, et reste vide pour une carte scannée.

- [ ] **Step 6: Habiller la carte**

Dans `css/aria-panel.css` (l'habillage est identique dans les deux panneaux et ne nomme que des
handles d'accent, jamais une couleur) :

```css
/* The frame shrink-wraps the rendered image: both cap at 100% of the stage, so a
   percentage coordinate always lands on the same pixel of the picture. */
.aria-frame { position: relative; display: inline-block; max-width: 100%; max-height: 100%;
              box-shadow: inset 0 0 0 1px rgba(var(--accent-rgb), .4), inset 0 0 26px rgba(9,8,4,.85); }
.aria-map   { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto;
              filter: sepia(.45) saturate(.75) contrast(1.08) brightness(.92); }
/* Vignette and grain sit above the image and below the pins; both are inert to the mouse
   so a click still reaches the frame's placement handler. */
.aria-frame::after  { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 1;
                      background: radial-gradient(ellipse at 50% 45%, transparent 52%, rgba(9,8,4,.72) 100%); }
.aria-frame::before { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 1;
                      opacity: .16; mix-blend-mode: overlay;
                      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
```

Et dans `css/aria-gm.css`, la barre d'outils, qui n'existe que côté MJ :

```css
.map-gen-label { color: var(--parchment-dim); font-size: 12px; }
.map-source-input { flex: 1; min-width: 160px; background: var(--bg2); border: 1px solid var(--border);
                    color: var(--parchment); border-radius: var(--radius); padding: 4px 8px; font-size: 12px; }
.map-upload-status { color: var(--parchment-dim); font-size: 12px; }
```

Déplacer aussi `#tab-map`, `.map-stage` et `.map-empty` de `css/aria-gm.css` (tâche 3, step 6)
vers `css/aria-panel.css` : le joueur en aura besoin à l'identique en tâche 8. `.map-bar` et
`.map-toolbar` restent côté MJ, le joueur n'a ni l'une ni l'autre.

Le vignettage assombrit les bords, là où iront les zones de brouillard de la phase 6 : les deux
se renforcent, c'est voulu.

- [ ] **Step 7: Vérifier**

Servir en HTTP (`python -m http.server 8080`) — l'upload passe par `fetch` vers Supabase Storage.

1. Importer un PNG : il s'affiche, en sépia, avec vignettage, grain et liseré violet.
2. Recharger : l'image revient (elle vient de son URL publique).
3. Réimporter une autre image : l'ancienne est remplacée, et l'objet précédent a disparu du
   bucket `campaign-files` (vérifier dans le tableau de bord Supabase).
4. Cliquer `Ville médiévale` : un onglet s'ouvre sur Watabou avec une graine, et le champ
   `URL source` s'est rempli avec exactement cette URL.
5. `Rouvrir la source` ramène sur la même ville avec les mêmes réglages.
6. Éditer le champ source à la main : la valeur est conservée après rechargement.
7. Rétrécir le volet : l'image reste entière et centrée, sans débordement horizontal.
8. Vérifier que l'image **n'apparaît pas** dans l'onglet `Fichiers`.

- [ ] **Step 8: Mettre à jour `commits`**

Première ligne : `feat: import du fond de carte, provenance et habillage`.

---

### Task 5: Points d'intérêt côté MJ — pose, glisser, fiche flottante

**Files:**
- Modify: `js/aria-gm.js` — couche de punaises, gestes, fiche flottante
- Modify: `css/aria-gm.css` — punaises, étiquettes, fiche

**Interfaces:**
- Consomme : `_mapFrame()`, `_activeMap()`, `saveMaps()`, `renderMapTab()`, `el()`, `fill()`, `uid()`.
- Produit :
  - `let mapSelectedPoiId = null`
  - `function _mapPinLayer(m): HTMLElement` — la couche `.map-pins`, réutilisée par la tâche 9
  - `function mapAddPoi(x, y): void` / `mapMovePoi(id, x, y)` / `mapSelectPoi(id)` / `mapDeletePoi(id)`
  - `function _poiCard(m, poi): HTMLElement` — la fiche flottante ; la tâche 9 y ajoute des sections

- [ ] **Step 1: Déclarer l'état de sélection**

Près de `gmMaps` :

```js
let mapSelectedPoiId = null;   // POI whose floating card is open (GM tab only)
```

- [ ] **Step 2: Écrire les gestes**

```js
// Percentage coordinates of a pointer event inside the map frame. Percentages, not pixels:
// the frame is exactly the rendered image, so these survive any pane size.
function _mapPct(e, frame) {
    const r = frame.getBoundingClientRect();
    return {
        x: Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width)  * 100)),
        y: Math.min(100, Math.max(0, ((e.clientY - r.top)  / r.height) * 100)),
    };
}

function mapAddPoi(x, y) {
    const m = _activeMap(); if (!m) return;
    const name = prompt('Nom du point d’intérêt :', 'Nouveau lieu');
    if (name === null) return;
    const poi = { id: uid(), name: name.trim() || 'Nouveau lieu', x, y,
                  publicDesc: '', gmNote: '', discoveredBy: [], zone: [] };
    m.pois.push(poi);
    mapSelectedPoiId = poi.id;
    saveMaps();
    renderMapTab();
}

function mapSelectPoi(id) { mapSelectedPoiId = mapSelectedPoiId === id ? null : id; renderMapTab(); }

function mapDeletePoi(id) {
    const m = _activeMap(); if (!m) return;
    const poi = m.pois.find(p => p.id === id); if (!poi) return;
    if (!confirm(`Supprimer « ${poi.name} » ?`)) return;
    m.pois = m.pois.filter(p => p.id !== id);
    // A token can't stand on a POI that no longer exists. Deleting the POI takes its zone
    // with it too — a zone belongs to a POI, there is no independent zone object.
    Object.keys(m.positions).forEach(k => { if (m.positions[k] === id) delete m.positions[k]; });
    if (mapSelectedPoiId === id) mapSelectedPoiId = null;
    saveMaps();
    renderMapTab();
}
```

- [ ] **Step 3: Écrire la couche de punaises**

```js
// The pin layer: one element per POI, positioned in percentages. Names arrive from the GM
// but tokens carry player names taken from presence, so everything is built with el() and
// textContent — never a string template.
function _mapPinLayer(m) {
    const layer = el('div', { className: 'map-pins' });
    m.pois.forEach(p => {
        const discovered = (p.discoveredBy || []).length > 0;
        const pin = el('div', {
            className: 'map-pin' + (discovered ? ' discovered' : '') + (p.id === mapSelectedPoiId ? ' selected' : ''),
            style: { left: p.x + '%', top: p.y + '%' },
            onpointerdown: e => _mapDragPin(e, p),
        },
            el('span', { className: 'map-pin-dot' }),
            el('span', { className: 'map-pin-label', textContent: p.name }));
        layer.append(pin);
    });
    return layer;
}

// Drag a pin, or select it when the pointer never really moved. One handler for both, so a
// click cannot be swallowed by a drag that travelled two pixels. `moved` compares against the
// gesture's origin (x0/y0), captured once — comparing against poi.x/poi.y as they get reassigned
// on every move would measure one frame's delta instead of the total displacement, and a slow
// drag (well under 0.5% per coalesced pointermove) would never trip it, silently discarding the
// move on release. pointercancel runs the same teardown as pointerup: a gesture that ends
// abnormally (touch-scroll takeover, an OS gesture, alt-tab mid-drag) fires neither pointerup nor
// click, and the pin commonly outlives that (typing in the card's textareas calls saveMaps()
// without a re-render), so a leaked listener pair would double up on the next real drag.
function _mapDragPin(e, poi) {
    e.preventDefault();
    const frame = document.getElementById('map-frame');
    const pin = e.currentTarget;
    const x0 = poi.x, y0 = poi.y;
    let moved = false;
    pin.setPointerCapture(e.pointerId);
    const onMove = ev => {
        // Guards a re-render mid-drag detaching the frame/pin — not reachable yet, but Task 7's
        // Ably state receive path will make it so. A detached frame's rect is zero-sized, and
        // dividing by that writes NaN into poi.x/poi.y.
        if (!pin.isConnected) return;
        const { x, y } = _mapPct(ev, frame);
        if (Math.abs(x - x0) > .5 || Math.abs(y - y0) > .5) moved = true;
        poi.x = x; poi.y = y;
        pin.style.left = x + '%'; pin.style.top = y + '%';
    };
    const end = () => {
        pin.removeEventListener('pointermove', onMove);
        pin.removeEventListener('pointerup', end);
        pin.removeEventListener('pointercancel', end);
        if (moved) { saveMaps(); renderMapTab(); }
        else mapSelectPoi(poi.id);
    };
    pin.addEventListener('pointermove', onMove);
    pin.addEventListener('pointerup', end);
    pin.addEventListener('pointercancel', end);
}
```

- [ ] **Step 4: Écrire la fiche flottante**

```js
// The floating POI card. It anchors beside the selected pin and never on top of it: past
// 55% of the width it flips to the left side. The three text layers are the whole point —
// gmNote is the one that must never leave this panel.
function _poiCard(m, poi) {
    const side = poi.x > 55 ? ' left' : '';
    return el('div', { className: 'map-poi-card' + side, style: { left: poi.x + '%', top: poi.y + '%' } },
        el('div', { className: 'map-poi-head' },
            el('input', { className: 'map-poi-name', value: poi.name,
                oninput: e => { poi.name = e.target.value; saveMaps(); } }),
            el('button', { className: 'map-poi-del', title: 'Supprimer', textContent: '✕',
                onclick: () => mapDeletePoi(poi.id) })),
        el('label', { className: 'map-poi-label', textContent: 'Description publique' }),
        el('textarea', { className: 'map-poi-text', value: poi.publicDesc || '',
            placeholder: 'Ce que lisent les joueurs qui ont découvert le lieu',
            oninput: e => { poi.publicDesc = e.target.value; saveMaps(); } }),
        el('label', { className: 'map-poi-label', textContent: 'Note MJ (privée)' }),
        el('textarea', { className: 'map-poi-text gm', value: poi.gmNote || '',
            placeholder: 'Ne quitte jamais ce panneau',
            oninput: e => { poi.gmNote = e.target.value; saveMaps(); } }));
}
```

- [ ] **Step 5: Brancher les couches dans `renderMapTab()`**

Remplacer `fill(stage, _mapFrame(m));` par :

```js
    const sel = m.pois.find(p => p.id === mapSelectedPoiId) || null;
    const frame = _mapFrame(m, _mapPinLayer(m), sel && _poiCard(m, sel));
    // A click on the background places a POI; a click on a pin or the card must not.
    frame.addEventListener('click', e => {
        if (e.target.closest('.map-pin') || e.target.closest('.map-poi-card')) return;
        if (mapSelectedPoiId) { mapSelectedPoiId = null; renderMapTab(); return; }
        const { x, y } = _mapPct(e, frame);
        mapAddPoi(x, y);
    });
    fill(stage, frame);
```

- [ ] **Step 6: Styler punaises et fiche**

Dans `css/aria-panel.css` — punaises, étiquettes et géométrie de la fiche sont identiques des
deux côtés (la tâche 8 les réutilise telles quelles) :

```css
.map-pins { position: absolute; inset: 0; z-index: 2; }
.map-pin { position: absolute; transform: translate(-50%, -50%); cursor: grab;
           display: flex; flex-direction: column; align-items: center; gap: 2px; touch-action: none; }
.map-pin-dot { width: 12px; height: 12px; border-radius: 50%;
               border: 1px dashed var(--parchment-dim); background: transparent; }
.map-pin.discovered .map-pin-dot { border: none; background: var(--gold);
                                   box-shadow: 0 0 10px 3px rgba(var(--accent-rgb), .45); }
.map-pin.selected  .map-pin-dot { box-shadow: 0 0 0 3px var(--gold-light), 0 0 12px 4px rgba(var(--accent-rgb), .6); }
.map-pin-label { font-family: 'Cinzel', serif; font-size: 11px; white-space: nowrap;
                 color: var(--parchment-dim); text-shadow: 0 1px 3px rgba(0,0,0,.9); }
.map-pin.discovered .map-pin-label { color: var(--parchment); }
.map-poi-card { position: absolute; z-index: 3; width: 240px; transform: translate(18px, -50%);
                background: var(--bg2); border: 1px solid var(--border); border-radius: var(--radius);
                padding: 8px; display: flex; flex-direction: column; gap: 4px;
                box-shadow: 0 8px 24px rgba(0,0,0,.6); }
.map-poi-card.left { transform: translate(calc(-100% - 18px), -50%); }
.map-poi-label { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--parchment-dim); }
```

Et dans `css/aria-gm.css`, les champs d'édition, qui n'existent que côté MJ (la fiche du joueur
est en lecture seule) :

```css
.map-poi-head { display: flex; gap: 4px; align-items: center; }
.map-poi-name { flex: 1; background: var(--bg3); border: 1px solid var(--border);
                color: var(--parchment); border-radius: var(--radius); padding: 3px 6px; }
.map-poi-del { background: none; border: none; color: var(--parchment-dim); cursor: pointer; }
.map-poi-text { background: var(--bg3); border: 1px solid var(--border); color: var(--parchment);
                border-radius: var(--radius); padding: 4px 6px; font-size: 12px; min-height: 48px; resize: vertical; }
.map-poi-text.gm { border-color: rgba(var(--accent-rgb), .45); }
```

- [ ] **Step 7: Vérifier**

1. Cliquer le fond : une invite demande un nom, une punaise creuse apparaît **à l'endroit cliqué**
   et sa fiche s'ouvre à côté, jamais par-dessus.
2. Poser une punaise dans le tiers droit : la fiche bascule à gauche.
3. Glisser une punaise : elle suit le pointeur ; au relâchement la position est enregistrée
   (`Ctrl+Shift+R` la retrouve au même endroit).
4. Un clic sans déplacement sur une punaise ouvre/ferme sa fiche — il ne crée pas de POI.
5. Cliquer le fond alors qu'une fiche est ouverte la ferme sans créer de POI ; le clic suivant
   en crée un.
6. Taper dans les trois champs : le texte est conservé après rechargement.
7. Rétrécir le volet à ~350 px : les punaises restent à la même position **relative** à l'image.
8. `✕` supprime le POI après confirmation.

- [ ] **Step 8: Mettre à jour `commits`**

Première ligne : `feat: points d'interet cote MJ, pose, glisser et fiche flottante`.

---

## Phase 2 — Diffusion et vue joueur

### Task 6: `visiblePois()` et sa couverture

**Files:**
- Modify: `js/aria-supabase.js` — les deux filtres, en fin de fichier
- Modify: `js/aria-shared.selfcheck.js` — charger `aria-supabase.js` et asserter

**Interfaces:**
- Consomme : rien (fonctions pures).
- Produit, pour les tâches 7, 8, 9, 12, 13, 14 :
  - `function visiblePois(state, charId): Array<poi>` — les POI dessinés en clair.
    `charId` non nul = vue d'un joueur ; `charId` nul = vue table (union des découvertes).

C'est de la logique pure, donc **test d'abord**. `fogZones()` arrive en phase 6 (tâche 13) ;
ne pas l'écrire ici.

- [ ] **Step 1: Écrire le test qui échoue**

Dans `js/aria-shared.selfcheck.js`, après le bloc des pastilles de filtre, ajouter le chargement
de `aria-supabase.js` puis les assertions. Ce fichier ne touche aucune globale navigateur au
chargement, donc il s'évalue tel quel :

```js
// ── Map filters (aria-supabase.js) ────────────────────────────────────────────
// Loaded by all four pages, so both filters are written once. They decide what each
// spectator sees; a divergence here is a leak on stream.
const sbSrc = fs.readFileSync(__dirname + '/aria-supabase.js', 'utf8');
const { visiblePois } =
    new Function(sbSrc + '\nreturn { visiblePois };')();

const poiA = { id: 'a', name: 'Taverne', x: 10, y: 10, publicDesc: 'ok', discoveredBy: ['alice'], zone: [] };
const poiB = { id: 'b', name: 'Crypte',  x: 20, y: 20, publicDesc: '',   discoveredBy: ['bob'],   zone: [[0,0],[10,0],[10,10]] };
const poiC = { id: 'c', name: 'Secret',  x: 30, y: 30, publicDesc: '',   discoveredBy: [],        zone: [] };
const mapState = { pois: [poiA, poiB, poiC], fog: [], positions: {}, players: {} };

// 1. A player sees only the POIs whose discoveredBy contains them.
assert.deepStrictEqual(visiblePois(mapState, 'alice').map(p => p.id), ['a']);
assert.deepStrictEqual(visiblePois(mapState, 'bob').map(p => p.id),   ['b']);
// 2. The table view (null charId) sees the union of every discovery.
assert.deepStrictEqual(visiblePois(mapState, null).map(p => p.id), ['a', 'b']);
// 3. A POI nobody has discovered appears in neither view.
assert.ok(!visiblePois(mapState, 'alice').some(p => p.id === 'c'));
assert.ok(!visiblePois(mapState, null).some(p => p.id === 'c'));
// 4. An empty pois list does not throw.
assert.deepStrictEqual(visiblePois({ pois: [] }, 'alice'), []);
assert.deepStrictEqual(visiblePois({ pois: [] }, null), []);
```

- [ ] **Step 2: Lancer le test et le voir échouer**

```
node js/aria-shared.selfcheck.js
```

Attendu : `ReferenceError: visiblePois is not defined` (pas `TypeError` — le `return { visiblePois }` du `new Function(...)` référence le nom avant tout appel, donc c'est une erreur de résolution, pas un appel sur une valeur non-fonction).

- [ ] **Step 3: Écrire les fonctions**

En fin de `js/aria-supabase.js` :

```js
// ═══════════════════════════════════════════
//  MAP VISIBILITY
//  One broadcast reaches every client, so these two decide what each one draws. They
//  live here because aria-supabase.js is the only file the four pages all load —
//  aria-shared.js is panels-only. Given how many divergent twins this project has
//  already paid for, there must be exactly one copy of each rule.
// ═══════════════════════════════════════════

// What gets drawn in the clear: pin, name, description. A charId is a player's view;
// null is the table view (GM tab, GM overlay).
function visiblePois(state, charId) {
    return (state?.pois || []).filter(p => charId ? (p.discoveredBy || []).includes(charId)
                                                  : (p.discoveredBy || []).length > 0);
}
```

- [ ] **Step 4: Lancer le test et le voir passer**

```
node js/aria-shared.selfcheck.js
```

Attendu : `aria-shared self-check: all assertions passed`.

- [ ] **Step 5: Mettre à jour `commits`**

Première ligne : `feat: filtre de visibilite des points d'interet, couvert par le self-check`.

---

### Task 7: Diffusion de l'état de la carte (MJ)

**Files:**
- Modify: `js/aria-gm.js` — canal, construction du payload, publication débouncée, `request`,
  démontage

**Interfaces:**
- Consomme : `campaignChannel()` (`js/aria-shared.js`), `_activeMap()`, `saveMaps()`, `players`
  (Map de présence), `ablyInstance`, `initAbly()`, `switchCampaign()`.
- Produit, pour les tâches 8, 9, 11, 12, 14 :
  - `let ablyMap = null`
  - `function buildMapState(): object | null` — **le seul endroit** qui construit le payload
  - `function publishMapState(): void` — débouncé à 150 ms

Forme du payload `state`, fixée ici :

```js
{ mapId, name, imageUrl,
  pois: [{ id, name, x, y, publicDesc, discoveredBy, zone }],
  fog: [{ id, zone }],          // vide jusqu'à la tâche 14
  positions: { charId: poiId },
  players: { charId: name } }
```

- [ ] **Step 1: Déclarer le canal**

Près des autres canaux (`let ablyMusic = null;`) :

```js
let ablyMap = null;
```

- [ ] **Step 2: Écrire le constructeur de payload**

Dans la section `CARTE` :

```js
// The public projection of the active map. This is the ONLY place the broadcast payload is
// built, which is what makes "gmNote is never published" a property of the code rather than
// a convention — there is nowhere else it could slip in. `state` replaces on the receiving
// side, it is never patched, so no client can drift.
function buildMapState() {
    const m = _activeMap();
    if (!m) return null;
    const names = {};
    players.forEach((p, charId) => { names[charId] = p.name || ''; });
    return {
        mapId: m.id, name: m.name, imageUrl: m.imageUrl || '',
        pois: (m.pois || [])
            .filter(p => (p.discoveredBy || []).length > 0)
            .map(p => ({ id: p.id, name: p.name, x: p.x, y: p.y,
                         publicDesc: p.publicDesc || '', discoveredBy: p.discoveredBy || [],
                         zone: p.zone || [] })),
        fog: [],                      // Task 14 fills this with geometry only
        positions: m.positions || {},
        players: names,
    };
}

let _mapPubTimer = null;
// Broadcast the map, debounced: a drag fires a mutation per pointer move.
function publishMapState() {
    clearTimeout(_mapPubTimer);
    _mapPubTimer = setTimeout(() => {
        if (!ablyMap) return;
        const state = buildMapState();
        if (state) ablyMap.publish('state', state);
    }, 150);
}
```

- [ ] **Step 3: Rediffuser à chaque mutation**

Ajouter l'appel à la fin de `saveMaps()` (Task 2, Step 4) :

```js
function saveMaps() {
    localStorage.setItem(mapsKey(), JSON.stringify(gmMaps));
    localStorage.setItem(activeMapKey(), activeMapId || '');
    debouncedSyncMaps();
    publishMapState();
}
```

Toute mutation de carte passe déjà par `saveMaps()` : c'est la raison pour laquelle elle existe.

- [ ] **Step 4: S'abonner et répondre aux `request`**

Dans `initAbly()` de `js/aria-gm.js`, à côté de `ablyMusic = …` :

```js
        ablyMap = ablyInstance.channels.get(campaignChannel('aria-map'));
        // A late joiner — a player connecting an hour in, or an OBS browser source
        // restarted mid-session — asks, and gets the whole state back.
        ablyMap.subscribe('request', () => publishMapState());
```

Et, juste après l'abonnement à la présence (là où le MJ publie son état initial), une première
diffusion : `publishMapState();`

- [ ] **Step 5: Démonter à la sortie de campagne**

Deux sites, pas un seul : `switchCampaign()` **et** `saveConfig()` ferment tous deux
`ablyInstance` puis relancent `initAbly()` — `saveConfig()` compte autant que
`switchCampaign()`, sinon `ablyMap` reste pointé sur un canal lié à une connexion déjà
fermée pendant tout l'intervalle entre le `close()` et le prochain `initAbly()`.

Dans `switchCampaign()`, ajouter `ablyMap = null;` à la ligne qui remet les canaux à `null`
(à côté de `ablyMusic = null;`). L'ordre importe : `ablyInstance.close()` d'abord, comme
aujourd'hui.

Dans `saveConfig()`, même ajout à la ligne équivalente (`ablyInstance = null; ablyRolls =
null; ablyRollsHidden = null; ablyCards = null; ablyDamage = null; ablyMusic = null;`), juste
avant le `if (config.ablyKey) initAbly();` qui la suit.

- [ ] **Step 6: Rediffuser quand le roster bouge**

`state.players` porte les noms d'affichage venus de la présence. Dans `handlePresence()` (ou
juste après `applyPresenceSet` côté MJ, là où `renderPlayerCards()` est appelée), ajouter
`publishMapState();` — sinon un joueur qui se connecte après coup n'a pas son nom sur les jetons.

- [ ] **Step 7: Vérifier**

Deux onglets : `views/aria-gm.html` (campagne avec une carte et deux POI, dont un découvert par
personne) et une console d'écoute. Dans un troisième onglet, console de n'importe quelle page :

```js
const ably = new Ably.Realtime({ key: <clé>, transports: ['web_socket'] });
ably.channels.get('aria-map-' + '<JOINCODE>').subscribe('state', m => console.log(m.data));
ably.channels.get('aria-map-' + '<JOINCODE>').publish('request', {});
```

Attendu :
1. Un message arrive après le `request`.
2. `data.pois` ne contient **que** les POI découverts par au moins un joueur.
3. **Aucune** entrée de `data.pois` ne porte de champ `gmNote` — c'est le point à vérifier en
   premier, c'est la seule règle de sécurité du protocole.
4. Bouger une punaise dans le panneau MJ : un seul message part après le relâchement, pas un
   par mouvement de pointeur (compter les lignes de log).
5. `data.players` contient les joueurs connectés, par `charId`.

- [ ] **Step 8: Mettre à jour `commits`**

Première ligne : `feat: diffusion de l'etat de la carte sur aria-map`.

---

### Task 8: Onglet Carte côté joueur

**Files:**
- Modify: `views/aria-player.html` — bouton d'onglet masqué + `<div class="tab-content" id="tab-map">`
- Modify: `js/aria-player.js` — `CHAR_KEYS.map`, réception, rendu, visibilité de l'onglet
- Modify: `css/aria-player.css` — mêmes classes que le MJ, accent braise

**Interfaces:**
- Consomme : `visiblePois()` (Task 6), le payload `state` (Task 7), `campaignChannel()`,
  `charKey()`, `applyTabVisibility()`, `el()`, `fill()`, `initAbly()`, `switchCharacter()`.
- Produit, pour les tâches 10, 11 :
  - `let mapState = null` — dernier `state` reçu (ou relu du cache au chargement)
  - `let ablyMap = null`, `let mapSelectedPoiId = null`
  - `function renderMapTab(): void`
  - `function _mapVisible(): Array<poi>` — `visiblePois(mapState, currentCharId)`

**Le cache d'affichage.** `aria-map-{charId}` garde le dernier état reçu pour peindre la carte
tout de suite au rechargement ; le `request` publié à la connexion ramène l'état frais qui le
remplace. Ce n'est pas une source de vérité, c'est une image d'attente.

- [ ] **Step 1: Ajouter la clé de cache**

Dans `CHAR_KEYS` de `js/aria-player.js` :

```js
    map:    'aria-map-',
```

(La clé de notes `mapNotes` arrive en tâche 10. Les deux préfixes se ressemblent mais
`_dropCharacterKeys` supprime `préfixe + id` exactement, il n'y a pas de joker.)

- [ ] **Step 2: Ajouter l'onglet au HTML**

Dans `views/aria-player.html`, après le bouton `Documents` (ligne 201) :

```html
                <button class="tab-btn" id="tab-btn-map" data-tab="tab-map" style="display:none;" onclick="switchTab('tab-map',this)">Carte</button>
```

Et un conteneur à côté des autres `tab-content` :

```html
            <div class="tab-content" id="tab-map">
                <div class="map-title" id="map-title"></div>
                <div class="map-stage" id="map-stage"></div>
            </div>
```

- [ ] **Step 3: Déclarer l'état et la réception**

Dans `js/aria-player.js`, près des autres globales :

```js
let mapState = null;           // last public map state received (or the cached one)
let ablyMap = null;
let mapSelectedPoiId = null;
```

Dans `initAbly()`, à côté de `ablyMusic = …` :

```js
        ablyMap = ablyInstance.channels.get(campaignChannel('aria-map'));
        ablyMap.subscribe('state', msg => {
            // `state` replaces, it never patches: drop what we had and take this.
            mapState = msg.data || null;
            if (mapState) localStorage.setItem(charKey('map'), JSON.stringify(mapState));
            mapSelectedPoiId = null;
            applyTabVisibility();   // → renderMapTab, and shows the tab on first arrival
            renderMapTab();
        });
        // Covers arriving late: the GM answers a request with the whole state.
        ablyMap.publish('request', {});
```

Dans `loadCharacterState()`, à côté de `playerRollHistory = …` :

```js
    mapState = _charJSON('map', id, null);
```

Dans `switchCharacter()`, là où les canaux repassent à `null` :

```js
    ablyMap = null; mapState = null; mapSelectedPoiId = null;
```

- [ ] **Step 4: Afficher l'onglet quand une carte existe**

Dans `applyTabVisibility()`, sur le modèle de `Documents` :

```js
    const btnMap = document.getElementById('tab-btn-map');
    if (btnMap) btnMap.style.display = (mapState && mapState.imageUrl) ? '' : 'none';
```

et, dans le groupe des replis :

```js
    if (!(mapState && mapState.imageUrl) && document.getElementById('tab-map')?.classList.contains('active')) {
        switchTab('tab-skills', document.querySelector('.tab-btn'));
    }
```

Ajouter `renderMapTab();` juste avant `renderTabLayout();` en fin de fonction.

- [ ] **Step 5: Écrire le rendu**

```js
// ═══════════════════════════════════════════
//  CARTE
// ═══════════════════════════════════════════

// The POIs this character may see. One definition, shared with the GM tab and both
// overlays — see visiblePois() in aria-supabase.js.
function _mapVisible() { return visiblePois(mapState, currentCharId); }

// Tokens standing on one POI, as { charId, name, isMe }. Other players' tokens fall out
// for free: we only render POIs we know, so a player standing somewhere we don't know has
// nowhere to be drawn.
function _mapTokensAt(poiId) {
    const pos = mapState?.positions || {};
    return Object.keys(pos)
        .filter(cid => pos[cid] === poiId)
        .map(cid => ({ charId: cid, name: cid === currentCharId ? 'Vous' : (mapState.players?.[cid] || '?'),
                       isMe: cid === currentCharId }));
}

function renderMapTab() {
    const stage = document.getElementById('map-stage');
    const title = document.getElementById('map-title');
    if (!stage || !title) return;
    if (!mapState || !mapState.imageUrl) { title.textContent = ''; fill(stage); return; }
    title.textContent = mapState.name || '';

    const pins = el('div', { className: 'map-pins' });
    _mapVisible().forEach(p => {
        pins.append(el('div', {
            className: 'map-pin discovered' + (p.id === mapSelectedPoiId ? ' selected' : ''),
            style: { left: p.x + '%', top: p.y + '%' },
            onclick: () => { mapSelectedPoiId = mapSelectedPoiId === p.id ? null : p.id; renderMapTab(); },
        },
            el('span', { className: 'map-pin-dot' }),
            el('span', { className: 'map-pin-label', textContent: p.name }),
            el('div', { className: 'map-tokens' },
                _mapTokensAt(p.id).map(t => el('span', {
                    className: 'map-token' + (t.isMe ? ' me' : ''), textContent: t.name })))));
    });

    const sel = _mapVisible().find(p => p.id === mapSelectedPoiId) || null;
    fill(stage, el('div', { className: 'aria-frame', id: 'map-frame' },
        el('img', { className: 'aria-map', src: mapState.imageUrl, alt: mapState.name || '', draggable: false }),
        pins,
        sel && _poiCardPlayer(sel)));
}

// The floating card READS; the drawer writes. A floating card closes on an outside click,
// and a player is not made to type into a volatile container — see Task 10 for the drawer.
function _poiCardPlayer(poi) {
    return el('div', { className: 'map-poi-card' + (poi.x > 55 ? ' left' : ''),
                       style: { left: poi.x + '%', top: poi.y + '%' } },
        el('div', { className: 'map-poi-title', textContent: poi.name }),
        poi.publicDesc && el('div', { className: 'map-poi-desc', textContent: poi.publicDesc }));
}
```

- [ ] **Step 6: Fermer la fiche au clic extérieur**

À la fin de `renderMapTab()`, sur le cadre :

```js
    document.getElementById('map-frame')?.addEventListener('click', e => {
        if (e.target.closest('.map-pin') || e.target.closest('.map-poi-card')) return;
        if (mapSelectedPoiId) { mapSelectedPoiId = null; renderMapTab(); }
    });
```

- [ ] **Step 7: Styler**

**Ne rien recopier.** `.aria-frame`, `.aria-map`, les pseudo-éléments, `#tab-map`, `.map-stage`,
`.map-empty`, `.map-pins`, `.map-pin*` et la géométrie de `.map-poi-card` sont déjà dans
`css/aria-panel.css` (tâches 4 et 5) et ne nomment que `var(--gold)` / `var(--accent-rgb)` :
elles rendent en braise ici sans une ligne de plus. Ce qui suit est propre au joueur, et va dans
`css/aria-player.css`, avant le bloc `body.light-mode` :

```css
.map-title { font-family: 'Cinzel', serif; color: var(--gold-light); font-size: 14px; }
.map-tokens { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.map-token { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px;
             padding: 1px 7px; font-size: 10px; color: var(--parchment); white-space: nowrap; }
.map-token.me { border-color: var(--gold); color: var(--gold-light); }
.map-poi-title { font-family: 'Cinzel', serif; color: var(--gold-light); font-size: 13px; }
.map-poi-desc  { font-size: 12px; color: var(--parchment); white-space: pre-wrap; }
```

`.map-tokens` / `.map-token` sont, elles, communes : les poser dans `css/aria-panel.css`, la
tâche 9 les réutilise côté MJ. Seule la variante `.map-token.me` (« Vous ») reste ici — le MJ
n'a pas de jeton.

- [ ] **Step 8: Vérifier**

Deux onglets, MJ et joueur, sur la même campagne (le joueur a le bon code de liaison).

1. Tant que le MJ n'a pas de carte, l'onglet `Carte` du joueur **n'apparaît pas**.
2. Le MJ importe une image : l'onglet apparaît côté joueur, sans rechargement.
3. Un POI non découvert n'est **pas dessiné du tout** côté joueur — ni punaise, ni silhouette,
   ni point d'interrogation.
4. Ajouter à la main `discoveredBy` du joueur (console MJ : `_activeMap().pois[0].discoveredBy.push('<charId>'); saveMaps()`)
   → la punaise apparaît côté joueur avec son nom et sa description.
5. Poser un jeton à la main (console MJ : `_activeMap().positions['<charId>'] = '<poiId>'; saveMaps()`)
   → une pastille `Vous` apparaît sous la punaise côté joueur.
6. Cliquer la punaise ouvre la fiche ; cliquer ailleurs la ferme.
7. `Ctrl+Shift+R` côté joueur : la carte est peinte immédiatement depuis le cache, puis
   remplacée par l'état frais (les deux doivent être identiques).
8. Changer de personnage puis revenir : pas de fuite de la carte de l'autre personnage.

- [ ] **Step 9: Mettre à jour `commits`**

Première ligne : `feat: onglet Carte cote joueur, punaises et jetons`.

---

### Task 9: MJ — Amener ici, Découvert par, Vue table

**Files:**
- Modify: `js/aria-gm.js` — jetons dans `_mapPinLayer()`, sections de `_poiCard()`, bascule de vue
- Modify: `css/aria-gm.css` — jetons, cases

**Interfaces:**
- Consomme : `_mapPinLayer()`, `_poiCard()`, `saveMaps()`, `visiblePois()`, `players`.
- Produit :
  - `let mapTableView = false`
  - `function mapBringHere(charId, poiId): void` — pose le jeton **et** découvre le POI
  - `function mapToggleDiscovered(poiId, charId): void`

- [ ] **Step 1: Déclarer la bascule de vue**

```js
let mapTableView = false;   // preview what the table sees, through the very same filter
```

- [ ] **Step 2: Écrire les deux actions**

```js
// Put a player's token on a POI. Moving a player there discovers it for them — the
// checkboxes below are for revealing at a distance and for fixing a mistake.
function mapBringHere(charId, poiId) {
    const m = _activeMap(); if (!m) return;
    const poi = m.pois.find(p => p.id === poiId); if (!poi) return;
    m.positions[charId] = poiId;
    if (!poi.discoveredBy.includes(charId)) poi.discoveredBy.push(charId);
    saveMaps();
    renderMapTab();
}

function mapToggleDiscovered(poiId, charId) {
    const m = _activeMap(); if (!m) return;
    const poi = m.pois.find(p => p.id === poiId); if (!poi) return;
    poi.discoveredBy = poi.discoveredBy.includes(charId)
        ? poi.discoveredBy.filter(c => c !== charId)
        : [...poi.discoveredBy, charId];
    saveMaps();
    renderMapTab();
}
```

- [ ] **Step 3: Dessiner les jetons**

Dans `_mapPinLayer()`, ajouter la couche de pastilles sous l'étiquette, comme côté joueur :

```js
            el('div', { className: 'map-tokens' },
                Object.keys(m.positions)
                    // A charId left in positions after the character left the campaign is not
                    // in `players`, so no token is drawn for it — nothing to clean up.
                    .filter(cid => m.positions[cid] === p.id && players.has(cid))
                    .map(cid => el('span', { className: 'map-token', textContent: players.get(cid).name || '?' })))
```

- [ ] **Step 4: Ajouter les deux sections à la fiche**

À la fin de `_poiCard(m, poi)`, avant la parenthèse fermante :

```js
        el('label', { className: 'map-poi-label', textContent: 'Découvert par' }),
        el('div', { className: 'map-poi-disc' },
            [...players.values()].map(pl => el('label', { className: 'map-poi-check' },
                el('input', { type: 'checkbox', checked: poi.discoveredBy.includes(pl.charId),
                    onchange: () => mapToggleDiscovered(poi.id, pl.charId) }),
                el('span', { textContent: pl.name || pl.charId })))),
        el('label', { className: 'map-poi-label', textContent: 'Amener ici' }),
        el('div', { className: 'map-poi-bring' },
            [...players.values()].map(pl => el('button', { className: 'gm-btn ghost',
                textContent: pl.name || pl.charId,
                // One button per player, no drag and drop: this is the most frequent action
                // in play, it has to be one click and no aiming.
                onclick: () => mapBringHere(pl.charId, poi.id) })))
```

- [ ] **Step 5: Ajouter la bascule Vue table**

Dans la barre d'outils de `renderMapTab()` :

```js
        el('button', { className: 'gm-btn ghost' + (mapTableView ? ' active' : ''), textContent: 'Vue table',
            onclick: () => { mapTableView = !mapTableView; renderMapTab(); } }),
```

Et, dans `_mapPinLayer()`, filtrer la liste rendue :

```js
    // Table view goes through the very same filter the overlay uses, so the preview
    // cannot lie about what the table sees.
    const list = mapTableView ? visiblePois(buildMapState(), null) : m.pois;
    list.forEach(p => { … });
```

- [ ] **Step 6: Styler**

```css
.map-poi-disc  { display: flex; flex-wrap: wrap; gap: 6px; }
.map-poi-check { display: flex; align-items: center; gap: 3px; font-size: 11px; color: var(--parchment); }
.map-poi-bring { display: flex; flex-wrap: wrap; gap: 4px; }
.gm-btn.ghost.active { background: var(--violetsoft); border-color: var(--violet); color: var(--violet2); }
```

Le bouton `Vue table` reprend la convention `.active` déjà établie ailleurs dans le fichier
(`.rf-pill.rf-player.active`, `.music-ctrl-btn.active`, `.group-chip.active`, …) : contour au
repos, rempli une fois activé.

`.map-tokens` / `.map-token` sont déjà dans `css/aria-panel.css` (tâche 8) : rien à ajouter pour
les pastilles.

- [ ] **Step 7: Vérifier**

Deux onglets, MJ et joueur connectés.

1. `Amener ici : <joueur>` pose la pastille sous la punaise **des deux côtés**, et la punaise
   passe de creuse à pleine côté MJ.
2. Le POI apparaît côté joueur au même instant — c'est le déplacement qui l'a découvert.
3. Décocher le joueur dans `Découvert par` : la punaise disparaît côté joueur, la pastille avec.
4. `Vue table` masque les punaises que personne n'a découvertes et les remontre au second clic.
5. Deux joueurs sur le même POI : deux pastilles empilées, lisibles sans survol.
6. Un `charId` inconnu dans `positions` (console : `_activeMap().positions['zzz']='<poiId>'; saveMaps()`)
   ne dessine aucun jeton et ne fait rien planter.

- [ ] **Step 8: Mettre à jour `commits`**

Première ligne : `feat: jetons, revelation par joueur et vue table cote MJ`.

---

## Phase 3 — Notes joueur et regroupement

### Task 10: Notes de carte du joueur

**Files:**
- Modify: `js/aria-player.js` — `CHAR_KEYS.mapNotes`, `_charStateRow()`, `loadFromSupabase()`,
  tiroir, focus depuis la punaise
- Modify: `views/aria-player.html` — le tiroir sous la carte
- Modify: `css/aria-player.css` — le tiroir

**Interfaces:**
- Consomme : `mapState`, `_mapVisible()`, `renderMapTab()` (Task 8) ; `_charStateRow()`,
  `debouncedSyncState()`, `_charJSON()`.
- Produit :
  - `let mapNotes = {}` — `{ poiId: texte }`
  - `function renderMapNotesDrawer(): void`
  - `function saveMapNote(poiId, text): void` — débouncé

- [ ] **Step 1: Ajouter la clé et la globale**

Dans `CHAR_KEYS` :

```js
    mapNotes: 'aria-map-notes-',
```

Près de `mapState` :

```js
let mapNotes = {};   // { poiId: text } — private, never leaves character_state
```

Dans `loadCharacterState()`, à côté de `mapState = …` :

```js
    mapNotes = _charJSON('mapNotes', id, {}) || {};
```

Dans `switchCharacter()` : `mapNotes = {};`

- [ ] **Step 2: Faire porter les notes par `character_state`**

Dans `_charStateRow(charId)`, ajouter une ligne au retour :

```js
        map_notes: _charJSON('mapNotes', charId, {}),
```

Dans `loadFromSupabase()`, dans le `states.forEach` :

```js
            if (s.map_notes) localStorage.setItem(charKey('mapNotes', s.character_id), JSON.stringify(s.map_notes));
```

C'est le chemin des PV et des onglets : aucune table nouvelle côté joueur.

- [ ] **Step 3: Écrire la sauvegarde débouncée**

```js
let _mapNoteTimer = null;
// Auto-save a map note. localStorage is the runtime truth; character_state is the
// persistence layer, reached through the same debounced state sync as HP and tabs.
function saveMapNote(poiId, text) {
    mapNotes[poiId] = text;
    localStorage.setItem(charKey('mapNotes'), JSON.stringify(mapNotes));
    clearTimeout(_mapNoteTimer);
    _mapNoteTimer = setTimeout(() => debouncedSyncState(), 500);
}
```

- [ ] **Step 4: Ajouter le tiroir au HTML**

Dans `#tab-map` de `views/aria-player.html`, après `#map-stage` :

```html
                <details class="map-drawer" id="map-notes-drawer">
                    <summary>Mes notes de carte</summary>
                    <div id="map-notes-list"></div>
                </details>
```

- [ ] **Step 5: Écrire le rendu du tiroir**

```js
// The grouping view AND the only writing surface. One row per DISCOVERED POI: it is
// filtered by _mapVisible(), so if the GM takes a discovery back the note stays stored but
// leaves the list — otherwise the place's name would leak through its own note.
function renderMapNotesDrawer() {
    const list = document.getElementById('map-notes-list');
    if (!list) return;
    const pois = _mapVisible();
    if (!pois.length) { fill(list, el('div', { className: 'map-empty', textContent: 'Aucun lieu découvert.' })); return; }
    fill(list, pois.map(p => el('div', { className: 'map-note-row' },
        el('span', { className: 'map-note-name', textContent: p.name }),
        el('input', { className: 'map-note-input', id: 'map-note-' + p.id, value: mapNotes[p.id] || '',
            placeholder: 'Ma note', oninput: e => saveMapNote(p.id, e.target.value) }))));
}
```

Appeler `renderMapNotesDrawer();` à la fin de `renderMapTab()`.

- [ ] **Step 6: Afficher la note dans la fiche, et écrire dans le tiroir**

Dans `_poiCardPlayer(poi)`, ajouter avant la parenthèse fermante :

```js
        mapNotes[poi.id] && el('div', { className: 'map-poi-label', textContent: 'Ma note' }),
        mapNotes[poi.id] && el('div', { className: 'map-poi-mynote', textContent: mapNotes[poi.id] }),
```

Et, dans le `onclick` de la punaise (Task 8, Step 5), après `renderMapTab()` :

```js
                // The card reads, the drawer writes: clicking a pin unfolds the drawer and
                // puts the caret on that POI's row.
                const dr = document.getElementById('map-notes-drawer');
                if (dr && mapSelectedPoiId) { dr.open = true; document.getElementById('map-note-' + p.id)?.focus(); }
```

- [ ] **Step 7: Styler**

```css
.map-drawer { border-top: 1px solid var(--border); padding-top: 6px; }
.map-drawer > summary { cursor: pointer; color: var(--gold-light); font-family: 'Cinzel', serif; font-size: 12px; }
.map-note-row { display: flex; gap: 8px; align-items: center; padding: 3px 0; }
.map-note-name { min-width: 120px; font-size: 12px; color: var(--parchment-dim); }
.map-note-input { flex: 1; background: var(--bg2); border: 1px solid var(--border); color: var(--parchment);
                  border-radius: var(--radius); padding: 3px 6px; font-size: 12px; }
.map-poi-mynote { font-size: 12px; color: var(--parchment-dim); font-style: italic; white-space: pre-wrap; }
```

- [ ] **Step 8: Vérifier**

1. Le tiroir liste une ligne par lieu découvert, aucune pour les autres.
2. Taper une note : elle est conservée après `Ctrl+Shift+R`.
3. Après ~2 s, `await sbSelect('character_state','character_id=eq.<charId>&select=map_notes')`
   renvoie l'objet.
4. Cliquer une punaise : le tiroir se déplie et le curseur est sur la bonne ligne.
5. La note apparaît en lecture dans la fiche, et **ne s'y édite pas**.
6. Le MJ retire la découverte : la ligne disparaît du tiroir, la note reste dans
   `localStorage.getItem(charKey('mapNotes'))`, et **le nom du lieu n'apparaît nulle part**
   dans l'onglet.
7. Recharger depuis un autre appareil avec la même clé de sauvegarde : les notes reviennent.

- [ ] **Step 9: Mettre à jour `commits`**

Première ligne : `feat: notes de carte du joueur et tiroir de regroupement`.

---

## Phase 4 — Demandes de déplacement

### Task 11: `move-request` / `move-denied`

**Files:**
- Modify: `js/aria-player.js` — bouton à quatre états, verrouillage sans MJ
- Modify: `js/aria-gm.js` — file, badges, valider / refuser
- Modify: `css/aria-gm.css`, `css/aria-player.css`

**Interfaces:**
- Consomme : `ablyMap` des deux côtés, `mapBringHere()` (Task 9), `_poiCardPlayer()` (Task 8),
  `applyPresenceSet()` (`js/aria-player.js`).
- Produit :
  - joueur : `let gmOnline = false`, `let mapPendingPoiId = null`, `let mapDeniedPoiId = null`,
    `function requestMove(poiId): void`
  - MJ : `let moveRequests = []` — `[{ charId, charName, poiId }]`,
    `function acceptMove(i)`, `function denyMove(i)`, `function _renderMoveQueue()`

Messages, tels que la spec les fixe :

```js
'move-request' : { charId, charName, poiId }   // joueur → MJ
'move-denied'  : { charId, poiId }             // MJ → joueur
```

Il n'y a **pas** de message d'acceptation : le MJ accepte, il republie `state`, le jeton bouge.
Seul le refus a besoin d'être dit.

- [ ] **Step 1: Suivre la présence du MJ côté joueur**

Dans `js/aria-player.js`, près de `gmStreamId` :

```js
let gmOnline = false;   // a request sent with no GM in the set waits for an answer nobody got
```

Dans `applyPresenceSet()`, après `const gm = [...byId.values()].find(d => d.role === 'gm');` :

```js
    const gmWas = gmOnline;
    gmOnline = !!gm;
    if (gmWas !== gmOnline) renderMapTab();   // the move button is gated on it
```

- [ ] **Step 2: Écrire la demande côté joueur**

```js
let mapPendingPoiId = null;   // request sent, waiting for the token to move
let mapDeniedPoiId  = null;   // last refusal, sticky until the player asks again — a `state`
                               // broadcast (the GM publishes one on every map edit) must not
                               // wipe a refusal the player hasn't seen yet

function requestMove(poiId) {
    if (!ablyMap || !gmOnline) return;
    mapPendingPoiId = poiId;
    mapDeniedPoiId = null;
    ablyMap.publish('move-request', { charId: currentCharId, charName: character.name || '', poiId });
    renderMapTab();
}
```

Dans l'abonnement `move-denied` (à ajouter à côté de l'abonnement `state`) :

```js
        ablyMap.subscribe('move-denied', msg => {
            if (msg.data?.charId !== currentCharId) return;
            mapPendingPoiId = null;
            mapDeniedPoiId = msg.data.poiId;
            renderMapTab();
        });
```

Et dans l'abonnement `state`, avant `renderMapTab()` : une acceptation se reconnaît au jeton
arrivé, pas à un message.

```js
            if (mapPendingPoiId && mapState?.positions?.[currentCharId] === mapPendingPoiId) mapPendingPoiId = null;
```

- [ ] **Step 3: Ajouter le bouton à quatre états**

Dans `_poiCardPlayer(poi)`, avant la parenthèse fermante :

```js
        el('button', {
            className: 'map-move-btn' + (mapDeniedPoiId === poi.id ? ' denied' : ''),
            disabled: !gmOnline || mapPendingPoiId === poi.id || mapState?.positions?.[currentCharId] === poi.id,
            textContent: !gmOnline                     ? 'MJ absent'
                       : mapPendingPoiId === poi.id    ? 'Demande envoyée…'
                       : mapDeniedPoiId  === poi.id    ? 'Refusé'
                       : 'Demander à s’y rendre',
            onclick: () => requestMove(poi.id) })
```

- [ ] **Step 4: Recevoir la file côté MJ**

Dans `js/aria-gm.js` :

```js
let moveRequests = [];   // [{ charId, charName, poiId }] — persistent badge, not a toast:
                         // the GM may be looking elsewhere for ten minutes.
```

Dans `initAbly()`, sous l'abonnement `request` :

```js
        ablyMap.subscribe('move-request', msg => {
            const d = msg.data || {};
            if (!_isIdToken(d.charId) || !d.poiId) return;
            // One pending request per player: asking twice replaces, it doesn't queue.
            moveRequests = moveRequests.filter(r => r.charId !== d.charId);
            moveRequests.push({ charId: d.charId, charName: String(d.charName || ''), poiId: d.poiId });
            renderMapTab();
            _renderMapTabBadge();
        });
```

- [ ] **Step 5: Valider / refuser**

```js
function acceptMove(i) {
    const r = moveRequests[i]; if (!r) return;
    moveRequests.splice(i, 1);
    mapBringHere(r.charId, r.poiId);   // saveMaps → publishMapState: the moved token IS the answer
    _renderMapTabBadge();
}

function denyMove(i) {
    const r = moveRequests[i]; if (!r) return;
    moveRequests.splice(i, 1);
    if (ablyMap) ablyMap.publish('move-denied', { charId: r.charId, poiId: r.poiId });
    renderMapTab();
    _renderMapTabBadge();
}
```

- [ ] **Step 6: Afficher le badge et la liste**

`moveRequests.length > 0`, pas `moveRequests.length` — `append()`/`fill()` (aria-shared.js)
ne sautent que `null`, `undefined`, `false` et `''` ; `0` leur échappe et devient un nœud
texte `"0"` planté dans la barre d'outils à chaque rendu sans demande en attente (le cas
courant). Même piège que Task 15 (`(poi.zone || []).length`) — utiliser `> 0` partout où une
longueur sert de garde à un enfant `el()`.

Dans la barre d'outils de `renderMapTab()`, après `Vue table` :

```js
        moveRequests.length > 0 && el('details', { className: 'map-queue' },
            el('summary', { textContent: `⚑ ${moveRequests.length}` }),
            el('div', { className: 'map-queue-list' },
                moveRequests.map((r, i) => el('div', { className: 'map-queue-row' },
                    el('span', { textContent: `${r.charName || r.charId} → ${(_activeMap()?.pois.find(p => p.id === r.poiId)?.name) || '?'}` }),
                    el('button', { className: 'gm-btn', textContent: '✓', onclick: () => acceptMove(i) }),
                    el('button', { className: 'gm-btn ghost', textContent: '✕', onclick: () => denyMove(i) }))))),
```

Et le même compteur sur le bouton d'onglet, pour qu'il survive au fait que le MJ regarde ailleurs :

```js
// Mirror the queue count onto the Carte tab button — the tab may not even be open.
function _renderMapTabBadge() {
    const btn = document.querySelector('.tab-btn[data-tab="tab-map"]');
    if (!btn) return;
    btn.textContent = moveRequests.length ? `Carte ⚑${moveRequests.length}` : 'Carte';
}
```

- [ ] **Step 7: Styler**

```css
/* aria-gm.css */
.map-queue > summary { cursor: pointer; color: var(--gold-light); font-size: 12px; }
.map-queue-list { display: flex; flex-direction: column; gap: 4px; padding-top: 4px; }
.map-queue-row  { display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--parchment); }

/* aria-player.css */
.map-move-btn { background: var(--bg3); border: 1px solid var(--border); color: var(--parchment);
                border-radius: var(--radius); padding: 4px 8px; font-size: 12px; cursor: pointer; }
.map-move-btn:disabled { opacity: .55; cursor: default; }
.map-move-btn.denied   { border-color: var(--fail); color: var(--fail); }
```

- [ ] **Step 8: Nettoyer au changement de campagne / personnage**

`moveRequests` et le pending/denied state du joueur sont en mémoire, jamais persistés — ils
doivent être vidés partout où le reste de l'état carte l'est déjà, sinon ils survivent au
changement.

Dans `js/aria-gm.js`, `switchCampaign()`, à côté de la remise à zéro existante :

```js
    moveRequests = [];
    mapSelectedPoiId = null;
    mapTableView = false;
    _renderMapTabBadge();
```

Pas seulement cosmétique côté MJ : une entrée de `moveRequests` qui survit à un changement de
campagne pointe vers un `charId` de la campagne quittée, et `acceptMove()` appelle
`mapBringHere(charId, poiId)` sans revérifier l'appartenance — accepter cette entrée écrirait
l'id d'un joueur d'une autre campagne dans `positions` de la campagne nouvellement ouverte.

Dans `js/aria-player.js`, `switchCharacter()`, sur la ligne qui remet déjà `ablyMap`, `mapState`,
`mapSelectedPoiId` et `mapNotes` à zéro, ajouter `mapPendingPoiId` et `mapDeniedPoiId` :

```js
    ablyMap = null; mapState = null; mapSelectedPoiId = null; mapPendingPoiId = null; mapDeniedPoiId = null; mapNotes = {};
```

Sans ça, une demande en attente ou un refus du personnage précédent suit le joueur sur l'onglet
Carte d'un autre personnage.

- [ ] **Step 9: Vérifier**

Deux onglets, MJ et joueur.

1. Le joueur clique `Demander à s'y rendre` → le bouton passe à `Demande envoyée…` et se
   désactive ; le MJ voit `⚑1` **sur le bouton d'onglet**, même en étant sur un autre onglet.
2. Le MJ valide : le jeton du joueur arrive, le bouton du joueur redevient normal et se
   désactive parce qu'il est déjà là. Aucun message d'acceptation n'a circulé.
3. Le MJ refuse : le bouton du joueur passe à `Refusé` et reste cliquable ; un `state` non lié
   (le MJ édite autre chose sur la carte) ne le remet PAS à neuf — c'est délibéré, un refus ne
   doit pas s'effacer avant d'avoir été vu. Cliquer à nouveau sur `Refusé` relance une demande
   (`requestMove()` efface `mapDeniedPoiId`).
4. Le MJ ferme son onglet : côté joueur le bouton devient `MJ absent` et est désactivé,
   dans les 15 s (délai de purge de la présence Ably).
5. Le joueur demande deux fois de suite : une seule ligne dans la file.
6. Deux joueurs demandent : deux lignes, chacune avec son couple ✓ / ✕.

- [ ] **Step 10: Mettre à jour `commits`**

Première ligne : `feat: demandes de deplacement validees par le MJ`.

---

## Phase 5 — Widget overlay

### Task 12: Widget Carte sur l'overlay OBS

**Files:**
- Modify: `js/aria-overlay-editor.js:18` — une ligne dans `WIDGET_DEFS.persistent`
- Modify: `js/aria-overlay.js` — abonnement `aria-map`, `syncMapWidget()`, aiguillage dans
  `renderWidgetLayer()` et `updateWidgetData()`
- Modify: `css/aria-overlay.css` — cadre, punaises, jetons

**Interfaces:**
- Consomme : `visiblePois()` (Task 6), le payload `state` (Task 7), `campaignChannel()`,
  `OVERLAY_ID`, `esc()`, `renderWidgetLayer()`, `updateWidgetData()`.
- Produit :
  - `let mapState = null` (dans `aria-overlay.js`)
  - `const MAP_CHAR_ID` — `charId` du propriétaire pour un overlay joueur, `null` pour un overlay MJ
  - `function syncMapWidget(el, widget): void`

**Le widget Carte se traite comme le widget Caméra.** `updateWidgetData()` réassigne `innerHTML`
à chaque changement de présence, donc à chaque PV qui bouge, sur une sortie qui tourne des heures.
Le widget contient une `<img>` : la reconstruire à ce rythme la fait scintiller — exactement ce
qui a valu au widget Caméra son `return` anticipé.

- [ ] **Step 1: Déclarer le widget dans l'éditeur**

Dans `js/aria-overlay-editor.js`, dans `WIDGET_DEFS.persistent`, après `custom_text` :

```js
        { type: 'map',               label: 'Carte',                 defaultW: 40, defaultH: 45 },
```

Sans `gmOnly` : le widget existe des deux côtés et montre la vue de son propriétaire.
`WIDGET_LABELS` en dérive, et l'éditeur dessine déjà une boîte étiquetée pour n'importe quel type.

- [ ] **Step 2: Déclarer l'état et le propriétaire**

Dans `js/aria-overlay.js`, près des autres globales :

```js
let mapState = null;
// The overlay already knows whose it is: a player overlay shows that character's view, a
// GM overlay the table's. GM notes are in neither — they are never in the payload at all.
const MAP_CHAR_ID = OVERLAY_ID.startsWith('player_') ? OVERLAY_ID.slice(7) : null;
```

- [ ] **Step 3: S'abonner**

Dans le bloc `if (ABLY_KEY) { … }`, après l'abonnement `aria-damage` :

```js
    // Map. `state` replaces wholesale; `request` at connect is what gets a restarted OBS
    // browser source its picture back mid-session.
    const mapCh = ably.channels.get(campaignChannel('aria-map'));
    mapCh.subscribe('state', msg => { mapState = msg.data || null; renderWidgetLayer(); });
    mapCh.publish('request', {});
```

- [ ] **Step 4: Écrire `syncMapWidget()`**

Près de `syncCameraWidget()` :

```js
// Create the <img> once and only re-assign src when it differs — the setFrameSrc guard,
// for the same reason: this output runs for hours and a reload is a visible flash. Only
// the pin layer is rebuilt, and only when a state arrives.
function syncMapWidget(el, widget) {
    if (!mapState || !mapState.imageUrl) { el.innerHTML = ''; return; }
    let img = el.querySelector('img.ow-map-img');
    if (!img) {
        el.innerHTML = `<div class="ow-map"><img class="ow-map-img" src="${esc(mapState.imageUrl)}" alt=""><div class="ow-map-pins"></div></div>`;
        img = el.querySelector('img.ow-map-img');
    } else if (img.getAttribute('src') !== mapState.imageUrl) {
        img.setAttribute('src', mapState.imageUrl);
    }
    const pos = mapState.positions || {};
    const names = mapState.players || {};
    // This file builds strings and has its own esc(); every interpolated field goes
    // through it. Names arrive over Ably — anyone with the key can publish one.
    el.querySelector('.ow-map-pins').innerHTML = visiblePois(mapState, MAP_CHAR_ID).map(p => {
        const tokens = Object.keys(pos).filter(cid => pos[cid] === p.id)
            .map(cid => `<span class="ow-map-token">${esc(names[cid] || '?')}</span>`).join('');
        return `<div class="ow-map-pin" style="left:${Number(p.x) || 0}%;top:${Number(p.y) || 0}%">`
             + `<span class="ow-map-dot"></span>`
             + `<span class="ow-map-label">${esc(p.name)}</span>`
             + `<span class="ow-map-tokens">${tokens}</span></div>`;
    }).join('');
}
```

- [ ] **Step 5: Aiguiller les deux rendus**

Dans `renderWidgetLayer()`, remplacer la paire de lignes camera/else par :

```js
        if (widget.type === 'map')         syncMapWidget(el, widget);
        else if (widget.type === 'camera') syncCameraWidget(el, widget, live);
        else                               el.innerHTML = renderWidgetContent(widget);
```

Dans `updateWidgetData()`, à côté du `return` des caméras :

```js
        if (widget.type === 'map') return;   // updated by aria-map, not by presence
```

- [ ] **Step 6: Styler**

Dans `css/aria-overlay.css` :

```css
.ow-map { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
.ow-map-img { max-width: 100%; max-height: 100%; width: auto; height: auto; display: block;
              filter: sepia(.45) saturate(.75) contrast(1.08) brightness(.92); }
.ow-map-pins { position: absolute; inset: 0; }
.ow-map-pin { position: absolute; transform: translate(-50%, -50%);
              display: flex; flex-direction: column; align-items: center; gap: 2px; }
.ow-map-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--gold);
              box-shadow: 0 0 10px 3px rgba(201,168,76,.45); }
.ow-map-label { font-family: 'Cinzel', serif; font-size: 12px; color: var(--parchment);
                text-shadow: 0 1px 3px rgba(0,0,0,.9); white-space: nowrap; }
.ow-map-tokens { display: flex; flex-direction: column; align-items: center; gap: 1px; }
.ow-map-token { background: rgba(9,8,4,.75); border: 1px solid var(--border); border-radius: 10px;
                padding: 0 6px; font-size: 10px; color: var(--parchment); white-space: nowrap; }
```

- [ ] **Step 7: Vérifier**

Utiliser le bouton **📋 Copier URL Overlay (OBS)** du modal ⚙ — ne pas fabriquer l'URL à la main,
elle doit porter `campaign=` et `overlay=`.

1. Dans l'éditeur d'overlay, `Carte` apparaît dans la liste des widgets persistants et se pose.
2. Sur l'overlay joueur : seuls les POI **découverts par ce personnage** sont dessinés.
3. Sur l'overlay MJ : l'union des découvertes de la table.
4. Aucun `gmNote` ni aucune note privée nulle part — vérifier dans la console de l'overlay
   (`mapState.pois[0]`) qu'il n'y a **pas** de champ `gmNote`.
5. Le MJ bouge une punaise : la couche se met à jour, et l'`<img>` **n'est pas rechargée**
   (onglet Réseau : aucune requête pour l'image).
6. Un jet de dés / un changement de PV pendant ce temps ne fait pas clignoter la carte
   (c'est le `return` de `updateWidgetData()`).
7. Recharger la source navigateur en pleine partie : la carte revient toute seule (c'est le
   `request` à la connexion).
8. Déplacer le widget dans l'éditeur : au `layout-update` suivant, la carte ne clignote pas
   (`renderWidgetLayer()` réconcilie en place, il ne reconstruit rien).

- [ ] **Step 8: Mettre à jour `commits`**

Première ligne : `feat: widget Carte sur l'overlay OBS`.

---

## Phase 6 — Zones et brouillard

### Task 13: `fogZones()` et sa couverture

**Files:**
- Modify: `js/aria-supabase.js` — `fogZones()`, sous `visiblePois()`
- Modify: `js/aria-shared.selfcheck.js` — quatre assertions de plus

**Interfaces:**
- Consomme : `visiblePois()` (Task 6).
- Produit, pour la tâche 14 :
  - `function fogZones(state, charId): Array<{ id, zone }>` — **géométrie seule**, jamais de texte

Logique pure, donc test d'abord.

- [ ] **Step 1: Écrire le test qui échoue**

Dans `js/aria-shared.selfcheck.js`, sous les assertions de `visiblePois`, et en ajoutant
`fogZones` au `return` du `new Function(sbSrc + …)` :

```js
// state.pois carries what at least one player discovered, state.fog what nobody did but
// which has a zone. fogZones() recomposes, per spectator, the set of black districts.
// poiC must be in this state (not just declared) for assertion 7 to mean anything — without
// it, "c does not appear" is true by construction and the assertion cannot fail.
const fogState = {
    pois: [poiA, poiB, poiC],                       // a: alice, b: bob (zone), c: nobody, no zone
    fog:  [{ id: 'd', zone: [[50,50],[60,50],[60,60]] }],   // nobody discovered d
};
// 5. A POI nobody discovered, with a zone, is in the fog.
assert.ok(fogZones(fogState, 'alice').some(z => z.id === 'd'));
assert.ok(fogZones(fogState, null).some(z => z.id === 'd'));
// 6. A POI Bob discovered and Alice did not is in Alice's fog, not in Bob's.
assert.ok(fogZones(fogState, 'alice').some(z => z.id === 'b'));
assert.ok(!fogZones(fogState, 'bob').some(z => z.id === 'b'));
// 7. An undiscovered POI WITHOUT a zone shows up nowhere — neither clear nor fogged.
assert.ok(!visiblePois(fogState, 'alice').some(p => p.id === 'c'));
assert.ok(!fogZones(fogState, 'alice').some(z => z.id === 'c'));
// 8. No fog entry carries a name or a description. This is the assertion that guards the
//    "geometry only" rule: a player must be able to draw a black district without
//    learning anything about what is in it.
for (const z of fogZones(fogState, 'alice')) {
    assert.deepStrictEqual(Object.keys(z).sort(), ['id', 'zone']);
    assert.strictEqual(z.name, undefined);
    assert.strictEqual(z.publicDesc, undefined);
}
```

- [ ] **Step 2: Lancer le test et le voir échouer**

```
node js/aria-shared.selfcheck.js
```

Attendu : `ReferenceError: fogZones is not defined` (même cause qu'à la tâche 6 : le `return { visiblePois, fogZones }` référence le nom avant tout appel).

- [ ] **Step 3: Écrire la fonction**

Sous `visiblePois()` dans `js/aria-supabase.js` :

```js
// What gets drawn in black: geometry, no text. state.fog holds the POIs nobody has
// discovered (id + zone, nothing else); the rest are POIs someone else found and this
// spectator has not. Both end up as { id, zone } — mapping is what strips the name.
function fogZones(state, charId) {
    const mine = new Set(visiblePois(state, charId).map(p => p.id));
    return [...(state?.fog || []), ...(state?.pois || []).filter(p => p.zone?.length && !mine.has(p.id))]
           .map(p => ({ id: p.id, zone: p.zone }));
}
```

- [ ] **Step 4: Lancer le test et le voir passer**

```
node js/aria-shared.selfcheck.js
```

Attendu : `aria-shared self-check: all assertions passed`.

- [ ] **Step 5: Mettre à jour `commits`**

Première ligne : `feat: calcul du brouillard par zone, couvert par le self-check`.

---

### Task 14: Rendu des zones dans les trois vues

**Files:**
- Modify: `js/aria-shared.js` — `_mapZoneLayer()`, la couche `<svg>` des deux panneaux
- Modify: `js/aria-gm.js` — `fog` dans `buildMapState()`, pose de la couche
- Modify: `js/aria-player.js` — pose de la couche
- Modify: `js/aria-overlay.js` — version chaîne de la couche dans `syncMapWidget()`
- Modify: `css/aria-panel.css` (règles communes), `css/aria-gm.css` et `css/aria-player.css`
  (la seule qui diffère : `.zone-fog`), `css/aria-overlay.css`

**Interfaces:**
- Consomme : `visiblePois()`, `fogZones()` (tâches 6 et 13), `poi.zone`.
- Produit :
  - `function _mapZoneLayer(clear, fog): SVGElement` (dans `js/aria-shared.js`) — `clear` et
    `fog` sont deux listes d'objets portant `.id` et `.zone`

Le rendu JS est **le même** des deux côtés : c'est le CSS qui distingue le MJ (qui voit à travers
le brouillard) du joueur (pour qui il est opaque). La couche va donc dans `aria-shared.js`, pas
en double dans les deux panneaux — c'est la règle du projet, et c'est exactement le genre de
jumeau qui a déjà divergé ici.

Rendu d'une zone selon l'observateur :

| observateur | zone découverte | zone non découverte |
|---|---|---|
| MJ | contour accentué, remplissage très léger | contour pointillé gris, remplissage sombre translucide (le MJ voit à travers) |
| joueur / overlay | contour accentué, remplissage très léger | **noir opaque, sans nom ni punaise** |

- [ ] **Step 1: Remplir `fog` dans le payload**

Dans `buildMapState()` (Task 7), remplacer `fog: []` par :

```js
        // Geometry only: no name, no description, no pin coordinates. This is what lets a
        // player draw a black district without learning anything about what is in it. A POI
        // with no zone and no discovery appears nowhere at all.
        fog: (m.pois || [])
            .filter(p => (p.discoveredBy || []).length === 0 && (p.zone || []).length)
            .map(p => ({ id: p.id, zone: p.zone })),
```

- [ ] **Step 2: Écrire la couche SVG**

Dans `js/aria-shared.js`, à côté de `el()` — `el()` ne construit pas de SVG (`createElement`
crée un élément HTML même nommé `svg`), il faut `createElementNS` :

```js
const SVG_NS = 'http://www.w3.org/2000/svg';

// Zones are <polygon>s in a viewBox of 0–100 on both axes, which is exactly the percentage
// coordinate system the pins already use. Hover, outline and fill are native CSS — no
// collision maths, no canvas. The reveal is a transition on fill and opacity.
function _mapZoneLayer(clear, fog) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'map-zones');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    const add = (z, cls) => {
        // z.zone is remote-controlled: it arrives over Ably ('aria-map' / 'state') with no
        // validation, so anyone holding the Ably key can publish garbage in its place. An
        // uncaught throw here would abort el()'s argument evaluation and take down the whole
        // renderMapTab() — a malformed zone must be silently skipped, never trusted.
        if (!Array.isArray(z.zone) || z.zone.length < 3) return;
        const pts = z.zone.filter(v => Array.isArray(v) && v.length === 2)
            .map(([x, y]) => `${Number(x) || 0},${Number(y) || 0}`);
        if (pts.length < 3) return;
        const poly = document.createElementNS(SVG_NS, 'polygon');
        poly.setAttribute('points', pts.join(' '));
        poly.setAttribute('class', cls);
        // Without this the stroke thickness distorts the moment the map changes size —
        // and it changes size constantly in the pane engine.
        poly.setAttribute('vector-effect', 'non-scaling-stroke');
        svg.appendChild(poly);
    };
    clear.forEach(z => add(z, 'zone-known'));
    fog.forEach(z => add(z, 'zone-fog'));
    return svg;
}
```

- [ ] **Step 3: Poser la couche sous les punaises**

Panneau MJ, dans `renderMapTab()` — la couche passe **avant** `_mapPinLayer(m)` dans les
arguments de `_mapFrame()`, sinon un quartier noir avale les pastilles posées dessus :

```js
    const st = buildMapState();
    const clear = mapTableView ? visiblePois(st, null) : m.pois.filter(p => (p.zone || []).length);
    const fog   = mapTableView ? fogZones(st, null) : [];
    const frame = _mapFrame(m, _mapZoneLayer(clear, fog), _mapPinLayer(m), sel && _poiCard(m, sel));
```

Panneau joueur, dans `renderMapTab()` — la couche passe avant `pins` :

```js
        _mapZoneLayer(_mapVisible().filter(p => (p.zone || []).length), fogZones(mapState, currentCharId)),
```

- [ ] **Step 4: Poser la couche dans le widget overlay**

`aria-overlay.js` construit des chaînes. Les sommets ne sont que des nombres : les coercer avec
`Number(…) || 0` **est** l'échappement ici (`esc()` reste obligatoire pour tout champ texte).

```js
// Zones first, pins after: a black district must not swallow the tokens standing on it.
function _owZones(charId) {
    // mapState comes straight off Ably ('aria-map' / 'state') with no validation — anyone
    // holding the key can publish a malformed zone. A throw here would blank the whole
    // widget, and on the overlay that kills the live OBS output mid-stream, so a bad shape
    // renders as no polygon instead of blowing up the render.
    const poly = (z, cls) => {
        if (!Array.isArray(z.zone) || z.zone.length < 3) return '';
        const pts = z.zone.filter(v => Array.isArray(v) && v.length === 2)
            .map(([x, y]) => `${Number(x) || 0},${Number(y) || 0}`);
        return pts.length >= 3 ? `<polygon class="${cls}" vector-effect="non-scaling-stroke" points="${pts.join(' ')}"/>` : '';
    };
    const clear = visiblePois(mapState, charId).filter(p => p.zone?.length)
        .map(z => poly(z, 'ow-zone-known')).join('');
    const fog = fogZones(mapState, charId)
        .map(z => poly(z, 'ow-zone-fog')).join('');
    return `<svg class="ow-map-zones" viewBox="0 0 100 100" preserveAspectRatio="none">${clear}${fog}</svg>`;
}
```

Dans `syncMapWidget()`, ajouter `<div class="ow-map-zones-wrap"></div>` au gabarit de création,
**avant** `.ow-map-pins`, et à chaque arrivée de `state` réécrire son `innerHTML` avec
`_owZones(MAP_CHAR_ID)` — en même temps que la couche de punaises, et toujours sans toucher à
l'`<img>`.

- [ ] **Step 5: Styler les trois rendus**

Dans `css/aria-panel.css`, les règles communes aux deux panneaux :

```css
/* Zones sit above the image and below the pins. Hover and outline are native. */
.map-zones { position: absolute; inset: 0; z-index: 1; pointer-events: none; }
.map-zones polygon { pointer-events: auto; transition: fill .4s ease, opacity .4s ease; }
.zone-known { fill: rgba(var(--accent-rgb), .10); stroke: var(--gold); stroke-width: 1.5; }
.zone-known:hover { fill: rgba(var(--accent-rgb), .20); }
```

C'est la **seule** règle qui diffère, et c'est tout l'intérêt de garder le JS partagé.
Dans `css/aria-gm.css` — le MJ voit à travers :

```css
.zone-fog { fill: rgba(9,8,4,.55); stroke: var(--parchment-dim); stroke-width: 1; stroke-dasharray: 3 3; }
```

Dans `css/aria-player.css` — noir opaque :

```css
.zone-fog { fill: rgb(9,8,4); stroke: none; }
```

```css
/* aria-overlay.css */
.ow-map-zones  { position: absolute; inset: 0; width: 100%; height: 100%; }
.ow-zone-known { fill: rgba(201,168,76,.10); stroke: #c9a84c; stroke-width: 1.5; }
.ow-zone-fog   { fill: rgb(9,8,4); stroke: none; }
```

- [ ] **Step 6: Vérifier**

Poser une zone à la main en attendant l'éditeur de la tâche 15 (console MJ) :

```js
_activeMap().pois[0].zone = [[10,10],[40,10],[40,40],[10,40]]; saveMaps();
```

1. Côté MJ, POI non découvert : polygone sombre translucide à contour pointillé — le MJ **voit
   la carte à travers**.
2. Côté joueur, POI non découvert : polygone **noir opaque**, sans punaise, sans nom.
3. Découvrir le POI pour ce joueur : la zone s'éclaircit en transition, la punaise apparaît.
4. Le survol d'une zone connue l'éclaircit — sans une ligne de JavaScript.
5. Redimensionner le volet du simple au double : l'épaisseur des contours **ne change pas**
   (c'est `vector-effect`), et les zones restent alignées sur l'image.
6. Un jeton posé sur un POI dont la zone est tracée reste **au-dessus** du polygone.
7. Console joueur : `mapState.fog[0]` a exactement deux clés, `id` et `zone`.
8. Overlay : mêmes règles, et l'`<img>` n'est pas rechargée quand une zone change.

- [ ] **Step 7: Mettre à jour `commits`**

Première ligne : `feat: rendu des zones et du brouillard dans les trois vues`.

---

### Task 15: Éditeur de tracé de zones (MJ)

**Files:**
- Modify: `js/aria-gm.js` — mode tracé, sommets, fermeture, correction, suppression
- Modify: `css/aria-gm.css` — poignées de sommet, aperçu du tracé

**Interfaces:**
- Consomme : `_mapPct()`, `_activeMap()`, `saveMaps()`, `renderMapTab()`, `_mapZoneLayer()`.
- Produit :
  - `let zoneEditPoiId = null` — POI dont la zone est en cours de tracé
  - `let zoneDraft = []` — sommets posés, en pourcentages
  - `function startZoneEdit(poiId)` / `closeZone()` / `cancelZoneEdit()` / `clearZone(poiId)`

C'est le vrai coût de la fonctionnalité : le rendu est presque gratuit, le tracé ne l'est pas.
D'où sa position en dernier. **Aucun joueur ne trace** ; rien n'est déduit automatiquement.

- [ ] **Step 1: Déclarer l'état du tracé**

```js
let zoneEditPoiId = null;   // POI whose zone is being traced
let zoneDraft = [];         // vertices placed so far, in percentages
```

- [ ] **Step 2: Écrire les commandes**

```js
function startZoneEdit(poiId) {
    const m = _activeMap(); if (!m) return;
    zoneEditPoiId = poiId;
    zoneDraft = [...(m.pois.find(p => p.id === poiId)?.zone || [])];
    renderMapTab();
}

// Close the polygon: three vertices is the minimum that encloses anything.
function closeZone() {
    const m = _activeMap();
    const poi = m?.pois.find(p => p.id === zoneEditPoiId);
    if (!poi) return;
    if (zoneDraft.length < 3) { alert('Une zone demande au moins trois sommets.'); return; }
    poi.zone = zoneDraft;
    zoneEditPoiId = null; zoneDraft = [];
    saveMaps();
    renderMapTab();
}

function cancelZoneEdit() { zoneEditPoiId = null; zoneDraft = []; renderMapTab(); }

function clearZone(poiId) {
    const m = _activeMap();
    const poi = m?.pois.find(p => p.id === poiId); if (!poi) return;
    poi.zone = [];
    saveMaps();
    renderMapTab();
}
```

- [ ] **Step 3: Ajouter le bouton à la fiche**

Dans `_poiCard(m, poi)`, avant la parenthèse fermante :

```js
        el('div', { className: 'map-poi-zone' },
            el('button', { className: 'gm-btn ghost',
                textContent: (poi.zone || []).length ? 'Modifier la zone' : 'Tracer une zone',
                onclick: () => startZoneEdit(poi.id) }),
            (poi.zone || []).length > 0 && el('button', { className: 'gm-btn ghost', textContent: 'Effacer la zone',
                onclick: () => clearZone(poi.id) }))
```

- [ ] **Step 4: Écrire la couche de tracé**

```js
// The tracing layer: click to place a vertex, click the first vertex to close, drag a
// vertex to correct it, Suppr to remove the last one.
function _zoneEditLayer() {
    const layer = el('div', { className: 'map-zone-edit' });
    zoneDraft.forEach(([x, y], i) => {
        layer.append(el('div', {
            className: 'zone-vertex' + (i === 0 ? ' first' : ''),
            style: { left: x + '%', top: y + '%' },
            onpointerdown: e => {
                e.stopPropagation();
                if (i === 0 && zoneDraft.length >= 3) { closeZone(); return; }
                _zoneDragVertex(e, i);
            },
        }));
    });
    return layer;
}

function _zoneDragVertex(e, i) {
    e.preventDefault();
    const frame = document.getElementById('map-frame');
    const node = e.currentTarget;
    node.setPointerCapture(e.pointerId);
    const onMove = ev => {
        const { x, y } = _mapPct(ev, frame);
        zoneDraft[i] = [x, y];
        node.style.left = x + '%'; node.style.top = y + '%';
    };
    const onUp = () => {
        node.removeEventListener('pointermove', onMove);
        node.removeEventListener('pointerup', onUp);
        renderMapTab();
    };
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', onUp);
}
```

- [ ] **Step 5: Détourner le clic du cadre pendant le tracé**

Dans le gestionnaire `click` du cadre (Task 5, Step 5), **en tête** :

```js
        if (zoneEditPoiId) {
            if (e.target.closest('.zone-vertex')) return;   // handled by the vertex itself
            const { x, y } = _mapPct(e, frame);
            zoneDraft.push([x, y]);
            renderMapTab();
            return;
        }
```

Un changement de carte pendant le tracé (le POI tracé n'est pas sur la nouvelle carte) ou la
suppression du POI tracé depuis sa propre fiche ouverte (`mapDeletePoi()` réinitialise
`mapSelectedPoiId` mais ne sait rien de `zoneEditPoiId`) laisse sinon le mode de tracé actif sur
une géométrie qui ne pourra jamais être validée. Un seul garde, en tête de `renderMapTab()`, à
côté du nettoyage de `activeMapId` périmé, couvre les deux cas :

```js
    if (zoneEditPoiId && !_activeMap()?.pois.some(p => p.id === zoneEditPoiId)) { zoneEditPoiId = null; zoneDraft = []; }
```

Et poser la couche + la barre de tracé dans `renderMapTab()` quand `zoneEditPoiId` est défini :

```js
    const frame = _mapFrame(m,
        _mapZoneLayer(clear, fog),
        zoneEditPoiId && _mapZoneLayer([{ id: 'draft', zone: zoneDraft }], []),
        _mapPinLayer(m),
        zoneEditPoiId && _zoneEditLayer(),
        sel && _poiCard(m, sel));
```

Dans la barre d'outils, quand `zoneEditPoiId` est défini :

```js
        zoneEditPoiId && el('span', { className: 'map-zone-hint',
            textContent: `Tracé en cours (${zoneDraft.length} sommets) — cliquez le premier sommet pour fermer, Suppr pour annuler le dernier` }),
        zoneEditPoiId && el('button', { className: 'gm-btn', textContent: 'Fermer la zone', onclick: closeZone }),
        zoneEditPoiId && el('button', { className: 'gm-btn ghost', textContent: 'Annuler', onclick: cancelZoneEdit }),
```

- [ ] **Step 6: Gérer la touche Suppr**

Une seule écoute, enregistrée une fois (pas dans `renderMapTab()`, qui s'appelle en boucle).
À côté de l'enregistrement du gestionnaire `click` global dans `initApp()` :

```js
    document.addEventListener('keydown', e => {
        if (e.key !== 'Delete' || !zoneEditPoiId) return;
        zoneDraft.pop();
        renderMapTab();
    });
```

- [ ] **Step 7: Styler**

```css
.map-zone-edit { position: absolute; inset: 0; z-index: 3; }
.zone-vertex { position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px;
               border-radius: 50%; background: var(--gold-light); border: 1px solid var(--bg);
               cursor: grab; touch-action: none; }
.zone-vertex.first { background: var(--success); }
.map-zone-hint { font-size: 11px; color: var(--parchment-dim); }
.map-poi-zone { display: flex; gap: 4px; }
```

- [ ] **Step 8: Vérifier**

1. `Tracer une zone` sur un POI : la barre affiche le compteur de sommets.
2. Cliquer quatre points : quatre poignées, le polygone provisoire se dessine au fur et à mesure.
3. Cliquer le premier sommet (vert) ferme la zone ; elle apparaît dans le rendu normal.
4. Glisser un sommet pendant le tracé le corrige.
5. `Suppr` retire le dernier sommet posé.
6. `Annuler` sort du mode sans rien enregistrer.
7. Deux sommets seulement + `Fermer la zone` → refus explicite, rien n'est enregistré.
8. `Modifier la zone` sur un POI qui en a une reprend le tracé existant.
9. `Effacer la zone` la vide : le POI redevient une simple punaise, et il disparaît du
   brouillard côté joueur (un POI non découvert **sans** zone n'apparaît nulle part).
10. Supprimer le POI emporte sa zone (il n'y a pas d'objet zone indépendant).
11. Pendant le tracé, un clic sur le fond **n'ajoute pas** de POI.

- [ ] **Step 9: Mettre à jour `commits`**

Première ligne : `feat: editeur de trace des zones cote MJ`.

---

## Couverture de la spec

| section de la spec | tâche(s) |
|---|---|
| Décision 1 — découverte individuelle + révélation manuelle | 9 |
| Décision 2 — jetons des autres sur les POI connus | 8 |
| Décision 3 — trois couches de texte | 5 (MJ), 8 (joueur), 10 (note privée) |
| Décision 4 — pas de note générée dans l'onglet Notes | 10 |
| Décision 5 — déplacement validé par le MJ | 11 |
| Décision 6 — carte posable sur l'overlay | 12 |
| Décision 7 — le widget montre la vue de son propriétaire | 12 |
| Décision 8 — carte plein cadre + fiche flottante | 5 (MJ), 8 (joueur) |
| Décision 9 — jetons en pastilles nommées | 8, 9 |
| Décision 10 — la fiche lit, le tiroir écrit | 10 |
| Décision 11 — zones en polygones SVG, brouillard par zone | 13, 14, 15 |
| Décision 12 — la carte se fabrique dehors et s'importe | 4 |
| Données MJ (`CAMP_KEYS`, `ENT.map`, `campaign_maps`) | 1, 2 |
| Image via `campaign-files`, hors de `gmFiles` | 4 |
| `sourceUrl` + `MAP_GENERATORS` + `Rouvrir la source` | 4 |
| Habillage CSS (sépia, vignettage, grain, liseré) | 4 |
| Données joueur (`aria-map-`, `aria-map-notes-`, `map_notes`) | 8, 10 |
| Protocole `state` / `request` / `move-request` / `move-denied` | 7, 11 |
| `gmNote` jamais publié | 7 (Step 2 + vérification Step 7.3) |
| `visiblePois()` / `fogZones()` écrits une seule fois | 6, 13 |
| UI MJ — onglet, barre de cartes, quatre gestes, `Vue table`, file `⚑` | 3, 4, 5, 9, 11 |
| Vocabulaire visuel — punaises (3 états), jetons | 5, 8, 9 |
| UI joueur — auto-affichage, POI muets, tiroir, bouton 4 états | 8, 10, 11 |
| Widget overlay — `WIDGET_DEFS`, `syncMapWidget`, abonnement | 12 |
| Vérification — points 1 à 8 du self-check | 6 (1–4), 13 (5–8) |

Hors périmètre de la spec, donc absent de ce plan : lier un POI à une autre carte, dessin libre,
rendu 3D, éditeur de carte intégré, générateur en iframe, vendorisation d'Azgaar, brouillard
progressif. L'idée « liste des substances identifiées » du fichier source est traitée à part.
