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
  aria-panel.css            ← rules shared by both panels (loaded first on each page)
  aria-player.css
  aria-gm.css
  aria-overlay.css
  aria-overlay-editor.css
js/
  aria-shared.selfcheck.js  ← node-runnable check for the pure logic in aria-shared.js
  aria-supabase.js          ← shared Supabase helpers (loaded first, before panel scripts)
  aria-shared.js            ← shared runtime: el() DOM builder, split-pane engine,
                              music transport, save-key gateway, card deck, utils
  aria-player.js
  aria-gm.js
  aria-overlay.js
  aria-overlay-editor.js
```

`aria-control-panel.html` and `aria-dice-roller.html` are **deprecated**.

### `aria-shared.js`

Loaded before the panel script on both panel pages (`aria-supabase.js` → `aria-shared.js` → `aria-player.js`/`aria-gm.js`). It holds everything the two panels would otherwise keep byte-identical copies of: the split-pane engine, the music transport, the DOM builder, the save-key gateway, the dddice connection, the dice grammar, the roll-filter predicate, and four widget factories.

**The factories are the pattern to follow when a widget exists on both sides.** Each returns an object holding its own state; the panel creates one instance and the HTML calls its methods (`deck.draw()`, `notes.add()`, `cam.toggle()`, `fileViewer.close()`).

| factory | player instance | GM instance |
|---|---|---|
| `makeDeck({ prefix, persist, publish, fly, announce })` | `deck` — table deck, persisted and published | `gmDeck` — `prefix:'gm-'`, private, takes no hooks |
| `makeNotes({ key, ids, sync, syncSoon, remove })` | `notes` — character-scoped | `gmNotes` — campaign-scoped |
| `makeCamera({ tag, sidPrefix, lockPrefix, frameId, ownerId, offKey, room, password, onChange, announce })` | `cam` — `'aria-'`, keyed on `charId` | `cam` — `'aria-gm-'`, keyed on `campaignId` |
| `makeFileViewer({ prefix, files })` | `fileViewer` — over `playerFiles` | `fileViewer` — `prefix:'gm-'`, over `gmFiles` |

Every one of these was previously written out twice, and every copy had drifted. The deck's: the GM's `gmTogglePill` had lost the `if (drawing) return` guard, and its `gmMakePill` never refreshed the pill it had just created, which a stray `gmRefreshAllPills()` in an unrelated function compensated for. The camera's: seven `gm`-prefixed twins (`gmDerivedStreamId`, `gmAdvertisedStreamId`, `gmVdoViewSrc`, `acquireGMPushLock`, `releaseGMPushLock`, `gmCameraOffKey`, `toggleGMCamera`) whose only real difference was which post-change render to run — now the `onChange` hook. **If you find yourself prefixing a function with `gm`, make it a hook instead.**

Three non-factory pieces were deduplicated the same way and are worth knowing by name:

| shared | replaced |
|---|---|
| `rollPassesFilter(entry, filter)` | one filter predicate per panel; see *Roll filter pills* under Known pitfalls |
| `rollDiceFormula(f)` / `formulaToDiceSpec(f)` / `_diceTerms(f)` | the `"2d6+2"` grammar, parsed in three places |
| `fileIcon(type)` | `_pfFileIcon` (player) and `_fileIcon` (GM), identical |

`js/aria-shared.selfcheck.js` covers the pure logic among these — `node js/aria-shared.selfcheck.js`. It stubs the two browser globals the file touches at load and asserts against the dice grammar and the filter pills. Run it after touching either; everything else in `aria-shared.js` needs a real DOM and is exercised by opening the panels.

Only one panel script ever shares a page with it, so **a name declared in `aria-shared.js` must not also be declared in either panel** (top-level `let`/`const` in classic scripts share one global lexical environment; a duplicate is a SyntaxError that kills the file). Note that top-level `let`/`const` are *not* properties of `window` — they resolve by name from other scripts and from inline HTML handlers, but `window.ARIA` is `undefined`.

Per-panel differences go through the `ARIA` hooks object, not a forked copy of the function. Each panel calls `ARIA.configure({...})` at the very top of its file:

| hook | player | GM |
|---|---|---|
| `role` / `tag` | `'player'` / `'PLAYER'` | `'gm'` / `'GM'` |
| `splitKey` | `aria-split-layout` | `aria-gm-split-layout` |
| `defaultPane` | `tab-skills` | `tab-players` |
| `joinCode()` | `character.campaignKey` | `currentJoinCode` |
| `syncAll()` / `clearLocal()` | `_syncAllPlayerData` / `_clearLocalPlayerData` | `_syncAllGMData` / `_clearLocalGMData` |
| `afterRestore()` | `restoreLastCharacter` | `restoreLastCampaign` |
| `onMusicPhase()` | update the music bar | re-render Musique tab, start progress ticker |

`renderTabLayout()` stays in each panel (each does its own post-layout work) and is called by name from shared — resolved at call time. It is `applyTabLayout()` → panel-specific work → `finishTabLayout()`.

---

## Architecture

### Communication — Ably (free tier)

All three apps share **one Ably key** (entered on `index.html`) and use five game channels, plus a config channel:

| Channel | Published by | Consumed by |
|---|---|---|
| `aria-rolls` | `aria-player` (per roll) | `aria-gm` (roll feed) + other `aria-player` instances (toast) + `aria-overlay` |
| `aria-rolls-hidden` | `aria-player` (rolls made with **Jet caché** armed) | `aria-gm` only — other players and the overlay never subscribe |
| `aria-cards` | `aria-player` or `aria-gm` | `aria-overlay` |
| `aria-damage` | `aria-gm` (damage/heal/monster-state/tab-config/grants/karma-set) + `aria-player` (Soigner damage/heal to a target) | `aria-player` (GM damage/heal + grants, all addressed by `charId`) + `aria-overlay` (monster-state; ignores `source:'player'` damage/heal — see payloads) |
| `aria-presence` | `aria-player` + `aria-gm` (Ably **presence** enter/update — not messages) | all three, via `presence.subscribe` + `presence.get`. The presence set is the roster: who is connected, each participant's character data, and the GM's room/spotlight. See *Presence*. |
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

**`ENT` is the single description of every table.** The camelCase-object ↔ snake_case-row mapping lives in `ENT` in `js/aria-supabase.js` and nowhere else. `toRow(entity, obj, parentId, extra)` / `fromRow(entity, row)` build rows and objects from it; `sbPut` / `sbPutAll` (which fills `position` from the array index) are the upsert wrappers.

Each mapping used to be hand-written **four times per entity** — in `runMigration`, in the panel's `sync{X}`, again in `_syncAll{X}Data`, and once more reversed in `loadFromSupabase` — roughly thirty copies that drifted. **Adding a column means adding one line to `ENT`.** A field is `jsKey: 'column'`, or `jsKey: { col, to, from, def }` for a write coercion, a read coercion, or a fallback when the column is null (`def` is called if it is a function, so each object gets its own array/object). `entity.stamp` names the timestamp column — `updated_at` by default, `created_at`/`drawn_at`/`ts` for the append-only logs, `null` for tables with none.

**Delete cascades are derived, not listed.** `childTables(parentCol)` returns every `ENT` table hanging off that FK, and `sbDeleteCascade(entity, parentCol, id)` deletes the parent plus all of them. `deleteCampaign()` used to spell out nine `sbDelete` calls and `deleteCharacter()` five; a new child entity is now covered the moment it is added to `ENT`.

- Player: `debouncedSync()` for character data, `debouncedSyncState()` for HP/cards/tabs, `syncCharacterNote` / `deleteCharacterNote` for notes, `syncCharacterFile` / `deleteCharacterFile` for files.
- GM: `syncCampaign`, `debouncedSyncMonsters`, `insertRoll` / `insertCardHistory` (append-only — `clearRolls()` / `clearCardHistory()` never touch the DB), `debouncedSyncPotions`, `debouncedSyncFiles`, `syncGMNote` / `deleteGMNoteFromDB`, `syncKnownPlayer` (called whenever the presence set changes), `syncMusicTrack` / `debouncedSyncMusic` / `deleteMusicTrackFromDB` (Supabase table `campaign_music`; field `youtube_id` maps to `youtubeId` in JS).
- `runMigration` is a one-time runner that reads the old JSON blob from `saves` and populates the relational tables. It checks `player_migrated_at` / `gm_migrated_at` flags to skip if already done.

### No server, no build

- State persisted in `localStorage` (character, config, cards, HP, monsters, potions)
- `sessionStorage` holds the per-tab `playerId` (UUID, regenerates per tab) — used only to suppress the toast for one's own roll; see *Player identity*

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
| `aria-gm-camera-off-{id}` | `'1'` when the GM cut their own camera (kill switch, survives refresh) |

Helper functions `monstersKey()`, `rollsKey()`, `cardHistKey()`, `potionsKey()`, `filesKey()`, `musicKey()`, `monsterGroupsKey()`, `fileGroupsKey()`, `gmNotesKey()`, `knownPlayersKey()` return the scoped key for the active campaign. Always use these — never hardcode the bare key.

**`CAMP_KEYS` names every campaign-scoped key, and `campKey(which, id)` is the only way to build one** (`id` defaults to the open campaign). `_CAMPAIGN_KEY_PREFIXES` — the list `_dropCampaignKeys(id)` walks — is `Object.values(CAMP_KEYS)`, so a key cannot be added to one and forgotten in the other. `CHAR_KEYS` / `charKey(which, id)` / `_dropCharacterKeys(id)` are the player-side equivalent. The named accessors above (`monstersKey()`, `hpKey()`, …) are thin wrappers over these.

This replaced a prefix literal repeated at every call site plus a hand-typed list inside `deleteCampaign()`; neither copy knew about `aria-gm-camera-off-`, so it leaked on every delete. **Adding a scoped key means adding one line to `CAMP_KEYS` / `CHAR_KEYS` and nothing else.** (Non-campaign-scoped GM keys: `aria-gm-split-layout` for the multi-pane layout, `aria-gm-read-table` for the bigger-faces toggle, `aria-gm-last-campaign` for auto re-entry.)

`generateJoinCode()` produces the join code. If a campaign loaded from storage lacks one, it is generated and saved on `loadCampaignState()`.

### Player identity

Three distinct identifiers — do not conflate them:
- `character.name` — display name, sent as `char` in roll payloads and `name` in presence.
- `charId` — stable character UUID. It is the Ably **`clientId`**, so it identifies the participant in the presence set, keys the GM `players` Map, **targets** every addressed message (grants, damage, tab-config, karma-set), and derives the VDO.ninja stream ID.
- `playerId` — per-tab session UUID (sessionStorage). Now used **only** in roll payloads, to suppress the toast for one's own roll. It is deliberately not the targeting token: a second tab of the same character should still be told about a roll made in the first, but it *should* receive that character's damage and grants.
- `connectionId` — assigned by Ably per connection, never by this code. It is what distinguishes two tabs sharing a `clientId`, and the GM keys `filesGrantedSessions` by it.

### Presence — Ably Presence API

**Liveness is not computed by this codebase.** All three apps use the presence set of a per-campaign channel, `aria-presence-{JOINCODE}`, as the roster. The player and the GM `enter()` it and `update()` their member data on change; the overlay only subscribes. Any change to the set is handled by re-reading it whole (`presence.get()`) rather than patching a local copy, so no app can drift from the server's view.

- **Player** — `clientId = charId`, member data is the character payload (see *Ably message payloads*).
- **GM** — `clientId = 'gm-' + campaignId`, member data is `{ role:'gm', streamId, vdoRoom, vdoRoomPassword, spotlightCharId, ts }`.
- **Overlay** — no `clientId`, never enters. Observers do not need one.

Two properties of Ably presence carry the design, and most of what used to live here was a hand-rolled substitute for them:

**A `clientId` may be present several times, differentiated by `connectionId`.** One character open in two tabs is two members, not a contested single slot. There is no per-character session registry in any of the three apps, and closing one tab cannot drop the character — the other member is still in the set. Members are collapsed to participants by `clientId`, newest `ts` winning.

**An abrupt disconnect is reported as `leave` after 15 seconds.** A page refresh opens a *new* connection that enters before the old one is reaped, so the set is never empty across a reload. This is why **neither app has a `beforeunload` handler** and why nothing announces its own departure: there is no signal that could be misread as a shutdown, so there is no grace period to ignore it and no auto-re-entry needed to satisfy that grace period. Do not add one back — the previous design needed three mechanisms whose combined effect on a refresh was to do nothing, and each was a bug source on its own. Ably's 15s can be shortened via `remainPresentFor` in `transportParams` if a genuine departure ever needs to be noticed faster; the trade is churn on flaky links.

Consequences worth stating because they used to be code:

- The GM has no `gm-presence` heartbeat. Room, MJ stream and spotlight are member data, so a player connecting an hour later gets them from `presence.get()` — which is what the 8s rebroadcast and the "immediate reply to new sessions" existed for.
- The GM has no offline sweep. `players` entries are marked `online:false` when they leave the set and kept, since that map doubles as the known-players snapshot; the camera iframe is gated on `online`.
- The player has no 5s heartbeat. Presence is republished from `saveCurrentCharacter()`, the HP handlers, and the tab-config handler — every place that used to rely on the next tick. `schedulePresence()` debounces bursts at 250ms.
- **Targeted messages on `aria-damage` address the `charId`, not a tab.** Every tab of a character receives and applies them, so a message can no longer be delivered to the tab that just closed — which is what the "repoint the stored `playerId` at a surviving session" logic existed to prevent. `playerId` survives only in roll payloads, where it suppresses the toast for one's *own* roll (a second tab of the same character should still be told).

### VDO.ninja camera integration

Each participant's camera stream is identified by an **auto-derived stream ID** — players never set this manually:
- Player: `'aria_' + charId.slice(0, 8)` — `cam.streamId()`, from `sidPrefix: 'aria_'`
- GM: `'aria_gm_' + campaignId.slice(0, 8)` — `cam.streamId()`, from `sidPrefix: 'aria_gm_'`

The GM sets a `vdoRoom` (and optional `vdoRoomPassword`) once on the campaign via the `⚙` config modal. It reaches players as part of the GM's presence member data. Players activate their hidden push iframe (`#vdo-push-frame`) once they see a room. Camera push only works on HTTPS (GitHub Pages), not from `file://`.

**Stream IDs must be `[A-Za-z0-9_]` — VDO.ninja rewrites everything else to `_`.** A stream pushed as `?push=aria-11b0286b` is announced in the room as `aria_11b0286b` (the push iframe says so itself: `stream-id-detected aria_e4d7af3c`, `share-link …?view=aria_gm_c2ac119b`, `getStats → {streamID:'aria_11b0286b'}`). A viewer asking for `?view=aria-11b0286b` therefore matches no publisher and stays **black on every side, forever** — with no error anywhere, since both halves believe they are working. The prefixes are `aria_` / `aria_gm_` for that reason, and `sidSafe()` (`\W+` → `_`, in `makeCamera` and again in `aria-overlay.js`) is applied to every id we push, advertise, view or compare — peers on an older build still advertise hyphens, and so do camera widgets saved by an older overlay editor. Never reintroduce a hyphen, or any other punctuation, into a stream id.

**Viewer iframes need the room password too.** Streams pushed into a password-protected room are encrypted, so a bare `?view=SID` stays black — `cam.viewSrc()` (both panels) and `vdoCamSrc()` (overlay) all append `&room` + `&password`. (An earlier version of this file claimed viewers didn't need it; that was wrong and cost a debugging session.)

**The push iframes live outside the tab/pane layout** — `#vdo-push-frame` (player) and `#vdo-gm-push-frame` (GM) are siblings of `#app-wrapper`, fixed and full-viewport at `opacity:0`. Never `display:none` (can block camera capture) and never visible (the self-preview shows through the app's transparent backgrounds). The GM's push frame used to sit inside the Joueurs tab, whose `.tab-content` goes `display:none` on every tab switch — the GM camera silently died. What shows in the Joueurs tab is a **muted viewer** of the GM's own stream, which is safe to hide.

**The session ends when the GM leaves the presence set.** Players then clear the room and blank the push iframe. There is no "session over" message, no silence timer, and no grace period — see *Presence* above for why a GM refresh does not reach this state.

**Nothing calls `getUserMedia` — in either app.** The push iframes own the camera; every in-app tile is a VDO.ninja **viewer**, the self tiles being viewers of one's own stream with `&muted`. A native self-view fallback used to exist for the "no VDO room" case on both sides; it was unreachable (the Caméras tab only appears once a room is known, so the fallback could never bootstrap) and is gone. Don't reintroduce it: it lights the camera LED for a preview nobody is watching.

**Participants advertise `streamId` only while actually publishing.** `cam.advertisedId()` gates it, returning `''` unless `cam.live()` (`= ownerId && room && !off`); `renderPlayerCards()` renders a camera iframe only when `p.streamId && isOnline && currentVdoRoom`. Advertising it unconditionally gave every GM card a permanent black box, and the persisted known-players snapshot resurrected dead iframes for offline players on campaign load.

**A viewer tile requires a room.** A viewer URL without `&room` cannot decrypt a stream pushed into a password-protected room, so a tile built from a `streamId` that outlived the room is a guaranteed black rectangle. Every tile builder gates on the room: `camerasAvailable()` (`= !!vdoRoom`) drives the player's Caméras tab and presence control, the GM/peer entries in `renderCamerasTab()` and `renderPresenceRail()` are gated on `vdoRoom` like the self tile always was, and the GM's player cards require `currentVdoRoom`. The GM's `saveConfig()` calls `renderPlayerCards()` so setting/clearing the room applies at once.

**Leaving a campaign requires a camera teardown, not just an Ably re-subscribe.** `resetCameraState()` (player) clears the room/peers/GM stream/spotlight, blanks the push iframe and re-renders. It is called by `switchCharacter()` **and** by `saveConfig()` when the join code changed — editing the join code in the ⚙ modal re-subscribes every channel onto another campaign and is a campaign switch. Closing the old Ably connection is what leaves the old campaign's presence set, so nothing needs to be published (or awaited) first.

**Both sides own a camera kill switch** — one implementation, `cam.off`, toggled by `cam.toggle()`: per character (`aria-camera-off-{charId}`, the `📹` pill in the presence control) and per campaign (`aria-gm-camera-off-{campaignId}`, the topbar `📹` next to *Lire la table*). It gates the push iframe, the advertised `streamId`, and the self tile / "Votre caméra" preview. The GM decides the room; each participant decides whether to publish into it. Cutting the GM camera is deliberately **not** a session-over signal — `vdoRoom` stays in the member data, so players go on publishing and only the MJ tile disappears. `cam.renderToggle(btnId)` hides the button when no room is set.

**The kill switch syncs across tabs via the `storage` event** (`cam.syncFromStorage(e)`, which each panel's handler calls). It is per-character / per-campaign localStorage state that `cam.live()` reads, so every tab of a participant must agree on it — otherwise two tabs sharing a `clientId` would advertise different stream IDs and the tile would flip between them. `storage` fires only in the *other* tabs, so the handler never re-enters the tab that made the change.

**One character, several tabs: only one may hold the webcam.** The push stream ID is a pure function of `charId` (`campaignId` for the GM), so two tabs would publish into the same room under the same ID. Arbitration is an **exclusive Web Lock** — `aria-push-{charId}` / `aria-gm-push-{campaignId}` — requested once per character/campaign and held for the tab's life via a promise that never resolves. The browser grants it to one tab, queues the rest, and releases it when the holder's tab goes away *including a crash*, at which point the next in the queue starts pushing immediately. `cam.releaseLock()` aborts the queued request or resolves the held one on character/campaign switch; `cam.acquireLock()` gets in line.

There is no TTL, no timestamped record, no read-back-after-write, and no "taking over" state to report: those all existed because the previous localStorage claim had to detect a dead holder itself. Web Locks needs a secure context with a real origin and throws from `file://`; both apps then assume sole ownership, which is correct there since nothing can push from `file://` anyway.

**The lock answers "which tab pushes" and nothing else.** "Is anyone pushing?" is `cam.live()` — shared state every tab of the participant evaluates identically — so they all advertise the same `streamId` and no consumer can see it flip. Gating the *advertised* ID on lock ownership would have a non-holding tab publish `''` under the same `clientId` as its sibling. `cam.syncPushFrame()` keeps the two questions apart: `cam.live()` drives the "Votre caméra" preview, and it adds `cam.lockHeld` to drive the push frame.

**Viewer iframes get `allow="autoplay; fullscreen"` and nothing else.** Only the push frames (`#vdo-push-frame`, `#gm-self-view-wrap`'s iframe) need `camera; microphone; display-capture`. Don't copy the push permission list onto a viewer.

**The VDO room password is a shared secret, not a credential.** It is distributed in cleartext in the GM's presence data (every subscriber gets it — players need it to push), and stored plaintext in `campaigns.vdo_room_password` and localStorage. Anyone holding the Ably key — which is pasted into OBS overlay URLs — can join the room. Treat the overlay URL as sensitive. The GM's push-URL log line redacts `password=` because those logs get pasted into bug reports.

**Push failure is reported, not silent.** `renderCamerasTab()` renders `#cameras-warning` when a room is active but the page is not on a real HTTPS origin, when the player cut their own camera, and when another tab holds the push lock. The insecure-origin test is `location.protocol === 'file:' || !window.isSecureContext` — **`isSecureContext` alone is not enough**: `file://` is *potentially trustworthy* per the Secure Contexts spec, so it reports `true` and the warning it was written for could never fire.

**The push URL disables the microphone with `&audiodevice=0`, not `&noaudio`.** `&noaudio` is a *viewer-side* option — it silences incoming streams and does nothing to what a page publishes. With it, the push iframe asked for camera **and** microphone; Chrome bundles those into one prompt, and denying it fails `getUserMedia` outright, so the webcam never started and nothing on screen said why. If table voice chat over VDO.ninja is ever wanted, this is the one parameter to change (and peer viewer tiles are already unmuted).

**The Caméras grid is never emptied while a room is known.** `.tab-content{display:none}` hides the iframes but leaves their WebRTC connections up, so leaving the tab for Inventaire and coming back costs nothing. `renderPresenceUI()` used to clear the grid whenever its pane closed, and every such trip meant watching the whole table reconnect from black. It still clears when `camerasAvailable()` goes false (session over) — `renderCamerasTab()` cannot, since it is unreachable once the pane is closed.

`renderPresenceUI()` still hides the Bandeau rail while `tab-cameras` is in `openPanes` (`renderTabLayout()` calls it, so docking/undocking re-evaluates), but with the grid now persisting, a *closed* pane in Bandeau means the rail and the hidden grid each hold a viewer on the same streams — **2× inbound connections per peer**. That is the accepted trade for instant tab switching at a table of a handful; the fix, if it ever bites, is one shared iframe host that the rail and the grid both style, rather than two sets that must never be alive at once (marked `ponytail:` at the site).

**Choosing which camera to publish — `&videodevice`.** VDO.ninja takes whatever camera Chrome offers first, which on a machine running OBS is the OBS virtual camera: the GM ends up broadcasting OBS's own output back into the table. `cam.setVideoDevice(v)` pins it, and the push URL carries `&videodevice=<v>`. Two things decide the shape of `v`:

- VDO.ninja matches it against the **normalised label** — its `normalizeDeviceLabel()` is `\W+ → _` lowercased — trying `startsWith`, then `includes`, then an exact `deviceId`. A `deviceId` is base64 and gets mangled by that same normalisation, so **store the normalised label, never the id**.
- The list comes from the **push iframe**, not from this page. `navigator.mediaDevices.enumerateDevices()` returns blank labels until *this origin* has been granted the camera, and it never is — the push iframe owns the webcam and is a different origin. `cam.askDevices()` posts `{getDeviceList:true}` to it 5s after load (alongside `pushStats()`); the reply is a flat array handled on the same `message` listener. It is cached in `aria-camera-device-list` so the picker is filled on the next load instead of sitting empty, and for tabs that hold no push frame at all.

There is no documented postMessage to switch device at runtime, so `setVideoDevice()` re-srcs the push frame — a couple of seconds of black for everyone watching, acceptable for a setting changed once per machine. The choice lives in **`aria-camera-device`, deliberately unscoped**: it names a device on this machine, so it is right for every character the browser opens and for the GM panel in the next tab. `cam.renderDevicePick(selectId)` fills the `<select>` (`#cam-device-pick` in the player's Caméras toolbar, `#gm-cam-device-pick` in the GM's Joueurs tab, rendered *before* `updateGMPushIframe()`'s early return — the picker exists to fix a wrong camera, which is exactly when the preview is hidden) and hides it when no room is set.

**Camera tile size is two knobs: one common, one per tile.** The `Taille` slider moves `camSize` → `aria-camera-size` (px), applied as `--cam-w` on `#cameras-grid` and read by `.camera-iframe-wrap{width:var(--cam-w,280px)}` — every tile follows it. The corner grip (`attachCamResize`, on the self tile too) resizes **only its own tile**, keyed by the cell's stream ID in `camSizes` → `aria-camera-sizes` (`{ streamId: px }`). `applyCamSize()` re-applies both on every render — an override becomes an inline `wrap.style.width`, no override sets `''` so the cell falls back to the slider. `resetCamSize()` (`Réinit.`) clears the overrides *and* the common size. A cell with no stream ID (placeholder) has nothing to key on, so its grip moves the common size instead. The grip used to write `wrap.style.width` directly with no backing store, so a per-cell size was lost on every rebuild; that is why the override is persisted per stream ID rather than left on the node.

**Viewer URLs that include `&room=` MUST also include `&solo`** — without it VDO.ninja ignores `&view` and renders the "Join Room with Camera" landing page instead of the stream. `cam.viewSrc()` appends `&solo&room=...` together.

**Push URLs MUST include a blank `&view`** (`?push=SID&room=ROOM&view&...`) — per VDO.ninja docs, an empty `&view` means "no streams will play; only publishing will be allowed". Without it, a push page inside a room acts as a full room client and *renders every other guest's video* next to the self-preview (players appeared inside the GM's "Votre caméra" panel) and silently downloads all remote streams in the player's hidden push iframe.

**Important:** `renderPlayerCards()` in `aria-gm.js` goes through `reconcile()` so camera iframes are never detached when the roster changes — removing an iframe from the DOM kills its WebRTC stream. It used to build the card as a template string on first sight and then maintain a *second, parallel* branch that reached back in with `querySelector` to update each field; there is now one description of the card (`create`) and one updater (`update`), over a node whose identity is preserved. `renderCamerasTab()` in `aria-player.js` still surgically adds/removes cells rather than clearing the grid.

**`Reconnecter` does not reconnect.** The ⚙ modal's save button used to close the Ably connection unconditionally on both panels, and closing it *leaves the presence set*. On the GM that is the session-over signal: every player dropped `vdoRoom`, blanked its push iframe and tore down every tile, then rebuilt the lot when the GM re-entered — one click restarted the whole table's cameras. On a player it emptied that tab's own grid (its presence set read back empty) and made every peer rebuild its tile. Nothing in either modal can change the connection: the Ably key comes from `index.html`, and the channel suffix comes from the join code, which the GM modal only *displays*. So `saveConfig()` now reconnects only when the player edited the join code (a real campaign switch, with `resetCameraState()`) or when `ablyInstance` is already gone; otherwise the GM republishes its presence member data (`publishGMPresence()` → `presence.update()`, which is all the room/password need) and the player leaves the connection alone.

**Camera logging is off by default.** `camLog()` in `aria-shared.js` (gated by `camLogOn`) replaced every automatic `console.log` on the camera path — push/lock/device/stats in `makeCamera`, the `[VDO]` render and presence lines in `aria-player.js`, the preview line in `aria-gm.js` — and `aria-overlay.js`'s per-widget lines were deleted outright (it doesn't load shared). `ariaCamDiag()` still prints a full snapshot on demand in all three apps, and calls `ariaCamLog(true)` first so the async `pushStats` reply lands. `ariaCamLog(false)` turns it back off. `console.error` on presence/Ably failures is untouched.

**Auto re-entry.** Both apps remember what they were in — `aria-gm-last-campaign`, `aria-last-character` — and `tryRestoreSupabase()` re-enters it after `showSelectionScreen()`, so a refresh comes straight back rather than parking on the selection screen. This is now a convenience: it used to be the only thing that got the GM broadcasting again inside the players' 12s camera grace period. An unknown id (deleted elsewhere) is refused and the key cleared; `switchCampaign()` / `switchCharacter()` clear it, since leaving on purpose should not be undone on the next load.

### Overlay editor (`aria-overlay-editor.js`)

A separate drag-and-drop editor opened in a new tab from the player or GM panel. Widgets are defined in `WIDGET_DEFS` (persistent and event categories). Each widget has `{ id, type, category, x, y, w, h, visible, config }` where all positions are percentages of the 1920×1080 canvas. The editor saves to Supabase `overlay_configs` table (keyed by `{type}_{ownerId}`) and publishes `layout-update` on `aria-overlay-config` for live sync to the running overlay. `camera` widgets (GM-only) render a VDO.ninja viewer iframe and are **skipped in `updateWidgetData()`** to prevent iframe reload on every roster change. The overlay reads `vdoRoom`/`vdoRoomPassword` from the GM's presence member and builds camera iframe URLs with `vdoCamSrc()` (`&solo&room&password` appended once known — a bare `?view=SID` stays black for streams pushed into a password-protected room); `refreshCameraWidgets()` re-srcs the iframes when the room info arrives, **and swaps a widget for the `—` placeholder when its stream stops** — liveness is `liveStreamIds()` (the `streamId`s in `presenceCache`, i.e. the players currently in the presence set, plus `gmLiveStreamId`). Without it a disconnected player left a black rectangle on stream forever. `renderWidgetContent()` applies the same rule so a layout re-render can't recreate a dead iframe, and neither path re-srcs an iframe that is already correct (that would kill the WebRTC connection and flicker the picture). `applyPresenceSet()` computes whether anything camera-relevant actually moved before calling `refreshCameraWidgets()`, for the same reason. **`vdoRoom` is only ever cleared by a GM that is still present and has cleared it** — when the GM leaves the set entirely, only `gmLiveStreamId` is dropped and the cached room is kept: clearing it would change every *player* widget's URL (theirs lose `&room`) and re-src live iframes, flickering every camera on the OBS output. Their streams stop being live on their own once the players stop publishing. The camera widget's stream ID is picked from a **dropdown** (`#prop-stream-pick`, filled by `availableStreams()`) — stream IDs are derived from UUIDs and shown nowhere in the panels, so the free-text field alone was unfillable. The list is rebuilt from same-origin localStorage: `aria-gm-known-players-{campaignId}` for a GM overlay, `aria-characters` for a player one. Manual entry still works and the two fields stay mirrored.

`renderWidgetLayer()` **reconciles in place** — it must never do `container.innerHTML = ''`. It runs on every `layout-update`, and the editor publishes one 1.5s after any drag/resize/property edit, so rebuilding blacked out every camera on the OBS output whenever the layout was touched. Existing elements are never re-appended either (moving an iframe reloads it); new ones go on the end, which keeps DOM order matching `overlayConfig.widgets` because the editor only ever appends widgets. Cameras go through `syncCameraWidget()`, shared with `refreshCameraWidgets()`.

`loadOverlayConfig()` **yields to a live layout**: it awaits Supabase at startup while the editor publishes over Ably and writes to the DB concurrently, so a `layout-update` arriving during that round-trip is newer than anything the read can return. The `layoutFromAbly` flag makes the stale row a no-op instead of dropping the OBS output back to the previous layout until the next edit.

### dddice 3D dice (browser SDK)

Loaded at runtime via dynamic `import('https://esm.sh/dddice-js')` — no npm, no build.

- **`initDddiceSDK(onRollFinished)`** in `aria-shared.js` does the whole connection — import, theme fetch, dropdown fill, `new ThreeDDice(canvas, key)`, `.start()`, `.connect(slug)`, resize listener — and owns `dddiceSDK` / `dddiceAPI` / `dddiceResizeHandler`. The **`RollFinished` handler is the only per-panel part**, and is its sole argument; `teardownDddice()` is the matching disconnect. Each panel's `initDddice()` is now just that handler (plus the player's asset preload). Only the GM used to register the resize listener, so the player's dice rendered at a stale scale after a window resize.
- A `<canvas id="dddice-canvas">` is positioned fixed/full-screen with `pointer-events:none` and high `z-index` in all three apps
- `RollFinished` event clears the canvas after 1.5s
- A 12s safety timer (`dddiceRollSafetyTimer`) forces fallback if the SDK stalls
- Overlay syncs Ably roll data with dddice animation via `pendingRollData`/`diceFinished` flags; if SDK is not configured, a 3s fixed delay is used instead
- `saveConfig()` always disconnects dddice and removes the resize listener before reinit. It **does not close the Ably connection** — see *`Reconnecter` does not reconnect* below. When it does close one (player, campaign switch), it must call `ablyInstance.close()`: nulling the refs without closing leaves the old WebSocket subscribed and duplicates every incoming message

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
| `aria-last-character` | id of the character to re-enter on load (see *Auto re-entry*) — not per-character |
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

### `aria-presence` — presence member data (not messages)

Published with `presence.enter()` / `presence.update()`, read with `presence.get()`. There is no heartbeat: a member republishes only when something changes.

**Player** (`clientId = charId`):
```js
{ role: 'player', charId, name, charClass, hp, maxHP, stats, protection, skills, specials,
  weapons, inventory, potions, vials, potionRecipeIds, tabs, money, karma,
  campaignKey, ariaType, streamId, ts }
```
- `charId` — character UUID (stable; never changes even if the name does). Also the `clientId`, so it keys the participant in every consumer.
- `streamId` — `'aria_' + charId.slice(0, 8)`, or `''` unless a `vdoRoom` is active and the kill switch is off (`cam.advertisedId()`) (an advertised ID nobody is pushing renders as a black iframe on every receiver).
- `ts` — publish time. Used to pick the newest member when one `clientId` has several (two tabs, or the ghost of a refreshed tab).
- `karma` — the character's stored karma. Seeds the GM's in-memory `gmKarma` map the first time a `charId` is seen (a GM page reload wipes the map; without seeding, the next ± click would send `karma-set` with ±1 and clobber the player's real karma). After seeding, the GM's local value is authoritative — the GM is the only karma writer.

Republished by `saveCurrentCharacter()`, `handleGMDamage()` / `handleGMHeal()`, the Soigner self-heal paths, and the `tab-config` handler — every place that previously relied on the next 5s tick. `schedulePresence()` debounces at 250ms.

**GM** (`clientId = 'gm-' + campaignId`):
```js
{ role: 'gm', streamId, vdoRoom, vdoRoomPassword, spotlightCharId, ts }
```
`streamId` is `'aria_gm_' + campaignId.slice(0, 8)`, or `''` while the GM's kill switch is on or no room is set (`cam.advertisedId()`). Players read `vdoRoom`/`vdoRoomPassword` from here to activate their push iframe. `spotlightCharId` lives here rather than in a broadcast so a late joiner picks it up from `presence.get()`.

Republished by `toggleSpotlight()`, `cam.toggle()`, `saveConfig()` (via re-entry on the new connection), and when the spotlighted player leaves the set.

There is **no "session over" payload**. Leaving the presence set is the signal, and Ably emits it. `gmSpotlightCharId` is cleared when the spotlighted player is no longer in the set — Ably has already waited out a possible reconnect, so this no longer fires on a refresh or a closed second tab.

**Validation.** Presence data is remote-controlled (anyone holding the Ably key can enter the set), so the GM's `handlePresence()` rejects members whose `campaignKey !== currentJoinCode` or whose `ariaType` doesn't match, **validates that `charId` is UUID-shaped** via `_isIdToken()` (`/^[A-Za-z0-9_-]{1,64}$/`), and **coerces `hp`/`maxHP`/`vials`/`karma` via `_finiteNum()`**. Both are now *message validation* — a malformed id is a bad message — rather than escaping: since the renders build elements with `el()`, neither is load-bearing for injection any more.

`loadCampaignState()` applies the **same `_isIdToken()` check** when rehydrating the `aria-gm-known-players-{id}` snapshot. That snapshot is written from presence data, but entries persisted before the validation existed can hold anything, and they feed the same `players` Map and the same renders. Card lookups (`playerCardEl` / `monsterCardEl`) go through `keyedNode()` — a Map lookup, so an id containing a quote is a miss rather than a thrown exception. They used to be `CSS.escape`'d CSS selectors, where a missed escape threw out of `players.forEach` and froze the Joueurs tab and its camera iframes.

### `aria-damage` / `damage` | `heal`
```js
{ targetId, damage, hpBefore, hpAfter, maxHP, charName, source: 'gm' }     // GM → player
{ targetId, amount, hpBefore, hpAfter, maxHP, charName, source: 'gm' }
{ targetId, damage, source: 'player' }                                     // player → player (Soigner)
{ targetId, amount, source: 'player' }
```
`targetId` is a **`charId`** — every tab of that character receives and applies the change. `charName` is displayed by the overlay's damage/heal VFX. The `source:'player'` variants carry **no HP fields** — the target computes and applies the change itself, and the overlay ignores them.

### `aria-damage` / `karma-set`
```js
{ charId, karma: number }   // GM sets a player's karma; player stores it on the character
```

### `aria-damage` / `tab-config`
```js
{ charId, tabs: { cards: bool, alchemy: bool } }
```

### `aria-damage` / `potion-grant` | `potion-revoke` | `vial-grant`
```js
{ charId, potion: { id, name, desc, ingredients, successChance } }
{ charId, potionId: string }
{ charId, qty: number }
```

### `aria-damage` / `file-grant` | `file-revoke`
```js
{ charId, file: { id, name, type, url } }   // grant — player adds file to playerFiles
{ charId, fileId: string }                   // revoke — player removes file from playerFiles
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
Lists all saved characters. Creating a character prompts for name, class, an optional campaign join code, and the character type (Médiéval/Contemporain radio — picks the template). The join code and type are shown as badges on each character card. `selectCharacter(id)` → `loadCharacterState(id)` → `initApp()`. `switchCharacter()` closes Ably (which leaves the presence set), releases the push lock, and tears down dddice before returning.

### GM campaign selection screen
Lists all campaigns, each showing its join code (click to copy). `selectCampaign(id)` → `loadCampaignState(id)` → `initApp()`. After entering a campaign, the join code is shown in the topbar (click to copy) so the GM can share it with players.

### Player panel tabs
`Compétences` | `Caractéristiques` | `Jet libre` | `Inventaire` | `Notes` | `Cartes` | `⚗ Alchimie` | `Fichiers` | `📹 Caméras` | `Personnage`

The Caméras tab carries a toolbar above the grid: the camera picker (`#cam-device-pick`) and the tile-size slider (`#cam-size`) + `Réinit.` — see *Choosing which camera to publish* and *Camera tile size* under VDO.ninja.

`Cartes` and `⚗ Alchimie` are hidden by default — shown only when GM enables them via `tab-config`. `Fichiers` auto-shows when the GM grants at least one file (`playerFiles.length > 0`). `Caméras` auto-shows while a `vdoRoom` is known (`camerasAvailable()`) — see *A viewer tile requires a room* below.

### GM panel tabs
`Joueurs` | `Monstres` | `Jets` | `Jet MJ` | `Cartes` | `⚗ Alchimie` | `Fichiers` | `♪ Musique`

The GM Fichiers tab lets the GM upload files to Supabase Storage (`campaign-files` bucket) and grant/revoke access per player. `gmFiles` entries: `{ id, name, type, url, path, grantedTo: [] | 'all' }`. Upload via `uploadFileToSupabase()`, grant via `file-grant` message on `aria-damage`.

The GM ♪ Musique tab holds **multiple named playlists** rendered as a chip bar (`#music-playlist-bar`): click a chip's ▶ to launch that playlist, click its name to view/edit it, ✎/✕ on the active chip rename/delete. New tracks are added to the active playlist. See *Music playlists: active vs. playing* under Known pitfalls.

The **Monstres** and **Fichiers** tabs each have a **group chip bar** (`#monster-group-bar` / `#file-group-bar`) for navigating long lists — a `Tous` chip (always present) plus one chip per group, then `＋`. Clicking a chip name filters the grid to that group; the active group chip carries ✎/✕ (rename/delete). Each card has a `⠿` drag grip; drag a card onto a chip to assign it (drop on `Tous` un-assigns). Adding a monster/file while a group is filtered auto-assigns it to that group. Groups + membership live in a **separate, non-synced** localStorage key (`monsterGroupsKey()` / `fileGroupsKey()`) — see *Monster/file grouping is not synced* under Known pitfalls. The grouping engine is shared by both tabs (`_renderGroupBar(type)`, `_groupChip`, drag helpers `_groupDrag*`, and `assign{Monster,File}ToGroup`).

The Joueurs tab shows a live player card per connected player. Each card displays a VDO.ninja viewer iframe (`?view=STREAMID`) above the HP bar when the player has an active stream. `renderPlayerCards()` reconciles by `charId` — it never clears the grid — to preserve live camera iframes when the roster changes. When a player has no stream the wrapper is **hidden, not detached** (detaching kills the connection; blanking the src reloads the frame on the way back).

### Bonus/Malus bar (player)
Persistent bar between topbar and content. Buttons: +10/+20/+30/−10/−20/−30 + custom ± + reset. The persistent `bonusMalus` applies to all BM-affected rolls (every `doRoll` with `skipBM=false`; the **Jet libre** free roll passes `skipBM=true` and is unaffected). `doRoll` also adds the character's **karma** to every non-skipBM threshold.

**`rollThreshold(base, { bonus, skipBM })` is the one definition of a threshold.** `doRoll` rolls against it and every live preview (skills, specials, stat cards, combat reactions, potion chance) displays it, so the shown % *is* the rolled threshold. It was previously hand-written at nine call sites which had already drifted: the potion card floored at 0 while `doRoll` floored at 1 — a recipe could advertise `Succès 0%` and then roll against 1 — and the potion preview omitted the per-skill `bonus` the skill list included. **Never re-derive `base + liveBM() + karma` inline.**

The bar also holds the **Jet caché** toggle (`hiddenRollMode`) — while armed, rolls publish to `aria-rolls-hidden` (GM only) instead of `aria-rolls`. Resets on character switch.

**Temporary modifier (next N rolls)** — the `Prochains jets` control arms a one-off modifier (`bmNextValue`) that applies to the next `bmNextCount` BM-affected rolls then auto-expires. `bmNextActive()` returns the value while charges remain; `liveBM() = bonusMalus + bmNextActive()` is used for **all live percentage previews** (skills, specials, stat thresholds, combat reactions, potion chance). `doRoll` stamps the total applied modifier into `_appliedBM` (= `bonusMalus + tempBM`, karma excluded) so the roll payload's `bonusMalus` field, the float card, and the GM/overlay feed report what was actually applied; it then consumes one charge (decrement `bmNextCount`, clearing `bmNextValue` at 0). The armed state shows as a pill (`#bm-next-status`) with a ✕ to cancel (`clearBMNext`). All temp state resets on character switch. This is **player-side only** — no payload/protocol change.

**Per-skill permanent modifier (#12)** — each skill/special carries an optional `bonus` (set via a `mod` input in the **Personnage** editor, next to the `%`). It is part of the character object (a JSON column on the `characters` table, so it round-trips cross-device — no migration). The modifier is **baked into `basePct`** at the roll call site (`doRoll(name, skill.pct + bonus)` for skills/specials/Soigner/parade/esquive), so the rolled threshold already includes it; `bonus` is therefore distinct from `bonusMalus`, the temp modifier, and `karma`. Live previews pass it through as `rollThreshold(skill.pct, { bonus })`; a `.skill-mod` badge marks non-zero values in the Compétences list. The GM player-details modal folds it in via `_pdmSkillPct(s)` (shows `pct+bonus` with a `+N` note). Because it is baked into the threshold, no Ably payload changes.

### Player presence (GM — Joueurs tab)
- The `players` Map is rebuilt from the `aria-presence` set on every change — no heartbeat, no sweep. `online` is membership in the set.
- `handlePresence(charId, data)` rejects members whose `campaignKey !== currentJoinCode` or whose `ariaType` doesn't match the campaign
- Players who leave are marked `online:false`, not deleted — the map doubles as the offline known-players snapshot
- 📋 modal shows full character data and tab toggles

### Committing a character change (player)

After mutating `character`, call **`commitCharacter()`** — not `saveCurrentCharacter()` plus a hand-picked set of renderers. It persists (which also republishes presence) and then refreshes the views. There are two render tiers, and the split is the whole reason the ~20 mutation sites each used to pick a different subset:

- `renderDerived()` — the read-only views of `character` (skills, stats, HP, sidebars, potions, files, karma, BM). Nothing in them holds a caret, so it is always safe to run.
- `renderEditors()` — `renderEditorForm()` and the weapons/inventory/skills/specials editors. These write `.value` into form fields, so running one while the user is typing in it resets the caret.

`commitCharacter()` runs the derived tier only. Pass **`commitCharacter({ editors: true })`** when the change did *not* come from typing inside an editor — a button, a GM message, a character switch — i.e. when the form fields themselves need rewriting. `renderAll()` is both tiers, for load and character switch.

`autoSaveChar()` (the 700ms debounce behind the delegated `input` listeners on `#tab-char`/`#tab-inventory`/`#tab-alchemy`) uses the derived tier for exactly this reason; it used to carry an inlined copy of that renderer list with a comment explaining why.

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

### `css/aria-panel.css` — the shared panel stylesheet

Both panel pages load it **before** their own sheet:

```html
<link rel="stylesheet" href="../css/aria-panel.css">
<link rel="stylesheet" href="../css/aria-player.css">   <!-- or aria-gm.css -->
```

That order matters: anything in the shared sheet can still be overridden by the panel that needs to differ. It holds the ~170 rules that were byte-identical in the two panel sheets once notation (`0.2s` vs `.2s`) and token aliases (`--fail` vs `--bad`, `--gm-accent` vs `--gold`) were resolved — the base reset, `body`, tabs, panels, notes, deck pills, the gateway, the selection screen, modals and buttons.

**The shared sheet never names ember or violet.** It refers only to accent handles that each panel defines in its own `:root` (and again under `body.light-mode`), so one rule renders ember on the player and violet on the GM:

| token | player | GM |
|---|---|---|
| `--gold` / `--gold-light` | `var(--ember)` / `var(--ember2)` | `var(--violet)` / `var(--violet2)` |
| `--gold-dim` | `var(--faint)` | `var(--faint)` |
| `--accent-soft` | `var(--embersoft)` | `var(--violetsoft)` |
| `--accent-rgb` | `236,164,86` (light: `169,98,15`) | `169,139,221` (light: `106,71,163`) |

`--accent-rgb` exists so an accent at an arbitrary alpha is still one rule: `rgba(var(--accent-rgb), .12)`. `--accent-soft` is a `var()` reference, so it follows the theme without a light-mode entry of its own.

**About 60 rules genuinely differ and were deliberately left in the panel files** — the deck / card-back gradient (the GM's is a purple-dark gradient, not token-driven), `.topbar`, `.panel`, `.panel-header`, `.tabs`, `.die-btn`, `.fv-close-btn` and others. Those differences are now the *only* reason a selector appears in a panel file, which is what makes them visible as choices rather than drift.

**Changing a rule in `aria-panel.css` changes both panels.** If only one should change, override it in that panel's sheet instead. Before the split the two copies had already drifted — `.card-action-btn` had grown a 1px padding difference and `.clear-btn` differed only in declaration order.

The extraction was verified by diffing computed styles: every element, 33 properties, across the selection screen, every tab, the modals and both themes — 14 states on the player and 12 on the GM, ~500k computed values, zero differences. Re-run that comparison if you ever move rules between these files; source order decides equal-specificity conflicts and only the real cascade can settle them.

---

## Conventions

- **No frameworks** — pure vanilla JS, no npm, no bundler
- **No `type="number"` spinners** — use `type="text" inputmode="numeric"` with `oninput` regex filter
  - Numeric only: `oninput="this.value=this.value.replace(/[^0-9]/g,'')"`
  - Allows minus: `oninput="this.value=this.value.replace(/[^0-9-]/g,'').replace(/(?!^)-/g,'')"`
- **No `display:none` for layout-shifting elements** — use `visibility:hidden/visible`
- **Each app = 3 files** — logic in `.js`, styles in `.css`, structure in `.html`. What both panels share goes in `js/aria-shared.js`, behind an `ARIA` hook if it differs between them — never a second copy.
- **No inline `on*=` attributes in generated markup** — build the element with `el()` and pass a function. (`views/*.html` still has a few static ones; those are fine.)

---

## Known pitfalls

### `.flipped` means "face showing" — in both stylesheets

`.flip-face` carries the `rotateY(180deg)`, so a `.flip-wrap` at rest shows `.card-back-face` and adding `.flipped` animates round to the card. `aria-gm.css` used to put that rotation on `.card-back-face` instead, which inverted the meaning of `.flipped` between the two panels, and every reveal in `aria-gm.js` carried inverted logic to compensate (set `.flipped` with the transition off, then remove it). Both stylesheets now share the convention and `makeDeck`'s single `reveal()` drives both stages. If a card shows its back, fix the stylesheet, not the JS.

### Roll filter pills: Succès and Échec include their criticals

Both panels show the same five pills (`Tous` / `Succès` / `Échec` / `Critique` / `Dés`) over the same `rollFilter` Set, and each used to carry its own predicate. They had drifted: the player's treated a critical success as a success, while the GM's ended in `rollFilter.has(type)` — where `type` is `'crit-success'`, not `'success'` — so lighting **Succès** on the GM feed *hid* every critical success, and **Échec** hid every critical failure. The same buttons meant two different things.

`rollPassesFilter(entry, filter)` in `aria-shared.js` is now the only definition, and it matches what the labels promise: `Succès`/`Échec` include their critical variants, `Critique` catches both, `Dés` matches `threshold === null`, an empty set passes everything, and several lit pills union. The GM composes it with its player-name filter (`playerFilter`); nothing else re-derives it.

### `element.className = ''` strips base CSS classes
Always reset to the base class string, not `''`:
```js
card.className = 'float-roll-card'; // not ''
```

### Removing iframes from the DOM kills WebRTC streams
Never use `parent.innerHTML = ''` on a container that holds camera iframes. The browser immediately terminates the WebRTC connection when an iframe is detached. **Use `reconcile()`** — it keys children by id, so `create` runs once and `update` runs on every later pass over the *same* node. `renderPlayerCards()` (GM) and `renderPresenceRail()` (player) go through it; `renderCamerasTab()` still manages its cells by hand. Pair it with `setFrameSrc()`: re-assigning an iframe's existing `src` reloads it and drops the connection just as surely as detaching it.

`reconcile()` decides a node is dead when `node.parentNode !== container` — **not** `isConnected`. A container that is itself detached (a closed pane) has children that are all `!isConnected`, and treating those as dead appends a duplicate on every pass.

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

### Build DOM with `el()`, never by concatenating strings

**The panels have no `_escHtml` and no `_escJs`.** They were deleted along with the ~70 call sites that needed them. Data is remote-controlled — skill/weapon/character names arrive at the **GM panel** via presence and roll payloads, potion recipes reach **players** via `potion-grant`, track names come from YouTube API responses, and anyone holding the Ably key can publish any of it — so the rule is that data never becomes markup in the first place:

```js
el('button', { className: 'pc-btn', textContent: p.name, onclick: () => spotlight(charId) })
```

`textContent` cannot be XSSed and a function assigned to `onclick` is a reference, so an id never has to survive a trip through the HTML parser and then the JS parser. Four defensive layers disappeared with the string templates: `_escHtml`, `_escJs` (and the rule that its output must be nested inside `_escHtml`), the `CSS.escape` on selectors used to find those nodes again, and the `safeId` scrubbing that made ids selector-safe.

The builders live in `aria-shared.js`:

| helper | use |
|---|---|
| `el(tag, props, ...kids)` | build an element; `props` are assigned directly (`className`, `textContent`, `onclick`, `value`, `disabled`…), `style`/`dataset` take an object; falsy children are skipped, so `cond && el(...)` reads naturally |
| `fill(node, ...kids)` | replace a node's children — the `innerHTML = ...` replacement, without the parse step |
| `reconcile(container, items, create, update)` | keyed in-place update: `create` runs once per key, `update` on every pass, stale keys are removed |
| `keyedNode(container, key)` | the element `reconcile` created for a key |
| `clearKeyed(container)` | drop the children *and* forget the keys |
| `setFrameSrc(frame, src)` | assign an iframe src only if it differs |
| `uid()` | id for a locally created record; falls back off `crypto.randomUUID` outside a secure context. **Never inline the `crypto.randomUUID ? … : …` expression** — it was pasted thirteen times across the two panels, nine of them in `aria-gm.js`, one of which sat below that file's own `_uid()` helper |

`_isIdToken()` and `_finiteNum()` still exist and are still applied to presence data — but as **message validation** (a malformed id is a bad message) rather than as escaping. They are no longer load-bearing for injection.

`aria-overlay.js` still builds strings and has its own `esc()` — every interpolated field there must go through it (on-stream XSS in OBS otherwise). It has not been converted to `el()`.

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
