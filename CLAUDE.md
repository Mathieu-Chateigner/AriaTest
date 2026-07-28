# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. 

---

## Project overview

TTRPG overlay system for OBS streaming built with vanilla HTML/CSS/JS (no framework, no build step).
Three apps that communicate in real time over Ably, each split into separate HTML/CSS/JS files.

Live at: `https://mathieu-chateigner.github.io/Aria/`

---

## Workflow

### Commits
**Never commit or push.** The user commits and pushes manually.

After every set of changes, update the `commits` file at the repo root with a plain-text summary of what was changed and why. Overwrite the previous content — it only needs to describe the most recent batch of changes, not a full history. No markdown — plain text only. Format:

```
type: short summary line (this becomes the GitHub commit title)

Changes:

- file : what changed and why
```

Common types: `feat`, `fix`, `docs`, `refactor`, `style`. The first line is what appears on GitHub — keep it concise and meaningful.

Always update `commits` as the last step of any task.

---

## Development

**No build step, no package manager, no test suite.**

- Open any `.html` directly in a browser (`file://`). Chrome is required (OBS browser sources use CEF).
- To test changes: save the file, hard-refresh (`Ctrl+Shift+R`).
- For Streamlabs OBS: serve over HTTP (`python -m http.server 8080`) — Streamlabs blocks WebSocket from `file://` origins. Standard OBS works fine with `file://`.

---

## Files

```
index.html                  ← Home/selection screen + shared config panel
views/
  aria-player.html
  aria-gm.html
  aria-overlay.html
  aria-overlay-editor.html  ← drag-and-drop overlay layout editor (opened from player/GM panel)
css/
  aria-player.css
  aria-gm.css
  aria-overlay.css
  aria-overlay-editor.css
js/
  aria-supabase.js          ← shared Supabase helpers (loaded first, before panel scripts)
  aria-player.js
  aria-gm.js
  aria-overlay.js
  aria-overlay-editor.js
```

`aria-control-panel.html` and `aria-dice-roller.html` are **deprecated**.

---

## Architecture

### Communication — Ably (free tier)

All three apps share **one Ably key** (entered on `index.html`) and use five game channels, plus a config channel:

| Channel | Published by | Consumed by |
|---|---|---|
| `aria-rolls` | `aria-player` (per roll) | `aria-gm` (roll feed) + other `aria-player` instances (toast) + `aria-overlay` |
| `aria-rolls-hidden` | `aria-player` (rolls made with **Jet caché** armed) | `aria-gm` only — other players and the overlay never subscribe |
| `aria-cards` | `aria-player` or `aria-gm` | `aria-overlay` |
| `aria-damage` | `aria-gm` (damage/heal/gm-presence/monster-state/tab-config/grants/karma-set/spotlight) + `aria-player` (presence heartbeat every 5s, `leave` on switch **and on tab close**, Soigner damage/heal to a target) | `aria-player` (GM damage/heal + gm-presence + grants + peer presence) + `aria-gm` (presence + leave) + `aria-overlay` (presence + **leave** + gm-presence for the camera widgets' VDO room + monster-state; ignores `source:'player'` damage/heal — see payloads) |
| `aria-music` | `aria-gm` (play/stop/pause/resume commands) | `aria-player` (subscribe only) — GM does **not** subscribe to its own commands |
| `aria-overlay-config` | overlay editor (layout/content updates) | `aria-overlay` (receives layout changes in real time) |

#### Per-campaign channel scoping

The five game channels (`aria-rolls`, `aria-rolls-hidden`, `aria-cards`, `aria-damage`, `aria-music`) are **scoped per campaign** by suffixing the campaign join code: `aria-rolls-{JOINCODE}`, etc. Each app derives the suffix the same way via a `campaignChannel(base)` helper:
- GM: `currentJoinCode`
- Player: `character.campaignKey`
- Overlay: `?campaign=JOINCODE` URL param

The join code is uppercased/trimmed in all three. An **empty** token falls back to the bare global channel (backward compatible; unlinked players). This isolates concurrent campaigns sharing one Ably key — rolls/cards/HP/music no longer bleed across campaigns or overlays.

`aria-overlay-config` stays **global** — it is already isolated by `overlayId` (`gm_{campaignId}` or `player_{charId}`).

> **`monster-state`** is published by the GM on `aria-damage` (scoped) and consumed by `aria-overlay` on the same channel (filtered by `overlayId`). It is **not** on `aria-overlay-config`.

### Supabase credentials

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are hardcoded at the top of `js/aria-supabase.js`. Change only that file when switching Supabase projects. The GM uses two Supabase Storage buckets: `campaign-files` (GM file sharing with players) and `campaign-music` (uploaded audio tracks).

### Save key / Supabase sync

Both player and GM use a **save key** (UUID) to sync localStorage to Supabase, enabling multi-device access.

- On page load, `#file-gateway` starts `display:none`. `tryRestoreSupabase()` checks `localStorage('aria-save-key')`:
  - Key found → calls `loadFromSupabase()` then `hideGateway()` + `showSelectionScreen()` (no flash)
  - No key → calls `showGateway()` which sets `display:flex`, prompting the user to create or enter a key
- `saveKey` is stored in `localStorage('aria-save-key')` and also held in the module-level `saveKey` variable
- **Never set `#file-gateway` to `display:flex` in HTML** — it must start hidden to avoid the flash on load
- `loadFromSupabase()` returns `true`/`false`; `tryRestoreSupabase()` only runs the full push-sync when the load **succeeded** — syncing after a failed (offline) load would overwrite newer remote data with stale local state
- **GM child tables are restored unconditionally** (even when the DB result is empty): a campaign row only exists after a full sync, so an empty child table means "deleted on another device". Guarding writes with `if (rows.length)` resurrects deleted monsters/potions/files on the next sync — don't reintroduce it
- `submitExistingKey()` first verifies the key exists in `saves`, then (when switching keys) clears the previous key's local data via `_clearLocalPlayerData()` / `_clearLocalGMData()` so the old key's characters/campaigns never merge into the new key

**Sync architecture** — `js/aria-supabase.js` exposes shared helpers (`sbUpsert`, `sbDelete`, `sbSelect`, `sbInsert`, `runMigration`). Both panels use **per-entity granular sync** — separate debounced functions per data type — rather than one monolithic blob. `localStorage` is always the runtime source of truth; Supabase is only the persistence layer.

- Player: `debouncedSync()` for character data, `debouncedSyncState()` for HP/cards/tabs, `syncCharacterNote` / `deleteCharacterNote` for notes, `syncCharacterFile` / `deleteCharacterFile` for files.
- GM: `syncCampaign`, `debouncedSyncMonsters`, `insertRoll` / `insertCardHistory` (append-only — `clearRolls()` / `clearCardHistory()` never touch the DB), `debouncedSyncPotions`, `debouncedSyncFiles`, `syncGMNote` / `deleteGMNoteFromDB`, `syncKnownPlayer` (called on every presence heartbeat), `syncMusicTrack` / `debouncedSyncMusic` / `deleteMusicTrackFromDB` (Supabase table `campaign_music`; field `youtube_id` maps to `youtubeId` in JS).
- `runMigration` is a one-time runner that reads the old JSON blob from `saves` and populates the relational tables. It checks `player_migrated_at` / `gm_migrated_at` flags to skip if already done.

### No server, no build

- State persisted in `localStorage` (character, config, cards, HP, monsters, potions)
- `sessionStorage` holds the per-tab `playerId` (UUID, regenerates per tab)

### Config — shared between player and GM

Both apps read from the **same** key:

```js
// localStorage: aria-config
{ ablyKey, dddiceKey, dddiceRoom, dddiceTheme, lightMode: bool, youtubeApiKey }
```
`youtubeApiKey` is optional — used only for YouTube Data API v3 playlist import in the GM Musique tab.

Keys are entered once on `index.html`. The in-app ⚙ modal in each panel can also update this key (for theme and reconnecting), but uses the same `aria-config` storage. **Never use `aria-gm-config`** — it is obsolete.

**VDO.ninja room** (`vdoRoom`, `vdoRoomPassword`) is **campaign-scoped** — stored on the campaign object in `aria-gm-campaigns`, NOT in `aria-config`.

### Campaign system (GM)

The GM panel supports multiple campaigns. Each campaign has a **join code** (5-char, e.g. `X7K2M`) that players enter to link their character. Only players whose `campaignKey` matches the active campaign's `joinCode` **and** whose `ariaType` matches the campaign's appear in the Joueurs tab.

Campaign object shape: `{ id, name, joinCode, vdoRoom, vdoRoomPassword, ariaType }` — `ariaType` is `'ancient'` (médiéval, default) or `'contemporary'`.

All campaign-scoped data uses keys suffixed with `currentCampaignId`:

| localStorage key | Content |
|---|---|
| `aria-gm-campaigns` | `[{ id, name, joinCode, vdoRoom, vdoRoomPassword }]` campaign list |
| `aria-gm-monsters-{id}` | monsters for campaign |
| `aria-gm-rolls-{id}` | roll history |
| `aria-gm-card-history-{id}` | card draw log |
| `aria-gm-potions-{id}` | alchemy recipes |
| `aria-gm-files-{id}` | files uploaded by GM for this campaign |
| `aria-gm-music-{id}` | named music playlists for this campaign (`[{ id, name, tracks: [{ id, name, type, url, youtubeId, path }] }]`) |
| `aria-gm-monster-groups-{id}` | monster grouping: `{ groups: [{ id, name }], assign: { monsterId: groupId } }` |
| `aria-gm-file-groups-{id}` | file grouping: `{ groups: [{ id, name }], assign: { fileId: groupId } }` |
| `aria-gm-notes-{id}` | GM notes `[{ id, name, content }]` |
| `aria-gm-known-players-{id}` | last-seen presence snapshot per charId (repopulates the Joueurs tab offline) |

Helper functions `monstersKey()`, `rollsKey()`, `cardHistKey()`, `potionsKey()`, `filesKey()`, `musicKey()`, `monsterGroupsKey()`, `fileGroupsKey()`, `gmNotesKey()`, `knownPlayersKey()` return the scoped key for the active campaign. Always use these — never hardcode the bare key. (Non-campaign-scoped GM keys: `aria-gm-split-layout` for the multi-pane layout, `aria-gm-read-table` for the bigger-faces toggle.)

`generateJoinCode()` produces the join code. If a campaign loaded from storage lacks one, it is generated and saved on `loadCampaignState()`.

### Player identity

Three distinct identifiers — do not conflate them:
- `character.name` — display name, sent as `char` in roll payloads and `name` in presence.
- `playerId` — per-tab session UUID (sessionStorage), used to **target** Ably messages (grants, damage, tab-config). Changes on every refresh.
- `charId` — stable character UUID, used as the key in the GM `players` Map and to derive the VDO.ninja stream ID.

### VDO.ninja camera integration

Each participant's camera stream is identified by an **auto-derived stream ID** — players never set this manually:
- Player: `'aria-' + charId.slice(0, 8)` — derived in `derivedStreamId()` in `aria-player.js`
- GM: `'aria-gm-' + campaignId.slice(0, 8)` — derived inline in `startGMPresenceBroadcast()`

The GM sets a `vdoRoom` (and optional `vdoRoomPassword`) once on the campaign via the `⚙` config modal. This is broadcast to players every **8s** via `gm-presence` on `aria-damage` (plus immediately when a new player session appears). Players activate their hidden push iframe (`#vdo-push-frame`) when they receive the room from `gm-presence`. Camera push only works on HTTPS (GitHub Pages), not from `file://`.

**Viewer iframes need the room password too.** Streams pushed into a password-protected room are encrypted, so a bare `?view=SID` stays black — `vdoViewSrc()` (player), `gmVdoViewSrc()` (GM) and `vdoCamSrc()` (overlay) all append `&room` + `&password`. (An earlier version of this file claimed viewers didn't need it; that was wrong and cost a debugging session.)

**The push iframes live outside the tab/pane layout** — `#vdo-push-frame` (player) and `#vdo-gm-push-frame` (GM) are siblings of `#app-wrapper`, fixed and full-viewport at `opacity:0`. Never `display:none` (can block camera capture) and never visible (the self-preview shows through the app's transparent backgrounds). The GM's push frame used to sit inside the Joueurs tab, whose `.tab-content` goes `display:none` on every tab switch — the GM camera silently died. What shows in the Joueurs tab is a **muted viewer** of the GM's own stream, which is safe to hide.

**The GM broadcast is expired like a peer.** Players stamp `gmPresenceTs` on every `gm-presence`; `prunePeers()` (5s tick) clears `gmStreamId`/`vdoRoom`/`vdoRoomPassword` and calls `updatePushIframe()` after **30s** of silence. Without this the cached room lived forever and the player's push iframe kept broadcasting the webcam after the GM closed the session. The GM also publishes an **empty** `gm-presence` (`publishGMPresenceOff()`) when the room is cleared in the config modal, on `switchCampaign()`, and on `beforeunload`. Players act on it after a **12s grace period** (`GM_OFF_GRACE_MS`, cancelled the moment a room reappears) — not immediately. `beforeunload` also fires on a plain page refresh, and the documented dev loop is "save, `Ctrl+Shift+R`", so an immediate teardown restarted every player's camera (iframe reload + WebRTC renegotiation) on every GM reload. The grace period is longer than the 8s heartbeat, so a reload never interrupts anything while a real shutdown still stops in ~12s. `stopGMSession()` is the single teardown path, shared by the grace timer and the 30s silence expiry. Two rules on that function: it **returns the publish promise** and `switchCampaign()` awaits it before `ablyInstance.close()` (closing right after a fire-and-forget publish drops the message — the player's `leave` is awaited for the same reason), and it is gated on `gmPresenceWasOn` so a second GM tab opened on the same campaign, before its own room is configured, doesn't tell every player "session over" and cut their cameras.

**Nothing calls `getUserMedia` — in either app.** The push iframes own the camera; every in-app tile is a VDO.ninja **viewer**, the self tiles being viewers of one's own stream with `&muted`. A native self-view fallback used to exist for the "no VDO room" case on both sides; it was unreachable (the Caméras tab only appears once a room or a peer stream is known, so the fallback could never bootstrap) and is gone. Don't reintroduce it: it lights the camera LED for a preview nobody is watching.

**Players advertise `streamId` only while pushing** (`sendPresence()` sends `''` when `vdoRoom` is empty), and `renderPlayerCards()` renders a camera iframe only when `p.streamId && isOnline`. Sending it unconditionally gave every GM card a permanent black box, and the persisted known-players snapshot resurrected dead iframes for offline players on campaign load.

**Players own a camera kill switch.** `cameraOff` (persisted per character in `aria-camera-off-{charId}`, toggled by `toggleCamera()` from the `📹` pill in the presence control) gates the push iframe, the advertised `streamId`, the self tile and the rail entry. The GM decides the room; the player decides whether to publish into it. The Caméras tab states the fact when it is on.

**The GM owns the mirror-image kill switch.** `gmCameraOff` (persisted per campaign in `aria-gm-camera-off-{campaignId}`, toggled by `toggleGMCamera()` from the `📹` button in the topbar next to *Lire la table*) gates the push iframe, the "Votre caméra" preview, and the `streamId` advertised in `gm-presence` — via `gmAdvertisedStreamId()`, which every `gm-presence` publish site must use instead of `gmDerivedStreamId()`. Without it the GM's only way to go camera-off was clearing the room, which cuts **every** player's camera too. Cutting the GM camera is deliberately **not** a session-over signal: the payload keeps its `vdoRoom`, so players go on publishing and only the MJ tile disappears. `renderGMCameraToggle()` hides the button when no room is set (nothing is published either way, so it would be a no-op).

**Viewer iframes get `allow="autoplay; fullscreen"` and nothing else.** Only the push frames (`#vdo-push-frame`, `#gm-self-view-wrap`'s iframe) need `camera; microphone; display-capture`. Don't copy the push permission list onto a viewer.

**The VDO room password is a shared secret, not a credential.** It is broadcast in cleartext on `aria-damage` (every subscriber gets it — players need it to push), stored plaintext in `campaigns.vdo_room_password` and localStorage. Anyone holding the Ably key — which is pasted into OBS overlay URLs — can join the room. Treat the overlay URL as sensitive. The GM's push-URL log line redacts `password=` because those logs get pasted into bug reports.

**Push failure is reported, not silent.** `renderCamerasTab()` renders `#cameras-warning` when a room is active but `window.isSecureContext` is false (the `file://` case, where `getUserMedia` refuses and the player is invisible to everyone), and when the player cut their own camera.

**The Bandeau rail and the Caméras grid must never both be live** — they open viewer iframes on the same streams, doubling the WebRTC connections per peer. `renderPresenceUI()` hides the rail while `tab-cameras` is in `openPanes`; `renderTabLayout()` calls `renderPresenceUI()` so docking/undocking the pane re-evaluates it.

**Viewer URLs that include `&room=` MUST also include `&solo`** — without it VDO.ninja ignores `&view` and renders the "Join Room with Camera" landing page instead of the stream. `vdoViewSrc()` (player) and `gmVdoViewSrc()` (GM) append `&solo&room=...` together. The player's hidden `#vdo-push-frame` is full-viewport with `opacity:0` — never `display:none` (can block camera capture) and never visible (its self-preview shows through the app's transparent backgrounds).

**Push URLs MUST include a blank `&view`** (`?push=SID&room=ROOM&view&...`) — per VDO.ninja docs, an empty `&view` means "no streams will play; only publishing will be allowed". Without it, a push page inside a room acts as a full room client and *renders every other guest's video* next to the self-preview (players appeared inside the GM's "Votre caméra" panel) and silently downloads all remote streams in the player's hidden push iframe.

**Important:** `renderPlayerCards()` in `aria-gm.js` does **in-place DOM updates** (not `grid.innerHTML = ''`) so that camera iframes are never removed from the DOM during routine presence heartbeats. Removing an iframe from the DOM kills its WebRTC stream. The same principle applies to `renderCamerasTab()` in `aria-player.js` — it surgically adds/removes cells rather than clearing the grid.

### Overlay editor (`aria-overlay-editor.js`)

A separate drag-and-drop editor opened in a new tab from the player or GM panel. Widgets are defined in `WIDGET_DEFS` (persistent and event categories). Each widget has `{ id, type, category, x, y, w, h, visible, config }` where all positions are percentages of the 1920×1080 canvas. The editor saves to Supabase `overlay_configs` table (keyed by `{type}_{ownerId}`) and publishes `layout-update` on `aria-overlay-config` for live sync to the running overlay. `camera` widgets (GM-only) render a VDO.ninja viewer iframe and are **skipped in `updateWidgetData()`** to prevent iframe reload on every presence tick. The overlay caches `vdoRoom`/`vdoRoomPassword` from the GM's `gm-presence` broadcast and builds camera iframe URLs with `vdoCamSrc()` (`&solo&room&password` appended once known — a bare `?view=SID` stays black for streams pushed into a password-protected room); `refreshCameraWidgets()` re-srcs the iframes when the room info arrives, **and swaps a widget for the `—` placeholder when its stream stops** — liveness is `liveStreamIds()` (the `streamId`s in `presenceCache`, which is pruned at `PRESENCE_MAX_AGE`, plus `gmLiveStreamId` from `gm-presence`). Without it a disconnected player left a black rectangle on stream forever. `renderWidgetContent()` applies the same rule so a layout re-render can't recreate a dead iframe, and neither path re-srcs an iframe that is already correct (that would kill the WebRTC connection and flicker the picture every heartbeat). `gmLiveStreamId` and `vdoRoom` are only ever updated from a **non-empty** `gm-presence`; the overlay ignores the empty "session over" payload entirely and lets `GM_PRESENCE_MAX_AGE` (30s of silence, measured from the last real broadcast) drop `gmLiveStreamId`. Acting on the empty payload cleared `vdoRoom` and re-src'd every live *player* camera iframe (their `vdoCamSrc` loses `&room`), flickering every camera on the OBS output on a plain GM refresh — the on-air version of the player-side flicker the 12s grace period fixes. The camera widget's stream ID is picked from a **dropdown** (`#prop-stream-pick`, filled by `availableStreams()`) — stream IDs are derived from UUIDs and shown nowhere in the panels, so the free-text field alone was unfillable. The list is rebuilt from same-origin localStorage: `aria-gm-known-players-{campaignId}` for a GM overlay, `aria-characters` for a player one. Manual entry still works and the two fields stay mirrored.

### dddice 3D dice (browser SDK)

Loaded at runtime via dynamic `import('https://esm.sh/dddice-js')` — no npm, no build.

- **`ThreeDDice(canvas, apiKey)`** → `.start()` then `.connect(roomSlug)`
- A `<canvas id="dddice-canvas">` is positioned fixed/full-screen with `pointer-events:none` and high `z-index` in all three apps
- `RollFinished` event clears the canvas after 1.5s
- A 12s safety timer (`dddiceRollSafetyTimer`) forces fallback if the SDK stalls
- Overlay syncs Ably roll data with dddice animation via `pendingRollData`/`diceFinished` flags; if SDK is not configured, a 3s fixed delay is used instead
- `saveConfig()` always disconnects dddice, removes the resize listener, **and closes the old Ably connection (`ablyInstance.close()`)** before reinit — nulling the Ably refs without closing leaves the old WebSocket subscribed and duplicates every incoming message

---

## ARIA game rules

- Roll **1d100** (simulated as two d10s via dddice: `d10x` tens + `d10` ones, total 0 = 100)
- **≤ threshold** = SUCCÈS, **> threshold** = ÉCHEC
- **SUCCÈS CRITIQUE**: roll ≤ 10 AND roll ≤ threshold
- **ÉCHEC CRITIQUE**: roll ≥ 91 AND roll > threshold
- Threshold calculation: Skill (`pct` + bonus/malus) | Stat (`multiplier × stat_value + bonus/malus`) | Free roll (manual)

### Combat reactions (parry & dodge)

Per `Docs/Aide aux combats.pdf`:
- **Parade**: rolls under **Combat rapproché** skill — once per turn, blocks attack, can still attack same turn
- **Esquive**: rolls under **Esquiver** skill — abandons all attacks, can dodge multiple times; ranged dodge has −20% malus

The combat sidebar auto-discovers these via regex — ancient: `/combat.rapproch/i` for parade, `/esquiv/i` for esquive; contemporary: `/tabasser/i` for parade, `/réflexes/i` for esquive.

### Special skill: Soigner
Clicking `Soigner` first opens a **target picker** (self or any player seen via presence in the last 30s), then rolls. `applySoigner(success)` fires after the float card (1500ms delay):
- **Success**: rolls `1d6` — heals self (capped at max PV, broadcasts presence), or publishes `heal` `{ targetId, amount, source: 'player' }` to the chosen target
- **Failure**: rolls `1d3` — damages self (floored at 0, damage VFX, MORT screen at 0 HP), or publishes `damage` `{ targetId, damage, source: 'player' }` to the target

The **target applies the HP change itself** when it receives the message (it knows its own HP; the sender doesn't). These `source:'player'` payloads carry no `hpBefore/hpAfter/maxHP`, so the overlay skips them.

---

## Character data structure

### Multi-character system (Player)

`localStorage: aria-characters` → `[{ id, name, class, stats, ... }]`

Each character carries its own `id` (UUID). HP and card state are keyed by that ID:

| localStorage key | Content |
|---|---|
| `aria-characters` | `[{ id, ...charFields }]` full character list |
| `aria-current-hp-{id}` | current HP integer for that character |
| `aria-cards-{id}` | card deck state for that character |
| `aria-player-tabs-{id}` | `{ cards: bool, alchemy: bool }` tab visibility |
| `aria-notes-{id}` | notes `[{ id, name, content }]` |
| `aria-player-files-{id}` | GM-granted files `[{ id, name, type, url }]` |
| `aria-player-rolls-{id}` | local roll history (max 100, also inserted into Supabase `character_rolls`) |
| `aria-camera-off-{id}` | `'1'` when the player cut their own camera (kill switch, survives refresh) |

Tab visibility is managed separately from the character object and persisted per character ID. Helper functions `hpKey()`, `cardKey()`, `notesKey()` return the scoped key for the active character. Always use these — never hardcode the bare key. `deleteCharacter()` must remove **all** of these keys plus the Supabase rows (`characters`, `character_state`, `character_notes`, `character_files`, `character_rolls`).

The **empty vials row** in the Inventaire tab is only rendered when `playerTabs.alchemy === true` — `renderInventoryEditor()` prepends a `Fioles vides` row with ± controls at the top of the item list. `applyTabVisibility()` calls `renderInventoryEditor()` so the inventory updates immediately when the GM toggles the alchemy tab.

### Character fields (`aria-characters[n]`)

```js
{
  id: string,                                // UUID
  name: string,
  class: string,
  ariaType: 'ancient' | 'contemporary',      // character sheet variant (default 'ancient')
  campaignKey: string,                       // join code of the linked campaign (e.g. 'X7K2M')
  stats: { FOR, DEX, END, INT, CHA, PV },   // all integers; contemporary has only { PV }
  physical: { age, taille, poids, yeux, cheveux, signes, histoire },
  inventory: [{ name, qty }],
  weapons: [{ nom, degats, favourite }],     // degats = dice formula; favourite = shown in combat sidebar
  protection: { nom, valeur },
  skills: [{ name, link, pct, bonus? }],     // link = "FOR/DEX" (empty for contemporary); bonus = optional per-skill permanent modifier (#12)
  specials: [{ name, desc, pct, bonus? }],   // fully editable; bonus = optional per-skill permanent modifier
  potions: [{ name, desc, ingredients, qty }],
  potionRecipes: [{ id, name, desc, ingredients, successChance }],
  vials: number,
  money: { couronne, orbe, sceptre, sou } | { francs },  // ancient coins | contemporary francs
  karma: number,                             // GM-set modifier (karma-set message), added to every threshold roll
}
```

> `blessures` was removed. `tabs` was removed from the character object — stored separately as `aria-player-tabs-{id}`. `streamId` was removed — stream IDs are now auto-derived from `charId`.
>
> **Two character templates** exist (`DEFAULT_CHAR_ANCIENT` / `DEFAULT_CHAR_CONTEMPORARY`): contemporary has its own skill list (Armes à feu, Tabasser, …), no FOR/DEX/END/INT/CHA stats (the Caractéristiques tab is hidden), and francs for money. The GM filters presence by matching `ariaType` against the campaign's type.

### Monsters (`localStorage: aria-gm-monsters-{id}`)
```js
[{ id, name, pv, maxPV, armor, stats: { FOR, DEX, END, INT, CHA }, attacks: [{ name, pct, dmg }] }]
```

---

## Ably message payloads

### `aria-rolls` / `roll`
```js
{ skillName, threshold, roll, success, char, bonusMalus, playerId, hidden? }
```
`threshold: null` for simple die rolls (d4, d6… buttons) — overlay treats these as display-only.

### `aria-rolls-hidden` / `roll`
Same payload with `hidden: true`. Published instead of `aria-rolls` while the player's **Jet caché** toggle (`hiddenRollMode`) is armed. Only the GM subscribes; the feed marks these rows with an `MJ` badge. The roller still sees their own float card.

### `aria-damage` / `damage` | `heal`
```js
{ targetId, damage, hpBefore, hpAfter, maxHP, charName, source: 'gm' }     // GM → player
{ targetId, amount, hpBefore, hpAfter, maxHP, charName, source: 'gm' }
{ targetId, damage, source: 'player' }                                     // player → player (Soigner)
{ targetId, amount, source: 'player' }
```
`charName` is displayed by the overlay's damage/heal VFX. The `source:'player'` variants carry **no HP fields** — the target computes and applies the change itself, and the overlay ignores them.

### `aria-damage` / `presence` (heartbeat every 5s)
```js
{ playerId, charId, name, charClass, hp, maxHP, stats, protection, skills, specials,
  weapons, inventory, potions, vials, potionRecipeIds, tabs, money, karma,
  campaignKey, ariaType, streamId }
```
- `playerId` — session UUID (sessionStorage, changes per tab/refresh); used only for Ably targeting
- `charId` — character UUID (stable; never changes even if name changes); used as the key in the GM `players` Map
- `streamId` — auto-derived as `'aria-' + charId.slice(0, 8)`, but sent as `''` unless a `vdoRoom` is active and `cameraOff` is false (an advertised ID nobody is pushing renders as a black iframe on every receiver); used for VDO.ninja viewer iframes
- `karma` — the character's stored karma. Seeds the GM's in-memory `gmKarma` map the first time a `charId` is seen (a GM page reload wipes the map; without seeding, the next ± click would send `karma-set` with ±1 and clobber the player's real karma). After seeding, the GM's local value is authoritative — the GM is the only karma writer.

The GM's `handlePresence()` rejects messages whose `campaignKey !== currentJoinCode` or whose `ariaType` doesn't match the campaign type, **validates that `charId`/`playerId` are UUID-shaped** via `_isIdToken()` (`/^[A-Za-z0-9_-]{1,64}$/`) since they end up in element ids, CSS selectors and inline handlers, and **coerces the numeric fields (`hp`, `maxHP`, `vials`, `karma`) via `_finiteNum()`** since those are interpolated into `innerHTML` by the player-card renders.

`loadCampaignState()` applies the **same `_isIdToken()` check** when rehydrating the `aria-gm-known-players-{id}` snapshot. That snapshot is written from presence payloads, but entries persisted before the validation existed can hold anything, and they feed the same `players` Map and the same renders — validating only the live path left the door open. `renderPlayerCards()` additionally wraps its lookup selector in `CSS.escape` (as `playerCardEl()` already did): an unescaped quote throws out of `players.forEach`, which kills that render and every later one, freezing the Joueurs tab and its camera iframes.

### `aria-damage` / `leave`
```js
{ playerId }
```
Sent by the player on `switchCharacter()` and on `beforeunload`. **Both the GM and the overlay subscribe to it** — the GM drops the player card, the overlay drops the `presenceCache` entry and refreshes its camera widgets. Without the overlay half, a face and its camera stayed on stream for the full `PRESENCE_MAX_AGE` (60s) after the player left. The unload publish is best-effort — the browser may kill the page first, which is what the 30s sweep still covers.

### `aria-damage` / `gm-presence` (every 8s from GM, plus immediately for new sessions)
```js
{ streamId, vdoRoom, vdoRoomPassword, spotlightCharId }
```
`streamId` is `'aria-gm-' + campaignId.slice(0, 8)`, or `''` while the GM's kill switch is on (`gmAdvertisedStreamId()`). Players cache `vdoRoom` and `vdoRoomPassword` and use them to activate their push iframe. `spotlightCharId` mirrors the GM spotlight so late joiners pick it up.

Two different "empty" payloads — do not conflate them:
- **All-empty** (`streamId` *and* `vdoRoom` empty) is the explicit "camera session over" signal (`publishGMPresenceOff()`) — players clear the room and stop pushing (after `GM_OFF_GRACE_MS`), and the overlay ignores it entirely.
- **Empty `streamId`, room still set** is the GM kill switch mid-session. Players drop the MJ tile and keep publishing; the overlay acts on it at once (`if (!gmSid && !room) return;`) so the GM's camera widget swaps to the placeholder instead of sitting black for the 30s `GM_PRESENCE_MAX_AGE`. Only `gmLiveStreamId` changes, so player widget URLs are untouched and their streams survive.

### `aria-damage` / `spotlight`
```js
{ charId }   // null clears — that player's camera goes big on every player's Bandeau/Tablée view
```

### `aria-damage` / `karma-set`
```js
{ playerId, karma: number }   // GM sets a player's karma; player stores it on the character
```

### `aria-damage` / `tab-config`
```js
{ playerId, tabs: { cards: bool, alchemy: bool } }
```

### `aria-damage` / `potion-grant` | `potion-revoke` | `vial-grant`
```js
{ playerId, potion: { id, name, desc, ingredients, successChance } }
{ playerId, potionId: string }
{ playerId, qty: number }
```

### `aria-damage` / `file-grant` | `file-revoke`
```js
{ playerId, file: { id, name, type, url } }   // grant — player adds file to playerFiles
{ playerId, fileId: string }                   // revoke — player removes file from playerFiles
```
Player stores granted files in `localStorage: aria-player-files-{charId}`. The Fichiers tab auto-hides when `playerFiles` is empty.

### `aria-music` / `play` | `stop` | `pause` | `resume`
```js
{ type: 'play', track: { id, name, type, url, youtubeId }, fadeDuration: number }  // ms
{ type: 'stop' }
{ type: 'pause' }
{ type: 'resume' }
```
GM plays locally via `_musicTriggerPlay()` AND broadcasts — it does not subscribe. Player stores volume in `localStorage('aria-music-volume')` (0–100 integer, default 80); the music bar (`#music-bar`) uses `visibility:hidden` until the first track plays.

### `aria-cards` / `draw` | `reshuffle`
```js
{ cardId, excluded: [...], drawn: [...], deckIds: [...], lastCardId }
{ excluded: [...], drawn: [], deckIds: [...], lastCardId: null }
```

### `aria-overlay-config` / `layout-update` | `content-update` | `monster-state`
```js
{ overlayId, config }                                         // layout-update: full widget layout
{ overlayId, widgetId, content }                              // content-update: single widget text
{ overlayId, monsters }                                       // monster-state: live monster HP list
```

---

## Key UI components

### Home screen (`index.html`)
Displays Joueur / Maître de Jeu cards and a **⚙ Configuration** panel at the bottom. Reads and writes `aria-config` via inline `<script>`. This is the canonical entry point for key configuration.

### Player character selection screen
Lists all saved characters. Creating a character prompts for name, class, an optional campaign join code, and the character type (Médiéval/Contemporain radio — picks the template). The join code and type are shown as badges on each character card. `selectCharacter(id)` → `loadCharacterState(id)` → `initApp()`. `switchCharacter()` publishes `leave`, then tears down Ably and dddice before returning.

### GM campaign selection screen
Lists all campaigns, each showing its join code (click to copy). `selectCampaign(id)` → `loadCampaignState(id)` → `initApp()`. After entering a campaign, the join code is shown in the topbar (click to copy) so the GM can share it with players.

### Player panel tabs
`Compétences` | `Caractéristiques` | `Jet libre` | `Inventaire` | `Notes` | `Cartes` | `⚗ Alchimie` | `Fichiers` | `📹 Caméras` | `Personnage`

`Cartes` and `⚗ Alchimie` are hidden by default — shown only when GM enables them via `tab-config`. `Fichiers` auto-shows when the GM grants at least one file (`playerFiles.length > 0`). `Caméras` auto-shows when `gmStreamId` or any `peerCameras` entry has a stream ID (i.e. when cameras are active in the session).

### GM panel tabs
`Joueurs` | `Monstres` | `Jets` | `Jet MJ` | `Cartes` | `⚗ Alchimie` | `Fichiers` | `♪ Musique`

The GM Fichiers tab lets the GM upload files to Supabase Storage (`campaign-files` bucket) and grant/revoke access per player. `gmFiles` entries: `{ id, name, type, url, path, grantedTo: [] | 'all' }`. Upload via `uploadFileToSupabase()`, grant via `file-grant` message on `aria-damage`.

The GM ♪ Musique tab holds **multiple named playlists** rendered as a chip bar (`#music-playlist-bar`): click a chip's ▶ to launch that playlist, click its name to view/edit it, ✎/✕ on the active chip rename/delete. New tracks are added to the active playlist. See *Music playlists: active vs. playing* under Known pitfalls.

The **Monstres** and **Fichiers** tabs each have a **group chip bar** (`#monster-group-bar` / `#file-group-bar`) for navigating long lists — a `Tous` chip (always present) plus one chip per group, then `＋`. Clicking a chip name filters the grid to that group; the active group chip carries ✎/✕ (rename/delete). Each card has a `⠿` drag grip; drag a card onto a chip to assign it (drop on `Tous` un-assigns). Adding a monster/file while a group is filtered auto-assigns it to that group. Groups + membership live in a **separate, non-synced** localStorage key (`monsterGroupsKey()` / `fileGroupsKey()`) — see *Monster/file grouping is not synced* under Known pitfalls. The grouping engine is shared by both tabs (`_renderGroupBar(type)`, `_groupChip`, drag helpers `_groupDrag*`, and `assign{Monster,File}ToGroup`).

The Joueurs tab shows a live player card per connected player. Each card displays a VDO.ninja viewer iframe (`?view=STREAMID`) above the HP bar when the player has an active stream. `renderPlayerCards()` does **in-place DOM updates** — it never clears the grid entirely — to preserve live camera iframes across presence heartbeats.

### Bonus/Malus bar (player)
Persistent bar between topbar and content. Buttons: +10/+20/+30/−10/−20/−30 + custom ± + reset. The persistent `bonusMalus` applies to all BM-affected rolls (every `doRoll` with `skipBM=false`; the **Jet libre** free roll passes `skipBM=true` and is unaffected). `doRoll` also adds the character's **karma** to every non-skipBM threshold — all live previews (skills, specials, stat cards, combat reactions, potion chance) must include `liveBM() + (character.karma ?? 0)` so the displayed % matches the rolled threshold.

The bar also holds the **Jet caché** toggle (`hiddenRollMode`) — while armed, rolls publish to `aria-rolls-hidden` (GM only) instead of `aria-rolls`. Resets on character switch.

**Temporary modifier (next N rolls)** — the `Prochains jets` control arms a one-off modifier (`bmNextValue`) that applies to the next `bmNextCount` BM-affected rolls then auto-expires. `bmNextActive()` returns the value while charges remain; `liveBM() = bonusMalus + bmNextActive()` is used for **all live percentage previews** (skills, specials, stat thresholds, combat reactions, potion chance). `doRoll` stamps the total applied modifier into `_appliedBM` (= `bonusMalus + tempBM`, karma excluded) so the roll payload's `bonusMalus` field, the float card, and the GM/overlay feed report what was actually applied; it then consumes one charge (decrement `bmNextCount`, clearing `bmNextValue` at 0). The armed state shows as a pill (`#bm-next-status`) with a ✕ to cancel (`clearBMNext`). All temp state resets on character switch. This is **player-side only** — no payload/protocol change.

**Per-skill permanent modifier (#12)** — each skill/special carries an optional `bonus` (set via a `mod` input in the **Personnage** editor, next to the `%`). It is part of the character object (a JSON column on the `characters` table, so it round-trips cross-device — no migration). The modifier is **baked into `basePct`** at the roll call site (`doRoll(name, skill.pct + bonus)` for skills/specials/Soigner/parade/esquive), so the rolled threshold already includes it; `bonus` is therefore distinct from `bonusMalus`, the temp modifier, and `karma`. Live previews (`renderSkills`, `updateBMDisplay`, combat sidebar) add it; a `.skill-mod` badge marks non-zero values in the Compétences list. The GM player-details modal folds it in via `_pdmSkillPct(s)` (shows `pct+bonus` with a `+N` note). Because it is baked into the threshold, no Ably payload changes.

### Player presence (GM — Joueurs tab)
- Players send heartbeat every 5s on `aria-damage` channel
- GM's `handlePresence()` rejects any message where `campaignKey !== currentJoinCode`
- GM sweeps offline players every 10s (threshold: 30s = offline)
- 📋 modal shows full character data and tab toggles

### Post-roll effect pattern
Skills with side-effects after a roll use a flag set before `doRoll()` and checked in `handleResult()`:
```js
pendingCraft = recipe.id;   // id, not index — a potion-revoke mid-roll would shift indexes
doRoll(recipe.name, recipe.successChance || 0);   // BM + karma apply (skipBM defaults to false)

// In handleResult():
if (skillName === 'Soigner') applySoigner(success);
if (pendingCraft !== null) { applyCraft(success, pendingCraft); pendingCraft = null; }
```
Craft and Soigner rolls are **BM-affected** like any skill roll — only the **Jet libre** free roll passes `skipBM=true`. `applyCraft` / `applySoigner` use a 1500ms `setTimeout` so the float card shows before the effect fires.

---

## CSS design system

```css
--gold: #c9a84c          /* primary accent */
--gold-light: #e8c97a
--gold-dim: #6b5020
--bg: #111009            /* darkest background */
--bg2: #1a1610
--bg3: #221e14
--parchment: #f0e6c8     /* primary text */
--parchment-dim: #9e8e6a
--success: #4caf77
--fail: #c0392b
--border: rgba(201,168,76,0.15)
--radius: 4px
--gm-accent: #7b3fa0     /* GM purple (gm file only) */
```

**Fonts:** Cinzel (headings/numbers), EB Garamond (body/italic), Cinzel Decorative (title), Playfair Display (roll card skill name)

**Light mode:** Toggled via `config.lightMode`. Applied at module level (before `initApp`) to prevent flash. All overrides live in a `body.light-mode` block at the bottom of each CSS file. Always use CSS variables — never hardcode dark colors.

---

## Conventions

- **No frameworks** — pure vanilla JS, no npm, no bundler
- **No `type="number"` spinners** — use `type="text" inputmode="numeric"` with `oninput` regex filter
  - Numeric only: `oninput="this.value=this.value.replace(/[^0-9]/g,'')"`
  - Allows minus: `oninput="this.value=this.value.replace(/[^0-9-]/g,'').replace(/(?!^)-/g,'')"`
- **No `display:none` for layout-shifting elements** — use `visibility:hidden/visible`
- **Each app = 3 files** — logic in `.js`, styles in `.css`, structure in `.html`

---

## Known pitfalls

### `element.className = ''` strips base CSS classes
Always reset to the base class string, not `''`:
```js
card.className = 'float-roll-card'; // not ''
```

### Removing iframes from the DOM kills WebRTC streams
Never use `parent.innerHTML = ''` on a container that holds camera iframes. The browser immediately terminates the WebRTC connection when an iframe is detached. Always do in-place DOM updates: find existing elements, update only what changed, append new ones, remove stale ones. See `renderPlayerCards()` and `renderCamerasTab()` for the pattern.

### dddice resize listener accumulation
Store the handler reference and call `removeEventListener` before re-registering (done in `saveConfig()`).

### dddice init order
Must call `.start()` before `.connect()`. The safety timer must be cleared inside `RollFinished`, not after `await sdk.roll()`.

### Campaign join code filtering
`handlePresence()` in `aria-gm.js` early-returns if `data.campaignKey !== currentJoinCode`. When `currentJoinCode` is `null` (e.g. during init), no filtering is applied — all presence messages are accepted.

### Music engine teardown order
In `switchCampaign()`, `musicStop()` must be called **before** the playlist/Ably state is reset (`ablyMusic = null`, `gmPlaylists = []`). `musicStop()` calls `publishMusicStop()` which reads `ablyMusic` — nulling it first makes the publish a no-op and leaves players with orphaned audio.

### Music playlists: active vs. playing
GM music is organized into **named playlists** (`gmPlaylists = [{ id, name, tracks: [...] }]`). Two distinct ids must not be conflated:
- `activePlaylistId` — the playlist **shown/edited** in the Musique tab. Add/delete/rename track ops and the rendered rows target this one (`_activeTracks()`).
- `musicPlayingPlaylistId` — the playlist the **now-playing** track belongs to. Auto-advance, next/prev, and the now-playing label target this one (`_playingTracks()` / `_currentTrack()`); `musicCurrentIndex` indexes into it. Playback can continue from one playlist while the GM browses another.

Use the accessor helpers (`_activePlaylist`/`_playingPlaylist`/`_activeTracks`/`_playingTracks`/`_currentTrack`/`_allTracks`) — never re-add a flat `gmMusic` variable. `musicSelectTrack(i)` plays index `i` of the **active** playlist and makes it the playing one; `musicLaunchPlaylist(id)` is the "choose which queue to launch" entry point.

**Persistence:** localStorage (`aria-gm-music-{id}`) stores the full playlist structure. The Supabase `campaign_music` table stays **flat** (no playlist column) — `_syncAllGMData`/`debouncedSyncMusic` flatten via `_allTracks()` (global `position`), and `loadFromSupabase` calls `_mergeMusicGrouping()` to fold DB tracks back into the existing local grouping (drops tracks deleted elsewhere, appends new ones to the first playlist). `_normalizeMusicData()` migrates the legacy flat array into a single default playlist on read. Cross-device limitation: grouping is not persisted to the DB, so a fresh device collapses all tracks into one playlist.

### Monster/file grouping is not synced
Monster and file groups (`monsterGroups`/`fileGroups` + the `monsterGroupAssign`/`fileGroupAssign` membership maps) live **only** in `aria-gm-monster-groups-{id}` / `aria-gm-file-groups-{id}` localStorage — the synced `monsters` / `campaign_files` Supabase tables use **explicit column lists** (no group column) and `loadFromSupabase` rebuilds the local objects from those columns. So a `groupId` stored *on the entity* would be wiped on reload; keeping grouping in its own key makes it durable same-device. Like music grouping, it is **not** in the DB, so a fresh device shows everything under `Tous` (the entities themselves are never lost). The membership map is keyed by entity id; deleting a monster/file prunes its key (`removeMonster`/`removeGmFile`), and deleting a group clears all keys pointing to it (members fall back to `Tous`). A stale `activeXGroupId` (group removed elsewhere) is reset to `null` at the top of `renderMonsters`/`renderGmFiles`.

### innerHTML and user-supplied strings
Always escape user-supplied content before injecting into `innerHTML`. Both `aria-gm.js` and `aria-player.js` define the same helpers:
- `_escHtml(str)` — for text/attribute contexts.
- `_escJs(str)` — for strings embedded in a single-quoted JS literal inside an inline handler; **always wrap it in `_escHtml` too** (`onclick="fn('${_escHtml(_escJs(v))}')"`), because the HTML parser decodes the attribute before the JS engine sees it.

This is not just self-XSS: skill/weapon/character names travel to the **GM panel** via presence and roll payloads, potion recipes travel to **players** via `potion-grant`, and track names come from YouTube API responses — anyone with the Ably key can publish these. When building lists from remote strings, prefer `document.createElement` + `textContent` + `addEventListener` (see the GM roll-feed player pills). `aria-overlay.js` has its own `esc()` — every interpolated field there must go through it (on-stream XSS in OBS otherwise).

### VDO.ninja push iframe only works on HTTPS
`getUserMedia` (camera capture) requires a secure context. The push iframe (`#vdo-push-frame`, `#vdo-gm-push-frame`) will silently do nothing when the app is served from `file://`. It works from the GitHub Pages URL.

---

## Docs & repo layout notes

- `Docs/` is **gitignored** (local-only). It holds `Aide aux combats.pdf` — official ARIA combat rules (parade/esquive source of truth) — plus console log captures.
- `aria/` — **new design handoff** (`aria/project/HANDOFF_claude_code.md` + screenshots). This design is not yet fully implemented here; keep the folder.
- `AriaTest.sln` / `.vs/` — the user opens the repo in Visual Studio; the `.sln` is tracked, `.vs/` is gitignored.
- `commits` (repo root, gitignored) — plain-text summary of the latest change batch; see Workflow.

---

## OBS setup

Don't hand-build these — use the **📋 Copier URL Overlay (OBS)** button in the player/GM ⚙ config modal, which fills in the right `campaign` (join code) and `overlay` (layout id) params for the active campaign/character.

```
https://mathieu-chateigner.github.io/Aria/views/aria-overlay.html?mode=player&ably=KEY&dddice_key=KEY&dddice_room=SLUG&overlay=player_CHARID&campaign=JOINCODE
https://mathieu-chateigner.github.io/Aria/views/aria-overlay.html?mode=gm&ably=KEY&dddice_key=KEY&dddice_room=SLUG&overlay=gm_CAMPAIGNID&campaign=JOINCODE
```

`campaign=JOINCODE` scopes the rolls/cards/damage channels to one campaign (see *Per-campaign channel scoping*). Omitting it falls back to the global channels — an overlay URL **without** `campaign` will receive nothing once players/GM are on a join code, so always re-copy the URL after this change. `overlay=` is required for the editor-made widget layout to load (player URLs use `player_{charId}`, GM URLs `gm_{campaignId}`).

Browser source size: 1920×1080, transparent background.
