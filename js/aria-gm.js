// ═══════════════════════════════════════════
//  PANEL WIRING
// ═══════════════════════════════════════════
// Everything the two panels share lives in aria-shared.js, loaded before this file.
// The differences between them are these hooks, not forked copies of the functions.
ARIA.configure({
    role:         'gm',
    tag:          'GM',
    splitKey:     'aria-gm-split-layout',
    defaultPane:  'tab-players',
    joinCode:     () => currentJoinCode || '',
    syncAll:      () => _syncAllGMData(),
    clearLocal:   () => _clearLocalGMData(),
    afterRestore: () => restoreLastCampaign(),
    onMusicPhase: (phase) => { renderMusicTab(); if (phase === 'faded') _startMusicProgress(); },
});

let ablyInstance = null, ablyRolls = null, ablyCards = null, ablyDamage = null, ablyRollsHidden = null;
let pendingGMRoll = null;        // { name, threshold, atk } for GM rolls in progress
let gmRollSafetyTimer = null;    // fallback timer in case RollFinished never fires

// Players, keyed by charId (stable UUID) -> presence data + { online }.
//
// This map is a projection of the `aria-presence` channel's presence set, not a
// replica maintained by hand. Ably decides who is present: a member enters, updates
// or leaves and the whole set is re-read. Three things follow, each of which used to
// be a mechanism here:
//
//  · No heartbeat and no offline sweep. `online` is membership in the set.
//  · No per-character session bookkeeping. One character open in several tabs is
//    several members sharing a clientId (= charId) and differing by connectionId, so
//    closing one tab cannot drop the card — the other member is still in the set.
//  · No teardown-on-unload to interpret. A refresh re-enters under a new connectionId
//    before Ably reaps the old one (15s), so the set never empties and nothing here
//    observes a departure that is about to be undone.
//
// Entries persisted in aria-gm-known-players-{id} are seeded with online:false so the
// Joueurs tab still lists the table while nobody is connected.
const players = new Map();

// Campaign state — loaded after selection
let currentCampaignId = null;
let currentJoinCode = null;
let currentCampaignType = 'ancient';
let monsters = [];
let newMonsterAttacks = [];
let rollFeed = [];
let rollFilter   = new Set();
let playerFilter = new Set();
let cardHistory = [];
let currentVdoRoom = '';
let currentVdoRoomPassword = '';
// GM-side camera, the mirror of the player's. The GM decides the room; this decides
// whether the GM publishes into it — without it the only way to go camera-off was
// clearing the room, which cuts every player's camera too. Cutting it is deliberately
// NOT a session-over signal: vdoRoom stays in the member data, so players go on
// publishing and only the MJ tile disappears.
//
// The Web Lock, the URL builders and the cross-tab kill-switch sync all live in
// makeCamera(); only the preview and topbar work below is GM-specific.
const cam = makeCamera({
    tag: '[GM]',
    sidPrefix: 'aria-gm-',
    lockPrefix: 'aria-gm-push-',
    frameId: 'vdo-gm-push-frame',
    ownerId:  () => currentCampaignId,
    offKey:   () => campKey('camera'),
    room:     () => currentVdoRoom,
    password: () => currentVdoRoomPassword,
    onChange: () => updateGMPushIframe(),
    announce: () => publishGMPresence(),
});
let ablyPresence = null;   // the aria-presence channel — its presence set IS the roster
let gmClickHandlerRegistered = false;
let renderPlayerCardsTimer = null;
let renderMonstersTimer = null;
let gmPotions = [];
let gmFiles = [];
let gmMaps = [];          // [{ id, name, imageUrl, imagePath, sourceUrl, pois, positions }]
let activeMapId = null;   // map shown to the table (local: campaign_maps has no flag for it)
let mapSelectedPoiId = null;   // POI whose floating card is open (GM tab only)
let mapTableView = false;      // preview what the table sees, through the very same filter
// Monster and file grouping (navigation aid). Groups are a campaign-scoped list
// of { id, name }; membership is a flat { entityId: groupId } map. Both live in a
// separate localStorage key (NOT in the synced monsters/campaign_files tables), so
// grouping is durable same-device and simply collapses to "Tous" on a fresh device.
// activeXGroupId is the chip currently filtered in the tab (null = "Tous").
let monsterGroups = [];        // [{ id, name }]
let monsterGroupAssign = {};   // { monsterId: groupId }
let activeMonsterGroupId = null;
let fileGroups = [];
let fileGroupAssign = {};
let activeFileGroupId = null;
let _groupDrag = null;         // { id, type } during a chip drag-assign
// Music is organized into named playlists. gmPlaylists is the source of truth;
// activePlaylistId is the playlist shown/edited in the UI, musicPlayingPlaylistId
// is the playlist the now-playing track belongs to (playback can continue from one
// playlist while the GM browses another). See the MUSIC AUDIO ENGINE section.
let gmPlaylists = [];          // [{ id, name, tracks: [{id,name,type,url,youtubeId,path}] }]
let activePlaylistId = null;   // playlist currently shown/edited in the Musique tab
let musicPlayingPlaylistId = null; // playlist the now-playing track belongs to
let ablyMusic = null;
let ablyMap = null;
const filesGrantedSessions = new Set();

// Every row shape below comes from ENT in aria-supabase.js — see the note there.
// A debounced "sync the whole list" is the same shape for monsters, potions, files
// and music, so it is written once too.
function _debouncedListSync(entity, listFn, positioned = false) {
    let timer = null;
    return () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            if (_supabaseReady() && currentCampaignId) sbPutAll(entity, listFn(), currentCampaignId, positioned);
        }, 800);
    };
}

// Upsert campaign metadata (name, join code, VDO room) to Supabase. Returns true if successful.
async function syncCampaign(camp) {
    if (!_supabaseReady()) return false;
    return await sbPut(ENT.campaign, camp, saveKey);
}

const debouncedSyncMonsters = _debouncedListSync(ENT.monster, () => monsters);

// Insert a new roll entry into the campaign_rolls table.
async function insertRoll(data) {
    if (!_supabaseReady() || !currentCampaignId) return;
    await sbInsert(ENT.roll.table, toRow(ENT.roll, data, currentCampaignId));
}

// Insert a new card draw entry into the campaign_card_history table.
async function insertCardHistory(cardId) {
    if (!_supabaseReady() || !currentCampaignId) return;
    await sbInsert(ENT.cardDraw.table, toRow(ENT.cardDraw, { cardId }, currentCampaignId));
}

const debouncedSyncPotions = _debouncedListSync(ENT.potion, () => gmPotions);

const debouncedSyncFiles = _debouncedListSync(ENT.campaignFile, () => gmFiles);

const debouncedSyncMaps = _debouncedListSync(ENT.map, () => gmMaps, true);

// Upsert a music track record. `position` is the track's index in the flattened
// playlists — campaign_music has no playlist column (see _mergeMusicGrouping).
async function syncMusicTrack(t) {
    if (!_supabaseReady() || !currentCampaignId) return;
    const pos = _allTracks().findIndex(x => x.id === t.id);
    await sbPut(ENT.music, t, currentCampaignId, { position: Math.max(0, pos) });
}
const debouncedSyncMusic = _debouncedListSync(ENT.music, _allTracks, true);

// Delete a music track from the campaign_music table by ID.
async function deleteMusicTrackFromDB(id) {
    if (!_supabaseReady()) return;
    await sbDelete(ENT.music.table, 'id=eq.' + encodeURIComponent(id));
}

// Reconcile flat DB tracks into the existing local playlist grouping for a campaign.
// campaign_music has no playlist column, so playlist grouping lives only in
// localStorage. On load we keep the local grouping but sync membership with the DB:
// drop tracks deleted elsewhere, and append tracks added elsewhere to the first
// playlist. On a fresh device (no local grouping) everything lands in one default
// playlist. `lsKey` is the aria-gm-music-{campaignId} localStorage key.
function _mergeMusicGrouping(lsKey, dbTracks) {
    const playlists = _normalizeMusicData(localStorage.getItem(lsKey));
    const dbIds = new Set(dbTracks.map(t => t.id));
    const localIds = new Set();
    // Keep only tracks that still exist in the DB; collect their ids.
    playlists.forEach(pl => {
        pl.tracks = pl.tracks.filter(t => {
            if (dbIds.has(t.id)) { localIds.add(t.id); return true; }
            return false;
        });
    });
    // Append DB tracks not present in any local playlist (added on another device).
    const orphans = dbTracks.filter(t => !localIds.has(t.id));
    if (orphans.length) playlists[0].tracks.push(...orphans);
    return playlists;
}

// Upsert a GM note to the campaign_notes table. The notes engine owns the list and
// passes the note's position in it.
async function syncGMNote(note, position = 0) {
    if (!_supabaseReady() || !currentCampaignId) return;
    await sbPut(ENT.campaignNote, note, currentCampaignId, { position: Math.max(0, position) });
}

let _gmNoteTimer = null;
// Debounced sync of a single GM note.
function debouncedSyncGMNote(note, position = 0) { clearTimeout(_gmNoteTimer); _gmNoteTimer = setTimeout(() => syncGMNote(note, position), 800); }

// Delete a GM note from Supabase by ID.
async function deleteGMNoteFromDB(id) {
    if (!_supabaseReady()) return;
    await sbDelete(ENT.campaignNote.table, 'id=eq.' + encodeURIComponent(id));
}

// Upsert a known player record for this campaign to Supabase.
async function syncKnownPlayer(charId, data) {
    if (!_supabaseReady() || !currentCampaignId) return;
    const camp = getCampaigns().find(c => c.id === currentCampaignId);
    if (camp) {
        const ok = await syncCampaign(camp);
        if (!ok) return; // campaign FK must exist first; skip to avoid cascade error
    }
    await sbPutKnownPlayer(charId, data, currentCampaignId);
}

// Read a campaign-scoped JSON key, tolerating absent or corrupt values.
function _campJSON(which, cid, fallback) {
    const raw = localStorage.getItem(campKey(which, cid));
    if (!raw) return fallback;
    try { return JSON.parse(raw) ?? fallback; } catch (_) { return fallback; }
}

// Full sync of ALL GM data across every campaign to Supabase. Reads localStorage
// rather than the in-memory state because it covers every campaign, not just the
// open one; the row shapes are the same ENT descriptors the per-entity syncs use.
async function _syncAllGMData() {
    if (!_supabaseReady()) return;
    await sbUpsert('saves', { save_key: saveKey, type: 'gm' });
    const campaigns = getCampaigns();
    await Promise.all(campaigns.map(c => syncCampaign(c)));
    for (const { id: cid } of campaigns) {
        await sbPutAll(ENT.monster,      _campJSON('monsters', cid, []), cid);
        await sbPutAll(ENT.potion,       _campJSON('potions',  cid, []), cid);
        await sbPutAll(ENT.campaignFile, _campJSON('files',    cid, []), cid);
        await sbPutAll(ENT.map, _campJSON('maps', cid, []), cid, true);
        // Music is grouped into playlists locally but stored flat — campaign_music
        // has no playlist column, so position is the index across all playlists.
        await sbPutAll(ENT.music, _normalizeMusicData(localStorage.getItem(campKey('music', cid))).flatMap(p => p.tracks), cid, true);
        const notes = _campJSON('notes', cid, []);
        await sbPutAll(ENT.campaignNote, Array.isArray(notes) ? notes : [], cid, true);
        const kp = _campJSON('knownPlayers', cid, {});
        await Promise.all(Object.values(kp).filter(p => p?.charId).map(p => sbPutKnownPlayer(p.charId, p, cid)));
    }
}

// Load all GM data from Supabase into localStorage for the current save key.
// The child tables are written unconditionally (even when empty): the campaign row
// only exists in the DB after a full sync, so an empty result means "deleted on
// another device" — the old `if (rows.length)` guards let deleted monsters/files/
// potions survive locally and get re-upserted by the next sync (resurrection bug).
// Returns true when the load completed (even with no data), false on error —
// callers must not push local data back up after a failed load.
async function loadFromSupabase() {
    if (!_supabaseReady()) return false;
    await runMigration(saveKey, 'gm');
    try {
        const camps = await sbSelect(ENT.campaign.table, 'save_key=eq.' + encodeURIComponent(saveKey) + '&select=*');
        if (!camps.length) return true;
        const campaigns = camps.map(c => fromRow(ENT.campaign, c));
        localStorage.setItem('aria-gm-campaigns', JSON.stringify(campaigns));
        // Campaigns load concurrently, not one after another: a sequential loop cost
        // one round-trip PER CAMPAIGN before the app was usable. Each iteration writes
        // only its own campaign-scoped keys, so there is nothing to serialize.
        // (This used to be load-bearing for the camera teardown too — startup had to
        // finish inside the players' 12s grace period or a refresh restarted every
        // camera. Presence removed that constraint; the speed is still worth having.)
        await Promise.all(campaigns.map(async c => {
            const scope = 'campaign_id=eq.' + encodeURIComponent(c.id) + '&select=*';
            const byPos = scope + '&order=position.asc';
            const [mons, pots, files, kp, notes, music, maps] = await Promise.all([
                sbSelect(ENT.monster.table, scope),
                sbSelect(ENT.potion.table, scope),
                sbSelect(ENT.campaignFile.table, scope),
                sbSelect(ENT.knownPlayer.table, scope),
                sbSelect(ENT.campaignNote.table, byPos),
                sbSelect(ENT.music.table, byPos),
                sbSelect(ENT.map.table, byPos),
            ]);
            const store = (which, value) => localStorage.setItem(campKey(which, c.id), JSON.stringify(value));
            store('monsters', mons.map(m => fromRow(ENT.monster, m)));
            store('potions',  pots.map(p => fromRow(ENT.potion, p)));
            store('files',    files.map(f => fromRow(ENT.campaignFile, f)));
            store('notes',    notes.map(n => fromRow(ENT.campaignNote, n)));
            const known = {};
            kp.forEach(row => { if (row.char_id) known[row.char_id] = row.data; });
            store('knownPlayers', known);
            store('music', _mergeMusicGrouping(campKey('music', c.id), music.map(t => fromRow(ENT.music, t))));
            store('maps', maps.map(m => fromRow(ENT.map, m)));
        }));
        return true;
    } catch(e) { console.warn('[ARIA] GM load failed:', e); return false; }
}

// Every per-campaign localStorage key, named once — the GM-side twin of CHAR_KEYS.
// campKey(which, id) is the only way to build one and _CAMPAIGN_KEY_PREFIXES, the
// list every deletion path walks, is derived from the same table. deleteCampaign
// used to re-type all ten by hand next to a constant that already listed them, and
// neither copy knew about 'aria-gm-camera-off-', so it leaked on every delete.
const CAMP_KEYS = {
    monsters:      'aria-gm-monsters-',
    rolls:         'aria-gm-rolls-',
    cardHist:      'aria-gm-card-history-',
    potions:       'aria-gm-potions-',
    knownPlayers:  'aria-gm-known-players-',
    files:         'aria-gm-files-',
    notes:         'aria-gm-notes-',
    music:         'aria-gm-music-',
    monsterGroups: 'aria-gm-monster-groups-',
    fileGroups:    'aria-gm-file-groups-',
    maps:          'aria-gm-maps-',
    activeMap:     'aria-gm-active-map-',
    camera:        'aria-gm-camera-off-',
};
const _CAMPAIGN_KEY_PREFIXES = Object.values(CAMP_KEYS);

// Storage key for one campaign's slice of `which`; defaults to the open campaign.
function campKey(which, id = currentCampaignId) { return CAMP_KEYS[which] + id; }

// Remove every scoped key belonging to one campaign.
function _dropCampaignKeys(id) {
    _CAMPAIGN_KEY_PREFIXES.forEach(p => localStorage.removeItem(p + id));
}

// Remove all locally stored campaigns and their scoped keys (used when switching
// to a different save key, so the old key's data never merges into the new one).
function _clearLocalGMData() {
    getCampaigns().forEach(c => _dropCampaignKeys(c.id));
    localStorage.removeItem('aria-gm-campaigns');
}

// ═══════════════════════════════════════════
//  CAMPAIGN MANAGEMENT
// ═══════════════════════════════════════════
// Generate a random 5-character alphanumeric join code for a campaign.
function generateJoinCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

// Return the campaign-scoped localStorage key for monsters.
function monstersKey()      { return campKey('monsters'); }
// Return the campaign-scoped localStorage key for rolls.
function rollsKey()         { return campKey('rolls'); }
// Return the campaign-scoped localStorage key for card history.
function cardHistKey()      { return campKey('cardHist'); }
// Return the campaign-scoped localStorage key for potion recipes.
function potionsKey()       { return campKey('potions'); }
// Return the campaign-scoped localStorage key for known players.
function knownPlayersKey()  { return campKey('knownPlayers'); }
// Return the campaign-scoped localStorage key for files.
function filesKey()         { return campKey('files'); }
// Return the campaign-scoped localStorage key for monster groups.
function monsterGroupsKey() { return campKey('monsterGroups'); }
// Return the campaign-scoped localStorage key for file groups.
function fileGroupsKey()    { return campKey('fileGroups'); }
// Return the campaign-scoped localStorage key for maps.
function mapsKey()      { return campKey('maps'); }
// Return the campaign-scoped localStorage key for the active map id.
function activeMapKey() { return campKey('activeMap'); }

// The map currently shown to the table, or null when the campaign has none.
function _activeMap() { return gmMaps.find(m => m.id === activeMapId) || null; }
// Return the campaign-scoped localStorage key for GM notes.
function gmNotesKey()       { return campKey('notes'); }
// Return the campaign-scoped localStorage key for the music playlist.
function musicKey()         { return campKey('music'); }

// Persist the players Map to localStorage as a plain object.
function saveKnownPlayers() {
    const obj = {};
    players.forEach((p, id) => { obj[id] = p; });
    localStorage.setItem(knownPlayersKey(), JSON.stringify(obj));
}

// Read the campaigns array from localStorage.
function getCampaigns() { return JSON.parse(localStorage.getItem('aria-gm-campaigns') || '[]'); }
// Write campaigns to localStorage and sync each one to Supabase.
function saveCampaigns(campaigns) { localStorage.setItem('aria-gm-campaigns', JSON.stringify(campaigns)); Promise.all(campaigns.map(c => syncCampaign(c))); }

// Migrate old single-campaign localStorage keys to the multi-campaign format.
function migrateGMIfNeeded() {
    if (localStorage.getItem('aria-gm-campaigns')) return;
    const oldMonsters = localStorage.getItem('aria-gm-monsters');
    const oldRolls    = localStorage.getItem('aria-gm-rolls');
    const oldCards    = localStorage.getItem('aria-gm-card-history');
    if (!oldMonsters && !oldRolls && !oldCards) return;
    const id = uid();
    saveCampaigns([{ id, name: 'Campagne 1', joinCode: generateJoinCode() }]);
    if (oldMonsters) localStorage.setItem(campKey('monsters', id), oldMonsters);
    if (oldRolls)    localStorage.setItem(campKey('rolls', id), oldRolls);
    if (oldCards)    localStorage.setItem(campKey('cardHist', id), oldCards);
}

// Load a campaign by ID into module state, initializing all scoped data.
function loadCampaignState(id) {
    const campaigns = getCampaigns();
    const camp = campaigns.find(c => c.id === id);
    if (!camp) { console.warn('[GM] loadCampaignState: campaign not found', id); return false; }
    if (!camp.joinCode) { camp.joinCode = generateJoinCode(); saveCampaigns(campaigns); }
    currentCampaignId = id;
    currentJoinCode = camp.joinCode;
    currentCampaignType = camp.ariaType || 'ancient';
    currentVdoRoom = camp.vdoRoom || '';
    currentVdoRoomPassword = camp.vdoRoomPassword || '';
    // Read after currentCampaignId is set — the kill-switch key is scoped to it. A
    // GM who opted out must not be re-broadcast by the next page load.
    cam.loadOff();
    monsters    = JSON.parse(localStorage.getItem(monstersKey())  || '[]');
    rollFeed    = JSON.parse(localStorage.getItem(rollsKey())     || '[]');
    cardHistory = JSON.parse(localStorage.getItem(cardHistKey()) || '[]');
    gmPotions   = JSON.parse(localStorage.getItem(potionsKey())  || '[]');
    gmFiles     = JSON.parse(localStorage.getItem(filesKey())    || '[]');
    gmMaps      = JSON.parse(localStorage.getItem(mapsKey()) || '[]');
    activeMapId = localStorage.getItem(activeMapKey()) || null;
    // The active map is a local preference (campaign_maps has no flag for it), so a
    // fresh device falls back to the first map rather than showing nothing.
    if (!_activeMap()) activeMapId = gmMaps[0] ? gmMaps[0].id : null;
    loadMonsterGroups();
    loadFileGroups();
    gmPlaylists = _normalizeMusicData(localStorage.getItem(musicKey()));
    activePlaylistId = gmPlaylists[0] ? gmPlaylists[0].id : null;
    musicPlayingPlaylistId = null;
    musicCurrentIndex = -1;
    players.clear();
    const knownRaw = JSON.parse(localStorage.getItem(knownPlayersKey()) || '{}');
    Object.entries(knownRaw).forEach(([, p]) => {
        // Same id check as handlePresence. This snapshot is written from presence
        // data, but entries persisted before that validation existed can hold
        // anything — and they land in the same element ids and inline handlers, so
        // the guard has to cover this path too, not just the live one.
        if (!p.charId || !_isIdToken(p.charId)) return;
        // Seeded offline; whoever is actually connected is marked online by the first
        // applyPresenceSet, which arrives as soon as the channel attaches.
        players.set(p.charId, { ...p, online: false });
    });
    console.log('[GM] loadCampaignState:', camp.name, '| joinCode:', currentJoinCode, '| type:', currentCampaignType, '| vdoRoom:', currentVdoRoom || '(none)', '| monsters:', monsters.length, '| knownPlayers:', players.size, '| playlists:', gmPlaylists.length, '| music tracks:', _allTracks().length, '| files:', gmFiles.length, '| maps:', gmMaps.length);
    return true;
}

// Render the campaign selection grid from localStorage.
function renderCampaignScreen() {
    const campaigns = getCampaigns();
    const grid = document.getElementById('campaign-grid');
    grid.innerHTML = '';
    if (campaigns.length === 0) {
        grid.innerHTML = '<div class="sel-empty">Aucune campagne. Créez-en une pour commencer.</div>';
        return;
    }
    campaigns.forEach(c => {
        const stop = fn => e => { e.stopPropagation(); fn(e); };
        grid.append(el('div', { className: 'sel-card', onclick: () => selectCampaign(c.id) },
            el('button', { className: 'sel-card-delete', title: 'Supprimer', textContent: '×',
                onclick: stop(() => deleteCampaign(c.id)) }),
            el('div', { className: 'sel-card-head' },
                el('span', { className: 'sel-card-diamond' }),
                el('span', { className: 'sel-card-type' + (c.ariaType === 'contemporary' ? ' contemporary' : ''),
                    textContent: c.ariaType === 'contemporary' ? 'Contemporain' : 'Médiéval' })),
            el('div', { className: 'sel-card-name', textContent: c.name }),
            el('div', { className: 'sel-card-joincode', textContent: 'Code · ' + (c.joinCode || '—'),
                onclick: stop(e => copyJoinCodeFromCard(e.currentTarget, c.joinCode || '')) }),
            el('div', { className: 'sel-card-cta', textContent: 'Diriger →' })));
    });
}

// Switch the UI to the campaign selection screen.
function showSelectionScreen() {
    document.getElementById('selection-screen').style.display = 'flex';
    document.getElementById('app-wrapper').style.display = 'none';
    document.getElementById('new-campaign-form').style.display = 'none';
    renderCampaignScreen();
    updateSaveKeyStatus();
}

// Copy a join code to the clipboard from a campaign card element, showing feedback.
function copyJoinCodeFromCard(node, code) {
    if (!code) return;
    navigator.clipboard.writeText(code).catch(() => {});
    const orig = node.textContent;
    node.textContent = '✓ Copié !';
    setTimeout(() => { node.textContent = orig; }, 1500);
}

// Switch the UI to the main GM app view.
function showApp() {
    document.getElementById('selection-screen').style.display = 'none';
    document.getElementById('app-wrapper').style.display = 'flex';
}

// Remembered across reloads so a refresh comes straight back into the campaign.
// This is now a convenience, not a correctness requirement: it used to be the only
// thing that got the GM broadcasting again inside the players' 12s camera grace
// period, so a refresh that paused on the selection screen restarted every player's
// camera. Presence has no such window — the reconnected tab is simply a new member.
// Cleared by an explicit "changer de campagne", which is a deliberate exit.
const LAST_CAMPAIGN_KEY = 'aria-gm-last-campaign';

// Select a campaign, load its state, and initialize the GM app.
function selectCampaign(id) {
    if (!loadCampaignState(id)) return;
    localStorage.setItem(LAST_CAMPAIGN_KEY, id);
    showApp();
    initApp();
}

// Re-enter the campaign this browser was last in, if it still exists.
function restoreLastCampaign() {
    const id = localStorage.getItem(LAST_CAMPAIGN_KEY);
    if (!id) return false;
    if (!getCampaigns().some(c => c.id === id)) { localStorage.removeItem(LAST_CAMPAIGN_KEY); return false; }
    console.log('[GM] restoring last campaign:', id);
    selectCampaign(id);
    return true;
}

// Delete a campaign and all its scoped localStorage data and Supabase rows.
function deleteCampaign(id) {
    if (!confirm('Supprimer cette campagne ? Tous les monstres et données seront perdus.')) return;
    if (localStorage.getItem(LAST_CAMPAIGN_KEY) === id) localStorage.removeItem(LAST_CAMPAIGN_KEY);
    // Delete uploaded objects from Supabase Storage first (the DB rows hold the
    // only record of their paths — removing rows first would orphan the files).
    try {
        const files = JSON.parse(localStorage.getItem(campKey('files', id)) || '[]');
        files.forEach(f => { if (f.path) deleteFileFromStorage(f.path); });
        const tracks = _normalizeMusicData(localStorage.getItem(campKey('music', id))).flatMap(p => p.tracks);
        tracks.forEach(t => { if (t.type === 'file' && t.path) deleteMusicFileFromStorage(t.path); });
    } catch(_) {}
    // The child tables come from ENT, so adding a campaign-scoped entity cannot
    // leave rows behind here. This used to be nine hand-written sbDelete calls.
    sbDeleteCascade(ENT.campaign, 'campaign_id', id);
    const campaigns = getCampaigns().filter(c => c.id !== id);
    saveCampaigns(campaigns);
    _dropCampaignKeys(id);
    renderCampaignScreen();
}

// Show the new campaign creation form.
function createCampaign() {
    document.getElementById('new-campaign-form').style.display = 'flex';
    document.getElementById('new-campaign-name').value = '';
    document.getElementById('new-campaign-name').focus();
}

// Create a new campaign from the form and immediately select it.
function confirmCreateCampaign() {
    const name = document.getElementById('new-campaign-name').value.trim() || 'Nouvelle campagne';
    const ariaType = document.querySelector('input[name="new-campaign-type"]:checked')?.value || 'ancient';
    const id = uid();
    const campaigns = getCampaigns();
    campaigns.push({ id, name, joinCode: generateJoinCode(), ariaType });
    saveCampaigns(campaigns);
    document.getElementById('new-campaign-form').style.display = 'none';
    selectCampaign(id);
}

// Hide the new campaign creation form without creating.
function cancelCreateCampaign() {
    document.getElementById('new-campaign-form').style.display = 'none';
}

// Save an inline campaign name edit from a text input element.
function saveCampaignName(input) {
    const name = input.value.trim();
    const campaigns = getCampaigns();
    const camp = campaigns.find(c => c.id === currentCampaignId);
    if (!camp) return;
    if (!name) { input.value = camp.name; return; }
    camp.name = name;
    saveCampaigns(campaigns);
}

// Tear down the current campaign session (Ably, music, VDO) and return to selection.
function switchCampaign() {
    if (currentCampaignId) {
        saveMonsters();
        saveGMPotions();
        localStorage.setItem(rollsKey(), JSON.stringify(rollFeed));
        localStorage.setItem(cardHistKey(), JSON.stringify(cardHistory));
    }
    gmPotions = [];
    gmFiles = [];
    monsterGroups = [];
    monsterGroupAssign = {};
    activeMonsterGroupId = null;
    fileGroups = [];
    fileGroupAssign = {};
    activeFileGroupId = null;
    _groupDrag = null;
    musicStop();
    gmPlaylists = [];
    activePlaylistId = null;
    musicPlayingPlaylistId = null;
    musicCurrentIndex = -1;
    ablyMusic = null;
    filesGrantedSessions.clear();
    currentVdoRoom = '';
    currentVdoRoomPassword = '';
    cam.releaseLock();     // while currentCampaignId still resolves the lock name
    stopGMSelfView();
    if (renderPlayerCardsTimer) { clearTimeout(renderPlayerCardsTimer); renderPlayerCardsTimer = null; }
    if (renderMonstersTimer) { clearTimeout(renderMonstersTimer); renderMonstersTimer = null; }
    if (dddiceSDK) { try { dddiceSDK.disconnect?.(); } catch(_){} dddiceSDK = null; }
    clearTimeout(gmRollSafetyTimer);
    pendingGMRoll = null;
    // Closing the connection leaves the presence set, which is how players learn the
    // session is over — no message to publish first, and nothing to await before
    // closing (a fire-and-forget publish followed by close() would have been dropped).
    if (ablyInstance) { try { ablyInstance.close(); } catch(_){} }
    ablyInstance = null;
    ablyRolls = null; ablyRollsHidden = null; ablyCards = null; ablyDamage = null; ablyMusic = null; ablyMap = null;
    ablyPresence = null; gmPresenceEntered = false;
    players.clear();
    // Emptying the Map is not enough — nothing re-renders the grid on this path
    // (renderTabLayout doesn't touch player cards), so #players-grid kept live
    // viewer iframes on the previous campaign's players for as long as the user
    // stayed on the selection screen. With the Map empty this render clears the grid.
    renderPlayerCards();
    rollFilter.clear(); playerFilter.clear();
    localStorage.removeItem(LAST_CAMPAIGN_KEY);   // deliberate exit — don't auto-re-enter
    currentCampaignId = null;
    currentCampaignType = 'ancient';
    gmSpotlightCharId = null;
    resetSplitState();
    renderTabLayout();
    showSelectionScreen();
}

// ═══════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
    migrateGMIfNeeded();
    await tryRestoreSupabase();
});

// No `beforeunload` teardown, deliberately — see the note in aria-player.js. Saying
// "session over" on unload could not tell a close from a refresh, so players needed a
// grace period to ignore it and the GM needed auto-re-entry to satisfy that grace
// period. Ably reaps the dropped connection 15s later; a refresh has re-entered under
// a new connectionId well before that, so the set never empties and no player reacts.
// The Web Lock is released by the browser on unload, crash included.

// Initialize the full GM app after a campaign is selected.
function initApp() {
    console.log('[GM] initApp: campaign:', currentCampaignId, '| joinCode:', currentJoinCode, '| ablyKey:', config.ablyKey ? 'set' : 'MISSING', '| dddice:', config.dddiceKey ? 'set' : 'none');
    renderPlayerCards();
    renderMonsters();
    renderMapTab();
    renderRollFeed();
    renderCardHistory();
    renderGMPotions();
    renderGmFiles();
    renderMusicTab();
    gmNotes.load();
    initGmDeck();
    renderTabLayout(); // apply the restored multi-pane layout
    loadConfigInputs();
    if (config.dddiceKey && config.dddiceRoom) initDddice();
    if (config.ablyKey) initAbly();   // enters presence with the room + spotlight
    cam.acquireLock();
    updateGMPushIframe();   // drives the topbar button, the push frame and the preview
    applyReadTable();
    if (!gmClickHandlerRegistered) {
        document.addEventListener('click', e => { if (!e.target.closest('.gm-select')) closeAllSelects(); });
        gmClickHandlerRegistered = true;
    }
    const campaigns = getCampaigns();
    const camp = campaigns.find(c => c.id === currentCampaignId);
    const node = document.getElementById('campaign-display');
    if (node && camp) node.value = camp.name;
    const jel = document.getElementById('joincode-display');
    if (jel) jel.textContent = currentJoinCode || '';
    const tbJoin = document.getElementById('tb-joincode');
    if (tbJoin) {
        tbJoin.textContent = currentJoinCode || '—';
        tbJoin.style.display = currentJoinCode ? '' : 'none';
    }
    updateOverlayEditorBtn();
}

// Configure the overlay editor button href for this campaign.
function updateOverlayEditorBtn() {
    const btn = document.getElementById('btn-open-overlay-editor');
    if (!btn || !currentCampaignId) return;
    btn.style.display = '';
    btn.onclick = () => window.open('../views/aria-overlay-editor.html?type=gm&id=' + currentCampaignId, '_blank');
}

// Broadcast the current monster HP list to the overlay via Ably.
function publishMonsterStateToOverlay() {
    if (!currentCampaignId) return;
    const overlayId = 'gm_' + currentCampaignId;
    const monsters  = JSON.parse(localStorage.getItem(monstersKey()) || '[]');
    if (typeof ablyDamage !== 'undefined' && ablyDamage) {
        ablyDamage.publish('monster-state', { overlayId, monsters });
    }
}

// Copy the current campaign join code to the clipboard.
function copyJoinCode() {
    if (!currentJoinCode) return;
    navigator.clipboard.writeText(currentJoinCode).catch(() => {});
    const node = document.getElementById('joincode-display');
    if (node) { const t = node.textContent; node.textContent = '✓ Copié !'; setTimeout(() => { node.textContent = t; }, 1500); }
    const tbEl = document.getElementById('tb-joincode');
    if (tbEl) { const t = tbEl.textContent; tbEl.textContent = '✓ Copié'; setTimeout(() => { tbEl.textContent = t; }, 1500); }
}

// ═══════════════════════════════════════════
//  CUSTOM SELECT
// ═══════════════════════════════════════════
// Close all open custom select dropdown panels.
function closeAllSelects() {
    document.querySelectorAll('.gm-select-panel.open').forEach(p => p.classList.remove('open'));
}
// Toggle a custom select dropdown open, closing any others first.
function toggleSelect(trigger) {
    const panel = trigger.closest('.gm-select').querySelector('.gm-select-panel');
    const isOpen = panel.classList.contains('open');
    closeAllSelects();
    if (!isOpen) panel.classList.add('open');
}
// Read the selected value from a custom select element by ID.
function getSelectValue(id) { return document.getElementById(id)?.dataset.value ?? ''; }
// Set the displayed value and label of a custom select element.
function setSelectValue(id, value, label) {
    const node = document.getElementById(id);
    if (!node) return;
    node.dataset.value = value;
    const lbl = node.querySelector('.gm-select-label');
    if (lbl) lbl.textContent = label;
    closeAllSelects();
}
// Add an option div to a custom select panel with a click handler.
function addSelectOpt(panel, value, label, onClick) {
    const opt = document.createElement('div');
    opt.className = 'gm-select-opt';
    opt.textContent = label;
    opt.addEventListener('click', e => { e.stopPropagation(); onClick(); });
    panel.appendChild(opt);
}

// Apply the shared layout pass, then the GM-specific pane work.
function renderTabLayout() {
    applyTabLayout();
    if (openPanes.includes('tab-gm-roll')) refreshMonsterSelect();
    // Both of these hold camera iframes, which survive .tab-content{display:none} with
    // their WebRTC connections intact. Each function drops its iframes when the
    // Joueurs pane is closed and rebuilds them when it opens, so this is the one place
    // that has to run on every layout change.
    renderPlayerCards();
    updateGMPushIframe();
    finishTabLayout();
}

function copyOverlayUrl() {
    const base = window.location.href.replace(/aria-gm\.html.*$/, 'aria-overlay.html');
    const params = new URLSearchParams({ mode: 'gm', ably: config.ablyKey || '' });
    if (config.dddiceKey)  params.set('dddice_key', config.dddiceKey);
    if (config.dddiceRoom) params.set('dddice_room', extractRoomSlug(config.dddiceRoom));
    if (currentCampaignId) params.set('overlay', 'gm_' + currentCampaignId);  // scopes layout + monster widget to this campaign
    if (currentJoinCode)   params.set('campaign', currentJoinCode);            // scopes the rolls/cards/damage channels to this campaign
    const url = `${base}?${params}`;
    navigator.clipboard.writeText(url).then(() => {
        const btn = document.querySelector('.config-modal button[onclick="copyOverlayUrl()"]');
        if (!btn) return;
        const orig = btn.textContent;
        btn.textContent = '✓ Copié !';
        setTimeout(() => btn.textContent = orig, 2000);
    });
}
// Initialize the dddice SDK for GM rolls: fetch themes, create renderer, connect to room.
// Connect to dddice and resolve finished rolls against the GM's pending roll. The
// connection itself is initDddiceSDK() in aria-shared.js.
//
// RollFinished fires for incoming player rolls as well as the GM's own, so the
// canvas is always cleared but only a pending GM roll is consumed.
function initDddice() {
    return initDddiceSDK(roll => {
        setTimeout(() => dddiceSDK?.clear(), 1500);
        if (!pendingGMRoll) return;
        // Another participant's dice landing mid-animation must not be taken as the
        // GM's result (only enforced when both UUIDs are known).
        const finishedUuid = _ddRollUuid(roll);
        if (pendingGMRoll.uuid && finishedUuid && finishedUuid !== pendingGMRoll.uuid) return;
        clearTimeout(gmRollSafetyTimer);
        const { name, threshold, atk } = pendingGMRoll;
        pendingGMRoll = null;
        const total = (roll.total_value ?? 0) === 0 ? 100 : (roll.total_value ?? 0);
        const success = total <= threshold;
        const dmgResult = (success && atk?.dmg?.trim()) ? rollDiceFormula(atk.dmg) : null;
        showGMRollResult(name, threshold, total, success, dmgResult);
    });
}

// Initialize Ably channels and subscribe to all game events (rolls, cards, presence).
function initAbly() {
    console.log('[GM] initAbly: connecting with key', config.ablyKey?.slice(0, 8) + '...', '| campaign channel suffix:', currentJoinCode || '(global)');
    try {
        // clientId identifies the GM in the presence set. Two GM tabs on one campaign
        // share it and are told apart by the connectionId Ably assigns each connection.
        ablyInstance = new Ably.Realtime({ key: config.ablyKey, clientId: 'gm-' + currentCampaignId, transports: ['web_socket'] });
        ablyRolls = ablyInstance.channels.get(campaignChannel('aria-rolls'));
        ablyRollsHidden = ablyInstance.channels.get(campaignChannel('aria-rolls-hidden'));
        ablyCards = ablyInstance.channels.get(campaignChannel('aria-cards'));
        ablyDamage = ablyInstance.channels.get(campaignChannel('aria-damage'));
        ablyMusic = ablyInstance.channels.get(campaignChannel('aria-music'));
        ablyMap = ablyInstance.channels.get(campaignChannel('aria-map'));
        // A late joiner — a player connecting an hour in, or an OBS browser source
        // restarted mid-session — asks, and gets the whole state back.
        ablyMap.subscribe('request', () => publishMapState());
        ablyInstance.connection.on('connected', () => { console.log('[GM] Ably connected'); setAblyStatus(true); });
        ablyInstance.connection.on('failed',    () => { console.error('[GM] Ably connection FAILED'); setAblyStatus(false); });
        ablyInstance.connection.on('disconnected', () => console.warn('[GM] Ably disconnected'));
        ablyInstance.connection.on('suspended',    () => console.warn('[GM] Ably suspended'));
        ablyRolls.subscribe('roll', msg => { console.log('[GM] received roll from', msg.data?.char, '| skill:', msg.data?.skillName, '| roll:', msg.data?.roll, '| threshold:', msg.data?.threshold, '| success:', msg.data?.success); handleIncomingRoll(msg.data); });
        ablyRollsHidden.subscribe('roll', msg => { console.log('[GM] received HIDDEN roll from', msg.data?.char, '| skill:', msg.data?.skillName, '| roll:', msg.data?.roll); handleIncomingRoll(msg.data); });
        ablyCards.subscribe('draw',     msg => { console.log('[GM] received card draw:', msg.data?.cardId, 'by player'); handlePlayerCard(msg.data); });
        ablyCards.subscribe('reshuffle', () => { console.log('[GM] received card reshuffle'); handlePlayerReshuffle(); });
        // The roster. Any change to the set is re-read in full rather than patched,
        // so the Joueurs tab cannot drift from who is actually connected.
        ablyPresence = ablyInstance.channels.get(campaignChannel('aria-presence'));
        ablyPresence.presence.subscribe(() => refreshPresenceSet());
        publishGMPresence();
        publishMapState();
        console.log('[GM] initAbly: subscribed to all channels');
    } catch (e) { console.error('[GM] initAbly error:', e); setAblyStatus(false); }
}
// Update the Ably status dot and text labels in the topbar and config modal.
function setAblyStatus(ok) {
    ['ably-dot', 'cfg-ably-dot'].forEach(id => { const node = document.getElementById(id); if (node) node.className = 'status-dot ' + (ok ? 'connected' : 'error'); });
    ['ably-status', 'cfg-ably-status'].forEach(id => { const node = document.getElementById(id); if (node) node.textContent = ok ? 'Ably connecté' : 'Ably erreur'; });
}
// ── Presence: publish ─────────────────────────────────────────────────────────
// What the GM tells the table: the VDO room, the MJ stream, and the spotlight.
// Published as presence member data, so it is part of the roster rather than a
// broadcast that has to be repeated on a timer for late joiners — `presence.get()`
// hands a player who connects an hour from now exactly the same thing.
//
// There is no "session over" message to publish, and so none to be misread as one:
// leaving the presence set IS the signal, and Ably emits it when the connection
// goes. That also removes the second-GM-tab hazard the old flag guarded against —
// a tab that has entered cannot make the set look empty while its sibling is in it.
let gmPresenceEntered = false;
function gmPresenceData() {
    return {
        role: 'gm',
        streamId: cam.advertisedId(),
        vdoRoom: currentVdoRoom,
        vdoRoomPassword: currentVdoRoomPassword,
        spotlightCharId: gmSpotlightCharId,
        ts: Date.now(),
    };
}
// Announce, or republish after a change to the room / kill switch / spotlight.
function publishGMPresence() {
    if (!ablyPresence) return;
    const d = gmPresenceData();
    if (gmPresenceEntered) {
        ablyPresence.presence.update(d).catch(err => console.error('[GM] presence update:', err));
    } else {
        ablyPresence.presence.enter(d).then(
            () => { gmPresenceEntered = true; console.log('[GM] entered presence | room:', currentVdoRoom || '(none)', '| streamId:', d.streamId || '(none)'); },
            err => console.error('[GM] presence enter:', err));
    }
}

function applyPresenceSet(members) {
    // Collapse members to participants: several tabs of one character share a
    // clientId and differ by connectionId, as does the ghost of a tab that refreshed
    // until Ably reaps it. Newest ts wins, which is always a live tab.
    const byId = new Map();
    (members || []).forEach(m => {
        const d = m.data || {};
        if (!m.clientId || d.role !== 'player') return;
        const prev = byId.get(m.clientId);
        if (!prev || (d.ts || 0) >= (prev.ts || 0)) byId.set(m.clientId, d);
    });
    // Everyone currently in the set is online; everyone we knew who is not, is not.
    // No sweep, no PRESENCE_TIMEOUT, no last-seen arithmetic. Entries are marked
    // offline rather than deleted: `players` doubles as the known-players snapshot
    // that lists the table when nobody is connected.
    players.forEach(p => { p.online = false; });
    byId.forEach((data, charId) => { handlePresence(charId, data); });
    // Bootstrap sessions that have just appeared, and forget the ones that went, so a
    // player who reconnects is bootstrapped again. Keyed by connectionId — the real
    // per-tab identity, which (unlike the old sessionStorage id) cannot survive a
    // reload and leave a refreshed tab looking already-served.
    const liveConns = new Set((members || []).map(m => m.connectionId).filter(Boolean));
    [...filesGrantedSessions].forEach(c => { if (!liveConns.has(c)) filesGrantedSessions.delete(c); });
    let anyNewSession = false;
    (members || []).forEach(m => {
        const d = m.data || {};
        if (!m.connectionId || d.role !== 'player') return;
        // `online` is the proof handlePresence ACCEPTED this member — `players` can
        // also hold offline entries restored from the known-players snapshot, and
        // bootstrapping off those would send this campaign's files to a member whose
        // campaignKey or ariaType we just rejected.
        const p = players.get(m.clientId);
        if (!p || p.online !== true) return;
        if (filesGrantedSessions.has(m.connectionId)) return;
        filesGrantedSessions.add(m.connectionId);
        sendFileGrantsToPlayer(p);
        anyNewSession = true;
    });
    // Once per apply, not once per new member: publishMusicPlay is a broadcast to the
    // whole table, so a loop would re-send it to everyone for each arrival.
    if (anyNewSession && musicIsPlaying && _currentTrack()) publishMusicPlay(_currentTrack());
    // Drop the spotlight when the player carrying it leaves the set — it is otherwise
    // only cleared by clicking ☀ again, so it stayed armed on a departed player,
    // invisible (the card carrying the ☀ state is gone) and silently re-applied if
    // they came back. Ably has already waited out a reconnect before reporting the
    // departure, so this no longer fires on a refresh or a closed second tab.
    if (gmSpotlightCharId && !byId.has(gmSpotlightCharId)) {
        console.log('[GM] spotlighted player left — clearing spotlight');
        gmSpotlightCharId = null;
        publishGMPresence();
    }
    saveKnownPlayers();
    // Who the table thinks is publishing. A player with no streamId here is either
    // camera-off, on file://, or has not received our room yet — the GM card for them
    // will show the hatched placeholder, not a black rectangle.
    console.log('[GM] presence applied |', members?.length ?? 0, 'members →', byId.size, 'players |',
        'room:', currentVdoRoom || '(NONE — nobody can publish; set it in ⚙)',
        '| online publishers:', [...players].filter(([, p]) => p.online && p.streamId).map(([id, p]) => `${p.name}=${p.streamId}`).join(', ') || '(none)',
        '| online without a stream:', [...players].filter(([, p]) => p.online && !p.streamId).map(([, p]) => p.name).join(', ') || '(none)');
    clearTimeout(renderPlayerCardsTimer);
    renderPlayerCardsTimer = setTimeout(renderPlayerCards, 150);
    // state.players carries display names from presence — republish so a player who
    // connects after the map was last saved still gets their name on the token.
    publishMapState();
}

// One command that prints the whole GM-side camera path: our own publishing state,
// the room we are advertising, and every player card's camera decision with its URL.
// Type ariaCamDiag() in the console.
window.ariaCamDiag = function () {
    console.log('[GM] ── camera diagnostic ─────────────────────────────');
    console.log('[GM] me:', cam.diag());
    console.log('[GM] session: room=', currentVdoRoom || '(NONE)', '| password=', currentVdoRoomPassword ? '(set)' : '(none)',
        '| joinCode=', currentJoinCode || '(none)', '| ably=', ablyPresence ? 'connected' : 'NOT CONNECTED',
        '| spotlight=', gmSpotlightCharId || '(none)', '| Joueurs pane open=', openPanes.includes('tab-players'));
    console.log('[GM] player cards:', [...players].map(([id, p]) => {
        const s = _playerCardState(p, id);
        return { name: p.name, online: s.online, streamId: p.streamId || '(none)',
                 tile: s.camSrc ? s.camSrc.replace(/([?&]password=)[^&]*/, '$1***')
                     : !p.streamId ? '(placeholder — player advertises no stream)'
                     : !s.online ? '(placeholder — player offline)' : '(placeholder — no room set)' };
    }));
    cam.pushStats();
    return 'see console — cam.pushStats() reply arrives in a moment';
};
// ═══════════════════════════════════════════
//  PRESENCE — "Lire la table" + Spotlight (design frame 26)
// ═══════════════════════════════════════════
let readTable = localStorage.getItem('aria-gm-read-table') === '1';
let gmSpotlightCharId = null;

// Toggle bigger player faces on the Joueurs cards (frame 26: "lire la table").
function toggleReadTable() {
    readTable = !readTable;
    localStorage.setItem('aria-gm-read-table', readTable ? '1' : '0');
    applyReadTable();
}
function applyReadTable() {
    document.getElementById('players-grid')?.classList.toggle('read-table', readTable);
    document.getElementById('tb-read-table')?.classList.toggle('on', readTable);
}
// Spotlight a player: their camera goes big on every player's Tablée/Bandeau view.
// Clicking the same player again clears the spotlight.
function toggleSpotlight(charId) {
    gmSpotlightCharId = gmSpotlightCharId === charId ? null : charId;
    publishGMPresence();   // the spotlight lives in our presence data
    renderPlayerCards();
}

// The GM's camera UI: the topbar kill switch, the hidden push frame (both owned by
// cam), and the "Votre caméra" preview in the Joueurs tab, which is ours.
//
// The push frame is deliberately NOT the preview: it used to be the visible iframe
// inside #tab-players, and .tab-content goes display:none on every tab switch, which
// can block camera capture. The preview is a muted viewer of our own stream instead.
function updateGMPushIframe() {
    cam.renderToggle('tb-cam-toggle');
    cam.syncPushFrame();
    const wrap = document.getElementById('gm-self-view-wrap');
    const section = document.getElementById('gm-self-view-section');
    if (!wrap || !section) return;
    // Only worth showing while some tab is publishing — the same rule as the
    // advertised ID, and cam.live() is that rule. Safe to hide with the tab, but not
    // safe to *leave loaded* behind a display:none pane, which keeps its WebRTC
    // connection up. Dropped with the pane; renderTabLayout() rebuilds it on reopen.
    if (!cam.live() || !openPanes.includes('tab-players')) {
        console.log('[GM] "Votre caméra" preview hidden —',
            !cam.live() ? (cam.off ? 'camera cut locally' : !currentVdoRoom ? 'no vdoRoom set' : 'not live') : 'Joueurs pane is closed');
        if (wrap.innerHTML) wrap.innerHTML = '';
        section.style.display = 'none';   // nothing published ⇒ no empty preview box
        return;
    }
    const viewSrc = cam.viewSrc(cam.streamId(), true);
    let iframe = wrap.querySelector('iframe');
    if (!iframe) {
        iframe = el('iframe', { allow: 'autoplay; fullscreen',   // viewer-only
            style: { width: '100%', height: '100%', border: 'none', display: 'block' } });
        wrap.appendChild(iframe);
    }
    setFrameSrc(iframe, viewSrc);
    section.style.display = '';
}
// Tear down the GM camera: stops publishing and drops the preview. There is
// deliberately no native getUserMedia path anywhere — without a room nothing is
// streamed, so grabbing the webcam would light the camera LED for nothing.
function stopGMSelfView() {
    cam.blankPushFrame();
    const section = document.getElementById('gm-self-view-section');
    if (section) section.style.display = 'none';
    const wrap = document.getElementById('gm-self-view-wrap');
    if (wrap) wrap.innerHTML = '';
}

// Publish a damage event to a specific player via the aria-damage channel.
function publishDamage(targetId, damage, hpBefore, hpAfter, maxHP, charName) {
    if (!ablyDamage) { console.warn('[GM] publishDamage: ablyDamage not ready'); return; }
    console.log('[GM] publishDamage → ', charName, '| dmg:', damage, '| HP:', hpBefore, '→', hpAfter, '/', maxHP);
    ablyDamage.publish('damage', { targetId, damage, hpBefore, hpAfter, maxHP, charName, source: 'gm' });
}
// Publish a heal event to a specific player via the aria-damage channel.
function publishHeal(targetId, amount, hpBefore, hpAfter, maxHP, charName) {
    if (!ablyDamage) { console.warn('[GM] publishHeal: ablyDamage not ready'); return; }
    console.log('[GM] publishHeal → ', charName, '| heal:', amount, '| HP:', hpBefore, '→', hpAfter, '/', maxHP);
    ablyDamage.publish('heal', { targetId, amount, hpBefore, hpAfter, maxHP, charName, source: 'gm' });
}

// Publish a music play command with fade duration to all players via Ably.
function publishMusicPlay(track) {
    if (!ablyMusic) { console.warn('[GM] publishMusicPlay: ablyMusic not ready'); return; }
    console.log('[GM] publishMusicPlay:', track?.name, '| type:', track?.type, '| fade:', musicFadeDuration, 's');
    ablyMusic.publish('music', { type: 'play', track, fadeDuration: musicFadeDuration });
}
// Publish a music stop command to all players via Ably.
function publishMusicStop() {
    if (!ablyMusic) return;
    console.log('[GM] publishMusicStop');
    ablyMusic.publish('music', { type: 'stop' });
}
// Publish a music pause command to all players via Ably.
function publishMusicPause() {
    if (!ablyMusic) return;
    console.log('[GM] publishMusicPause');
    ablyMusic.publish('music', { type: 'pause' });
}
// Publish a music resume command to all players via Ably.
function publishMusicResume() {
    if (!ablyMusic) return;
    console.log('[GM] publishMusicResume');
    ablyMusic.publish('music', { type: 'resume' });
}

// ═══════════════════════════════════════════
//  PLAYER PRESENCE
// ═══════════════════════════════════════════
// Project one presence member onto the players Map. The set decides who is here;
// this only validates and shapes what they published about themselves.
function handlePresence(charId, data) {
    if (!charId || !_isIdToken(charId)) { console.warn('[GM] handlePresence: malformed charId', charId); return; }
    if (currentJoinCode && (data.campaignKey || '') !== currentJoinCode) { console.log('[GM] handlePresence: IGNORED (campaignKey mismatch:', data.campaignKey, 'vs', currentJoinCode, ') from', data.name); return; }
    if (currentCampaignType && (data.ariaType || 'ancient') !== currentCampaignType) { console.log('[GM] handlePresence: IGNORED (ariaType mismatch:', data.ariaType, 'vs', currentCampaignType, ') from', data.name); return; }
    // Presence data is still remote-controlled — anyone holding the Ably key can enter
    // the set — so the coercion that keeps crafted values out of innerHTML stays.
    const playerData = {
        ...data,
        charId,
        hp:    _finiteNum(data.hp),
        maxHP: _finiteNum(data.maxHP),
        vials: _finiteNum(data.vials) ?? 0,
        ts: Date.now(), online: true,
    };
    // Seed the karma map from the player's stored value on first sight (a GM page
    // reload wipes the in-memory map; without this, the next ± click would send
    // karma-set with ±1 and clobber the player's real karma). After seeding, the
    // GM's local value stays authoritative — the GM is the only karma writer.
    if (!(charId in gmKarma)) gmKarma[charId] = _finiteNum(data.karma) ?? 0;
    players.set(charId, playerData);
    syncKnownPlayer(charId, playerData);
}
// Render/update all player cards with in-place DOM updates to preserve camera iframes.
// Cosmetic combat-feedback FX on a player/monster card (flash + shake + number pop).
// HP numbers are updated synchronously by the render; this only adds the transient
// visual layer, then removes it so a re-render can't leave it stuck.
function triggerCardFx(node, type) {
    if (!node) return;
    node.classList.remove('fx-dmg', 'fx-crit', 'fx-heal');
    void node.offsetWidth; // restart the animation
    node.classList.add('fx-' + type);
    setTimeout(() => node.classList.remove('fx-' + type), 650);
}
// Card lookups go through the reconciler's key map rather than a CSS selector, so
// an id containing a quote is a miss instead of a thrown exception.
function playerCardEl(id) { return keyedNode(document.getElementById('players-grid'), id); }
function monsterCardEl(id) { return keyedNode(document.getElementById('monsters-grid'), String(id)); }

// Derived display state for one player card, from the presence entry.
// Coerced here because a known-players snapshot persisted before the presence
// validation existed can still hold arbitrary values.
function _playerCardState(p, charId) {
    const online = p.online !== false;
    const hp = _finiteNum(p.hp) ?? _finiteNum(p.maxHP) ?? '?';
    const maxHP = _finiteNum(p.maxHP) ?? '?';
    const pct = maxHP > 0 ? hp / maxHP : 0;
    const dead = typeof hp === 'number' && hp <= 0;
    return {
        online, hp, maxHP, pct,
        hpColor: pct > 0.5 ? 'var(--ok)' : pct > 0.25 ? 'var(--warn)' : 'var(--bad)',
        hpClass: pct <= 0.25 ? 'critical' : pct <= 0.5 ? 'low' : '',
        stateCls: dead ? ' is-dead' : (!dead && pct >= 0 && pct <= 0.25 ? ' hp-critical' : ''),
        stats: p.stats || {},
        karma: gmKarma[charId] ?? 0,
        // A viewer URL without &room cannot decrypt a stream pushed into a
        // password-protected room, and the known-players snapshot keeps the last
        // streamId of players who have gone — so both gates, or the card shows a
        // guaranteed-black rectangle.
        camSrc: (p.streamId && online && currentVdoRoom) ? cam.viewSrc(p.streamId, false) : '',
    };
}

// Render/update all player cards.
//
// One description of the card, not two. The previous version built it as a template
// string on first sight and then maintained a second, parallel branch that reached
// back in with querySelector to update each field — because innerHTML on the
// container would have detached the camera iframes and killed their WebRTC
// connections. reconcile() keeps the node identity instead, so `create` runs once and
// `update` runs every pass over the same element, and the iframe is only ever
// re-src'd when its URL actually changes.
function renderPlayerCards() {
    const grid = document.getElementById('players-grid');
    const noP = document.getElementById('no-players');
    if (!grid || !noP) return;
    // Joueurs pane closed. .tab-content{display:none} hides the camera iframes but
    // leaves their WebRTC connections up, so every player's stream would keep being
    // decoded for a tab nobody is looking at. Drop them; renderTabLayout() rebuilds
    // the grid on reopen. (The player app does the same in renderPresenceUI.)
    if (!openPanes.includes('tab-players') || players.size === 0) {
        noP.style.display = players.size === 0 ? '' : 'none';
        clearKeyed(grid);
        return;
    }
    noP.style.display = 'none';
    const focusedId = document.activeElement?.id;

    reconcile(grid, players, (charId, p) => {
        const numeric = { type: 'text', inputMode: 'numeric', oninput: e => { e.target.value = e.target.value.replace(/[^0-9]/g, ''); } };
        const dmgInput = el('input', { ...numeric, className: 'pc-dmg-input', id: `dmg-${charId}`, placeholder: 'Dégâts',
            onkeydown: e => { if (e.key === 'Enter') applyPlayerDamage(charId); } });
        const healInput = el('input', { ...numeric, className: 'pc-heal-input', id: `heal-${charId}`, placeholder: 'Soins',
            onkeydown: e => { if (e.key === 'Enter') applyPlayerHeal(charId); } });

        const refs = {
            dot:   el('div', { className: 'pc-online-dot' }),
            name:  el('div', { className: 'pc-name' }),
            cls:   el('div', { className: 'pc-class' }),
            spot:  el('button', { className: 'pc-btn spot', textContent: '☀', onclick: () => toggleSpotlight(charId),
                       title: 'Spotlight — la caméra de ce joueur passe en grand chez tous' }),
            hpNum: el('div', { className: 'pc-hp-num' }),
            hpMax: el('div', { className: 'pc-hp-max' }),
            hpBar: el('div', { className: 'pc-hp-bar' }),
            prot:  el('div', { className: 'pc-prot', title: 'Protection' }),
            stats: el('div', { className: 'pc-stats' }),
            karma: el('span', { className: 'pc-karma-val' }),
            // Viewer-only permissions. Only the push iframes need camera/microphone/
            // display-capture; granting them here would widen what a third-party frame
            // can ask for, for no benefit.
            cam:   el('iframe', { className: 'pc-camera-frame', allow: 'autoplay; fullscreen', allowFullscreen: true }),
        };
        refs.camWrap = el('div', { className: 'pc-camera-wrap' }, refs.cam);

        const card = el('div', { className: 'player-card', dataset: { charId } },
            refs.camWrap,
            el('div', { className: 'pc-header' },
                refs.dot,
                el('div', { style: { flex: '1', minWidth: '0' } }, refs.name, refs.cls),
                refs.spot,
                el('button', { className: 'pc-btn details', textContent: '≡', title: 'Voir la fiche', onclick: () => openPlayerDetails(charId) })),
            el('div', { className: 'pc-body' },
                el('div', { className: 'pc-hp-row' },
                    el('div', null, refs.hpNum, refs.hpMax),
                    el('div', { className: 'pc-hp-bar-wrap' }, refs.hpBar)),
                refs.prot,
                refs.stats,
                el('div', { className: 'pc-actions' },
                    dmgInput,
                    el('button', { className: 'pc-btn dmg', textContent: '−', onclick: () => applyPlayerDamage(charId) }),
                    healInput,
                    el('button', { className: 'pc-btn heal', textContent: '+', onclick: () => applyPlayerHeal(charId) })),
                el('div', { className: 'pc-karma-row' },
                    el('span', { className: 'pc-karma-label', textContent: 'Karma' }),
                    el('button', { className: 'pc-karma-btn minus', textContent: '−', onclick: () => setPlayerKarma(charId, -1) }),
                    refs.karma,
                    el('button', { className: 'pc-karma-btn plus', textContent: '+', onclick: () => setPlayerKarma(charId, 1) }))));
        card._refs = refs;
        return card;
    }, (card, p, charId) => {
        const s = _playerCardState(p, charId);
        const r = card._refs;
        // `no-cam` moves the death plate to the name row — see the MORT rule.
        card.className = `player-card ${s.online ? 'online' : 'offline'}${s.stateCls}${currentVdoRoom ? '' : ' no-cam'}`;
        r.dot.className = `pc-online-dot${s.online ? ' online' : ''}`;
        r.name.textContent = p.name || charId;
        r.cls.textContent = p.charClass || '';
        r.spot.classList.toggle('active', gmSpotlightCharId === charId);
        r.hpNum.textContent = s.hp;
        r.hpNum.className = `pc-hp-num${s.hpClass ? ' ' + s.hpClass : ''}`;
        r.hpMax.textContent = `/ ${s.maxHP} PV`;
        r.hpBar.style.width = `${Math.round(s.pct * 100)}%`;
        r.hpBar.style.background = s.hpColor;
        fill(r.stats, Object.entries(s.stats).filter(([k]) => k !== 'PV').map(([k, v]) =>
            el('span', { className: 'pc-stat', textContent: k + ' ' }, el('span', { textContent: String(v) }))));
        r.prot.style.display = p.protection ? '' : 'none';
        if (p.protection) {
            fill(r.prot,
                el('span', { className: 'pc-prot-label', textContent: 'Prot.' }),
                ' ',
                el('span', { style: { color: 'var(--parchment-dim)' }, textContent: p.protection.nom || '' }),
                p.protection.valeur && el('span', { style: { color: 'var(--gold)', fontWeight: '600' }, textContent: ' ' + p.protection.valeur }));
        }
        r.karma.textContent = `${s.karma > 0 ? '+' : ''}${s.karma}`;
        r.karma.className = `pc-karma-val${s.karma > 0 ? ' positive' : s.karma < 0 ? ' negative' : ''}`;
        // Hide rather than detach: removing the wrapper would kill the WebRTC
        // connection, and blanking the src reloads the frame on the way back.
        // No room at all: no face area. Room but no stream from this player: the
        // design's hatched placeholder, which also keeps every card the same height.
        r.camWrap.style.display = currentVdoRoom ? '' : 'none';
        r.camWrap.classList.toggle('no-stream', !s.camSrc);
        r.cam.style.display = s.camSrc ? '' : 'none';
        if (s.camSrc) setFrameSrc(r.cam, s.camSrc);
        else if (r.cam.src && r.cam.src !== 'about:blank') r.cam.src = 'about:blank';
    });

    if (focusedId) document.getElementById(focusedId)?.focus();
}
// Open the player details modal with character info, tab toggles, and file/potion grants.
function openPlayerDetails(charId) {
    const p = players.get(charId);
    if (!p) return;
    document.getElementById('pdm-name').textContent = p.name || charId;
    document.getElementById('pdm-class').textContent = p.charClass || '';

    // Coerced — these are interpolated into innerHTML and come from remote presence.
    const hp = _finiteNum(p.hp) ?? _finiteNum(p.maxHP) ?? '?', maxHP = _finiteNum(p.maxHP) ?? '?';
    const pct = maxHP > 0 ? hp / maxHP : 0;
    const hpColor = pct > 0.5 ? 'var(--success)' : pct > 0.25 ? '#e8a020' : 'var(--fail)';
    const stats = p.stats || {};
    const skills = p.skills || [];
    const specials = p.specials || [];
    const weapons = p.weapons || [];
    const inventory = p.inventory || [];
    const potions = p.potions || [];
    const tabs = p.tabs || { cards: false, alchemy: false };
    const grantedRecipeIds = new Set(p.potionRecipeIds || []);

    // Every field below comes from a remote presence payload. Built as elements, so
    // the values are text by construction rather than by remembering to escape.
    const section = (title, body) => body && el('div', { className: 'pdm-section' },
        el('div', { className: 'pdm-section-title', textContent: title }), body);
    const toggles = (...kids) => el('div', { className: 'pdm-tab-toggles' }, ...kids);
    const listRow = (name, val, nameStyle) => el('div', { className: 'pdm-list-row' },
        el('span', { className: 'pdm-list-name', style: nameStyle, textContent: name }),
        el('span', { className: 'pdm-list-val', textContent: val }));
    const statBlock = (key, val) => el('div', { className: 'pdm-stat-block' },
        el('span', { className: 'pdm-stat-key', textContent: key }),
        el('span', { className: 'pdm-stat-val', textContent: val }));

    const realWeapons = weapons.filter(w => w.nom);
    const realInv = inventory.filter(i => i.name);
    const realPotions = potions.filter(x => x.name);
    const money = p.money || {};
    const vials = _finiteNum(p.vials) ?? 0;
    const showVials = tabs.alchemy && vials > 0;
    const MONEY_COINS = [
        { key: 'couronne', label: 'Couronne', color: '#eca456' },
        { key: 'orbe',     label: 'Orbe',     color: '#b8c4cc' },
        { key: 'sceptre',  label: 'Sceptre',  color: '#c87533' },
        { key: 'sou',      label: 'Sou',      color: '#8a8a94' },
    ];

    fill(document.getElementById('pdm-body'),
        section('Accès aux onglets', toggles(
            el('button', { className: 'pdm-tab-toggle' + (tabs.cards ? ' active' : ''), textContent: '🂠 Cartes',
                onclick: () => sendTabConfig(charId, 'cards', !tabs.cards) }),
            el('button', { className: 'pdm-tab-toggle' + (tabs.alchemy ? ' active' : ''), textContent: 'Alchimie',
                onclick: () => sendTabConfig(charId, 'alchemy', !tabs.alchemy) }))),

        gmFiles.length && section('Documents', toggles(gmFiles.map(f => {
            const isAll = f.grantedTo === 'all';
            const hasAccess = isAll || (Array.isArray(f.grantedTo) && f.grantedTo.includes(charId));
            return el('button', {
                className: 'pdm-tab-toggle' + (hasAccess ? ' active' : ''),
                textContent: `${fileIcon(f.type)} ${f.name}`,
                disabled: isAll,
                title: isAll ? 'Accès accordé à tous' : null,
                onclick: isAll ? null : () => grantFileToPlayer(f.id, charId),
            });
        }))),

        // Recipe grants only make sense once the Alchimie tab is enabled.
        tabs.alchemy && gmPotions.length && section('Recettes alchimiques', toggles(gmPotions.map(pot =>
            el('button', { className: 'pdm-tab-toggle' + (grantedRecipeIds.has(pot.id) ? ' active' : ''),
                textContent: pot.name, title: pot.desc || '',
                onclick: () => sendPotionGrant(charId, pot.id) })))),

        section('Attributs', el('div', { className: 'pdm-attrs-row' },
            el('div', { className: 'pdm-hp-panel' },
                el('div', { className: 'pdm-hp-label', textContent: 'Points de vie' }),
                el('div', { className: 'pdm-hp-num', style: { color: hpColor } }, String(hp),
                    el('span', { className: 'pdm-hp-max', textContent: ` / ${maxHP}` }))),
            el('div', { className: 'pdm-stats-grid' },
                ['FOR', 'DEX', 'END', 'INT', 'CHA'].filter(k => stats[k] !== undefined).map(k => statBlock(k, stats[k])),
                p.protection?.nom && statBlock('Armure', p.protection.nom + (p.protection.valeur ? ' ' + p.protection.valeur : ''))))),

        realWeapons.length && section('Armes', el('div', { className: 'pdm-list' },
            realWeapons.map(w => listRow(w.nom, w.degats || '—')))),

        skills.length && section('Compétences', el('div', { className: 'pdm-skills-grid' },
            skills.map(s => el('div', { className: 'pdm-skill-row' },
                el('span', { className: 'pdm-skill-name', textContent: s.name }),
                el('span', { className: 'pdm-skill-pct' }, _pdmSkillPct(s)))))),

        specials.length && section('Compétences spéciales', el('div', { className: 'pdm-list' },
            specials.map(s => el('div', { className: 'pdm-special-row' },
                el('div', { className: 'pdm-special-header' },
                    el('span', { className: 'pdm-skill-name', textContent: s.name }),
                    el('span', { className: 'pdm-skill-pct' }, _pdmSkillPct(s))),
                s.desc && el('div', { className: 'pdm-special-desc', textContent: s.desc }))))),

        section('Monnaie', el('div', { className: 'pdm-money-row' },
            (p.ariaType || 'ancient') === 'contemporary'
                ? el('div', { className: 'pdm-coin-block' },
                    el('span', { className: 'pdm-coin-label', textContent: 'Francs' }),
                    el('span', { className: 'pdm-coin-val', textContent: money.francs ?? 0 }))
                : MONEY_COINS.map(c => el('div', { className: 'pdm-coin-block' },
                    el('span', { className: 'pdm-coin-dot', style: { color: c.color }, textContent: '●' }),
                    el('span', { className: 'pdm-coin-label', textContent: c.label }),
                    el('span', { className: 'pdm-coin-val', textContent: money[c.key] ?? 0 }))))),

        (showVials || realInv.length) && section('Inventaire', el('div', { className: 'pdm-list' },
            showVials && listRow('Fioles vides', `×${vials}`, { fontStyle: 'italic' }),
            realInv.map(i => listRow(i.name, `×${i.qty ?? 1}`)))),

        realPotions.length && section('Potions', el('div', { className: 'pdm-list' },
            realPotions.map(pot => el('div', { className: 'pdm-list-row' },
                el('span', { className: 'pdm-list-name', textContent: pot.name },
                    pot.desc && el('span', { className: 'pdm-list-desc', textContent: ` — ${pot.desc}` }),
                    pot.ingredients && el('span', { className: 'pdm-list-desc pdm-list-ing', textContent: ` ${pot.ingredients}` })),
                el('span', { className: 'pdm-list-val', textContent: `×${pot.qty ?? 1}` }))))));

    document.getElementById('details-scrim').classList.add('show');
    document.getElementById('player-details-modal').classList.add('show');
}
// Close the player details modal.
function closePlayerDetails() {
    document.getElementById('details-scrim').classList.remove('show');
    document.getElementById('player-details-modal').classList.remove('show');
}
// Send a tab-config message to toggle a player's Cartes or Alchimie tab access.
// `charId` is the stable character UUID (the players Map key); the published
// payload targets the character, so every tab of it applies the change.
function sendTabConfig(charId, tab, enabled) {
    if (!ablyDamage) { console.warn('[GM] sendTabConfig: ablyDamage not ready'); return; }
    const p = players.get(charId);
    if (!p) return;
    if (!p.tabs) p.tabs = { cards: false, alchemy: false };
    p.tabs[tab] = enabled;
    console.log('[GM] sendTabConfig → ', p.name, '| tab:', tab, '=', enabled, '| full tabs:', JSON.stringify(p.tabs));
    ablyDamage.publish('tab-config', { charId: p.charId, tabs: p.tabs });
    openPlayerDetails(charId); // refresh modal to reflect new state
}

// Read the damage input for a player, apply armor reduction, and publish the damage.
function applyPlayerDamage(charId) {
    const inp = document.getElementById(`dmg-${charId}`);
    const rawDmg = parseInt(inp.value);
    if (!rawDmg || rawDmg <= 0) return;
    const p = players.get(charId);
    if (!p) return;
    const prot = p.protection?.valeur || 0;
    const dmg = Math.max(0, rawDmg - prot);
    const hpBefore = p.hp ?? p.maxHP ?? 0;
    const hpAfter = Math.max(0, hpBefore - dmg);
    console.log('[GM] applyPlayerDamage:', p.name, '| raw:', rawDmg, '| armor:', prot, '| net dmg:', dmg, '| HP:', hpBefore, '→', hpAfter);
    p.hp = hpAfter;
    inp.value = '';
    publishDamage(p.charId, dmg, hpBefore, hpAfter, p.maxHP || hpBefore, p.name);
    renderPlayerCards();
    triggerCardFx(playerCardEl(charId), 'dmg');
}
// Read the heal input for a player, clamp to max HP, and publish the heal.
function applyPlayerHeal(charId) {
    const inp = document.getElementById(`heal-${charId}`);
    const amt = parseInt(inp.value);
    if (!amt || amt <= 0) return;
    const p = players.get(charId);
    if (!p) return;
    const hpBefore = p.hp ?? 0;
    const hpAfter = Math.min(p.maxHP || hpBefore, hpBefore + amt);
    console.log('[GM] applyPlayerHeal:', p.name, '| heal:', amt, '| HP:', hpBefore, '→', hpAfter);
    p.hp = hpAfter;
    inp.value = '';
    publishHeal(p.charId, amt, hpBefore, hpAfter, p.maxHP || hpBefore, p.name);
    renderPlayerCards();
    triggerCardFx(playerCardEl(charId), 'heal');
}

// ═══════════════════════════════════════════
//  MONSTERS
// ═══════════════════════════════════════════
// Persist monsters to localStorage, debounce Supabase sync, and push state to overlay.
function saveMonsters() { localStorage.setItem(monstersKey(), JSON.stringify(monsters)); debouncedSyncMonsters(); publishMonsterStateToOverlay(); }

// Persist maps and push them to Supabase. Every map mutation goes through here, so the
// broadcast added in Task 7 has exactly one place to hang off.
function saveMaps() {
    localStorage.setItem(mapsKey(), JSON.stringify(gmMaps));
    localStorage.setItem(activeMapKey(), activeMapId || '');
    debouncedSyncMaps();
    publishMapState();
}

// Add one or more monsters from the add-monster form (supports a count field).
function addMonster() {
    const name = document.getElementById('amf-name').value.trim();
    if (!name) { alert('Entrez un nom.'); return; }
    const pv = parseInt(document.getElementById('amf-pv').value) || 20;
    const armor = parseInt(document.getElementById('amf-armor').value) || 0;
    const count = Math.max(1, Math.min(20, parseInt(document.getElementById('amf-count')?.value) || 1));
    const stats = {
        FOR: parseInt(document.getElementById('amf-for').value) || 10,
        DEX: parseInt(document.getElementById('amf-dex').value) || 10,
        END: parseInt(document.getElementById('amf-end').value) || 10,
        INT: parseInt(document.getElementById('amf-int').value) || 10,
        CHA: parseInt(document.getElementById('amf-cha').value) || 10,
    };
    const added = [];
    for (let n = 0; n < count; n++) {
        const label = count > 1 ? ` ${n + 1}` : '';
        const monster = { id: uid(), name: name + label, pv, maxPV: pv, armor, stats, attacks: [...newMonsterAttacks.map(a => ({ ...a }))] };
        monsters.push(monster);
        added.push(monster.id);
    }
    saveMonsters();
    // When a group filter is active, new monsters join that group.
    if (activeMonsterGroupId) { added.forEach(id => { monsterGroupAssign[id] = activeMonsterGroupId; }); saveMonsterGroups(); }
    // Reset form
    ['amf-name', 'amf-pv', 'amf-armor', 'amf-for', 'amf-dex', 'amf-end', 'amf-int', 'amf-cha'].forEach(id => { document.getElementById(id).value = ''; });
    const countEl = document.getElementById('amf-count'); if (countEl) countEl.value = '';
    newMonsterAttacks = [];
    document.getElementById('amf-attacks-list').innerHTML = '';
    renderMonsters();
    refreshMonsterSelect();
}
// Remove a monster by ID from the list, Supabase, and the select dropdown.
function removeMonster(id) {
    sbDelete('monsters', 'id=eq.' + encodeURIComponent(String(id)));
    monsters = monsters.filter(m => String(m.id) !== String(id));
    if (monsterGroupAssign[id]) { delete monsterGroupAssign[id]; saveMonsterGroups(); }
    saveMonsters();
    renderMonsters();
    refreshMonsterSelect();
}
// One attack row of the add-monster form, bound to newMonsterAttacks[i].
function _amfAttackRow(a, i) {
    return el('div', { className: 'atk-row' },
        el('input', { placeholder: 'Nom', value: a.name || '',
            oninput: e => { newMonsterAttacks[i].name = e.target.value; } }),
        el('input', { type: 'text', inputMode: 'numeric', placeholder: '%', value: a.pct ?? '',
            oninput: e => { e.target.value = e.target.value.replace(/[^0-9]/g, ''); newMonsterAttacks[i].pct = +e.target.value || 0; } }),
        el('input', { placeholder: '1d6', value: a.dmg || '',
            oninput: e => { newMonsterAttacks[i].dmg = e.target.value; } }),
        el('button', { className: 'del-btn', textContent: '✕', onclick: () => removeAmfAttack(i) }));
}
// Add an attack row to the add-monster form.
function addAmfAttack() {
    newMonsterAttacks.push({ name: '', pct: 50, dmg: '' });
    _renderAmfAttacks();
}
// Remove an attack by index from the add-monster form and re-render the rows.
// Every row is rebuilt because the closures capture the index, which shifts.
function removeAmfAttack(idx) {
    newMonsterAttacks.splice(idx, 1);
    _renderAmfAttacks();
}
function _renderAmfAttacks() {
    fill(document.getElementById('amf-attacks-list'), newMonsterAttacks.map(_amfAttackRow));
}
// Apply damage to the selected monster in the GM roll panel.
function doGMMonsterDamage() {
    const mId = getSelectValue('gm-monster-select');
    const m = monsters.find(m => String(m.id) === mId); if (!m) return;
    const dmg = parseInt(document.getElementById('gm-monster-dmg-input').value); if (!dmg || dmg <= 0) return;
    const effective = Math.max(0, dmg - (m.armor || 0));
    m.pv = Math.max(0, m.pv - effective);
    document.getElementById('gm-monster-dmg-input').value = '';
    saveMonsters();
    clearTimeout(renderMonstersTimer); renderMonstersTimer = setTimeout(renderMonsters, 50);
    setTimeout(() => triggerCardFx(monsterCardEl(m.id), 'dmg'), 70);
}
// Apply heal to the selected monster in the GM roll panel.
function doGMMonsterHeal() {
    const mId = getSelectValue('gm-monster-select');
    const m = monsters.find(m => String(m.id) === mId); if (!m) return;
    const amt = parseInt(document.getElementById('gm-monster-heal-input').value); if (!amt || amt <= 0) return;
    m.pv = Math.min(m.maxPV, m.pv + amt);
    document.getElementById('gm-monster-heal-input').value = '';
    saveMonsters();
    clearTimeout(renderMonstersTimer); renderMonstersTimer = setTimeout(renderMonsters, 50);
    setTimeout(() => triggerCardFx(monsterCardEl(m.id), 'heal'), 70);
}
// Rebuild the attack select dropdown when the monster selection changes.
function onMonsterSelectChange() {
    const mId = getSelectValue('gm-monster-select');
    const panel = document.getElementById('gm-attack-select')?.querySelector('.gm-select-panel');
    if (!panel) return;
    panel.innerHTML = '';
    setSelectValue('gm-attack-select', '', '— Attaque personnalisée —');
    document.getElementById('gm-monster-threshold').value = '';
    const m = monsters.find(m => String(m.id) === mId);
    if (!m) return;
    addSelectOpt(panel, '', '— Attaque personnalisée —', () => setSelectValue('gm-attack-select', '', '— Attaque personnalisée —'));
    m.attacks.forEach((a, i) => {
        const label = `${a.name} (${a.pct}%)${a.dmg ? ' · ' + a.dmg : ''}`;
        addSelectOpt(panel, String(i), label, () => { setSelectValue('gm-attack-select', String(i), label); onAttackSelectChange(); });
    });
}
// Fill the threshold input with the selected attack's percentage.
function onAttackSelectChange() {
    const mId = getSelectValue('gm-monster-select');
    const atkIdx = getSelectValue('gm-attack-select');
    if (atkIdx === '') return;
    const m = monsters.find(m => String(m.id) === mId);
    if (!m) return;
    const atk = m.attacks[parseInt(atkIdx)];
    if (atk) document.getElementById('gm-monster-threshold').value = atk.pct;
}
// ═══════════════════════════════════════════
//  MONSTER / FILE GROUPING (navigation aid)
// ═══════════════════════════════════════════
// Grouping is purely a GM-side filter for navigating long lists. Groups and the
// flat membership map are persisted in a dedicated localStorage key per campaign,
// separate from the synced monsters / campaign_files tables (no schema change).
// See the comment on the state declarations near the top of this file.

// Load monster groups + membership from localStorage into module state.
function loadMonsterGroups() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(monsterGroupsKey()) || 'null') || {}; } catch (e) { p = {}; }
    monsterGroups = Array.isArray(p.groups) ? p.groups : [];
    monsterGroupAssign = (p.assign && typeof p.assign === 'object') ? p.assign : {};
    activeMonsterGroupId = null;
}
// Persist monster groups + membership to localStorage (not synced to Supabase).
function saveMonsterGroups() {
    localStorage.setItem(monsterGroupsKey(), JSON.stringify({ groups: monsterGroups, assign: monsterGroupAssign }));
}
// Load file groups + membership from localStorage into module state.
function loadFileGroups() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(fileGroupsKey()) || 'null') || {}; } catch (e) { p = {}; }
    fileGroups = Array.isArray(p.groups) ? p.groups : [];
    fileGroupAssign = (p.assign && typeof p.assign === 'object') ? p.assign : {};
    activeFileGroupId = null;
}
// Persist file groups + membership to localStorage (not synced to Supabase).
function saveFileGroups() {
    localStorage.setItem(fileGroupsKey(), JSON.stringify({ groups: fileGroups, assign: fileGroupAssign }));
}

// ─── Drag-to-assign (shared by both chip bars) ───
// A grip on each card starts the drag; chips are drop targets.
function _groupDragStart(ev, id, type) {
    _groupDrag = { id, type };
    if (ev.dataTransfer) { ev.dataTransfer.effectAllowed = 'move'; try { ev.dataTransfer.setData('text/plain', id); } catch (e) {} }
    const card = ev.currentTarget.closest('.monster-card, .gm-file-card');
    if (card) card.classList.add('dragging');
}
function _groupDragEnd(ev) {
    const card = ev.currentTarget.closest('.monster-card, .gm-file-card');
    if (card) card.classList.remove('dragging');
}
function _groupDragOver(ev) { ev.preventDefault(); if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'; ev.currentTarget.classList.add('drop-hover'); }
function _groupDragLeave(ev) { ev.currentTarget.classList.remove('drop-hover'); }
function _groupDrop(ev, groupId, type) {
    ev.preventDefault();
    ev.currentTarget.classList.remove('drop-hover');
    if (!_groupDrag || _groupDrag.type !== type) return;
    if (type === 'monster') assignMonsterToGroup(_groupDrag.id, groupId);
    else assignFileToGroup(_groupDrag.id, groupId);
    _groupDrag = null;
}

// Build one chip element. `id` empty string === the "Tous" chip (no edit/del).
function _groupChip(o) {
    const chip = document.createElement('div');
    chip.className = 'group-chip' + (o.active ? ' active' : '') + (o.isTous ? ' tous' : '');
    chip.addEventListener('dragover', _groupDragOver);
    chip.addEventListener('dragleave', _groupDragLeave);
    chip.addEventListener('drop', (ev) => _groupDrop(ev, o.id, o.type));
    const name = document.createElement('span');
    name.className = 'group-chip-name';
    name.textContent = o.name;                         // textContent → no XSS
    name.addEventListener('click', () => o.cfg.select(o.isTous ? null : o.id));
    chip.appendChild(name);
    const count = document.createElement('span');
    count.className = 'group-chip-count';
    count.textContent = o.count;
    chip.appendChild(count);
    if (!o.isTous && o.active) {
        const edit = document.createElement('button');
        edit.className = 'group-chip-edit'; edit.title = 'Renommer'; edit.textContent = '✎';
        edit.addEventListener('click', () => o.cfg.rename(o.id));
        chip.appendChild(edit);
        const del = document.createElement('button');
        del.className = 'group-chip-del'; del.title = 'Supprimer le groupe'; del.textContent = '✕';
        del.addEventListener('click', () => o.cfg.del(o.id));
        chip.appendChild(del);
    }
    return chip;
}

// Render a chip bar (monster, file, or map). "Tous" first (unless noTous), then groups, then ＋.
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

// ─── Monster group management ───
function addMonsterGroup() {
    const name = prompt('Nom du nouveau groupe :', 'Groupe ' + (monsterGroups.length + 1));
    if (name === null) return;
    const g = { id: uid(), name: name.trim() || ('Groupe ' + (monsterGroups.length + 1)) };
    monsterGroups.push(g);
    activeMonsterGroupId = g.id;
    saveMonsterGroups();
    renderMonsters();
}
function selectMonsterGroup(id) { activeMonsterGroupId = id; renderMonsters(); }
function renameMonsterGroup(id) {
    const g = monsterGroups.find(g => g.id === id); if (!g) return;
    const name = prompt('Nouveau nom du groupe :', g.name);
    if (name === null) return;
    const t = name.trim(); if (!t || t === g.name) return;
    g.name = t; saveMonsterGroups(); renderMonsters();
}
function deleteMonsterGroup(id) {
    const g = monsterGroups.find(g => g.id === id); if (!g) return;
    const n = monsters.reduce((c, m) => c + (monsterGroupAssign[m.id] === id ? 1 : 0), 0);
    if (!confirm(`Supprimer le groupe « ${g.name} » ? Les ${n} monstre(s) ne sont pas supprimés (déplacés vers « Tous »).`)) return;
    monsterGroups = monsterGroups.filter(x => x.id !== id);
    Object.keys(monsterGroupAssign).forEach(k => { if (monsterGroupAssign[k] === id) delete monsterGroupAssign[k]; });
    if (activeMonsterGroupId === id) activeMonsterGroupId = null;
    saveMonsterGroups(); renderMonsters();
}
function assignMonsterToGroup(mId, groupId) {
    if (groupId) monsterGroupAssign[mId] = groupId; else delete monsterGroupAssign[mId];
    saveMonsterGroups(); renderMonsters();
}

// ─── File group management ───
function addFileGroup() {
    const name = prompt('Nom du nouveau groupe :', 'Groupe ' + (fileGroups.length + 1));
    if (name === null) return;
    const g = { id: uid(), name: name.trim() || ('Groupe ' + (fileGroups.length + 1)) };
    fileGroups.push(g);
    activeFileGroupId = g.id;
    saveFileGroups();
    renderGmFiles();
}
function selectFileGroup(id) { activeFileGroupId = id; renderGmFiles(); }
function renameFileGroup(id) {
    const g = fileGroups.find(g => g.id === id); if (!g) return;
    const name = prompt('Nouveau nom du groupe :', g.name);
    if (name === null) return;
    const t = name.trim(); if (!t || t === g.name) return;
    g.name = t; saveFileGroups(); renderGmFiles();
}
function deleteFileGroup(id) {
    const g = fileGroups.find(g => g.id === id); if (!g) return;
    const n = gmFiles.reduce((c, f) => c + (fileGroupAssign[f.id] === id ? 1 : 0), 0);
    if (!confirm(`Supprimer le groupe « ${g.name} » ? Les ${n} fichier(s) ne sont pas supprimés (déplacés vers « Tous »).`)) return;
    fileGroups = fileGroups.filter(x => x.id !== id);
    Object.keys(fileGroupAssign).forEach(k => { if (fileGroupAssign[k] === id) delete fileGroupAssign[k]; });
    if (activeFileGroupId === id) activeFileGroupId = null;
    saveFileGroups(); renderGmFiles();
}
function assignFileToGroup(fId, groupId) {
    if (groupId) fileGroupAssign[fId] = groupId; else delete fileGroupAssign[fId];
    saveFileGroups(); renderGmFiles();
}

// Render all monster cards with inline damage/heal inputs and attack editing rows.
function renderMonsters() {
    const grid = document.getElementById('monsters-grid');
    const noM = document.getElementById('no-monsters');
    // Drop a stale active filter (e.g. group deleted elsewhere), then render chips.
    if (activeMonsterGroupId && !monsterGroups.some(g => g.id === activeMonsterGroupId)) activeMonsterGroupId = null;
    _renderGroupBar('monster');
    const list = activeMonsterGroupId
        ? monsters.filter(m => monsterGroupAssign[m.id] === activeMonsterGroupId)
        : monsters;
    if (!list.length) {
        clearKeyed(grid);
        if (noM) {
            noM.textContent = monsters.length ? 'Aucun monstre dans ce groupe' : 'Aucun monstre actif';
            noM.style.display = ''; grid.appendChild(noM);
        }
        return;
    }
    if (noM) noM.style.display = 'none';
    reconcile(grid, list.map(m => [String(m.id), m]), (id, m) => _monsterCard(id, m), (card, m) => _updateMonsterCard(card, m));
}

// Build one monster card. Handlers are closures over the monster id, so the id never
// has to survive a trip through the HTML parser and then the JS parser — hence no
// escaping here, and no `safeId` scrubbing to make it selector-safe.
function _monsterCard(id, m) {
    const numeric = { type: 'text', inputMode: 'numeric', oninput: e => { e.target.value = e.target.value.replace(/[^0-9]/g, ''); } };
    const dmgInput = el('input', { ...numeric, className: 'mc-inline-input', placeholder: 'Dégâts',
        onkeydown: e => { if (e.key === 'Enter') monsterInlineDamage(id); } });
    const healInput = el('input', { ...numeric, className: 'mc-inline-input', placeholder: 'Soins',
        onkeydown: e => { if (e.key === 'Enter') monsterInlineHeal(id); } });

    const refs = {
        name:   el('div', { className: 'mc-name' }),
        badge:  el('span', { className: 'group-badge' }),
        hpNum:  el('div', { className: 'mc-hp-num' }),
        hpMax:  el('div', { className: 'mc-hp-max' }),
        hpBar:  el('div', { className: 'mc-hp-bar' }),
        armor:  el('div', { style: { fontFamily: 'ui-monospace,Menlo,monospace', fontSize: '9px', letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(255,150,150,.5)' } }),
        stats:  el('div', { className: 'mc-stats' }),
        atks:   el('div', { className: 'mc-atk-section' }),
        dmgInput, healInput,
    };
    const card = el('div', { className: 'monster-card', dataset: { monsterId: id } },
        el('div', { className: 'mc-header' },
            el('span', { className: 'group-grip', draggable: true, title: 'Glisser vers un groupe', textContent: '⠿',
                ondragstart: e => _groupDragStart(e, id, 'monster'), ondragend: e => _groupDragEnd(e) }),
            refs.name, refs.badge,
            el('button', { className: 'mc-del', textContent: '✕', onclick: () => removeMonster(id) })),
        el('div', { className: 'mc-body' },
            el('div', { className: 'mc-hp-row' },
                el('div', null, refs.hpNum, refs.hpMax),
                el('div', { className: 'mc-hp-bar-wrap' }, refs.hpBar),
                refs.armor),
            el('div', { className: 'mc-inline-actions' },
                dmgInput,
                el('button', { className: 'mc-inline-btn dmg', textContent: '−', onclick: () => monsterInlineDamage(id) }),
                healInput,
                el('button', { className: 'mc-inline-btn heal', textContent: '♥', onclick: () => monsterInlineHeal(id) })),
            refs.stats,
            refs.atks));
    card._refs = refs;
    return card;
}

// Refresh a monster card in place. Attack rows are rebuilt only when their count
// changes or nothing inside them has focus — the node identity is preserved, so
// typing in an attack field is no longer interrupted by a re-render.
function _updateMonsterCard(card, m) {
    const r = card._refs;
    const id = String(m.id);
    const pct = m.maxPV > 0 ? m.pv / m.maxPV : 0;
    const hpColor = pct > 0.5 ? 'var(--ok)' : pct > 0.25 ? 'var(--warn)' : 'var(--bad)';
    const dead = m.pv <= 0;
    card.className = 'monster-card' + (dead ? ' is-dead' : (!dead && pct >= 0 && pct <= 0.25 ? ' hp-critical' : ''));
    r.name.textContent = m.name;
    const gName = monsterGroupAssign[m.id] ? (monsterGroups.find(g => g.id === monsterGroupAssign[m.id]) || {}).name : '';
    r.badge.textContent = gName || '';
    r.badge.style.display = gName ? '' : 'none';
    r.hpNum.textContent = m.pv;
    r.hpNum.style.color = hpColor;
    r.hpMax.textContent = `/ ${m.maxPV} PV`;
    r.hpBar.style.width = `${Math.round(pct * 100)}%`;
    r.hpBar.style.background = hpColor;
    r.armor.textContent = `Arm. ${m.armor}`;
    fill(r.stats, Object.entries(m.stats).map(([k, v]) =>
        el('span', { className: 'mc-stat', textContent: k + ' ' }, el('span', { textContent: String(v) }))));

    const rows = r.atks.querySelectorAll('.mc-atk-edit-row');
    if (rows.length === m.attacks.length && r.atks.contains(document.activeElement)) return;
    fill(r.atks,
        el('div', { className: 'mc-atk-hdr' },
            el('span', { className: 'mc-atk-col-label', textContent: 'Nom' }),
            el('span', { className: 'mc-atk-col-label center', textContent: '%' }),
            el('span', { className: 'mc-atk-col-label center', textContent: 'Dégâts' }),
            el('span')),
        m.attacks.map((a, i) => el('div', { className: 'mc-atk-edit-row' },
            el('input', { className: 'mc-atk-input', value: a.name || '', placeholder: 'Nom',
                oninput: e => updateMonsterAttack(id, i, 'name', e.target.value) }),
            el('input', { className: 'mc-atk-input center', type: 'text', inputMode: 'numeric', value: a.pct, placeholder: '%',
                oninput: e => { e.target.value = e.target.value.replace(/[^0-9]/g, ''); updateMonsterAttack(id, i, 'pct', +e.target.value || 0); } }),
            el('input', { className: 'mc-atk-input center', value: a.dmg || '', placeholder: '1d6',
                oninput: e => updateMonsterAttack(id, i, 'dmg', e.target.value) }),
            el('button', { className: 'del-btn', textContent: '✕', onclick: () => removeMonsterAttack(id, i) }))),
        el('button', { className: 'add-atk-btn mc-add-atk', textContent: '+ Attaque', onclick: () => addMonsterAttack(id) }));
}
// Add a new empty attack to an existing monster and re-render.
function addMonsterAttack(mId) {
    const m = monsters.find(m => String(m.id) === String(mId)); if (!m) return;
    m.attacks.push({ name: '', pct: 50, dmg: '' });
    saveMonsters(); renderMonsters(); refreshMonsterSelect();
}
// Remove an attack from an existing monster by index and re-render.
function removeMonsterAttack(mId, idx) {
    const m = monsters.find(m => String(m.id) === String(mId)); if (!m) return;
    m.attacks.splice(idx, 1);
    saveMonsters(); renderMonsters(); refreshMonsterSelect();
}
// Update a single field of a monster attack and quietly refresh the GM roll dropdown.
function updateMonsterAttack(mId, idx, field, value) {
    const m = monsters.find(m => String(m.id) === String(mId)); if (!m || !m.attacks[idx]) return;
    m.attacks[idx][field] = value;
    saveMonsters();
    // Silently refresh GM roll dropdowns without re-rendering cards (preserves focus)
    const prevMonster = getSelectValue('gm-monster-select');
    refreshMonsterSelect();
    if (prevMonster) setSelectValue('gm-monster-select', prevMonster, monsters.find(x => String(x.id) === prevMonster)?.name || '');
}
// Rebuild the monster dropdown in the GM Roll tab from the current monsters array.
function refreshMonsterSelect() {
    const wrapper = document.getElementById('gm-monster-select');
    if (!wrapper) return;
    const prevId = wrapper.dataset.value;
    const panel = wrapper.querySelector('.gm-select-panel');
    panel.innerHTML = '';
    addSelectOpt(panel, '', '— Aucun monstre —', () => { setSelectValue('gm-monster-select', '', '— Aucun monstre —'); onMonsterSelectChange(); });
    monsters.forEach(m => {
        addSelectOpt(panel, String(m.id), m.name, () => { setSelectValue('gm-monster-select', String(m.id), m.name); onMonsterSelectChange(); });
    });
    if (!monsters.find(m => String(m.id) === prevId)) {
        setSelectValue('gm-monster-select', '', '— Aucun monstre —');
        onMonsterSelectChange();
    }
}

// ═══════════════════════════════════════════
//  ROLL FEED
// ═══════════════════════════════════════════
// Add an incoming roll to the feed, persist it, and re-render the roll list.
function handleIncomingRoll(data) {
    if (!data) return;
    // Normalize numeric fields at the boundary — roll payloads are remote-controlled
    // and several of these are interpolated into innerHTML by renderRollFeed.
    data = {
        ...data,
        roll: _finiteNum(data.roll) ?? 0,
        threshold: data.threshold === null || data.threshold === undefined ? null : (_finiteNum(data.threshold) ?? 0),
        bonusMalus: _finiteNum(data.bonusMalus) ?? 0,
        success: data.success === null || data.success === undefined ? data.success : !!data.success,
        hidden: !!data.hidden,
    };
    rollFeed.unshift({ ...data, receivedAt: Date.now() });
    if (rollFeed.length > 50) rollFeed.pop();
    localStorage.setItem(rollsKey(), JSON.stringify(rollFeed));
    insertRoll(data);
    renderRollFeed();
}
// Render the GM roll feed with player pills, filters, and day-grouped entries.
function renderRollFeed() {
    const feed = document.getElementById('rolls-feed');

    // Rebuild player name pills. Names come from remote roll payloads (d.char is
    // player-controlled) — build with textContent, never innerHTML interpolation.
    const pillGroup = document.getElementById('gm-player-pills');
    if (pillGroup) {
        const names = [...new Set(rollFeed.map(d => d.char || d.playerId || '?'))].filter(Boolean);
        playerFilter = new Set([...playerFilter].filter(n => names.includes(n)));
        pillGroup.innerHTML = '';
        names.forEach(name => {
            const btn = document.createElement('button');
            btn.className = 'rf-pill rf-player' + (playerFilter.has(name) ? ' active' : '');
            btn.textContent = name;
            btn.addEventListener('click', () => togglePlayerFilter(name));
            pillGroup.appendChild(btn);
        });
    }

    // Apply filters. The roll pills go through the shared predicate — this copy used
    // to end in `rollFilter.has(type)`, which hid a critical success while "Succès"
    // was lit, so the same pills meant different things on the two panels.
    const filtered = rollFeed.filter(d =>
        (!playerFilter.size || playerFilter.has(d.char || d.playerId || '?'))
        && rollPassesFilter(d, rollFilter));

    if (!filtered.length) { feed.innerHTML = '<div class="rolls-empty">En attente de jets…</div>'; return; }

    // Group by day
    const days = new Map();
    filtered.forEach(d => {
        const ts = d.ts ?? d.receivedAt;
        const label = ts
            ? new Date(ts).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
            : 'Session en cours';
        if (!days.has(label)) days.set(label, []);
        days.get(label).push(d);
    });

    feed.innerHTML = '';
    let firstDay = true;
    const verdicts = { success: 'SUCCÈS', fail: 'ÉCHEC', 'crit-success': 'SUCCÈS CRITIQUE', 'crit-fail': 'ÉCHEC CRITIQUE' };
    const vcls     = { success: 's', fail: 'f', 'crit-success': 'cs', 'crit-fail': 'cf' };

    days.forEach((entries, label) => {
        const hdr = document.createElement('div');
        hdr.className = 'rh-day-header' + (firstDay ? ' rh-day-header-first' : '');
        hdr.textContent = label;
        feed.appendChild(hdr);
        firstDay = false;
        entries.forEach(d => {
            const isDie = d.threshold === null;
            const type = isDie ? 'die' : classify(d.roll, d.threshold, d.success);
            // Coerce here too — entries persisted in localStorage before the ingest
            // normalization existed can still hold arbitrary values.
            const roll = _finiteNum(d.roll) ?? 0;
            const threshold = _finiteNum(d.threshold) ?? 0;
            const bm = _finiteNum(d.bonusMalus) ?? 0;
            // char / skillName arrive over Ably from any holder of the key.
            const at = d.ts ?? d.receivedAt;
            feed.append(el('div', { className: `roll-entry ${type}${d.hidden ? ' hidden-roll' : ''}` },
                el('div', { className: 're-context' },
                    el('div', { className: 're-char' },
                        d.hidden && el('span', { className: 're-hidden-badge', textContent: 'MJ',
                            title: 'Jet caché — visible uniquement par le MJ' }),
                        d.char || d.playerId || '?'),
                    el('div', { className: 're-skill',
                        textContent: (d.skillName || '') + (isDie ? '' : ` · seuil ${threshold}%${bm ? ` · BM ${bm > 0 ? '+' : ''}${bm}` : ''}`) })),
                el('div', { className: 're-result' },
                    !isDie && el('div', { className: `re-verdict ${vcls[type]}`, textContent: verdicts[type] }),
                    at && el('div', { className: 're-time',
                        textContent: new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) })),
                el('div', { className: 're-roll', textContent: roll })));
        });
    });
}
// Clear the roll feed from memory, localStorage, and reset all filter pills.
function clearRolls() {
    rollFeed = [];
    rollFilter.clear();
    playerFilter.clear();
    localStorage.removeItem(rollsKey());
    document.querySelectorAll('#gm-roll-filter-bar .rf-pill:not(.rf-player)').forEach(btn => btn.classList.remove('active'));
    const allBtn = document.getElementById('gm-rfp-all');
    if (allBtn) allBtn.classList.add('active');
    renderRollFeed();
}

// Toggle a roll type filter pill and re-render the roll feed.
function toggleGMRollFilter(key) {
    if (key === 'all') {
        rollFilter.clear();
    } else {
        if (rollFilter.has(key)) rollFilter.delete(key);
        else rollFilter.add(key);
    }
    document.querySelectorAll('#gm-roll-filter-bar .rf-pill:not(.rf-player)').forEach(btn => btn.classList.remove('active'));
    if (rollFilter.size === 0) {
        const allBtn = document.getElementById('gm-rfp-all');
        if (allBtn) allBtn.classList.add('active');
    } else {
        rollFilter.forEach(k => { const node = document.getElementById('gm-rfp-' + k); if (node) node.classList.add('active'); });
    }
    renderRollFeed();
}

// Toggle a player name pill filter and re-render the roll feed.
function togglePlayerFilter(name) {
    if (playerFilter.has(name)) playerFilter.delete(name);
    else playerFilter.add(name);
    renderRollFeed();
}

// ═══════════════════════════════════════════
//  GM ROLLS
// ═══════════════════════════════════════════
// Safety fallback for GM dddice rolls: if RollFinished never fires (e.g. network
// drop after the roll was created), resolve the pending roll locally after 12s so
// the result panel never hangs. Cleared by the RollFinished handler on success.
function armGMRollSafetyTimer() {
    clearTimeout(gmRollSafetyTimer);
    gmRollSafetyTimer = setTimeout(() => {
        if (!pendingGMRoll) return;
        const { name, threshold, atk } = pendingGMRoll;
        pendingGMRoll = null;
        const roll = Math.floor(Math.random() * 100) + 1;
        const success = roll <= threshold;
        const dmgResult = (success && atk?.dmg?.trim()) ? rollDiceFormula(atk.dmg) : null;
        showGMRollResult(name, threshold, roll, success, dmgResult);
    }, 12000);
}
// Execute a free-threshold GM roll from the Jet MJ form.
function doGMFreeRoll() {
    const name = document.getElementById('gm-free-name').value.trim() || 'Jet MJ';
    const t = parseInt(document.getElementById('gm-free-threshold').value);
    if (isNaN(t) || t < 1 || t > 100) { alert('Seuil invalide.'); return; }
    if (dddiceSDK && dddiceAPI) {
        pendingGMRoll = { name, threshold: t, atk: null, uuid: null };
        armGMRollSafetyTimer();
        dddiceSDK.roll([{ type: 'd10x', theme: dddiceAPI.theme }, { type: 'd10', theme: dddiceAPI.theme }])
            .then(res => { if (pendingGMRoll) pendingGMRoll.uuid = _ddRollUuid(res); })
            .catch(e => { console.error('dddice GM roll:', e); clearTimeout(gmRollSafetyTimer); pendingGMRoll = null; const r = Math.floor(Math.random() * 100) + 1; showGMRollResult(name, t, r, r <= t); });
    } else {
        const roll = Math.floor(Math.random() * 100) + 1;
        showGMRollResult(name, t, roll, roll <= t);
    }
}
// Roll an attack for the selected monster, optionally rolling damage on success.
function doGMMonsterRoll() {
    const mId = getSelectValue('gm-monster-select');
    const t = parseInt(document.getElementById('gm-monster-threshold').value);
    if (isNaN(t) || t < 1 || t > 100) { alert('Seuil invalide.'); return; }
    const m = monsters.find(m => String(m.id) === mId);
    const atkIdx = getSelectValue('gm-attack-select');
    const atk = (m && atkIdx !== '') ? m.attacks[parseInt(atkIdx)] : null;
    const name = atk ? `${m.name} — ${atk.name}` : m ? `${m.name} (${t}%)` : `Jet MJ (${t}%)`;
    if (dddiceSDK && dddiceAPI) {
        pendingGMRoll = { name, threshold: t, atk, uuid: null };
        armGMRollSafetyTimer();
        dddiceSDK.roll([{ type: 'd10x', theme: dddiceAPI.theme }, { type: 'd10', theme: dddiceAPI.theme }])
            .then(res => { if (pendingGMRoll) pendingGMRoll.uuid = _ddRollUuid(res); })
            .catch(e => {
                console.error('dddice GM roll:', e);
                clearTimeout(gmRollSafetyTimer);
                pendingGMRoll = null;
                const roll = Math.floor(Math.random() * 100) + 1;
                const success = roll <= t;
                const dmgResult = (success && atk?.dmg?.trim()) ? rollDiceFormula(atk.dmg) : null;
                showGMRollResult(name, t, roll, success, dmgResult);
            });
    } else {
        const roll = Math.floor(Math.random() * 100) + 1;
        const success = roll <= t;
        const dmgResult = (success && atk && atk.dmg && atk.dmg.trim()) ? rollDiceFormula(atk.dmg) : null;
        showGMRollResult(name, t, roll, success, dmgResult);
    }
}
// Display a GM roll result in the result panel with optional damage and player target buttons.
function showGMRollResult(name, threshold, roll, success, dmgResult) {
    // Add to the roll feed
    handleIncomingRoll({ skillName: name, threshold, roll, success, char: 'MJ', bonusMalus: 0, playerId: 'gm' });
    if (dmgResult) handleIncomingRoll({ skillName: `${name} — Dégâts`, threshold: null, roll: dmgResult.total, success: null, char: 'MJ', bonusMalus: 0, playerId: 'gm' });
    const type = classify(roll, threshold, success);
    const verdicts = { success: 'SUCCÈS', fail: 'ÉCHEC', 'crit-success': 'SUCCÈS CRITIQUE', 'crit-fail': 'ÉCHEC CRITIQUE' };
    const colors = { success: 'var(--success)', fail: 'var(--fail)', 'crit-success': '#a8ff78', 'crit-fail': '#ff4444' };
    const online = dmgResult ? [...players.entries()].filter(([, p]) => p.online !== false) : [];
    fill(document.getElementById('gm-roll-result'),
        el('div', { className: 'gm-rr-name', textContent: name }),
        el('div', { className: 'gm-rr-roll', textContent: roll }),
        el('div', { className: 'gm-rr-detail', textContent: `Seuil : ${threshold}%` }),
        el('div', { className: 'gm-rr-verdict', style: { color: colors[type] }, textContent: verdicts[type] }),
        dmgResult && el('div', { className: 'gm-rr-dmg', textContent: 'Dégâts : ' },
            el('strong', { textContent: dmgResult.total }),
            dmgResult.breakdown && dmgResult.breakdown !== String(dmgResult.total)
                && el('span', { className: 'gm-rr-breakdown', textContent: ' ' + dmgResult.breakdown })),
        online.length && el('div', { className: 'gm-target-section' },
            el('div', { className: 'gm-target-label', textContent: 'Appliquer à :' }),
            el('div', { className: 'gm-target-btns' }, online.map(([id, p]) =>
                el('button', { className: 'gm-target-btn', dataset: { pid: id }, textContent: p.name || id.slice(-4),
                    onclick: () => applyDamageToPlayer(id, dmgResult.total) })))));
}
// Apply a damage amount to a player from the GM roll result panel, with armor reduction.
function applyDamageToPlayer(charId, amount) {
    const p = players.get(charId);
    if (!p) return;
    const prot = p.protection?.valeur || 0;
    const dmg = Math.max(0, amount - prot);
    const hpBefore = p.hp ?? p.maxHP ?? 0;
    const hpAfter = Math.max(0, hpBefore - dmg);
    p.hp = hpAfter;
    publishDamage(p.charId, dmg, hpBefore, hpAfter, p.maxHP || hpBefore, p.name);
    renderPlayerCards();
    const btn = document.querySelector(`.gm-target-btn[data-pid="${charId}"]`);
    if (btn) { btn.disabled = true; btn.classList.add('applied'); btn.textContent = `✓ ${p.name || charId}`; }
}

// ── GM DICE TRAY ─────────────────────────────
// Roll a standard GM die (shown in the die tray) and add it to the roll feed.
function gmRollDie(sides) {
    const result = Math.floor(Math.random() * sides) + 1;
    const out = document.getElementById('gm-die-result');
    if (out) { out.textContent = `d${sides} → ${result}`; out.style.animation = 'none'; void out.offsetWidth; out.style.animation = 'fadeIn .3s ease'; }
    handleIncomingRoll({ skillName: `d${sides}`, threshold: null, roll: result, success: null, char: 'MJ', bonusMalus: 0, playerId: 'gm' });
}

// ── GM BULK DAMAGE / HEAL ─────────────────────
// Apply a damage amount (with armor reduction) to all online players simultaneously.
function bulkDamageAll() {
    const inp = document.getElementById('bulk-dmg-input');
    const rawDmg = parseInt(inp?.value);
    if (!rawDmg || rawDmg <= 0) return;
    const online = [...players.entries()].filter(([, p]) => p.online !== false);
    online.forEach(([id, p]) => {
        const prot = p.protection?.valeur || 0;
        const dmg = Math.max(0, rawDmg - prot);
        const hpBefore = p.hp ?? p.maxHP ?? 0;
        const hpAfter = Math.max(0, hpBefore - dmg);
        p.hp = hpAfter;
        publishDamage(p.charId, dmg, hpBefore, hpAfter, p.maxHP || hpBefore, p.name);
    });
    if (inp) inp.value = '';
    renderPlayerCards();
    online.forEach(([id]) => triggerCardFx(playerCardEl(id), 'dmg'));
}
// Apply a heal amount to all online players simultaneously.
function bulkHealAll() {
    const inp = document.getElementById('bulk-heal-input');
    const amt = parseInt(inp?.value);
    if (!amt || amt <= 0) return;
    const online = [...players.entries()].filter(([, p]) => p.online !== false);
    online.forEach(([id, p]) => {
        const hpBefore = p.hp ?? 0;
        const hpAfter = Math.min(p.maxHP || hpBefore, hpBefore + amt);
        p.hp = hpAfter;
        publishHeal(p.charId, amt, hpBefore, hpAfter, p.maxHP || hpBefore, p.name);
    });
    if (inp) inp.value = '';
    renderPlayerCards();
    online.forEach(([id]) => triggerCardFx(playerCardEl(id), 'heal'));
}

// ── KARMA ─────────────────────────────────────
const gmKarma = {};
// Increment or decrement a player's karma and broadcast the new value via Ably.
function setPlayerKarma(charId, delta) {
    gmKarma[charId] = (gmKarma[charId] ?? 0) + delta;
    const p = players.get(charId);
    if (p && ablyDamage) {
        ablyDamage.publish('karma-set', { charId: p.charId, karma: gmKarma[charId] });
    }
    renderPlayerCards();
}

// ── MONSTER INLINE DAMAGE / HEAL ─────────────
// Apply damage (with armor reduction) from the monster card inline input.
function monsterInlineDamage(id) {
    const m = monsters.find(m => String(m.id) === String(id)); if (!m) return;
    const inp = monsterCardEl(id)?._refs.dmgInput;
    const dmg = parseInt(inp?.value); if (!dmg || dmg <= 0) return;
    const effective = Math.max(0, dmg - (m.armor || 0));
    m.pv = Math.max(0, m.pv - effective);
    if (inp) inp.value = '';
    saveMonsters();
    clearTimeout(renderMonstersTimer); renderMonstersTimer = setTimeout(renderMonsters, 50);
    setTimeout(() => triggerCardFx(monsterCardEl(m.id), 'dmg'), 70);
}
// Apply heal from the monster card inline input, capping at maxPV.
function monsterInlineHeal(id) {
    const m = monsters.find(m => String(m.id) === String(id)); if (!m) return;
    const inp = monsterCardEl(id)?._refs.healInput;
    const amt = parseInt(inp?.value); if (!amt || amt <= 0) return;
    m.pv = Math.min(m.maxPV, m.pv + amt);
    if (inp) inp.value = '';
    saveMonsters();
    clearTimeout(renderMonstersTimer); renderMonstersTimer = setTimeout(renderMonsters, 50);
    setTimeout(() => triggerCardFx(monsterCardEl(m.id), 'heal'), 70);
}

window.addEventListener('storage', e => {
    if (e.key === 'aria-config') {
        const newCfg = JSON.parse(e.newValue || '{}');
        config = { ...config, ...newCfg };
        applyTheme(!!config.lightMode);
        return;
    }
    // Keep every GM tab agreeing on the kill switch: cam.live() reads it, so two
    // tabs that disagreed would advertise different stream IDs under one clientId and
    // the MJ tile would flip between them on every player's rail (and on the OBS
    // overlay). See cam.syncFromStorage(), which re-renders and republishes presence.
    cam.syncFromStorage(e);
});
// Populate the config modal inputs from the current config and campaign.
function loadConfigInputs() {
    document.getElementById('cfg-light-mode').checked = !!config.lightMode;
    document.getElementById('cfg-vdo-room').value = currentVdoRoom;
    document.getElementById('cfg-vdo-room-password').value = currentVdoRoomPassword;
}
// Save config modal changes: VDO room, theme, and reinitialize Ably/dddice/presence.
function saveConfig() {
    const newVdoRoom = document.getElementById('cfg-vdo-room').value.trim();
    const newVdoRoomPassword = document.getElementById('cfg-vdo-room-password').value.trim();
    config = {
        ...config,
        dddiceTheme: document.getElementById('cfg-dddice-theme').value || '',
        lightMode: document.getElementById('cfg-light-mode').checked,
    };
    localStorage.setItem('aria-config', JSON.stringify(config));
    if (newVdoRoom !== currentVdoRoom || newVdoRoomPassword !== currentVdoRoomPassword) {
        currentVdoRoom = newVdoRoom;
        currentVdoRoomPassword = newVdoRoomPassword;
        const campaigns = getCampaigns();
        const camp = campaigns.find(c => c.id === currentCampaignId);
        if (camp) { camp.vdoRoom = newVdoRoom; camp.vdoRoomPassword = newVdoRoomPassword; saveCampaigns(campaigns); }
    }
    teardownDddice();
    clearTimeout(gmRollSafetyTimer);
    pendingGMRoll = null;
    // Close the old Ably connection before reinit — nulling the refs without closing
    // leaves the old WebSocket subscribed, duplicating every incoming roll/presence.
    if (ablyInstance) { try { ablyInstance.close(); } catch (_) {} }
    ablyInstance = null; ablyRolls = null; ablyRollsHidden = null; ablyCards = null; ablyDamage = null; ablyMusic = null; ablyMap = null;
    if (config.dddiceKey && config.dddiceRoom) initDddice();
    ablyPresence = null; gmPresenceEntered = false;
    if (config.ablyKey) initAbly();   // re-enters presence with the new room
    // No cam.acquireLock() here. The lock is named after currentCampaignId, which
    // this modal cannot change, so we already hold it — and acquireLock() *releases*
    // first, which dropped lockHeld to false for the round-trip of the re-grant. The
    // updateGMPushIframe() below then ran with lockHeld false, blanked the push frame
    // and logged "another tab holds the push lock" at the exact moment the GM had
    // just set the room. Worse, a second GM tab sitting in the queue could take it.
    updateGMPushIframe();
    // Setting or clearing the room changes whether player cards may carry a camera at
    // all. Without this the grid waited for the next presence heartbeat (up to 5s) —
    // 5s of black boxes after a clear, 5s of nothing after a set.
    renderPlayerCards();
    toggleConfig();
}

// Render the card draw history feed.
function renderCardHistory() {
    const feed = document.getElementById('card-history-feed');
    if (!cardHistory.length) { feed.innerHTML = '<div class="rolls-empty">Aucun tirage pour l\'instant…</div>'; return; }
    feed.innerHTML = '';
    cardHistory.forEach(entry => {
        const card = cardById(entry.cardId);
        const label = card ? (card.isJoker ? card.label : `${card.rank} de ${SUIT_FR[card.suit.name] || card.suit.name}`) : entry.cardId;
        const colorCls = card ? (card.isJoker ? 'c-purple' : card.suit.cls) : '';
        const sym = card ? (card.isJoker ? '★' : card.suit.sym) : '?';
        feed.append(el('div', { className: 'card-history-row' },
            el('div', { className: 'chr-player', textContent: entry.playerName || '?' }),
            el('div', { className: `chr-card ${colorCls}`, textContent: `${sym} ${label}` }),
            el('div', { className: 'chr-time',
                textContent: new Date(entry.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) })));
    });
}
// Clear the card draw history from memory and localStorage.
function clearCardHistory() {
    cardHistory = [];
    localStorage.removeItem(cardHistKey());
    renderCardHistory();
}
// Handle a player card draw: log it, animate the card display, and update history.
async function handlePlayerCard(data) {
    if (!data?.cardId) return;
    const card = cardById(data.cardId);
    if (!card) return;
    const label = card.isJoker ? card.label : `${card.rank} de ${SUIT_FR[card.suit.name] || card.suit.name}`;
    const who = data.playerName ? `${data.playerName} — ${label}` : label;
    document.getElementById('gm-card-info').textContent = who;
    cardHistory.unshift({ cardId: data.cardId, playerName: data.playerName || '?', ts: Date.now() });
    localStorage.setItem(cardHistKey(), JSON.stringify(cardHistory));
    insertCardHistory(data.cardId);
    renderCardHistory();
    // `.flipped` = face showing, same as the player panel (see aria-gm.css): show
    // the back, then flip. This used to be written inverted to match a stylesheet
    // whose rotation sat on the other face.
    const flipWrap = document.getElementById('flip-wrap');
    flipWrap.classList.add('hidden');
    flipWrap.classList.remove('flipped');
    document.getElementById('drawn-card').classList.remove('ready');
    renderCardContent(card);
    document.getElementById('drawn-card').classList.add('ready');
    flipWrap.classList.remove('hidden');
    flipWrap.getBoundingClientRect();
    await delay(30);
    flipWrap.classList.add('flipped');
}
// Handle a player deck reshuffle: hide the card display and update the info label.
function handlePlayerReshuffle() {
    const flipWrap = document.getElementById('flip-wrap');
    flipWrap.classList.remove('flipped'); flipWrap.classList.add('hidden');
    document.getElementById('drawn-card').classList.remove('ready');
    document.getElementById('gm-card-info').textContent = 'Jeu mélangé par le joueur';
}

// ═══════════════════════════════════════════
//  GM PRIVATE DECK
// ═══════════════════════════════════════════
// The engine is makeDeck() in aria-shared.js. The GM's deck is private: nothing is
// persisted and nothing is published, so it takes none of the hooks.
const gmDeck = makeDeck({ prefix: 'gm-' });

// Reset the GM private deck to a fresh shuffled state and rebuild its tracker.
function initGmDeck() {
    gmDeck.reset();
    gmDeck.mount();
}

// ═══════════════════════════════════════════
//  GM FILE VIEWER
// ═══════════════════════════════════════════
// Same engine as the player's; the 'gm-' prefix reaches this page's copy of the
// identical markup.
const fileViewer = makeFileViewer({ prefix: 'gm-', files: () => gmFiles });

// ═══════════════════════════════════════════
//  GM ALCHEMY
// ═══════════════════════════════════════════
// Persist GM potion recipes to localStorage and debounce Supabase sync.
function saveGMPotions() { if (currentCampaignId) { localStorage.setItem(potionsKey(), JSON.stringify(gmPotions)); debouncedSyncPotions(); } }

// Add a new GM potion recipe from the add-potion form.
function addGMPotion() {
    const name = document.getElementById('apf-name').value.trim();
    if (!name) { alert('Entrez un nom.'); return; }
    const desc = document.getElementById('apf-desc').value.trim();
    const ingredients = document.getElementById('apf-ingredients').value.trim();
    const successChance = parseInt(document.getElementById('apf-chance').value) || 0;
    const id = uid();
    gmPotions.push({ id, name, desc, ingredients, successChance });
    saveGMPotions();
    ['apf-name', 'apf-desc', 'apf-ingredients', 'apf-chance'].forEach(eid => { const node = document.getElementById(eid); if (node) node.value = ''; });
    renderGMPotions();
}

// Remove a GM potion recipe by ID from the list and Supabase.
function removeGMPotion(id) {
    sbDelete('campaign_potions', 'id=eq.' + encodeURIComponent(id));
    gmPotions = gmPotions.filter(p => p.id !== id);
    saveGMPotions();
    renderGMPotions();
}

// Update a single field of a GM potion recipe and save.
function updateGMPotion(id, field, value) {
    const p = gmPotions.find(p => p.id === id);
    if (!p) return;
    p[field] = value;
    saveGMPotions();
}

// Render all GM potion recipe cards with inline editing inputs.
function renderGMPotions() {
    const list = document.getElementById('gm-pot-list');
    const empty = document.getElementById('gm-pot-empty');
    if (!list) return;
    list.innerHTML = '';
    if (!gmPotions.length) {
        if (empty) { empty.style.display = ''; list.appendChild(empty); }
        return;
    }
    if (empty) empty.style.display = 'none';
    const field = (icon, value, placeholder, key) => el('div', { className: 'gm-pot-field-row' },
        el('span', { className: 'gm-pot-field-icon', textContent: icon }),
        el('input', { className: 'gm-pot-text-input', value, placeholder,
            oninput: e => updateGMPotion(key.id, key.field, e.target.value) }));
    gmPotions.forEach(p => {
        list.append(el('div', { className: 'gm-pot-card' },
            el('div', { className: 'gm-pot-card-header' },
                el('span', { className: 'gm-pot-card-icon', textContent: '◆' }),
                el('input', { className: 'gm-pot-name-input', value: p.name, placeholder: 'Nom',
                    oninput: e => updateGMPotion(p.id, 'name', e.target.value) }),
                el('div', { className: 'gm-pot-chance-wrap' },
                    el('input', { className: 'gm-pot-chance-badge', type: 'text', inputMode: 'numeric',
                        value: p.successChance || '', placeholder: '—',
                        oninput: e => { e.target.value = e.target.value.replace(/[^0-9]/g, ''); updateGMPotion(p.id, 'successChance', +e.target.value || 0); } }),
                    el('span', { className: 'gm-pot-chance-suffix', textContent: '%' }))),
            el('div', { className: 'gm-pot-card-body' },
                field('✦', p.desc || '', 'Description / Effet', { id: p.id, field: 'desc' }),
                field('◈', p.ingredients || '', 'Ingrédients', { id: p.id, field: 'ingredients' })),
            el('button', { className: 'gm-pot-del-btn', textContent: '✕', onclick: () => removeGMPotion(p.id) })));
    });
}

// Toggle the alchemy import picker, listing other campaigns to import from.
function toggleAlchemyImportPicker(btn) {
    const picker = document.getElementById('alchemy-import-picker');
    if (picker.style.display !== 'none') { picker.style.display = 'none'; return; }
    const campaigns = getCampaigns().filter(c => c.id !== currentCampaignId);
    if (!campaigns.length) {
        picker.innerHTML = '<div class="alchemy-import-empty">Aucune autre campagne disponible.</div>';
    } else {
        picker.innerHTML = '';
        campaigns.forEach(c => {
            const b = document.createElement('button');
            b.className = 'alchemy-import-option';
            b.textContent = c.name;
            b.addEventListener('click', () => importAlchemyFrom(c.id, c.name));
            picker.appendChild(b);
        });
    }
    picker.style.display = '';
}

// Replace the current alchemy grimoire with recipes from another campaign.
function importAlchemyFrom(sourceId, sourceName) {
    document.getElementById('alchemy-import-picker').style.display = 'none';
    const sourcePotions = JSON.parse(localStorage.getItem(campKey('potions', sourceId)) || '[]');
    if (!sourcePotions.length) { alert(`Aucune recette dans la campagne "${sourceName}".`); return; }
    if (!confirm(`Remplacer le grimoire actuel par les ${sourcePotions.length} recette(s) de "${sourceName}" ?`)) return;
    gmPotions.forEach(p => sbDelete('campaign_potions', 'id=eq.' + encodeURIComponent(p.id)));
    gmPotions = sourcePotions.map(p => ({
        ...p,
        id: uid()
    }));
    saveGMPotions();
    renderGMPotions();
}

// Grant or revoke a potion recipe for a player via Ably, toggling state.
function sendPotionGrant(charId, potionId) {
    if (!ablyDamage) return;
    const player = players.get(charId);
    if (!player) return;
    if (!player.potionRecipeIds) player.potionRecipeIds = [];
    const alreadyGranted = player.potionRecipeIds.includes(potionId);
    if (alreadyGranted) {
        console.log('[GM] sendPotionGrant: REVOKING potion', potionId, 'from', player.name);
        ablyDamage.publish('potion-revoke', { charId: player.charId, potionId });
        player.potionRecipeIds = player.potionRecipeIds.filter(id => id !== potionId);
    } else {
        const pot = gmPotions.find(p => p.id === potionId);
        if (!pot) return;
        console.log('[GM] sendPotionGrant: GRANTING potion', pot.name, 'to', player.name);
        ablyDamage.publish('potion-grant', { charId: player.charId, potion: { ...pot } });
        player.potionRecipeIds.push(potionId);
    }
    openPlayerDetails(charId);
}
// Send a vial-grant message to give a player a quantity of empty vials.
function sendVialGrant(charId, qty) {
    if (!ablyDamage) return;
    const p = players.get(charId);
    if (!p) return;
    console.log('[GM] sendVialGrant:', qty, 'vials to', p.name);
    ablyDamage.publish('vial-grant', { charId: p.charId, qty });
}

// Render a skill/special percentage for the player-details modal, folding in the
// player's per-skill permanent modifier (s.bonus) and annotating it when non-zero.
// Returns nodes, not markup — the caller appends them, so the values stay text.
function _pdmSkillPct(s) {
    const pct = +s.pct || 0;
    const b = +s.bonus || 0;
    if (!b) return `${pct}%`;
    return [`${pct + b}% `, el('span', { className: 'pdm-skill-mod', title: 'Modificateur permanent',
        textContent: `${b > 0 ? '+' : ''}${b}` })];
}

// Persist GM files to localStorage and debounce Supabase sync.
function saveGmFiles() { localStorage.setItem(filesKey(), JSON.stringify(gmFiles)); debouncedSyncFiles(); }

// Persist the GM music playlists to localStorage and debounce Supabase sync.
function saveGMMusic() {
    if (!currentCampaignId) return;
    localStorage.setItem(musicKey(), JSON.stringify(gmPlaylists));
    debouncedSyncMusic();
}

let musicLoop         = false;
let _musicProgressRaf = null;

// ─── Playlist accessors ───
// gmPlaylists holds named playlists; the UI shows one (activePlaylistId) while
// playback tracks its own playlist (musicPlayingPlaylistId) + index. These helpers
// resolve the right track array for view vs. playback operations.
function _newPlaylist(name) {
    return { id: uid(),
             name: name || 'Playlist', tracks: [] };
}
function _activePlaylist()  { return gmPlaylists.find(p => p.id === activePlaylistId) || gmPlaylists[0] || null; }
function _playingPlaylist() { return gmPlaylists.find(p => p.id === musicPlayingPlaylistId) || null; }
function _activeTracks()    { const p = _activePlaylist();  return p ? p.tracks : []; }
function _playingTracks()   { const p = _playingPlaylist(); return p ? p.tracks : []; }
function _currentTrack()    { const t = _playingTracks(); return (musicCurrentIndex >= 0 && musicCurrentIndex < t.length) ? t[musicCurrentIndex] : null; }
// Flatten every track across all playlists, preserving order (used for flat Supabase sync).
function _allTracks()       { return gmPlaylists.flatMap(p => p.tracks); }
// Guarantee an active playlist exists (creating a default one if needed) and return
// its tracks array — used by the add-track paths so a push never lands nowhere.
function _ensureActivePlaylist() {
    if (!gmPlaylists.length) gmPlaylists.push(_newPlaylist('Playlist'));
    if (!_activePlaylist()) activePlaylistId = gmPlaylists[0].id;
    return _activePlaylist().tracks;
}
// True when the playlist on screen is also the one currently playing.
function _viewingPlayingPlaylist() { return activePlaylistId === musicPlayingPlaylistId; }

// Normalize raw localStorage music data into the playlist shape. Accepts the new
// format (array of {id,name,tracks}) or the legacy flat array of tracks (wraps it
// into a single default playlist). Always returns at least one playlist.
function _normalizeMusicData(raw) {
    let parsed = [];
    try { parsed = JSON.parse(raw || '[]'); } catch(_) { parsed = []; }
    if (!Array.isArray(parsed)) parsed = [];
    let playlists;
    if (parsed.length && parsed[0] && Array.isArray(parsed[0].tracks)) {
        // already playlist format
        playlists = parsed.map(p => ({
            id: p.id || _newPlaylist().id,
            name: p.name || 'Playlist',
            tracks: Array.isArray(p.tracks) ? p.tracks : [],
        }));
    } else {
        // legacy flat track array → one default playlist
        const pl = _newPlaylist('Playlist');
        pl.tracks = parsed.filter(t => t && t.id);
        playlists = [pl];
    }
    if (!playlists.length) playlists = [_newPlaylist('Playlist')];
    return playlists;
}

// Advance to the next track when the current ends; loops or stops based on musicLoop flag.
// Operates on the PLAYING playlist (not whichever the GM is currently viewing).
function _musicAutoAdvance() {
    const tracks = _playingTracks();
    if (!tracks.length) return;
    const nextIdx = (musicCurrentIndex + 1 < tracks.length)
        ? musicCurrentIndex + 1
        : (musicLoop ? 0 : -1);
    if (nextIdx === -1) {
        musicIsPlaying = false;
        if (_musicProgressRaf) { cancelAnimationFrame(_musicProgressRaf); _musicProgressRaf = null; }
        renderMusicTab();
        return;
    }
    _musicTriggerPlay(tracks[nextIdx], nextIdx);
    publishMusicPlay(tracks[nextIdx]);
}

// Start the rAF loop that updates the music progress bar for file-based tracks.
function _startMusicProgress() {
    if (_musicProgressRaf) cancelAnimationFrame(_musicProgressRaf);
    function tick() {
        const track = _currentTrack();
        const progressFill = document.getElementById('music-progress-fill');
        const progressWrap = document.getElementById('music-progress-wrap');
        if (track?.type === 'file') {
            const audio = _musicSlots[_musicCurrentSlot].audio;
            if (progressWrap) progressWrap.style.visibility = 'visible';
            if (progressFill && audio?.duration) progressFill.style.width = (audio.currentTime / audio.duration * 100) + '%';
        } else {
            if (progressWrap) progressWrap.style.visibility = 'hidden';
        }
        if (musicIsPlaying) _musicProgressRaf = requestAnimationFrame(tick);
    }
    _musicProgressRaf = requestAnimationFrame(tick);
}

// Render the music tab: now-playing label, play/loop buttons, volume, playlist chips
// bar, and the rows of the active playlist.
function renderMusicTab() {
    const track = _currentTrack();

    const titleEl = document.getElementById('music-np-title');
    if (titleEl) titleEl.textContent = track ? track.name : 'Aucune piste';

    // Topbar music mini chip (design frame 12) — mirrors the now-playing track.
    const tbChip = document.getElementById('tb-music-chip');
    if (tbChip) {
        tbChip.style.visibility = track ? 'visible' : 'hidden';
        const tbTitle = document.getElementById('tb-music-title');
        if (tbTitle) tbTitle.textContent = track ? track.name : '—';
    }

    // Subtitle showing which playlist the now-playing track belongs to.
    const npPl = document.getElementById('music-np-playlist');
    if (npPl) {
        const playing = _playingPlaylist();
        npPl.textContent = (track && playing) ? '♪ ' + playing.name : '';
    }

    const playBtn = document.getElementById('music-play-btn');
    if (playBtn) playBtn.textContent = musicIsPlaying ? '⏸' : '▶';

    const loopBtn = document.getElementById('music-loop-btn');
    if (loopBtn) loopBtn.classList.toggle('active', musicLoop);

    const volSlider = document.getElementById('music-gm-volume');
    if (volSlider) volSlider.value = String(musicMasterVolume);
    const volVal = document.getElementById('music-gm-vol-val');
    if (volVal) volVal.textContent = String(musicMasterVolume);

    renderPlaylistBar();

    const playlist = document.getElementById('music-playlist');
    if (!playlist) return;

    const tracks = _activeTracks();
    const viewingPlaying = _viewingPlayingPlaylist();

    if (!tracks.length) {
        playlist.innerHTML = '<div class="music-empty">Playlist vide. Ajoutez des fichiers ou des URLs YouTube ci-dessous.</div>';
        return;
    }

    // Track names come from YouTube API responses and uploaded filenames.
    fill(playlist, tracks.map((t, i) => {
        const isCurrent = viewingPlaying && i === musicCurrentIndex;
        return el('div', { className: 'music-track-row' + (isCurrent ? ' active' : '') },
            el('span', { className: 'music-track-indicator', textContent: (isCurrent && musicIsPlaying) ? '▶' : '○' }),
            el('span', { className: 'music-track-name', textContent: t.name, onclick: () => musicSelectTrack(i) }),
            el('span', { className: 'music-track-badge', textContent: t.type === 'youtube' ? 'youtube' : 'fichier' }),
            el('button', { className: 'music-track-rename', title: 'Renommer', textContent: '✎', onclick: () => musicRenameTrack(i) }),
            el('button', { className: 'music-track-delete', textContent: '✕', onclick: () => musicDeleteTrack(i) }));
    }));
}

// ─── Playlist management ───
// Create a new (empty) playlist, make it active, and focus the add field.
function musicAddPlaylist() {
    const name = prompt('Nom de la nouvelle playlist :', 'Playlist ' + (gmPlaylists.length + 1));
    if (name === null) return;
    const pl = _newPlaylist(name.trim() || ('Playlist ' + (gmPlaylists.length + 1)));
    gmPlaylists.push(pl);
    activePlaylistId = pl.id;
    saveGMMusic();
    renderMusicTab();
}

// Switch the playlist shown/edited in the tab (does not affect playback).
function musicSelectPlaylist(id) {
    if (!gmPlaylists.some(p => p.id === id)) return;
    activePlaylistId = id;
    renderMusicTab();
}

// Rename a playlist by id.
function musicRenamePlaylist(id) {
    const pl = gmPlaylists.find(p => p.id === id);
    if (!pl) return;
    const name = prompt('Nouveau nom de la playlist :', pl.name);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === pl.name) return;
    pl.name = trimmed;
    saveGMMusic();
    renderMusicTab();
}

// Delete a playlist (and its tracks) by id. Always keeps at least one playlist.
// If the deleted playlist is the one playing, playback stops.
function musicDeletePlaylist(id) {
    if (gmPlaylists.length <= 1) return;
    const idx = gmPlaylists.findIndex(p => p.id === id);
    if (idx === -1) return;
    const pl = gmPlaylists[idx];
    if (!confirm(`Supprimer la playlist « ${pl.name} » et ses ${pl.tracks.length} piste(s) ?`)) return;
    if (id === musicPlayingPlaylistId) { musicStop(); musicCurrentIndex = -1; musicPlayingPlaylistId = null; }
    // Clean up each track from Supabase + storage.
    pl.tracks.forEach(t => {
        deleteMusicTrackFromDB(t.id);
        if (t.type === 'file' && t.path) deleteMusicFileFromStorage(t.path);
    });
    gmPlaylists.splice(idx, 1);
    if (activePlaylistId === id) activePlaylistId = gmPlaylists[0].id;
    saveGMMusic();
    renderMusicTab();
}

// Launch a playlist: make it active and start it from its first track (local +
// broadcast). This is the "choisir quelle queue lancer" entry point.
function musicLaunchPlaylist(id) {
    const pl = gmPlaylists.find(p => p.id === id);
    if (!pl) return;
    activePlaylistId = id;
    if (!pl.tracks.length) { renderMusicTab(); return; }
    musicSelectTrack(0);   // active == this playlist, so it becomes the playing one
}

// Render the row of playlist chips. The active chip is highlighted and carries
// launch/rename/delete controls; a trailing ＋ button creates a new playlist.
function renderPlaylistBar() {
    const bar = document.getElementById('music-playlist-bar');
    if (!bar) return;
    fill(bar,
        gmPlaylists.map(pl => {
            const isActive = pl.id === activePlaylistId;
            const isPlaying = pl.id === musicPlayingPlaylistId && musicIsPlaying;
            return el('div', { className: 'music-pl-chip' + (isActive ? ' active' : '') + (isPlaying ? ' playing' : '') },
                el('span', { className: 'music-pl-launch', title: 'Lancer cette playlist', textContent: '▶',
                    onclick: () => musicLaunchPlaylist(pl.id) }),
                el('span', { className: 'music-pl-name', textContent: pl.name, onclick: () => musicSelectPlaylist(pl.id) }),
                el('span', { className: 'music-pl-count', textContent: pl.tracks.length }),
                isActive && el('button', { className: 'music-pl-edit', title: 'Renommer', textContent: '✎',
                    onclick: () => musicRenamePlaylist(pl.id) }),
                isActive && el('button', { className: 'music-pl-del', title: 'Supprimer', textContent: '✕',
                    disabled: gmPlaylists.length <= 1, onclick: () => musicDeletePlaylist(pl.id) }));
        }),
        el('button', { className: 'music-pl-add', title: 'Nouvelle playlist', textContent: '＋', onclick: musicAddPlaylist }));
}

// Select and play a track (by index within the ACTIVE playlist) locally and
// broadcast to players via Ably. The active playlist becomes the playing playlist.
function musicSelectTrack(index) {
    const tracks = _activeTracks();
    const track = tracks[index];
    if (!track) return;
    musicPlayingPlaylistId = activePlaylistId;
    _musicTriggerPlay(track, index);  // immediate local playback
    publishMusicPlay(track);          // broadcast to players via Ably
}

// Toggle music playback (play/pause) and broadcast the command to players.
function musicTogglePlay() {
    if (!musicIsPlaying) {
        const track = _currentTrack();
        // Nothing cued: start the active playlist from its first track.
        if (!track) { if (_activeTracks().length) musicSelectTrack(0); return; }
        const slot = _musicCurrentSlot;
        if (_musicSlots[slot].audio) _musicSlots[slot].audio.play().catch(() => {});
        const yt = slot === 'A' ? _ytSlotA : _ytSlotB;
        if (yt) { try { yt.playVideo(); } catch(_) {} }
        musicIsPlaying = true;
        _startMusicProgress();
        publishMusicResume();
    } else {
        const slot = _musicCurrentSlot;
        if (_musicSlots[slot].audio) _musicSlots[slot].audio.pause();
        const yt = slot === 'A' ? _ytSlotA : _ytSlotB;
        if (yt) { try { yt.pauseVideo(); } catch(_) {} }
        musicIsPlaying = false;
        if (_musicProgressRaf) { cancelAnimationFrame(_musicProgressRaf); _musicProgressRaf = null; }
        publishMusicPause();
    }
    renderMusicTab();
}

// Stop music playback on both slots locally and broadcast the stop command.
function musicStop() {
    if (_musicFadeRaf) { cancelAnimationFrame(_musicFadeRaf); _musicFadeRaf = null; }
    if (_musicProgressRaf) { cancelAnimationFrame(_musicProgressRaf); _musicProgressRaf = null; }
    _stopSlot('A');
    _stopSlot('B');
    musicIsPlaying = false;
    renderMusicTab();
    publishMusicStop();
}

// Skip to the next track in the PLAYING playlist (wraps if loop is on).
function musicNext() {
    const tracks = _playingTracks();
    if (!tracks.length) return;
    const next = musicCurrentIndex + 1 < tracks.length
        ? musicCurrentIndex + 1
        : (musicLoop ? 0 : musicCurrentIndex);
    if (next === musicCurrentIndex && !musicLoop && musicCurrentIndex === tracks.length - 1) return;
    _playFromPlayingPlaylist(next);
}

// Skip to the previous track in the PLAYING playlist (wraps if loop is on).
function musicPrev() {
    const tracks = _playingTracks();
    if (!tracks.length) return;
    const prev = musicCurrentIndex > 0
        ? musicCurrentIndex - 1
        : (musicLoop ? tracks.length - 1 : 0);
    _playFromPlayingPlaylist(prev);
}

// Play a track by index within the currently PLAYING playlist (used by next/prev,
// which must stay on the playing playlist even if the GM is viewing another one).
function _playFromPlayingPlaylist(index) {
    const tracks = _playingTracks();
    const track = tracks[index];
    if (!track) return;
    _musicTriggerPlay(track, index);
    publishMusicPlay(track);
}

// Toggle the music loop flag and refresh the tab UI.
function musicToggleLoop() {
    musicLoop = !musicLoop;
    renderMusicTab();
}

// Set the crossfade duration in seconds (1–10).
function musicSetFade(val) {
    const n = parseInt(val);
    if (!isNaN(n) && n >= 1 && n <= 10) musicFadeDuration = n * 1000;
}

// Handle GM volume slider change: persist the value and apply it to the active slot.
function onGMMusicVolumeChange(val) {
    musicMasterVolume = Math.max(0, Math.min(100, parseInt(val) || 0));
    localStorage.setItem('aria-music-volume', String(musicMasterVolume));
    if (musicIsPlaying && !_musicFadeRaf) _setSlotVol(_musicCurrentSlot, musicMasterVolume);
    const volVal = document.getElementById('music-gm-vol-val');
    if (volVal) volVal.textContent = String(musicMasterVolume);
}

// Rename a track in the ACTIVE playlist.
function musicRenameTrack(index) {
    const track = _activeTracks()[index];
    if (!track) return;
    const name = prompt('Nouveau nom de la piste :', track.name);
    if (name === null) return;                 // cancelled
    const trimmed = name.trim();
    if (!trimmed || trimmed === track.name) return;
    track.name = trimmed;
    saveGMMusic();
    syncMusicTrack(track);
    renderMusicTab();   // refreshes the playlist row and the now-playing title
}

// Delete a track from the ACTIVE playlist, stopping it if it is the now-playing
// track, and clean up storage. The musicCurrentIndex only shifts when the playlist
// being edited is also the one currently playing.
function musicDeleteTrack(index) {
    const track = _activeTracks()[index];
    if (!track) return;
    if (_viewingPlayingPlaylist()) {
        if (index === musicCurrentIndex) { musicStop(); musicCurrentIndex = -1; }
        else if (index < musicCurrentIndex) musicCurrentIndex--;
    }
    deleteMusicTrackFromDB(track.id);
    if (track.type === 'file' && track.path) deleteMusicFileFromStorage(track.path);
    _activeTracks().splice(index, 1);
    saveGMMusic();
    renderMusicTab();
}

// Delete an audio file from Supabase Storage (campaign-music bucket).
async function deleteMusicFileFromStorage(path) {
    try {
        await fetch(`${SUPABASE_URL}/storage/v1/object/campaign-music/${path}`, {
            method: 'DELETE',
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        });
    } catch(e) { console.warn('[ARIA] Music storage delete failed:', e); }
}

// Extract a YouTube video ID from a URL or raw 11-char ID string.
function _parseYTVideoId(input) {
    const m = input.match(/(?:youtu\.be\/|[?&]v=|\/embed\/)([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9_-]{11}$/.test(input.trim())) return input.trim();
    return null;
}

// Extract a YouTube playlist ID from a URL query string.
function _parseYTPlaylistId(input) {
    const m = input.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
}

// Fetch a YouTube video title via the Data API or oEmbed fallback.
async function _fetchYTTitle(videoId, apiKey) {
    if (apiKey) {
        try {
            const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(apiKey)}`);
            const data = await res.json();
            const title = data.items?.[0]?.snippet?.title;
            if (title) return title;
        } catch(_) {}
    }
    try {
        const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`);
        const data = await res.json();
        return data.title || videoId;
    } catch(_) { return videoId; }
}

// Fetch all video items from a YouTube playlist via the Data API (paginated).
async function _fetchYTPlaylist(playlistId, apiKey) {
    const tracks = [];
    let pageToken = '';
    try {
        do {
            const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${encodeURIComponent(playlistId)}&maxResults=50&key=${encodeURIComponent(apiKey)}${pageToken ? '&pageToken=' + pageToken : ''}`;
            const res = await fetch(url);
            const data = await res.json();
            if (!data.items) break;
            for (const item of data.items) {
                const videoId = item.snippet?.resourceId?.videoId;
                const title   = item.snippet?.title;
                if (videoId && title !== 'Private video' && title !== 'Deleted video') {
                    tracks.push({ id: uid(), name: title || videoId, type: 'youtube', url: null, youtubeId: videoId, path: null });
                }
            }
            pageToken = data.nextPageToken || '';
        } while (pageToken);
    } catch(e) { console.warn('[ARIA] YT playlist fetch failed:', e); }
    return tracks;
}

// Add a YouTube video or playlist to the GM music playlist from the input field.
async function musicAddYoutube() {
    const input    = document.getElementById('music-yt-input');
    const statusEl = document.getElementById('music-add-status');
    const raw      = (input?.value || '').trim();
    if (!raw) return;

    statusEl.textContent = 'Chargement…';
    const dest = _ensureActivePlaylist();   // tracks added to the active playlist

    const playlistId = _parseYTPlaylistId(raw);
    if (playlistId && playlistId.startsWith('RD')) {
        const videoId = _parseYTVideoId(raw);
        if (!videoId) { statusEl.textContent = '⚠ URL invalide.'; return; }
        const name = await _fetchYTTitle(videoId, config.youtubeApiKey);
        dest.push({ id: uid(), name, type: 'youtube', url: null, youtubeId: videoId, path: null });
        statusEl.textContent = '✓ Piste ajoutée. (Les Mix YouTube ne peuvent pas être importés en entier — seule cette vidéo a été ajoutée.)';
    } else if (playlistId) {
        const apiKey = config.youtubeApiKey;
        if (!apiKey) {
            statusEl.textContent = '⚠ Clé API YouTube manquante — ajoutez-la dans ⚙ Configuration.';
            return;
        }
        const tracks = await _fetchYTPlaylist(playlistId, apiKey);
        if (!tracks.length) { statusEl.textContent = '⚠ Playlist introuvable ou vide.'; return; }
        tracks.forEach(t => dest.push(t));
        statusEl.textContent = `✓ ${tracks.length} piste(s) ajoutée(s).`;
    } else {
        const videoId = _parseYTVideoId(raw);
        if (!videoId) { statusEl.textContent = '⚠ URL ou ID invalide.'; return; }
        const name = await _fetchYTTitle(videoId, config.youtubeApiKey);
        dest.push({ id: uid(), name, type: 'youtube', url: null, youtubeId: videoId, path: null });
        statusEl.textContent = '✓ Piste ajoutée.';
    }

    saveGMMusic();
    renderMusicTab();
    if (input) input.value = '';
    setTimeout(() => { statusEl.textContent = ''; }, 3000);
}

// Upload an audio file to Supabase Storage and add it to the GM music playlist.
async function musicUploadFile(input) {
    const file     = input.files[0];
    input.value    = '';
    if (!file) return;
    const statusEl = document.getElementById('music-add-status');
    if (file.size > 50 * 1024 * 1024) { statusEl.textContent = '⚠ Fichier trop volumineux (max 50 Mo).'; return; }

    statusEl.textContent = 'Téléchargement…';

    try {
        const ext  = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
        const id   = uid();
        const name = file.name.replace(/\.[^.]+$/, '');
        const path = `${currentCampaignId}/${id}${ext ? '.' + ext : ''}`;
        const res  = await fetch(`${SUPABASE_URL}/storage/v1/object/campaign-music/${path}`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': file.type || 'audio/mpeg',
                'x-upsert': 'false',
            },
            body: file,
        });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || `Erreur ${res.status}`); }
        const url = `${SUPABASE_URL}/storage/v1/object/public/campaign-music/${path}`;
        _ensureActivePlaylist().push({ id, name, type: 'file', url, youtubeId: null, path });
        saveGMMusic();
        renderMusicTab();
        statusEl.textContent = '✓ Fichier ajouté.';
        setTimeout(() => { statusEl.textContent = ''; }, 3000);
    } catch(e) {
        statusEl.textContent = `⚠ Erreur : ${e.message}`;
        console.warn('[ARIA] Music upload failed:', e);
    }
}

// ═══════════════════════════════════════════
//  NOTES MJ
// ═══════════════════════════════════════════
// The engine is makeNotes() in aria-shared.js; this is just the campaign-scoped
// wiring. The HTML calls gmNotes.add() / gmNotes.save() / gmNotes.rename() directly.
const gmNotes = makeNotes({
    key: gmNotesKey,
    ids: { list: 'gm-notes-list', name: 'gm-notes-name-input', area: 'gm-notes-area' },
    sync:     (note, pos) => syncGMNote(note, pos),
    syncSoon: (note, pos) => debouncedSyncGMNote(note, pos),
    remove:   id => deleteGMNoteFromDB(id),
});

// Upload a file to Supabase Storage (campaign-files bucket) and return its URL and path.
async function uploadFileToStorage(file) {
    const fileId = uid();
    const parts = file.name.split('.');
    const ext = parts.length > 1 ? parts.pop().toLowerCase() : '';
    const storageName = ext ? `${fileId}.${ext}` : fileId;
    const path = `${currentCampaignId}/${storageName}`;
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/campaign-files/${path}`, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': file.type || 'application/octet-stream',
            'x-upsert': 'false',
        },
        body: file,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Erreur ${res.status}`);
    }
    return { fileId, path, url: `${SUPABASE_URL}/storage/v1/object/public/campaign-files/${path}` };
}

// Delete a file from Supabase Storage (campaign-files bucket) by path.
async function deleteFileFromStorage(path) {
    try {
        await fetch(`${SUPABASE_URL}/storage/v1/object/campaign-files/${path}`, {
            method: 'DELETE',
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        });
    } catch(e) { console.warn('[ARIA] Storage delete failed:', e); }
}

// Handle a file upload input: upload to Supabase Storage, add to gmFiles, and re-render.
async function handleFileUpload(input) {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { alert('Fichier trop volumineux (max 50 Mo).'); return; }
    const btn = document.getElementById('file-upload-btn');
    const progress = document.getElementById('file-upload-progress');
    if (btn) btn.disabled = true;
    if (progress) { progress.style.display = ''; progress.textContent = 'Envoi en cours…'; progress.className = 'gm-files-progress'; }
    try {
        const { fileId, path, url } = await uploadFileToStorage(file);
        gmFiles.push({ id: fileId, name: file.name, type: file.type || 'application/octet-stream', path, url, grantedTo: [] });
        // When a group filter is active, the new file joins that group.
        if (activeFileGroupId) { fileGroupAssign[fileId] = activeFileGroupId; saveFileGroups(); }
        saveGmFiles();
        renderGmFiles();
        if (progress) { progress.textContent = '✓ Fichier ajouté.'; setTimeout(() => { progress.style.display = 'none'; }, 2500); }
    } catch(e) {
        if (progress) { progress.textContent = `Erreur : ${e.message}`; progress.className = 'gm-files-progress error'; setTimeout(() => { progress.style.display = 'none'; }, 4000); }
        console.error('[ARIA] Upload error:', e);
    } finally {
        if (btn) btn.disabled = false;
    }
}

// Remove a GM file: revoke from all players, delete from storage and Supabase, re-render.
async function removeGmFile(fileId) {
    const f = gmFiles.find(f => f.id === fileId);
    if (!f) return;
    if (ablyDamage) ablyDamage.publish('file-revoke', { charId: 'all', fileId });
    await deleteFileFromStorage(f.path);
    sbDelete('campaign_files', 'id=eq.' + encodeURIComponent(fileId));
    gmFiles = gmFiles.filter(f => f.id !== fileId);
    if (fileGroupAssign[fileId]) { delete fileGroupAssign[fileId]; saveFileGroups(); }
    saveGmFiles();
    renderGmFiles();
}

// Toggle a file's access: grant to all online players or revoke global access.
function grantFileToAll(fileId) {
    const f = gmFiles.find(f => f.id === fileId);
    if (!f) return;
    if (f.grantedTo === 'all') {
        console.log('[GM] grantFileToAll: REVOKING', f.name, 'from all');
        f.grantedTo = [];
        if (ablyDamage) ablyDamage.publish('file-revoke', { charId: 'all', fileId });
    } else {
        console.log('[GM] grantFileToAll: GRANTING', f.name, 'to all online players');
        f.grantedTo = 'all';
        if (ablyDamage) {
            players.forEach(p => {
                if (p.online !== false) {
                    ablyDamage.publish('file-grant', { charId: p.charId, file: { id: f.id, name: f.name, type: f.type, url: f.url } });
                }
            });
        }
    }
    saveGmFiles();
    renderGmFiles();
}

// Grant or revoke a file for a specific player, toggling their access.
function grantFileToPlayer(fileId, charId) {
    const f = gmFiles.find(f => f.id === fileId);
    const p = players.get(charId);
    if (!f || !p) return;
    if (f.grantedTo === 'all') { openPlayerDetails(charId); return; }
    if (!Array.isArray(f.grantedTo)) f.grantedTo = [];
    if (f.grantedTo.includes(charId)) {
        console.log('[GM] grantFileToPlayer: REVOKING', f.name, 'from', p.name);
        f.grantedTo = f.grantedTo.filter(id => id !== charId);
        if (ablyDamage) ablyDamage.publish('file-revoke', { charId: p.charId, fileId });
    } else {
        console.log('[GM] grantFileToPlayer: GRANTING', f.name, 'to', p.name);
        f.grantedTo.push(charId);
        if (ablyDamage) ablyDamage.publish('file-grant', { charId: p.charId, file: { id: f.id, name: f.name, type: f.type, url: f.url } });
    }
    saveGmFiles();
    openPlayerDetails(charId);
}

// Send all applicable file-grant messages to a newly connected player.
function sendFileGrantsToPlayer(playerData) {
    if (!ablyDamage) return;
    const grants = [];
    for (const f of gmFiles) {
        const shouldGrant = f.grantedTo === 'all' || (Array.isArray(f.grantedTo) && f.grantedTo.includes(playerData.charId));
        if (shouldGrant) {
            grants.push(f.name);
            ablyDamage.publish('file-grant', { charId: playerData.charId, file: { id: f.id, name: f.name, type: f.type, url: f.url } });
        }
    }
    if (grants.length) console.log('[GM] sendFileGrantsToPlayer:', playerData.name, '| files:', grants.join(', '));
}

// Render all GM files as cards with access status, open, grant-all, and delete buttons.
function renderGmFiles() {
    const list = document.getElementById('gm-files-list');
    const empty = document.getElementById('gm-files-empty');
    if (!list) return;
    list.innerHTML = '';
    if (activeFileGroupId && !fileGroups.some(g => g.id === activeFileGroupId)) activeFileGroupId = null;
    _renderGroupBar('file');
    const files = activeFileGroupId
        ? gmFiles.filter(f => fileGroupAssign[f.id] === activeFileGroupId)
        : gmFiles;
    if (!files.length) {
        if (empty) {
            empty.textContent = gmFiles.length
                ? 'Aucun fichier dans ce groupe.'
                : 'Aucun fichier. Ajoutez des documents pour les partager avec vos joueurs.';
            empty.style.display = ''; list.appendChild(empty);
        }
        return;
    }
    if (empty) empty.style.display = 'none';
    files.forEach(f => {
        const isAll = f.grantedTo === 'all';
        const count = isAll ? 'Tous' : (Array.isArray(f.grantedTo) ? f.grantedTo.length : 0);
        const grantLabel = isAll ? 'Tous les joueurs' : (count > 0 ? `${count} joueur(s)` : 'Aucun accès');
        const gName = fileGroupAssign[f.id] ? (fileGroups.find(g => g.id === fileGroupAssign[f.id]) || {}).name : '';
        list.append(el('div', { className: 'gm-file-card' },
            el('span', { className: 'group-grip', draggable: true, title: 'Glisser vers un groupe', textContent: '⠿',
                ondragstart: e => _groupDragStart(e, f.id, 'file'), ondragend: e => _groupDragEnd(e) }),
            el('div', { className: 'gm-file-icon', textContent: fileIcon(f.type) }),
            el('div', { className: 'gm-file-info' },
                el('div', { className: 'gm-file-name', textContent: f.name }),
                el('div', { className: 'gm-file-grant-status', textContent: grantLabel },
                    gName && el('span', { className: 'group-badge', textContent: ' ' + gName }))),
            el('div', { className: 'gm-file-actions' },
                el('button', { className: 'gm-file-open-btn', title: 'Ouvrir', textContent: 'Ouvrir', onclick: () => fileViewer.open(f.id) }),
                el('button', { className: 'gm-file-btn' + (isAll ? ' active' : ''), textContent: 'Tous',
                    title: isAll ? 'Révoquer accès global' : 'Accorder à tous', onclick: () => grantFileToAll(f.id) }),
                el('button', { className: 'gm-file-del-btn', title: 'Supprimer', textContent: '✕', onclick: () => removeGmFile(f.id) }))));
    });
}

// ═══════════════════════════════════════════
//  CARTE
// ═══════════════════════════════════════════

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

// The map frame: a shrink-wrapping container around the image, plus whatever layers the
// caller passes. Frame and image both cap at 100% of the stage, so the frame is exactly the
// rendered image — which is what makes the percentage coordinates land on the right pixel
// whatever the pane's aspect ratio.
function _mapFrame(m, ...layers) {
    return el('div', { className: 'aria-frame', id: 'map-frame' },
        el('img', { className: 'aria-map', src: m.imageUrl, alt: m.name, draggable: false }),
        ...layers);
}

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

// The pin layer: one element per POI, positioned in percentages. Names arrive from the GM
// but tokens carry player names taken from presence, so everything is built with el() and
// textContent — never a string template.
function _mapPinLayer(m) {
    const layer = el('div', { className: 'map-pins' });
    // Table view goes through the very same filter the overlay uses, so the preview
    // cannot lie about what the table sees.
    const list = mapTableView ? visiblePois(buildMapState(), null) : m.pois;
    list.forEach(p => {
        const discovered = (p.discoveredBy || []).length > 0;
        const pin = el('div', {
            className: 'map-pin' + (discovered ? ' discovered' : '') + (p.id === mapSelectedPoiId ? ' selected' : ''),
            style: { left: p.x + '%', top: p.y + '%' },
            onpointerdown: e => _mapDragPin(e, p),
        },
            el('span', { className: 'map-pin-dot' }),
            el('span', { className: 'map-pin-label', textContent: p.name }),
            el('div', { className: 'map-tokens' },
                Object.keys(m.positions)
                    // A charId left in positions after the character left the campaign is not
                    // in `players`, so no token is drawn for it — nothing to clean up.
                    .filter(cid => m.positions[cid] === p.id && players.has(cid))
                    .map(cid => el('span', { className: 'map-token', textContent: players.get(cid).name || '?' }))));
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
            oninput: e => { poi.gmNote = e.target.value; saveMaps(); } }),
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
                onclick: () => mapBringHere(pl.charId, poi.id) }))));
}

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
            onclick: () => window.open(m.sourceUrl, '_blank', 'noopener') }),
        el('button', { className: 'gm-btn ghost' + (mapTableView ? ' active' : ''), textContent: 'Vue table',
            onclick: () => { mapTableView = !mapTableView; renderMapTab(); } }));

    if (!m.imageUrl) {
        fill(stage, el('div', { className: 'map-empty', textContent: 'Aucune image. Importez-en une ou générez-en une.' }));
        return;
    }
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
}

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
