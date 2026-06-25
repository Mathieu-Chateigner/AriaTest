// ═══════════════════════════════════════════
//  CARD CONSTANTS
// ═══════════════════════════════════════════
const SUITS = [
    { name: 'spades', sym: '♠', cls: 'c-black', pillCls: '' },
    { name: 'clubs', sym: '♣', cls: 'c-black', pillCls: '' },
    { name: 'hearts', sym: '♥', cls: 'c-red', pillCls: 'c-red' },
    { name: 'diamonds', sym: '♦', cls: 'c-red', pillCls: 'c-red' },
];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUIT_FR = { spades: 'Pique', clubs: 'Trèfle', hearts: 'Cœur', diamonds: 'Carreau' };
const ALL_CARDS = [];
for (const s of SUITS) for (const r of RANKS) ALL_CARDS.push({ id: `${r}-${s.name}`, rank: r, suit: s });
ALL_CARDS.push({ id: 'joker-red', isJoker: true, jokerColor: 'red', label: 'Joker Rouge' });
ALL_CARDS.push({ id: 'joker-black', isJoker: true, jokerColor: 'black', label: 'Joker Noir' });
// Look up a card in ALL_CARDS by its ID string.
function cardById(id) { return ALL_CARDS.find(c => c.id === id); }
// Fisher-Yates shuffle of an array, returning a new array.
function shuffle(a) { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[b[i], b[j]] = [b[j], b[i]]; } return b; }
// Build a freshly shuffled deck of all 54 cards.
function buildDeck() { return shuffle([...ALL_CARDS]); }

// ═══════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════
let config = JSON.parse(localStorage.getItem('aria-config') || '{}');
if (config.lightMode) document.body.classList.add('light-mode');
let ablyInstance = null, ablyRolls = null, ablyCards = null, ablyDamage = null, ablyRollsHidden = null;
let dddiceSDK = null;            // ThreeDDice SDK instance
let dddiceAPI = null;            // { theme } once connected
let pendingGMRoll = null;        // { name, threshold, atk } for GM rolls in progress
let dddiceResizeHandler = null;  // stored so we can remove it before re-registering

// Players presence map: charId (stable UUID) -> {playerId,name,charClass,hp,maxHP,stats,ts,...}
const players = new Map();
const PRESENCE_TIMEOUT = 30000; // 30s offline threshold

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
let sweepIntervalId = null;
let gmPresenceIntervalId = null;
let currentVdoRoom = '';
let currentVdoRoomPassword = '';
let gmSelfViewStream = null;
let gmClickHandlerRegistered = false;
let renderPlayerCardsTimer = null;
let renderMonstersTimer = null;
let gmPotions = [];
let gmFiles = [];
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
const filesGrantedSessions = new Set();
let saveKey        = localStorage.getItem('aria-save-key') || null;
let _pendingNewKey = null;

// ═══════════════════════════════════════════
//  CLOUD SAVE — RELATIONAL SYNC
// ═══════════════════════════════════════════
// Check whether a save key is set (required for all Supabase writes).
function _supabaseReady() { return !!saveKey; }
// Return the current UTC time as an ISO 8601 string.
function _nowISO() { return new Date().toISOString(); }

// Upsert campaign metadata (name, join code, VDO room) to Supabase. Returns true if successful.
async function syncCampaign(camp) {
    if (!_supabaseReady()) return false;
    return await sbUpsert('campaigns', { id: camp.id, save_key: saveKey, name: camp.name, join_code: camp.joinCode || null, vdo_room: camp.vdoRoom || null, vdo_room_password: camp.vdoRoomPassword || null, aria_type: camp.ariaType || 'ancient', updated_at: _nowISO() });
}

// Upsert a single monster's stats and attacks to Supabase.
async function syncMonster(m) {
    if (!_supabaseReady() || !currentCampaignId) return;
    await sbUpsert('monsters', { id: String(m.id), campaign_id: currentCampaignId, name: m.name, pv: m.pv, max_pv: m.maxPV, armor: m.armor || 0, stats: m.stats || null, attacks: m.attacks || null, updated_at: _nowISO() });
}

let _monstersTimer = null;
// Debounced sync of all monsters for the current campaign.
function debouncedSyncMonsters() {
    clearTimeout(_monstersTimer);
    _monstersTimer = setTimeout(() => { if (_supabaseReady() && currentCampaignId) Promise.all(monsters.map(m => syncMonster(m))); }, 800);
}

// Insert a new roll entry into the campaign_rolls table.
async function insertRoll(data) {
    if (!_supabaseReady() || !currentCampaignId) return;
    await sbInsert('campaign_rolls', { campaign_id: currentCampaignId, skill_name: data.skillName || '', threshold: data.threshold ?? null, roll: data.roll, success: !!data.success, char_name: data.char || data.playerId || '', bonus_malus: data.bonusMalus || 0, created_at: _nowISO() });
}

// Insert a new card draw entry into the campaign_card_history table.
async function insertCardHistory(cardId) {
    if (!_supabaseReady() || !currentCampaignId) return;
    await sbInsert('campaign_card_history', { campaign_id: currentCampaignId, card_id: cardId, drawn_at: _nowISO() });
}

// Upsert a GM potion recipe to the campaign_potions table.
async function syncPotion(p) {
    if (!_supabaseReady() || !currentCampaignId) return;
    await sbUpsert('campaign_potions', { id: p.id, campaign_id: currentCampaignId, name: p.name, description: p.desc || '', ingredients: p.ingredients || null, success_chance: p.successChance || 0, updated_at: _nowISO() });
}

let _potionsTimer = null;
// Debounced sync of all GM potion recipes for the current campaign.
function debouncedSyncPotions() {
    clearTimeout(_potionsTimer);
    _potionsTimer = setTimeout(() => { if (_supabaseReady() && currentCampaignId) Promise.all(gmPotions.map(p => syncPotion(p))); }, 800);
}

// Upsert a campaign file record (URL, grants) to Supabase.
async function syncFile(f) {
    if (!_supabaseReady() || !currentCampaignId) return;
    await sbUpsert('campaign_files', { id: f.id, campaign_id: currentCampaignId, name: f.name, type: f.type || '', url: f.url || '', path: f.path || '', granted_to: f.grantedTo || [], updated_at: _nowISO() });
}

let _filesTimer = null;
// Debounced sync of all campaign files.
function debouncedSyncFiles() {
    clearTimeout(_filesTimer);
    _filesTimer = setTimeout(() => { if (_supabaseReady() && currentCampaignId) Promise.all(gmFiles.map(f => syncFile(f))); }, 800);
}

// Upsert a music track record to the campaign_music table.
async function syncMusicTrack(t) {
    if (!_supabaseReady() || !currentCampaignId) return;
    const pos = _allTracks().findIndex(x => x.id === t.id);
    await sbUpsert('campaign_music', {
        id: t.id, campaign_id: currentCampaignId, name: t.name,
        type: t.type, url: t.url || null, youtube_id: t.youtubeId || null,
        path: t.path || null, position: pos >= 0 ? pos : 0, updated_at: _nowISO(),
    });
}

let _musicSyncTimer = null;
// Debounced sync of all music tracks for the current campaign.
function debouncedSyncMusic() {
    clearTimeout(_musicSyncTimer);
    _musicSyncTimer = setTimeout(() => {
        if (_supabaseReady() && currentCampaignId) Promise.all(_allTracks().map(t => syncMusicTrack(t)));
    }, 800);
}

// Delete a music track from the campaign_music table by ID.
async function deleteMusicTrackFromDB(id) {
    if (!_supabaseReady()) return;
    await sbDelete('campaign_music', 'id=eq.' + encodeURIComponent(id));
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

// Upsert a GM note to the campaign_notes table.
async function syncGMNote(note) {
    if (!_supabaseReady() || !currentCampaignId) return;
    const pos = gmNotesList.findIndex(n => n.id === note.id);
    await sbUpsert('campaign_notes', { id: note.id, campaign_id: currentCampaignId, name: note.name || 'Note', content: note.content || '', position: pos >= 0 ? pos : 0, updated_at: _nowISO() });
}

let _gmNoteTimer = null;
// Debounced sync of a single GM note.
function debouncedSyncGMNote(note) { clearTimeout(_gmNoteTimer); _gmNoteTimer = setTimeout(() => syncGMNote(note), 800); }

// Delete a GM note from Supabase by ID.
async function deleteGMNoteFromDB(id) {
    if (!_supabaseReady()) return;
    await sbDelete('campaign_notes', 'id=eq.' + encodeURIComponent(id));
}

// Upsert a known player record for this campaign to Supabase.
async function syncKnownPlayer(charId, data) {
    if (!_supabaseReady() || !currentCampaignId) return;
    const camp = getCampaigns().find(c => c.id === currentCampaignId);
    if (camp) {
        const ok = await syncCampaign(camp);
        if (!ok) return; // campaign FK must exist first; skip to avoid cascade error
    }
    await sbUpsert('campaign_known_players', { id: charId + ':' + currentCampaignId, campaign_id: currentCampaignId, char_id: charId, data, updated_at: _nowISO() }, 'campaign_id,char_id');
}

// Full sync of ALL GM data across every campaign to Supabase.
async function _syncAllGMData() {
    if (!_supabaseReady()) return;
    await sbUpsert('saves', { save_key: saveKey, type: 'gm' });
    const campaigns = getCampaigns();
    await Promise.all(campaigns.map(c => syncCampaign(c)));
    const now = _nowISO();
    for (const c of campaigns) {
        const cid = c.id;
        const mons = JSON.parse(localStorage.getItem('aria-gm-monsters-' + cid) || '[]');
        await Promise.all(mons.map(m => sbUpsert('monsters', {
            id: String(m.id), campaign_id: cid, name: m.name, pv: m.pv, max_pv: m.maxPV,
            armor: m.armor || 0, stats: m.stats || null, attacks: m.attacks || null, updated_at: now,
        })));
        const pots = JSON.parse(localStorage.getItem('aria-gm-potions-' + cid) || '[]');
        await Promise.all(pots.map(p => sbUpsert('campaign_potions', {
            id: p.id, campaign_id: cid, name: p.name, description: p.desc || '',
            ingredients: p.ingredients || null, success_chance: p.successChance || 0, updated_at: now,
        })));
        const files = JSON.parse(localStorage.getItem('aria-gm-files-' + cid) || '[]');
        await Promise.all(files.map(f => sbUpsert('campaign_files', {
            id: f.id, campaign_id: cid, name: f.name, type: f.type || '',
            url: f.url || '', path: f.path || '', granted_to: f.grantedTo || [], updated_at: now,
        })));
        // Music is stored as playlists locally but synced flat (campaign_music has no
        // playlist column); flatten across playlists, preserving order.
        const musicPlaylists = _normalizeMusicData(localStorage.getItem('aria-gm-music-' + cid));
        const musicTracks = musicPlaylists.flatMap(p => p.tracks);
        await Promise.all(musicTracks.map((t, i) => sbUpsert('campaign_music', {
            id: t.id, campaign_id: cid, name: t.name, type: t.type,
            url: t.url || null, youtube_id: t.youtubeId || null, path: t.path || null,
            position: i, updated_at: now,
        })));
        const rawNotes = localStorage.getItem('aria-gm-notes-' + cid);
        let notes = [];
        if (rawNotes) { try { const p = JSON.parse(rawNotes); notes = Array.isArray(p) ? p : []; } catch(e) {} }
        await Promise.all(notes.map((n, i) => sbUpsert('campaign_notes', {
            id: n.id, campaign_id: cid, name: n.name || 'Note',
            content: n.content || '', position: i, updated_at: now,
        })));
        const kp = JSON.parse(localStorage.getItem('aria-gm-known-players-' + cid) || '{}');
        await Promise.all(Object.values(kp).map(p => {
            if (!p?.charId) return Promise.resolve();
            return sbUpsert('campaign_known_players', {
                id: p.charId + ':' + cid, campaign_id: cid, char_id: p.charId,
                data: p, updated_at: now,
            }, 'campaign_id,char_id');
        }));
    }
}

// Load all GM data from Supabase into localStorage for the current save key.
async function loadFromSupabase() {
    if (!_supabaseReady()) return;
    await runMigration(saveKey, 'gm');
    try {
        const camps = await sbSelect('campaigns', 'save_key=eq.' + encodeURIComponent(saveKey) + '&select=id,name,join_code,vdo_room,vdo_room_password,aria_type');
        if (!camps.length) return;
        const campaigns = camps.map(c => ({ id: c.id, name: c.name, joinCode: c.join_code, vdoRoom: c.vdo_room || '', vdoRoomPassword: c.vdo_room_password || '', ariaType: c.aria_type || 'ancient' }));
        localStorage.setItem('aria-gm-campaigns', JSON.stringify(campaigns));
        for (const c of campaigns) {
            const [mons, pots, files, kp, notes, music] = await Promise.all([
                sbSelect('monsters', 'campaign_id=eq.' + encodeURIComponent(c.id) + '&select=*'),
                sbSelect('campaign_potions', 'campaign_id=eq.' + encodeURIComponent(c.id) + '&select=*'),
                sbSelect('campaign_files', 'campaign_id=eq.' + encodeURIComponent(c.id) + '&select=*'),
                sbSelect('campaign_known_players', 'campaign_id=eq.' + encodeURIComponent(c.id) + '&select=*'),
                sbSelect('campaign_notes', 'campaign_id=eq.' + encodeURIComponent(c.id) + '&select=*&order=position.asc'),
                sbSelect('campaign_music', 'campaign_id=eq.' + encodeURIComponent(c.id) + '&select=*&order=position.asc'),
            ]);
            if (mons.length) localStorage.setItem('aria-gm-monsters-' + c.id, JSON.stringify(mons.map(m => ({ id: m.id, name: m.name, pv: m.pv, maxPV: m.max_pv, armor: m.armor || 0, stats: m.stats || {}, attacks: m.attacks || [] }))));
            if (pots.length) localStorage.setItem('aria-gm-potions-' + c.id, JSON.stringify(pots.map(p => ({ id: p.id, name: p.name, desc: p.description, ingredients: p.ingredients, successChance: p.success_chance }))));
            if (files.length) localStorage.setItem('aria-gm-files-' + c.id, JSON.stringify(files.map(f => ({ id: f.id, name: f.name, type: f.type, url: f.url, path: f.path, grantedTo: f.granted_to || [] }))));
            if (kp.length) {
                const obj = {};
                kp.forEach(row => { if (row.char_id) obj[row.char_id] = row.data; });
                localStorage.setItem('aria-gm-known-players-' + c.id, JSON.stringify(obj));
            }
            if (notes.length) localStorage.setItem('aria-gm-notes-' + c.id, JSON.stringify(notes.map(n => ({ id: n.id, name: n.name, content: n.content }))));
            if (music.length) {
                const dbTracks = music.map(t => ({ id: t.id, name: t.name, type: t.type, url: t.url, youtubeId: t.youtube_id, path: t.path }));
                localStorage.setItem('aria-gm-music-' + c.id, JSON.stringify(_mergeMusicGrouping('aria-gm-music-' + c.id, dbTracks)));
            }
        }
    } catch(e) { console.warn('[ARIA] GM load failed:', e); }
}

// Show the save-key creation panel with a freshly generated key.
function showGateway() {
    _pendingNewKey = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    document.getElementById('gateway-key-display').textContent = _pendingNewKey;
    document.getElementById('gateway-new').style.display = '';
    document.getElementById('gateway-existing').style.display = 'none';
    document.getElementById('file-gateway').style.display = 'flex';
}

// Switch the gateway panel to the "enter an existing key" form.
function showGatewayExisting() {
    document.getElementById('gateway-new').style.display = 'none';
    document.getElementById('gateway-existing').style.display = '';
    const input = document.getElementById('gateway-key-input');
    if (input) { input.value = ''; input.focus(); }
}

// Hide the file-gateway panel.
function hideGateway() {
    document.getElementById('file-gateway').style.display = 'none';
}

// Copy the displayed save key to the clipboard.
function copyGatewayKey() {
    const key = document.getElementById('gateway-key-display').textContent;
    navigator.clipboard.writeText(key).catch(() => {});
    const btn = document.getElementById('gateway-copy-btn');
    if (btn) { btn.textContent = 'Copié !'; setTimeout(() => { btn.textContent = 'Copier'; }, 2000); }
}

// Confirm new save key creation: persist it, create the Supabase row, and sync data.
async function confirmNewKey() {
    if (!_pendingNewKey) return;
    saveKey = _pendingNewKey;
    localStorage.setItem('aria-save-key', saveKey);
    await sbUpsert('saves', { save_key: saveKey, type: 'gm' });
    await _syncAllGMData();
    hideGateway();
    showSelectionScreen();
}

// Load data from Supabase using an existing save key entered by the user.
async function submitExistingKey() {
    const input = document.getElementById('gateway-key-input');
    const key = input ? input.value.trim() : '';
    if (!key) return;
    saveKey = key;
    localStorage.setItem('aria-save-key', key);
    await loadFromSupabase();
    hideGateway();
    showSelectionScreen();
}

// Update the save-key status label on the campaign selection screen.
function updateSaveKeyStatus() {
    const label = document.getElementById('sel-save-label');
    if (!label) return;
    label.textContent = saveKey ? saveKey.slice(0, 8) + '…' : '—';
    label.className = 'sel-save-label' + (saveKey ? ' connected' : '');
}

// Show the existing-key form so the user can switch save keys.
function changeSaveKey() {
    showGatewayExisting();
    document.getElementById('file-gateway').style.display = 'flex';
}

// Copy the current save key to the clipboard.
function copySaveKey() {
    if (!saveKey) return;
    navigator.clipboard.writeText(saveKey).catch(() => {});
    const btns = document.querySelectorAll('.sel-save-btn');
    const copyBtn = [...btns].find(b => b.textContent === 'Copier');
    if (copyBtn) { copyBtn.textContent = 'Copié !'; setTimeout(() => { copyBtn.textContent = 'Copier'; }, 2000); }
}

// Cancel key entry: hide the gateway if a key exists, else show the creation panel.
function cancelGateway() {
    if (saveKey) { hideGateway(); } else { showGateway(); }
}

// On load: restore from Supabase if a save key exists, otherwise show the gateway.
async function tryRestoreSupabase() {
    if (!saveKey) { showGateway(); return; }
    await loadFromSupabase();
    hideGateway();
    showSelectionScreen();
    _syncAllGMData();
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
function monstersKey()      { return 'aria-gm-monsters-'      + currentCampaignId; }
// Return the campaign-scoped localStorage key for rolls.
function rollsKey()         { return 'aria-gm-rolls-'          + currentCampaignId; }
// Return the campaign-scoped localStorage key for card history.
function cardHistKey()      { return 'aria-gm-card-history-'   + currentCampaignId; }
// Return the campaign-scoped localStorage key for potion recipes.
function potionsKey()       { return 'aria-gm-potions-'        + currentCampaignId; }
// Return the campaign-scoped localStorage key for known players.
function knownPlayersKey()  { return 'aria-gm-known-players-'  + currentCampaignId; }
// Return the campaign-scoped localStorage key for files.
function filesKey()         { return 'aria-gm-files-'          + currentCampaignId; }
// Return the campaign-scoped localStorage key for monster groups.
function monsterGroupsKey() { return 'aria-gm-monster-groups-' + currentCampaignId; }
// Return the campaign-scoped localStorage key for file groups.
function fileGroupsKey()    { return 'aria-gm-file-groups-'    + currentCampaignId; }
// Return the campaign-scoped localStorage key for GM notes.
function gmNotesKey()       { return 'aria-gm-notes-'          + currentCampaignId; }
// Return the campaign-scoped localStorage key for the music playlist.
function musicKey()         { return 'aria-gm-music-'          + currentCampaignId; }

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
    const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
    saveCampaigns([{ id, name: 'Campagne 1', joinCode: generateJoinCode() }]);
    if (oldMonsters) localStorage.setItem('aria-gm-monsters-' + id, oldMonsters);
    if (oldRolls)    localStorage.setItem('aria-gm-rolls-' + id, oldRolls);
    if (oldCards)    localStorage.setItem('aria-gm-card-history-' + id, oldCards);
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
    monsters    = JSON.parse(localStorage.getItem(monstersKey())  || '[]');
    rollFeed    = JSON.parse(localStorage.getItem(rollsKey())     || '[]');
    cardHistory = JSON.parse(localStorage.getItem(cardHistKey()) || '[]');
    gmPotions   = JSON.parse(localStorage.getItem(potionsKey())  || '[]');
    gmFiles     = JSON.parse(localStorage.getItem(filesKey())    || '[]');
    loadMonsterGroups();
    loadFileGroups();
    gmPlaylists = _normalizeMusicData(localStorage.getItem(musicKey()));
    activePlaylistId = gmPlaylists[0] ? gmPlaylists[0].id : null;
    musicPlayingPlaylistId = null;
    musicCurrentIndex = -1;
    players.clear();
    const knownRaw = JSON.parse(localStorage.getItem(knownPlayersKey()) || '{}');
    Object.entries(knownRaw).forEach(([, p]) => {
        if (!p.charId) return;
        players.set(p.charId, { ...p, online: false });
    });
    console.log('[GM] loadCampaignState:', camp.name, '| joinCode:', currentJoinCode, '| type:', currentCampaignType, '| vdoRoom:', currentVdoRoom || '(none)', '| monsters:', monsters.length, '| knownPlayers:', players.size, '| playlists:', gmPlaylists.length, '| music tracks:', _allTracks().length, '| files:', gmFiles.length);
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
        const card = document.createElement('div');
        card.className = 'sel-card';
        const typeBadge = c.ariaType === 'contemporary'
            ? '<span class="sel-card-type contemporary">🕵 Contemporain</span>'
            : '<span class="sel-card-type">⚔ Médiéval</span>';
        card.innerHTML = `<button class="sel-card-delete" onclick="event.stopPropagation();deleteCampaign('${c.id}')" title="Supprimer">✕</button><div class="sel-card-row"><div class="sel-card-name">${c.name}</div><div class="sel-card-joincode" onclick="event.stopPropagation();copyJoinCodeFromCard(this,'${c.joinCode||''}')">🔑 ${c.joinCode || '—'}</div></div>${typeBadge}`;
        card.addEventListener('click', () => selectCampaign(c.id));
        grid.appendChild(card);
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
function copyJoinCodeFromCard(el, code) {
    if (!code) return;
    navigator.clipboard.writeText(code).catch(() => {});
    const orig = el.textContent;
    el.textContent = '✓ Copié !';
    setTimeout(() => { el.textContent = orig; }, 1500);
}

// Switch the UI to the main GM app view.
function showApp() {
    document.getElementById('selection-screen').style.display = 'none';
    document.getElementById('app-wrapper').style.display = 'flex';
}

// Select a campaign, load its state, and initialize the GM app.
function selectCampaign(id) {
    if (!loadCampaignState(id)) return;
    showApp();
    initApp();
}

// Delete a campaign and all its scoped localStorage data and Supabase rows.
function deleteCampaign(id) {
    if (!confirm('Supprimer cette campagne ? Tous les monstres et données seront perdus.')) return;
    sbDelete('campaigns',                'id=eq.'          + encodeURIComponent(id));
    sbDelete('monsters',                 'campaign_id=eq.' + encodeURIComponent(id));
    sbDelete('campaign_potions',         'campaign_id=eq.' + encodeURIComponent(id));
    sbDelete('campaign_files',           'campaign_id=eq.' + encodeURIComponent(id));
    sbDelete('campaign_music',           'campaign_id=eq.' + encodeURIComponent(id));
    sbDelete('campaign_notes',           'campaign_id=eq.' + encodeURIComponent(id));
    sbDelete('campaign_known_players',   'campaign_id=eq.' + encodeURIComponent(id));
    sbDelete('campaign_rolls',           'campaign_id=eq.' + encodeURIComponent(id));
    sbDelete('campaign_card_history',    'campaign_id=eq.' + encodeURIComponent(id));
    const campaigns = getCampaigns().filter(c => c.id !== id);
    saveCampaigns(campaigns);
    localStorage.removeItem('aria-gm-monsters-' + id);
    localStorage.removeItem('aria-gm-rolls-' + id);
    localStorage.removeItem('aria-gm-card-history-' + id);
    localStorage.removeItem('aria-gm-potions-' + id);
    localStorage.removeItem('aria-gm-known-players-' + id);
    localStorage.removeItem('aria-gm-files-' + id);
    localStorage.removeItem('aria-gm-notes-' + id);
    localStorage.removeItem('aria-gm-music-' + id);
    localStorage.removeItem('aria-gm-monster-groups-' + id);
    localStorage.removeItem('aria-gm-file-groups-' + id);
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
    const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
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
    if (sweepIntervalId) { clearInterval(sweepIntervalId); sweepIntervalId = null; }
    if (gmPresenceIntervalId) { clearInterval(gmPresenceIntervalId); gmPresenceIntervalId = null; }
    currentVdoRoom = '';
    currentVdoRoomPassword = '';
    stopGMSelfView();
    if (renderPlayerCardsTimer) { clearTimeout(renderPlayerCardsTimer); renderPlayerCardsTimer = null; }
    if (renderMonstersTimer) { clearTimeout(renderMonstersTimer); renderMonstersTimer = null; }
    if (dddiceSDK) { try { dddiceSDK.disconnect?.(); } catch(_){} dddiceSDK = null; }
    if (ablyInstance) { try { ablyInstance.close(); } catch(_){} ablyInstance = null; }
    ablyRolls = null; ablyRollsHidden = null; ablyCards = null; ablyDamage = null; ablyMusic = null;
    players.clear();
    rollFilter.clear(); playerFilter.clear();
    currentCampaignId = null;
    currentCampaignType = 'ancient';
    showSelectionScreen();
}

// ═══════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
    migrateGMIfNeeded();
    await tryRestoreSupabase();
});

// Initialize the full GM app after a campaign is selected.
function initApp() {
    console.log('[GM] initApp: campaign:', currentCampaignId, '| joinCode:', currentJoinCode, '| ablyKey:', config.ablyKey ? 'set' : 'MISSING', '| dddice:', config.dddiceKey ? 'set' : 'none');
    renderPlayerCards();
    renderMonsters();
    renderRollFeed();
    renderCardHistory();
    renderGMPotions();
    renderGmFiles();
    renderMusicTab();
    loadGMNotes();
    initGmDeck();
    loadConfigInputs();
    if (config.dddiceKey && config.dddiceRoom) initDddice();
    if (config.ablyKey) initAbly();
    startGMPresenceBroadcast();
    updateGMPushIframe();
    startGMSelfView();
    if (sweepIntervalId) clearInterval(sweepIntervalId);
    sweepIntervalId = setInterval(sweepOfflinePlayers, 10000);
    if (!gmClickHandlerRegistered) {
        document.addEventListener('click', e => { if (!e.target.closest('.gm-select')) closeAllSelects(); });
        gmClickHandlerRegistered = true;
    }
    const campaigns = getCampaigns();
    const camp = campaigns.find(c => c.id === currentCampaignId);
    const el = document.getElementById('campaign-display');
    if (el && camp) el.value = camp.name;
    const jel = document.getElementById('joincode-display');
    if (jel) jel.textContent = currentJoinCode || '';
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
    const el = document.getElementById('joincode-display');
    if (el) { const t = el.textContent; el.textContent = '✓ Copié !'; setTimeout(() => { el.textContent = t; }, 1500); }
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
    const el = document.getElementById(id);
    if (!el) return;
    el.dataset.value = value;
    const lbl = el.querySelector('.gm-select-label');
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

// ═══════════════════════════════════════════
//  TABS
// ═══════════════════════════════════════════
// Switch the active GM panel tab and refresh the monster select if on the GM Roll tab.
function switchTab(id, btn) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    btn.classList.add('active');
    if (id === 'tab-gm-roll') refreshMonsterSelect();
}

// ═══════════════════════════════════════════
//  DDDICE
// ═══════════════════════════════════════════
// Extract the dddice room slug from a full URL or return the raw value.
function extractRoomSlug(val) {
    if (!val) return '';
    const m = val.match(/\/room\/([^/?#]+)/);
    return m ? m[1] : val.trim();
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
async function initDddice() {
    const slug = extractRoomSlug(config.dddiceRoom);
    if (!config.dddiceKey || !slug) return;
    try {
        const { ThreeDDice, ThreeDDiceRollEvent } = await import('https://esm.sh/dddice-js');

        // Fetch themes for the dropdown
        const h = { 'Authorization': `Bearer ${config.dddiceKey}`, 'Accept': 'application/json' };
        const boxRes = await fetch('https://dddice.com/api/1.0/dice-box', { headers: h });
        if (!boxRes.ok) throw new Error(`Dice box HTTP ${boxRes.status}`);
        const themes = (await boxRes.json()).data || [];
        if (!themes.length) throw new Error('Aucun thème.');

        const sel = document.getElementById('cfg-dddice-theme');
        sel.innerHTML = '';
        themes.forEach(t => { const o = document.createElement('option'); o.value = t.id; o.textContent = t.name ? `${t.name} (${t.id})` : t.id; sel.appendChild(o); });
        sel.disabled = false;
        sel.value = config.dddiceTheme && themes.find(t => t.id === config.dddiceTheme) ? config.dddiceTheme : themes[0].id;

        const canvas = document.getElementById('dddice-canvas');
        dddiceSDK = new ThreeDDice(canvas, config.dddiceKey);
        dddiceSDK.start();
        await dddiceSDK.connect(slug);

        // RollFinished fires for both incoming player rolls and GM rolls initiated locally.
        // Only act on it when a GM roll is pending.
        dddiceSDK.on(ThreeDDiceRollEvent.RollFinished, (roll) => {
            setTimeout(() => dddiceSDK?.clear(), 1500);
            if (!pendingGMRoll) return;
            const { name, threshold, atk } = pendingGMRoll;
            pendingGMRoll = null;
            const total = (roll.total_value ?? 0) === 0 ? 100 : (roll.total_value ?? 0);
            const success = total <= threshold;
            const dmgResult = (success && atk?.dmg?.trim()) ? rollDiceFormula(atk.dmg) : null;
            showGMRollResult(name, threshold, total, success, dmgResult);
        });

        // Keep WebGL viewport in sync with window size
        if (dddiceResizeHandler) window.removeEventListener('resize', dddiceResizeHandler);
        dddiceResizeHandler = () => dddiceSDK?.resize();
        window.addEventListener('resize', dddiceResizeHandler);

        dddiceAPI = { theme: sel.value };
        setDddiceStatus(true, themes.find(t => t.id === sel.value)?.name || sel.value);
        sel.onchange = () => { if (dddiceAPI) dddiceAPI.theme = sel.value; config.dddiceTheme = sel.value; localStorage.setItem('aria-config', JSON.stringify(config)); };
    } catch (e) { console.error('dddice:', e); setDddiceStatus(false, e.message); dddiceSDK = null; dddiceAPI = null; }
}
// Update the dddice status dot and text labels in the topbar and config modal.
function setDddiceStatus(ok, detail) {
    ['dddice-dot', 'cfg-dddice-dot'].forEach(id => { const el = document.getElementById(id); if (el) el.className = 'status-dot ' + (ok ? 'connected' : 'error'); });
    ['dddice-status', 'cfg-dddice-status'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ok ? `dddice: ${detail || 'connecté'}` : `Erreur: ${detail || 'dddice'}`; });
}

// ═══════════════════════════════════════════
//  ABLY
// ═══════════════════════════════════════════
// Suffix a base Ably channel name with the active campaign's join code so each
// campaign runs on its own isolated channels (rolls/cards/damage/music). Empty join
// code → global channel (backward compatible). Players and the overlay derive the
// same suffix from the join code, so all three apps land on the same channel.
function campaignChannel(base) {
    const t = (currentJoinCode || '').trim().toUpperCase();
    return t ? `${base}-${t}` : base;
}
// Initialize Ably channels and subscribe to all game events (rolls, cards, presence).
function initAbly() {
    console.log('[GM] initAbly: connecting with key', config.ablyKey?.slice(0, 8) + '...', '| campaign channel suffix:', currentJoinCode || '(global)');
    try {
        ablyInstance = new Ably.Realtime({ key: config.ablyKey, transports: ['web_socket'] });
        ablyRolls = ablyInstance.channels.get(campaignChannel('aria-rolls'));
        ablyRollsHidden = ablyInstance.channels.get(campaignChannel('aria-rolls-hidden'));
        ablyCards = ablyInstance.channels.get(campaignChannel('aria-cards'));
        ablyDamage = ablyInstance.channels.get(campaignChannel('aria-damage'));
        ablyMusic = ablyInstance.channels.get(campaignChannel('aria-music'));
        ablyInstance.connection.on('connected', () => { console.log('[GM] Ably connected'); setAblyStatus(true); });
        ablyInstance.connection.on('failed',    () => { console.error('[GM] Ably connection FAILED'); setAblyStatus(false); });
        ablyInstance.connection.on('disconnected', () => console.warn('[GM] Ably disconnected'));
        ablyInstance.connection.on('suspended',    () => console.warn('[GM] Ably suspended'));
        ablyRolls.subscribe('roll', msg => { console.log('[GM] received roll from', msg.data?.char, '| skill:', msg.data?.skillName, '| roll:', msg.data?.roll, '| threshold:', msg.data?.threshold, '| success:', msg.data?.success); handleIncomingRoll(msg.data); });
        ablyRollsHidden.subscribe('roll', msg => { console.log('[GM] received HIDDEN roll from', msg.data?.char, '| skill:', msg.data?.skillName, '| roll:', msg.data?.roll); handleIncomingRoll(msg.data); });
        ablyCards.subscribe('draw',     msg => { console.log('[GM] received card draw:', msg.data?.cardId, 'by player'); handlePlayerCard(msg.data); });
        ablyCards.subscribe('reshuffle', () => { console.log('[GM] received card reshuffle'); handlePlayerReshuffle(); });
        ablyDamage.subscribe('presence', msg => { handlePresence(msg.data); });
        ablyDamage.subscribe('leave', msg => {
            const sessionId = msg.data?.playerId;
            if (!sessionId) return;
            for (const [key, p] of players) {
                if (p.playerId === sessionId) { console.log('[GM] player LEFT (Ably leave):', p.name, '| charId:', key); players.delete(key); renderPlayerCards(); break; }
            }
        });
        console.log('[GM] initAbly: subscribed to all channels');
    } catch (e) { console.error('[GM] initAbly error:', e); setAblyStatus(false); }
}
// Update the Ably status dot and text labels in the topbar and config modal.
function setAblyStatus(ok) {
    ['ably-dot', 'cfg-ably-dot'].forEach(id => { const el = document.getElementById(id); if (el) el.className = 'status-dot ' + (ok ? 'connected' : 'error'); });
    ['ably-status', 'cfg-ably-status'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ok ? 'Ably connecté' : 'Ably erreur'; });
}
// Start broadcasting gm-presence (streamId + VDO room) to players every 8s.
function startGMPresenceBroadcast() {
    if (gmPresenceIntervalId) { clearInterval(gmPresenceIntervalId); gmPresenceIntervalId = null; }
    if (!currentVdoRoom || !ablyDamage) { console.log('[GM] startGMPresenceBroadcast: skipped (vdoRoom:', currentVdoRoom || 'empty', '| ablyDamage:', !!ablyDamage, ')'); return; }
    const gmStreamId = 'aria-gm-' + currentCampaignId.slice(0, 8);
    const publish = () => { console.log('[GM] broadcasting gm-presence | streamId:', gmStreamId, '| room:', currentVdoRoom); ablyDamage.publish('gm-presence', { streamId: gmStreamId, vdoRoom: currentVdoRoom, vdoRoomPassword: currentVdoRoomPassword }); };
    publish();
    gmPresenceIntervalId = setInterval(publish, 8000);
    console.log('[GM] startGMPresenceBroadcast: broadcasting every 8s | streamId:', gmStreamId);
}
// Set the GM VDO.ninja push iframe src so the GM camera streams to the room.
function updateGMPushIframe() {
    const wrap = document.getElementById('gm-self-view-wrap');
    const section = document.getElementById('gm-self-view-section');
    if (!wrap || !section) return;
    if (!currentVdoRoom || !currentCampaignId) {
        console.log('[GM] updateGMPushIframe: no vdoRoom, clearing push iframe');
        const existing = wrap.querySelector('iframe');
        if (existing) existing.src = '';
        return;
    }
    const gmStreamId = 'aria-gm-' + currentCampaignId.slice(0, 8);
    let src = `https://vdo.ninja/?push=${gmStreamId}&room=${encodeURIComponent(currentVdoRoom)}&autostart&webcam&noaudio&cleanoutput`;
    if (currentVdoRoomPassword) src += `&password=${encodeURIComponent(currentVdoRoomPassword)}`;
    console.log('[GM] updateGMPushIframe:', src);
    let iframe = wrap.querySelector('iframe');
    if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.allow = 'camera; microphone; autoplay; fullscreen; display-capture; picture-in-picture; screen-wake-lock; encrypted-media';
        iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
        wrap.appendChild(iframe);
    }
    if (iframe.src !== src) iframe.src = src;
    section.style.display = '';
}
// Show GM self-view: visible push iframe if a VDO room is configured, else native camera.
function startGMSelfView() {
    const section = document.getElementById('gm-self-view-section');
    const wrap = document.getElementById('gm-self-view-wrap');
    if (!section || !wrap) return;
    if (currentVdoRoom && currentCampaignId) {
        updateGMPushIframe();
        return;
    }
    if (gmSelfViewStream) return;
    if (!navigator.mediaDevices?.getUserMedia) return;
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        .then(stream => {
            gmSelfViewStream = stream;
            const w = document.getElementById('gm-self-view-wrap');
            const s = document.getElementById('gm-self-view-section');
            if (!w || !s) return;
            w.innerHTML = '';
            const vid = document.createElement('video');
            vid.autoplay = true; vid.muted = true; vid.playsInline = true;
            vid.srcObject = stream;
            vid.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
            w.appendChild(vid);
            s.style.display = '';
        })
        .catch(() => {});
}
// Stop the GM self-view stream and hide its container.
function stopGMSelfView() {
    if (gmSelfViewStream) {
        gmSelfViewStream.getTracks().forEach(t => t.stop());
        gmSelfViewStream = null;
    }
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
// Process a player presence heartbeat: update the players Map and trigger card/music/file grants.
function handlePresence(data) {
    if (!data?.playerId || !data?.charId) { console.warn('[GM] handlePresence: missing playerId or charId', data); return; }
    if (currentJoinCode && (data.campaignKey || '') !== currentJoinCode) { console.log('[GM] handlePresence: IGNORED (campaignKey mismatch:', data.campaignKey, 'vs', currentJoinCode, ') from', data.name); return; }
    if (currentCampaignType && (data.ariaType || 'ancient') !== currentCampaignType) { console.log('[GM] handlePresence: IGNORED (ariaType mismatch:', data.ariaType, 'vs', currentCampaignType, ') from', data.name); return; }
    const isNew = !players.has(data.charId);
    console.log('[GM] handlePresence:', isNew ? 'NEW' : 'update', '| player:', data.name, '| charId:', data.charId, '| hp:', data.hp, '/', data.maxHP, '| streamId:', data.streamId || 'none');
    const playerData = { ...data, ts: Date.now(), online: true };
    players.set(data.charId, playerData);
    saveKnownPlayers();
    syncKnownPlayer(data.charId, playerData);
    clearTimeout(renderPlayerCardsTimer);
    renderPlayerCardsTimer = setTimeout(renderPlayerCards, 150);
    // Auto-send file grants, music state, and gm-presence to newly connected sessions
    if (!filesGrantedSessions.has(data.playerId)) {
        filesGrantedSessions.add(data.playerId);
        sendFileGrantsToPlayer(data);
        if (musicIsPlaying && _currentTrack()) {
            publishMusicPlay(_currentTrack());
        }
        if (currentVdoRoom && ablyDamage) {
            const gmStreamId = 'aria-gm-' + currentCampaignId.slice(0, 8);
            console.log('[GM] new session detected — sending immediate gm-presence to', data.name);
            ablyDamage.publish('gm-presence', { streamId: gmStreamId, vdoRoom: currentVdoRoom, vdoRoomPassword: currentVdoRoomPassword });
        }
    }
}
// Mark players as offline or remove them if they haven't sent a heartbeat recently.
function sweepOfflinePlayers() {
    const now = Date.now();
    let changed = false;
    players.forEach((p, id) => {
        const age = now - (p.ts || 0);
        if (age > PRESENCE_TIMEOUT * 4) {
            console.log('[GM] sweep: REMOVED player', p.name, '(silent for', Math.round(age/1000), 's)');
            players.delete(id);
            changed = true;
            return;
        }
        const wasOnline = p.online !== false;
        const isOnline = age < PRESENCE_TIMEOUT;
        if (wasOnline !== isOnline) {
            console.log('[GM] sweep:', p.name, isOnline ? '→ ONLINE' : '→ OFFLINE', '(last seen', Math.round(age/1000), 's ago)');
            p.online = isOnline; changed = true;
        }
        else if (p.online === undefined) { p.online = isOnline; changed = true; }
    });
    if (changed) { saveKnownPlayers(); renderPlayerCards(); }
}
// Render/update all player cards with in-place DOM updates to preserve camera iframes.
// Cosmetic combat-feedback FX on a player/monster card (flash + shake + number pop).
// HP numbers are updated synchronously by the render; this only adds the transient
// visual layer, then removes it so a re-render can't leave it stuck.
function triggerCardFx(el, type) {
    if (!el) return;
    el.classList.remove('fx-dmg', 'fx-crit', 'fx-heal');
    void el.offsetWidth; // restart the animation
    el.classList.add('fx-' + type);
    setTimeout(() => el.classList.remove('fx-' + type), 650);
}
function playerCardEl(id) { try { return document.querySelector(`#players-grid [data-char-id="${CSS.escape(id)}"]`); } catch { return null; } }
function monsterCardEl(id) { try { return document.querySelector(`#monsters-grid [data-monster-id="${CSS.escape(String(id))}"]`); } catch { return null; } }

function renderPlayerCards() {
    const grid = document.getElementById('players-grid');
    const noP = document.getElementById('no-players');
    if (players.size === 0) {
        noP.style.display = '';
        grid.innerHTML = '';
        return;
    }
    noP.style.display = 'none';
    const focusedId = document.activeElement?.id;
    // Remove cards for players no longer in the Map
    [...grid.querySelectorAll('[data-char-id]')].forEach(el => {
        if (!players.has(el.dataset.charId)) el.remove();
    });
    players.forEach((p, playerId) => {
        const isOnline = p.online !== false && Date.now() - p.ts < PRESENCE_TIMEOUT;
        const hp = p.hp ?? p.maxHP ?? '?', maxHP = p.maxHP ?? '?';
        const pct = maxHP > 0 ? hp / maxHP : 0;
        const hpColor = pct > 0.5 ? 'var(--ok)' : pct > 0.25 ? 'var(--warn)' : 'var(--bad)';
        const hpClass = pct <= 0.25 ? 'critical' : pct <= 0.5 ? 'low' : '';
        const dead = (typeof hp === 'number' && hp <= 0);
        const critical = !dead && pct >= 0 && pct <= 0.25;
        const stateCls = dead ? ' is-dead' : (critical ? ' hp-critical' : '');
        const stats = p.stats || {};
        const k = gmKarma[playerId] ?? 0;
        let card = grid.querySelector(`[data-char-id="${playerId}"]`);
        if (!card) {
            // First render: build full card structure
            card = document.createElement('div');
            card.dataset.charId = playerId;
            card.className = `player-card ${isOnline ? 'online' : 'offline'}${stateCls}`;
            card.innerHTML = `
              <div class="pc-header">
                <div class="pc-online-dot ${isOnline ? 'online' : ''}"></div>
                <div style="flex:1;min-width:0;">
                  <div class="pc-name">${_escHtml(p.name || playerId)}</div>
                  <div class="pc-class">${_escHtml(p.charClass || '')}</div>
                </div>
                <button class="pc-btn details" onclick="openPlayerDetails('${playerId}')" title="Voir la fiche">📋</button>
              </div>
              <div class="pc-body">
                <div class="pc-hp-row">
                  <div>
                    <div class="pc-hp-num ${hpClass}">${hp}</div>
                    <div style="font-family:'Cormorant Garamond',serif;font-size:9px;color:var(--parchment-dim);">/ ${maxHP} PV</div>
                  </div>
                  <div class="pc-hp-bar-wrap"><div class="pc-hp-bar" style="width:${Math.round(pct * 100)}%;background:${hpColor};"></div></div>
                </div>
                ${p.protection ? `<div class="pc-prot" title="Protection">🛡 <span style="color:var(--parchment-dim)">${_escHtml(p.protection.nom || '')}</span>${p.protection.valeur ? ` <span style="color:var(--gold);font-weight:600;">${_escHtml(p.protection.valeur)}</span>` : ''}</div>` : ''}
                <div class="pc-stats">
                  ${Object.entries(stats).filter(([k]) => k !== 'PV').map(([k, v]) => `<span class="pc-stat">${_escHtml(k)} <span>${_escHtml(v)}</span></span>`).join('')}
                </div>
                <div class="pc-actions">
                  <input class="pc-dmg-input" id="dmg-${playerId}" type="text" inputmode="numeric"
                    placeholder="Dégâts" oninput="this.value=this.value.replace(/[^0-9]/g,'')"
                    onkeydown="if(event.key==='Enter')applyPlayerDamage('${playerId}')" />
                  <button class="pc-btn dmg" onclick="applyPlayerDamage('${playerId}')">⚔</button>
                  <input class="pc-heal-input" id="heal-${playerId}" type="text" inputmode="numeric"
                    placeholder="Soins" oninput="this.value=this.value.replace(/[^0-9]/g,'')"
                    onkeydown="if(event.key==='Enter')applyPlayerHeal('${playerId}')" />
                  <button class="pc-btn heal" onclick="applyPlayerHeal('${playerId}')">♥</button>
                </div>
                <div class="pc-karma-row">
                  <span class="pc-karma-label">Karma</span>
                  <button class="pc-karma-btn minus" onclick="setPlayerKarma('${playerId}',-1)">−</button>
                  <span class="pc-karma-val ${k>0?'positive':k<0?'negative':''}">${k>0?'+':''}${k}</span>
                  <button class="pc-karma-btn plus" onclick="setPlayerKarma('${playerId}',1)">+</button>
                </div>
              </div>`;
            grid.appendChild(card);
            // Camera iframe for new card (wrapped for resize)
            if (p.streamId) {
                const wrap = document.createElement('div');
                wrap.className = 'pc-camera-wrap';
                const iframe = document.createElement('iframe');
                let newCardSrc = `https://vdo.ninja/?view=${encodeURIComponent(p.streamId)}&room=${encodeURIComponent(currentVdoRoom)}&autoplay&cleanoutput`;
                if (currentVdoRoomPassword) newCardSrc += `&password=${encodeURIComponent(currentVdoRoomPassword)}`;
                iframe.src = newCardSrc;
                iframe.allow = 'autoplay; fullscreen; display-capture; picture-in-picture; screen-wake-lock';
                iframe.allowFullscreen = true;
                iframe.className = 'pc-camera-frame';
                wrap.appendChild(iframe);
                const pcBody = card.querySelector('.pc-body');
                pcBody.insertBefore(wrap, pcBody.firstElementChild);
            }
        } else {
            // In-place update: only touch what changed, never rebuild the whole card
            card.className = `player-card ${isOnline ? 'online' : 'offline'}${stateCls}`;
            const dot = card.querySelector('.pc-online-dot');
            if (dot) dot.className = `pc-online-dot${isOnline ? ' online' : ''}`;
            const nameEl = card.querySelector('.pc-name');
            if (nameEl) nameEl.textContent = p.name || playerId;
            const classEl = card.querySelector('.pc-class');
            if (classEl) classEl.textContent = p.charClass || '';
            const hpNum = card.querySelector('.pc-hp-num');
            if (hpNum) { hpNum.textContent = hp; hpNum.className = `pc-hp-num${hpClass ? ' ' + hpClass : ''}`; }
            const hpRowFirstDiv = card.querySelector('.pc-hp-row > div');
            if (hpRowFirstDiv?.lastElementChild) hpRowFirstDiv.lastElementChild.textContent = `/ ${maxHP} PV`;
            const hpBar = card.querySelector('.pc-hp-bar');
            if (hpBar) { hpBar.style.width = `${Math.round(pct * 100)}%`; hpBar.style.background = hpColor; }
            const statsEl = card.querySelector('.pc-stats');
            if (statsEl) statsEl.innerHTML = Object.entries(stats).filter(([sk]) => sk !== 'PV').map(([sk, v]) => `<span class="pc-stat">${_escHtml(sk)} <span>${_escHtml(v)}</span></span>`).join('');
            let protEl = card.querySelector('.pc-prot');
            if (p.protection) {
                const protHtml = `🛡 <span style="color:var(--parchment-dim)">${_escHtml(p.protection.nom || '')}</span>${p.protection.valeur ? ` <span style="color:var(--gold);font-weight:600;">${_escHtml(p.protection.valeur)}</span>` : ''}`;
                if (!protEl) {
                    protEl = document.createElement('div');
                    protEl.className = 'pc-prot';
                    protEl.title = 'Protection';
                    card.querySelector('.pc-hp-row')?.insertAdjacentElement('afterend', protEl);
                }
                protEl.innerHTML = protHtml;
            } else if (protEl) {
                protEl.remove();
            }
            const karmaVal = card.querySelector('.pc-karma-val');
            if (karmaVal) {
                karmaVal.textContent = `${k > 0 ? '+' : ''}${k}`;
                karmaVal.className = `pc-karma-val${k > 0 ? ' positive' : k < 0 ? ' negative' : ''}`;
            }
            // Camera: only create/update when streamId changes, never destroy existing iframe
            const existingWrap = card.querySelector('.pc-camera-wrap');
            const existingIframe = existingWrap?.querySelector('.pc-camera-frame');
            if (p.streamId) {
                let expectedSrc = `https://vdo.ninja/?view=${encodeURIComponent(p.streamId)}&room=${encodeURIComponent(currentVdoRoom)}&autoplay&cleanoutput`;
                if (currentVdoRoomPassword) expectedSrc += `&password=${encodeURIComponent(currentVdoRoomPassword)}`;
                if (!existingWrap) {
                    const wrap = document.createElement('div');
                    wrap.className = 'pc-camera-wrap';
                    const iframe = document.createElement('iframe');
                    iframe.src = expectedSrc;
                    iframe.allow = 'autoplay; fullscreen; display-capture; picture-in-picture; screen-wake-lock';
                    iframe.allowFullscreen = true;
                    iframe.className = 'pc-camera-frame';
                    wrap.appendChild(iframe);
                    const pcBody = card.querySelector('.pc-body');
                    pcBody.insertBefore(wrap, pcBody.firstElementChild);
                } else if (existingIframe && existingIframe.src !== expectedSrc) {
                    existingIframe.src = expectedSrc;
                }
                // src unchanged → iframe stays alive, no reload
            } else if (existingWrap) {
                existingWrap.remove();
            }
        }
    });
    if (focusedId) document.getElementById(focusedId)?.focus();
}
// Open the player details modal with character info, tab toggles, and file/potion grants.
function openPlayerDetails(playerId) {
    const p = players.get(playerId);
    if (!p) return;
    document.getElementById('pdm-name').textContent = p.name || playerId;
    document.getElementById('pdm-class').textContent = p.charClass || '';

    const hp = p.hp ?? p.maxHP ?? '?', maxHP = p.maxHP ?? '?';
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

    let html = '';

    // Tab access toggles
    html += `<div class="pdm-section">`;
    html += `<div class="pdm-section-title">Accès aux onglets</div>`;
    html += `<div class="pdm-tab-toggles">`;
    html += `<button class="pdm-tab-toggle${tabs.cards ? ' active' : ''}" onclick="sendTabConfig('${playerId}','cards',${!tabs.cards})">🂠 Cartes</button>`;
    html += `<button class="pdm-tab-toggle${tabs.alchemy ? ' active' : ''}" onclick="sendTabConfig('${playerId}','alchemy',${!tabs.alchemy})">⚗ Alchimie</button>`;
    html += `</div></div>`;

    // Files
    if (gmFiles.length) {
        html += `<div class="pdm-section"><div class="pdm-section-title">Documents</div><div class="pdm-tab-toggles">`;
        for (const f of gmFiles) {
            const isAll = f.grantedTo === 'all';
            const hasAccess = isAll || (Array.isArray(f.grantedTo) && f.grantedTo.includes(playerId));
            const icon = _fileIcon(f.type);
            const disabledAttr = isAll ? ' disabled title="Accès accordé à tous"' : '';
            const clickAttr = isAll ? '' : ` onclick="grantFileToPlayer('${f.id}','${playerId}')"`;
            html += `<button class="pdm-tab-toggle${hasAccess ? ' active' : ''}"${disabledAttr}${clickAttr}>${icon} ${_escHtml(f.name)}</button>`;
        }
        html += `</div></div>`;
    }

    // Alchemy — only show recipe grants if alchemy tab is enabled for this player
    if (tabs.alchemy && gmPotions.length) {
        html += `<div class="pdm-section"><div class="pdm-section-title">Recettes alchimiques</div><div class="pdm-tab-toggles">`;
        for (const pot of gmPotions) {
            const granted = grantedRecipeIds.has(pot.id);
            const safeTitle = (pot.desc || '').replace(/"/g, '&quot;');
            html += `<button class="pdm-tab-toggle${granted ? ' active' : ''}" onclick="sendPotionGrant('${playerId}','${pot.id}')" title="${safeTitle}">⚗ ${pot.name}</button>`;
        }
        html += `</div></div>`;
    }

    // Stats + HP row
    html += `<div class="pdm-section">`;
    html += `<div class="pdm-section-title">Attributs</div>`;
    html += `<div class="pdm-stats-row">`;
    html += `<div class="pdm-hp-block"><span class="pdm-hp-num" style="color:${hpColor}">${hp}</span><span class="pdm-hp-sep">/</span><span class="pdm-hp-max">${maxHP} PV</span></div>`;
    const statOrder = ['FOR','DEX','END','INT','CHA'];
    for (const k of statOrder) {
        if (stats[k] !== undefined) html += `<div class="pdm-stat-block"><span class="pdm-stat-key">${k}</span><span class="pdm-stat-val">${_escHtml(stats[k])}</span></div>`;
    }
    if (p.protection?.nom) html += `<div class="pdm-stat-block"><span class="pdm-stat-key">Armure</span><span class="pdm-stat-val">${_escHtml(p.protection.nom)}${p.protection.valeur ? ' '+_escHtml(p.protection.valeur) : ''}</span></div>`;
    html += `</div></div>`;

    // Weapons
    const realWeapons = weapons.filter(w => w.nom);
    if (realWeapons.length) {
        html += `<div class="pdm-section"><div class="pdm-section-title">Armes</div><div class="pdm-list">`;
        for (const w of realWeapons) {
            html += `<div class="pdm-list-row"><span class="pdm-list-name">${_escHtml(w.nom)}</span><span class="pdm-list-val">${w.degats ? _escHtml(w.degats) : '—'}</span></div>`;
        }
        html += `</div></div>`;
    }

    // Skills
    if (skills.length) {
        html += `<div class="pdm-section"><div class="pdm-section-title">Compétences</div><div class="pdm-skills-grid">`;
        for (const s of skills) {
            html += `<div class="pdm-skill-row"><span class="pdm-skill-name">${_escHtml(s.name)}</span><span class="pdm-skill-pct">${_pdmSkillPct(s)}</span></div>`;
        }
        html += `</div></div>`;
    }

    // Specials
    if (specials.length) {
        html += `<div class="pdm-section"><div class="pdm-section-title">Compétences spéciales</div><div class="pdm-list">`;
        for (const s of specials) {
            html += `<div class="pdm-special-row"><div class="pdm-special-header"><span class="pdm-skill-name">${_escHtml(s.name)}</span><span class="pdm-skill-pct">${_pdmSkillPct(s)}</span></div>${s.desc ? `<div class="pdm-special-desc">${_escHtml(s.desc)}</div>` : ''}</div>`;
        }
        html += `</div></div>`;
    }

    // Money
    const money = p.money || {};
    html += `<div class="pdm-section"><div class="pdm-section-title">Monnaie</div><div class="pdm-money-row">`;
    if ((p.ariaType || 'ancient') === 'contemporary') {
        html += `<div class="pdm-coin-block"><span class="pdm-coin-label">Francs</span><span class="pdm-coin-val">${_escHtml(money.francs ?? 0)}</span></div>`;
    } else {
        const MONEY_COINS = [
            { key: 'couronne', label: 'Couronne', color: '#c9a84c' },
            { key: 'orbe',     label: 'Orbe',     color: '#b8c4cc' },
            { key: 'sceptre',  label: 'Sceptre',  color: '#c87533' },
            { key: 'sou',      label: 'Sou',      color: '#8a8a94' },
        ];
        for (const c of MONEY_COINS) {
            html += `<div class="pdm-coin-block"><span class="pdm-coin-dot" style="color:${c.color}">●</span><span class="pdm-coin-label">${c.label}</span><span class="pdm-coin-val">${_escHtml(money[c.key] ?? 0)}</span></div>`;
        }
    }
    html += `</div></div>`;

    // Inventory
    const vials = p.vials ?? 0;
    const showVials = tabs.alchemy && vials > 0;
    const realInv = inventory.filter(i => i.name);
    if (showVials || realInv.length) {
        html += `<div class="pdm-section"><div class="pdm-section-title">Inventaire</div><div class="pdm-list">`;
        if (showVials) html += `<div class="pdm-list-row"><span class="pdm-list-name" style="font-style:italic;">Fioles vides</span><span class="pdm-list-val">×${vials}</span></div>`;
        for (const i of realInv) {
            html += `<div class="pdm-list-row"><span class="pdm-list-name">${_escHtml(i.name)}</span><span class="pdm-list-val">×${_escHtml(i.qty ?? 1)}</span></div>`;
        }
        html += `</div></div>`;
    }

    // Potions
    const realPotions = potions.filter(p => p.name);
    if (realPotions.length) {
        html += `<div class="pdm-section"><div class="pdm-section-title">Potions</div><div class="pdm-list">`;
        for (const p of realPotions) {
            html += `<div class="pdm-list-row"><span class="pdm-list-name">${_escHtml(p.name)}${p.desc ? ` <span class="pdm-list-desc">— ${_escHtml(p.desc)}</span>` : ''}${p.ingredients ? ` <span class="pdm-list-desc pdm-list-ing">⚗ ${_escHtml(p.ingredients)}</span>` : ''}</span><span class="pdm-list-val">×${_escHtml(p.qty ?? 1)}</span></div>`;
        }
        html += `</div></div>`;
    }

    document.getElementById('pdm-body').innerHTML = html;
    document.getElementById('details-scrim').classList.add('show');
    document.getElementById('player-details-modal').classList.add('show');
}
// Close the player details modal.
function closePlayerDetails() {
    document.getElementById('details-scrim').classList.remove('show');
    document.getElementById('player-details-modal').classList.remove('show');
}
// Send a tab-config message to toggle a player's Cartes or Alchimie tab access.
function sendTabConfig(playerId, tab, enabled) {
    if (!ablyDamage) { console.warn('[GM] sendTabConfig: ablyDamage not ready'); return; }
    const p = players.get(playerId);
    if (!p) return;
    if (!p.tabs) p.tabs = { cards: false, alchemy: false };
    p.tabs[tab] = enabled;
    console.log('[GM] sendTabConfig → ', p.name, '| tab:', tab, '=', enabled, '| full tabs:', JSON.stringify(p.tabs));
    ablyDamage.publish('tab-config', { playerId: p.playerId, tabs: p.tabs });
    openPlayerDetails(playerId); // refresh modal to reflect new state
}

// Read the damage input for a player, apply armor reduction, and publish the damage.
function applyPlayerDamage(playerId) {
    const inp = document.getElementById(`dmg-${playerId}`);
    const rawDmg = parseInt(inp.value);
    if (!rawDmg || rawDmg <= 0) return;
    const p = players.get(playerId);
    if (!p) return;
    const prot = p.protection?.valeur || 0;
    const dmg = Math.max(0, rawDmg - prot);
    const hpBefore = p.hp ?? p.maxHP ?? 0;
    const hpAfter = Math.max(0, hpBefore - dmg);
    console.log('[GM] applyPlayerDamage:', p.name, '| raw:', rawDmg, '| armor:', prot, '| net dmg:', dmg, '| HP:', hpBefore, '→', hpAfter);
    p.hp = hpAfter;
    inp.value = '';
    publishDamage(p.playerId, dmg, hpBefore, hpAfter, p.maxHP || hpBefore, p.name);
    renderPlayerCards();
    triggerCardFx(playerCardEl(playerId), 'dmg');
}
// Read the heal input for a player, clamp to max HP, and publish the heal.
function applyPlayerHeal(playerId) {
    const inp = document.getElementById(`heal-${playerId}`);
    const amt = parseInt(inp.value);
    if (!amt || amt <= 0) return;
    const p = players.get(playerId);
    if (!p) return;
    const hpBefore = p.hp ?? 0;
    const hpAfter = Math.min(p.maxHP || hpBefore, hpBefore + amt);
    console.log('[GM] applyPlayerHeal:', p.name, '| heal:', amt, '| HP:', hpBefore, '→', hpAfter);
    p.hp = hpAfter;
    inp.value = '';
    publishHeal(p.playerId, amt, hpBefore, hpAfter, p.maxHP || hpBefore, p.name);
    renderPlayerCards();
    triggerCardFx(playerCardEl(playerId), 'heal');
}

// ═══════════════════════════════════════════
//  MONSTERS
// ═══════════════════════════════════════════
// Persist monsters to localStorage, debounce Supabase sync, and push state to overlay.
function saveMonsters() { localStorage.setItem(monstersKey(), JSON.stringify(monsters)); debouncedSyncMonsters(); publishMonsterStateToOverlay(); }
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
        const monster = { id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2), name: name + label, pv, maxPV: pv, armor, stats, attacks: [...newMonsterAttacks.map(a => ({ ...a }))] };
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
// Add an attack row to the add-monster form.
function addAmfAttack() {
    const idx = newMonsterAttacks.length;
    newMonsterAttacks.push({ name: '', pct: 50, dmg: '' });
    const list = document.getElementById('amf-attacks-list');
    const row = document.createElement('div'); row.className = 'atk-row'; row.id = `amf-atk-${idx}`;
    row.innerHTML = `<input placeholder="Nom" oninput="newMonsterAttacks[${idx}].name=this.value" /><input type="text" inputmode="numeric" placeholder="%" oninput="this.value=this.value.replace(/[^0-9]/g,'');newMonsterAttacks[${idx}].pct=+this.value||0" /><input placeholder="1d6" oninput="newMonsterAttacks[${idx}].dmg=this.value" /><button class="del-btn" onclick="removeAmfAttack(${idx})">✕</button>`;
    list.appendChild(row);
}
// Remove an attack by index from the add-monster form and re-render the rows.
function removeAmfAttack(idx) {
    newMonsterAttacks.splice(idx, 1);
    // re-render amf attacks
    const list = document.getElementById('amf-attacks-list');
    list.innerHTML = '';
    newMonsterAttacks.forEach((a, i) => {
        const row = document.createElement('div'); row.className = 'atk-row';
        row.innerHTML = `<input value="${a.name}" placeholder="Nom" oninput="newMonsterAttacks[${i}].name=this.value" /><input type="text" inputmode="numeric" value="${a.pct}" placeholder="%" oninput="this.value=this.value.replace(/[^0-9]/g,'');newMonsterAttacks[${i}].pct=+this.value||0" /><input value="${a.dmg}" placeholder="1d6" oninput="newMonsterAttacks[${i}].dmg=this.value" /><button class="del-btn" onclick="removeAmfAttack(${i})">✕</button>`;
        list.appendChild(row);
    });
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
// Evaluate a dice formula string (e.g. "2d6+2") and return total and breakdown.
function rollDiceFormula(formula) {
    const expr = (formula || '').replace(/\s+/g, '').toLowerCase();
    if (!expr) return { total: 0, breakdown: '' };
    const tokens = expr.split(/(?=[+-])/);
    let total = 0;
    const parts = [];
    for (const token of tokens) {
        if (!token) continue;
        const sign = token[0] === '-' ? -1 : 1;
        const raw = token.replace(/^[+-]/, '');
        const m = raw.match(/^(\d+)d(\d+)$/);
        if (m) {
            const rolls = [];
            for (let i = 0; i < parseInt(m[1]); i++) rolls.push(Math.floor(Math.random() * parseInt(m[2])) + 1);
            const sub = rolls.reduce((a, b) => a + b, 0);
            total += sign * sub;
            parts.push(`${sign < 0 ? '−' : parts.length ? '+' : ''}[${rolls.join('+')}]`);
        } else {
            const num = parseInt(raw);
            if (!isNaN(num)) { total += sign * num; parts.push(`${sign < 0 ? '−' : parts.length ? '+' : ''}${num}`); }
        }
    }
    return { total, breakdown: parts.join(' ') };
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

function _uid() { return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2); }

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

// Render a chip bar (monster or file). "Tous" first, then groups, then ＋.
function _renderGroupBar(type) {
    const cfg = type === 'monster'
        ? { barId: 'monster-group-bar', groups: monsterGroups, activeId: activeMonsterGroupId, total: monsters.length,
            countOf: id => monsters.reduce((n, m) => n + (monsterGroupAssign[m.id] === id ? 1 : 0), 0),
            select: selectMonsterGroup, add: addMonsterGroup, rename: renameMonsterGroup, del: deleteMonsterGroup }
        : { barId: 'file-group-bar', groups: fileGroups, activeId: activeFileGroupId, total: gmFiles.length,
            countOf: id => gmFiles.reduce((n, f) => n + (fileGroupAssign[f.id] === id ? 1 : 0), 0),
            select: selectFileGroup, add: addFileGroup, rename: renameFileGroup, del: deleteFileGroup };
    const bar = document.getElementById(cfg.barId);
    if (!bar) return;
    bar.innerHTML = '';
    bar.appendChild(_groupChip({ id: '', name: 'Tous', count: cfg.total, isTous: true, active: cfg.activeId === null, type, cfg }));
    cfg.groups.forEach(g => bar.appendChild(_groupChip({ id: g.id, name: g.name, count: cfg.countOf(g.id), isTous: false, active: cfg.activeId === g.id, type, cfg })));
    const add = document.createElement('button');
    add.className = 'group-chip-add'; add.title = 'Nouveau groupe'; add.textContent = '＋';
    add.addEventListener('click', cfg.add);
    bar.appendChild(add);
}

// ─── Monster group management ───
function addMonsterGroup() {
    const name = prompt('Nom du nouveau groupe :', 'Groupe ' + (monsterGroups.length + 1));
    if (name === null) return;
    const g = { id: _uid(), name: name.trim() || ('Groupe ' + (monsterGroups.length + 1)) };
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
    const g = { id: _uid(), name: name.trim() || ('Groupe ' + (fileGroups.length + 1)) };
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
    grid.innerHTML = '';
    // Drop a stale active filter (e.g. group deleted elsewhere), then render chips.
    if (activeMonsterGroupId && !monsterGroups.some(g => g.id === activeMonsterGroupId)) activeMonsterGroupId = null;
    _renderGroupBar('monster');
    const list = activeMonsterGroupId
        ? monsters.filter(m => monsterGroupAssign[m.id] === activeMonsterGroupId)
        : monsters;
    if (!list.length) {
        if (noM) {
            noM.textContent = monsters.length ? 'Aucun monstre dans ce groupe' : 'Aucun monstre actif';
            noM.style.display = ''; grid.appendChild(noM);
        }
        return;
    }
    if (noM) noM.style.display = 'none';
    list.forEach(m => {
        const pct = m.maxPV > 0 ? m.pv / m.maxPV : 0;
        const hpColor = pct > 0.5 ? 'var(--ok)' : pct > 0.25 ? 'var(--warn)' : 'var(--bad)';
        const safeId = String(m.id).replace(/[^a-zA-Z0-9_-]/g, '-');
        const mDead = m.pv <= 0;
        const mCritical = !mDead && pct >= 0 && pct <= 0.25;
        const card = document.createElement('div');
        card.className = 'monster-card' + (mDead ? ' is-dead' : (mCritical ? ' hp-critical' : ''));
        card.dataset.monsterId = m.id;
        const gName = monsterGroupAssign[m.id] ? (monsterGroups.find(g => g.id === monsterGroupAssign[m.id]) || {}).name : '';
        card.innerHTML = `
          <div class="mc-header">
            <span class="group-grip" draggable="true" title="Glisser vers un groupe" ondragstart="_groupDragStart(event,'${m.id}','monster')" ondragend="_groupDragEnd(event)">⠿</span>
            <div class="mc-name">${m.name}</div>
            ${gName ? `<span class="group-badge">${_escHtml(gName)}</span>` : ''}
            <button class="mc-del" onclick="removeMonster('${m.id}')">✕</button>
          </div>
          <div class="mc-body">
            <div class="mc-hp-row">
              <div><div class="mc-hp-num" style="color:${hpColor}">${m.pv}</div><div style="font-family:'Cormorant Garamond',serif;font-size:9px;color:rgba(255,150,150,.5);">/ ${m.maxPV} PV</div></div>
              <div class="mc-hp-bar-wrap"><div class="mc-hp-bar" style="width:${Math.round(pct * 100)}%;background:${hpColor};"></div></div>
              <div style="font-family:'Cormorant Garamond',serif;font-size:10px;color:rgba(255,150,150,.5);">🛡 ${m.armor}</div>
            </div>
            <div class="mc-inline-actions">
              <input class="mc-inline-input" id="mc-dmg-${safeId}" type="text" inputmode="numeric" placeholder="Dégâts" oninput="this.value=this.value.replace(/[^0-9]/g,'')" onkeydown="if(event.key==='Enter')monsterInlineDamage('${m.id}')" />
              <button class="mc-inline-btn dmg" onclick="monsterInlineDamage('${m.id}')">⚔</button>
              <input class="mc-inline-input" id="mc-heal-${safeId}" type="text" inputmode="numeric" placeholder="Soins" oninput="this.value=this.value.replace(/[^0-9]/g,'')" onkeydown="if(event.key==='Enter')monsterInlineHeal('${m.id}')" />
              <button class="mc-inline-btn heal" onclick="monsterInlineHeal('${m.id}')">♥</button>
            </div>
            <div class="mc-stats">
              ${Object.entries(m.stats).map(([k, v]) => `<span class="mc-stat">${k} <span>${v}</span></span>`).join('')}
            </div>
            <div class="mc-atk-section">
              <div class="mc-atk-hdr">
                <span class="mc-atk-col-label">Nom</span>
                <span class="mc-atk-col-label center">%</span>
                <span class="mc-atk-col-label center">Dégâts</span>
                <span></span>
              </div>
              ${m.attacks.map((a, i) => `
              <div class="mc-atk-edit-row">
                <input class="mc-atk-input" value="${a.name}" placeholder="Nom" oninput="updateMonsterAttack('${m.id}',${i},'name',this.value)" />
                <input class="mc-atk-input center" type="text" inputmode="numeric" value="${a.pct}" placeholder="%" oninput="this.value=this.value.replace(/[^0-9]/g,'');updateMonsterAttack('${m.id}',${i},'pct',+this.value||0)" />
                <input class="mc-atk-input center" value="${a.dmg || ''}" placeholder="1d6" oninput="updateMonsterAttack('${m.id}',${i},'dmg',this.value)" />
                <button class="del-btn" onclick="removeMonsterAttack('${m.id}',${i})">✕</button>
              </div>`).join('')}
              <button class="add-atk-btn mc-add-atk" onclick="addMonsterAttack('${m.id}')">+ Attaque</button>
            </div>
          </div>`;
        grid.appendChild(card);
    });
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
    rollFeed.unshift({ ...data, receivedAt: Date.now() });
    if (rollFeed.length > 50) rollFeed.pop();
    localStorage.setItem(rollsKey(), JSON.stringify(rollFeed));
    insertRoll(data);
    renderRollFeed();
}
// Classify a d100 roll as success, fail, crit-success, or crit-fail.
function classify(roll, threshold, success) {
    if (roll <= 10 && success) return 'crit-success';
    if (roll >= 91 && !success) return 'crit-fail';
    return success ? 'success' : 'fail';
}
// Render the GM roll feed with player pills, filters, and day-grouped entries.
function renderRollFeed() {
    const feed = document.getElementById('rolls-feed');

    // Rebuild player name pills
    const pillGroup = document.getElementById('gm-player-pills');
    if (pillGroup) {
        const names = [...new Set(rollFeed.map(d => d.char || d.playerId || '?'))].filter(Boolean);
        playerFilter = new Set([...playerFilter].filter(n => names.includes(n)));
        pillGroup.innerHTML = names.map(name => {
            const safe = name.replace(/'/g, "\\'");
            const active = playerFilter.has(name) ? ' active' : '';
            return `<button class="rf-pill rf-player${active}" onclick="togglePlayerFilter('${safe}')">${name}</button>`;
        }).join('');
    }

    // Apply filters
    let filtered = rollFeed;
    if (rollFilter.size > 0 || playerFilter.size > 0) {
        filtered = rollFeed.filter(d => {
            if (playerFilter.size > 0) {
                const name = d.char || d.playerId || '?';
                if (!playerFilter.has(name)) return false;
            }
            if (rollFilter.size > 0) {
                const isDie = d.threshold === null;
                if (isDie) return rollFilter.has('die');
                const type = classify(d.roll, d.threshold, d.success);
                if (rollFilter.has('crit') && (type === 'crit-success' || type === 'crit-fail')) return true;
                return rollFilter.has(type);
            }
            return true;
        });
    }

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
            const row = document.createElement('div'); row.className = `roll-entry ${type}${d.hidden ? ' hidden-roll' : ''}`;
            row.innerHTML = `
              <div class="re-char">${d.hidden ? '<span class="re-hidden-badge" title="Jet caché — visible uniquement par le MJ">🔒</span> ' : ''}${_escHtml(d.char || d.playerId || '?')}</div>
              <div class="re-context">
                <div class="re-skill">${_escHtml(d.skillName)}</div>
                ${isDie ? '' : `<div class="re-threshold">Seuil : ${d.threshold}%${d.bonusMalus ? ` · BM : ${d.bonusMalus > 0 ? '+' : ''}${d.bonusMalus}` : ''}</div>`}
              </div>
              <div class="re-result">
                <div class="re-roll">${d.roll}</div>
                ${isDie ? '' : `<div class="re-verdict ${vcls[type]}">${verdicts[type]}</div>`}
              </div>`;
            feed.appendChild(row);
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
        rollFilter.forEach(k => { const el = document.getElementById('gm-rfp-' + k); if (el) el.classList.add('active'); });
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
// Execute a free-threshold GM roll from the Jet MJ form.
function doGMFreeRoll() {
    const name = document.getElementById('gm-free-name').value.trim() || 'Jet MJ';
    const t = parseInt(document.getElementById('gm-free-threshold').value);
    if (isNaN(t) || t < 1 || t > 100) { alert('Seuil invalide.'); return; }
    if (dddiceSDK && dddiceAPI) {
        pendingGMRoll = { name, threshold: t, atk: null };
        dddiceSDK.roll([{ type: 'd10x', theme: dddiceAPI.theme }, { type: 'd10', theme: dddiceAPI.theme }])
            .catch(e => { console.error('dddice GM roll:', e); pendingGMRoll = null; const r = Math.floor(Math.random() * 100) + 1; showGMRollResult(name, t, r, r <= t); });
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
        pendingGMRoll = { name, threshold: t, atk };
        dddiceSDK.roll([{ type: 'd10x', theme: dddiceAPI.theme }, { type: 'd10', theme: dddiceAPI.theme }])
            .catch(e => {
                console.error('dddice GM roll:', e);
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
    const dmgHtml = dmgResult
        ? `<div class="gm-rr-dmg">⚔ Dégâts : <strong>${dmgResult.total}</strong>${dmgResult.breakdown && dmgResult.breakdown !== String(dmgResult.total) ? ` <span class="gm-rr-breakdown">${dmgResult.breakdown}</span>` : ''}</div>`
        : '';
    let targetHtml = '';
    if (dmgResult) {
        const online = [...players.entries()].filter(([, p]) => p.online !== false && Date.now() - p.ts < PRESENCE_TIMEOUT);
        if (online.length) {
            const btns = online.map(([id, p]) => `<button class="gm-target-btn" data-pid="${id}" onclick="applyDamageToPlayer('${id}',${dmgResult.total})">${_escHtml(p.name || id.slice(-4))}</button>`).join('');
            targetHtml = `<div class="gm-target-section"><div class="gm-target-label">Appliquer à :</div><div class="gm-target-btns">${btns}</div></div>`;
        }
    }
    const el = document.getElementById('gm-roll-result');
    el.innerHTML = `
        <div class="gm-rr-name">${name}</div>
        <div class="gm-rr-roll">${roll}</div>
        <div class="gm-rr-detail">Seuil : ${threshold}%</div>
        <div class="gm-rr-verdict" style="color:${colors[type]};">${verdicts[type]}</div>
        ${dmgHtml}${targetHtml}`;
}
// Apply a damage amount to a player from the GM roll result panel, with armor reduction.
function applyDamageToPlayer(playerId, amount) {
    const p = players.get(playerId);
    if (!p) return;
    const prot = p.protection?.valeur || 0;
    const dmg = Math.max(0, amount - prot);
    const hpBefore = p.hp ?? p.maxHP ?? 0;
    const hpAfter = Math.max(0, hpBefore - dmg);
    p.hp = hpAfter;
    publishDamage(p.playerId, dmg, hpBefore, hpAfter, p.maxHP || hpBefore, p.name);
    renderPlayerCards();
    const btn = document.querySelector(`.gm-target-btn[data-pid="${playerId}"]`);
    if (btn) { btn.disabled = true; btn.classList.add('applied'); btn.textContent = `✓ ${p.name || playerId}`; }
}

// ── GM DICE TRAY ─────────────────────────────
// Roll a standard GM die (shown in the die tray) and add it to the roll feed.
function gmRollDie(sides) {
    const result = Math.floor(Math.random() * sides) + 1;
    const el = document.getElementById('gm-die-result');
    if (el) { el.textContent = `d${sides} → ${result}`; el.style.animation = 'none'; void el.offsetWidth; el.style.animation = 'fadeIn .3s ease'; }
    handleIncomingRoll({ skillName: `d${sides}`, threshold: null, roll: result, success: null, char: 'MJ', bonusMalus: 0, playerId: 'gm' });
}

// ── GM BULK DAMAGE / HEAL ─────────────────────
// Apply a damage amount (with armor reduction) to all online players simultaneously.
function bulkDamageAll() {
    const inp = document.getElementById('bulk-dmg-input');
    const rawDmg = parseInt(inp?.value);
    if (!rawDmg || rawDmg <= 0) return;
    const online = [...players.entries()].filter(([, p]) => p.online !== false && Date.now() - p.ts < PRESENCE_TIMEOUT);
    online.forEach(([id, p]) => {
        const prot = p.protection?.valeur || 0;
        const dmg = Math.max(0, rawDmg - prot);
        const hpBefore = p.hp ?? p.maxHP ?? 0;
        const hpAfter = Math.max(0, hpBefore - dmg);
        p.hp = hpAfter;
        publishDamage(p.playerId, dmg, hpBefore, hpAfter, p.maxHP || hpBefore, p.name);
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
    const online = [...players.entries()].filter(([, p]) => p.online !== false && Date.now() - p.ts < PRESENCE_TIMEOUT);
    online.forEach(([id, p]) => {
        const hpBefore = p.hp ?? 0;
        const hpAfter = Math.min(p.maxHP || hpBefore, hpBefore + amt);
        p.hp = hpAfter;
        publishHeal(p.playerId, amt, hpBefore, hpAfter, p.maxHP || hpBefore, p.name);
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
        ablyDamage.publish('karma-set', { playerId: p.playerId, karma: gmKarma[charId] });
    }
    renderPlayerCards();
}

// ── MONSTER INLINE DAMAGE / HEAL ─────────────
// Apply damage (with armor reduction) from the monster card inline input.
function monsterInlineDamage(id) {
    const m = monsters.find(m => String(m.id) === String(id)); if (!m) return;
    const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, '-');
    const inp = document.getElementById(`mc-dmg-${safeId}`);
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
    const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, '-');
    const inp = document.getElementById(`mc-heal-${safeId}`);
    const amt = parseInt(inp?.value); if (!amt || amt <= 0) return;
    m.pv = Math.min(m.maxPV, m.pv + amt);
    if (inp) inp.value = '';
    saveMonsters();
    clearTimeout(renderMonstersTimer); renderMonstersTimer = setTimeout(renderMonsters, 50);
    setTimeout(() => triggerCardFx(monsterCardEl(m.id), 'heal'), 70);
}

// ═══════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════
// Toggle light mode on the document body.
function applyTheme(light) {
    document.body.classList.toggle('light-mode', !!light);
}
window.addEventListener('storage', e => {
    if (e.key !== 'aria-config') return;
    const newCfg = JSON.parse(e.newValue || '{}');
    config = { ...config, ...newCfg };
    applyTheme(!!config.lightMode);
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
    if (dddiceSDK) { try { dddiceSDK.disconnect?.(); } catch (_) {} dddiceSDK = null; }
    if (dddiceResizeHandler) { window.removeEventListener('resize', dddiceResizeHandler); dddiceResizeHandler = null; }
    pendingGMRoll = null; dddiceAPI = null;
    ablyInstance = null; ablyRolls = null; ablyRollsHidden = null; ablyCards = null; ablyDamage = null; ablyMusic = null;
    if (config.dddiceKey && config.dddiceRoom) initDddice();
    if (config.ablyKey) initAbly();
    startGMPresenceBroadcast();
    updateGMPushIframe();
    toggleConfig();
}
// Toggle the config modal and scrim visibility.
function toggleConfig() {
    document.getElementById('config-modal').classList.toggle('show');
    document.getElementById('config-scrim').classList.toggle('show');
}

// ═══════════════════════════════════════════
//  CARD DISPLAY (player draws only)
// ═══════════════════════════════════════════
// Return a Promise that resolves after ms milliseconds.
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
// Render the face of a playing card into the player-view drawn-card element.
function renderCardContent(card) {
    const el = document.getElementById('drawn-card');
    if (card.isJoker) {
        el.className = `flip-face ${card.jokerColor === 'red' ? 'c-red' : 'c-black'}`;
        el.innerHTML = `<div class="card-corner tl"><span class="rank" style="font-size:14px;color:var(--card-purple)">JKR</span></div><div class="card-center" style="flex-direction:column;gap:6px;"><span style="font-size:50px;line-height:1;color:var(--card-purple)">★</span><span style="font-family:'Cormorant Garamond',serif;font-size:10px;font-weight:700;letter-spacing:.12em;color:var(--card-purple)">${card.label.toUpperCase()}</span></div><div class="card-corner br"><span class="rank" style="font-size:14px;color:var(--card-purple)">JKR</span></div>`;
    } else {
        el.className = `flip-face ${card.suit.cls}`;
        el.innerHTML = `<div class="card-corner tl"><span class="rank">${card.rank}</span><span class="suit-small">${card.suit.sym}</span></div><div class="card-center">${card.suit.sym}</div><div class="card-corner br"><span class="rank">${card.rank}</span><span class="suit-small">${card.suit.sym}</span></div>`;
    }
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
        const row = document.createElement('div');
        row.className = 'card-history-row';
        row.innerHTML = `
          <div class="chr-player">${_escHtml(entry.playerName || '?')}</div>
          <div class="chr-card ${colorCls}">${sym} ${label}</div>
          <div class="chr-time">${new Date(entry.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>`;
        feed.appendChild(row);
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
    const flipWrap = document.getElementById('flip-wrap');
    const flipInner = flipWrap.querySelector('.flip-inner');
    // Reset state
    flipWrap.classList.add('hidden');
    flipWrap.classList.remove('flipped');
    document.getElementById('drawn-card').classList.remove('ready');
    renderCardContent(card);
    document.getElementById('drawn-card').classList.add('ready');
    // Show back face instantly (no animation), then flip to reveal front
    flipInner.style.transition = 'none';
    flipWrap.classList.add('flipped');
    flipWrap.classList.remove('hidden');
    flipWrap.getBoundingClientRect();
    flipInner.style.transition = '';
    await delay(400);
    flipWrap.classList.remove('flipped');
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
let gmCardDeck = [];
let gmCardDrawn = new Set();
let gmCardExcluded = new Set();
let gmLastCardId = null;
let gmCardDrawing = false;
let gmCardStatusTimer = null;

// Initialize the GM private deck to a fresh shuffled state.
function initGmDeck() {
    gmCardDeck = buildDeck();
    gmCardDrawn = new Set();
    gmCardExcluded = new Set();
    gmLastCardId = null;
    gmCardDrawing = false;
    gmBuildTracker();
    gmUpdateDeckCount();
}

// Build the GM card tracker grid of suit rows and rank pills.
function gmBuildTracker() {
    const container = document.getElementById('gm-tracker-suits');
    if (!container) return;
    container.innerHTML = '';
    for (const suit of SUITS) {
        const row = document.createElement('div'); row.className = 'suit-row-t';
        const sym = document.createElement('span'); sym.className = `suit-sym ${suit.cls}`; sym.textContent = suit.sym;
        row.appendChild(sym);
        const pills = document.createElement('div'); pills.className = 'rank-pills';
        for (const rank of RANKS) { pills.appendChild(gmMakePill(`${rank}-${suit.name}`, rank, suit.pillCls)); }
        row.appendChild(pills); container.appendChild(row);
    }
    const jRow = document.createElement('div'); jRow.className = 'suit-row-t';
    const jSym = document.createElement('span'); jSym.className = 'suit-sym c-purple'; jSym.textContent = '★';
    jRow.appendChild(jSym);
    const jPills = document.createElement('div'); jPills.className = 'rank-pills';
    jPills.appendChild(gmMakePill('joker-red', 'R★', 'is-joker'));
    jPills.appendChild(gmMakePill('joker-black', 'N★', 'is-joker'));
    jRow.appendChild(jPills); container.appendChild(jRow);
}

// Create a rank pill element for the GM card tracker.
function gmMakePill(id, label, extraCls) {
    const p = document.createElement('span');
    p.className = `rank-pill${extraCls ? ' ' + extraCls : ''}`;
    p.id = `gm-pill-${id}`;
    p.textContent = label;
    p.onclick = () => gmTogglePill(id);
    return p;
}

// Update a GM tracker pill's drawn/excluded visual state.
function gmRefreshPill(p, id) {
    p.classList.toggle('drawn', gmCardDrawn.has(id));
    p.classList.toggle('excluded', gmCardExcluded.has(id));
}

// Refresh all GM tracker pills to match the current deck state.
function gmRefreshAllPills() {
    ALL_CARDS.forEach(c => { const p = document.getElementById(`gm-pill-${c.id}`); if (p) gmRefreshPill(p, c.id); });
}

// Cycle a GM tracker card's state: normal → excluded → returned to deck.
function gmTogglePill(id) {
    const card = cardById(id);
    if (!card) return;
    if (gmCardExcluded.has(id)) { gmCardExcluded.delete(id); gmCardDeck.splice(Math.floor(Math.random() * (gmCardDeck.length + 1)), 0, card); gmUpdateDeckCount(); }
    else if (gmCardDrawn.has(id)) { gmCardDrawn.delete(id); gmCardDeck.splice(Math.floor(Math.random() * (gmCardDeck.length + 1)), 0, card); gmUpdateDeckCount(); }
    else { gmCardExcluded.add(id); const idx = gmCardDeck.findIndex(c => c.id === id); if (idx !== -1) { gmCardDeck.splice(idx, 1); gmUpdateDeckCount(); } }
    const p = document.getElementById(`gm-pill-${id}`); if (p) gmRefreshPill(p, id);
    gmUpdateClearBtn();
}

// Remove all GM deck exclusions and put excluded cards back.
function gmClearExclusions() { if (gmCardDrawing) return; gmCardExcluded.forEach(id => { const c = cardById(id); if (c) gmCardDeck.splice(Math.floor(Math.random() * (gmCardDeck.length + 1)), 0, c); }); gmCardExcluded.clear(); gmUpdateDeckCount(); gmRefreshAllPills(); gmUpdateClearBtn(); gmShowCardStatus('Exclusions effacées'); }

// Update the GM deck count label and toggle reshuffle/clear button visibility.
function gmUpdateDeckCount() {
    const n = gmCardDeck.length;
    const countEl = document.getElementById('gm-deck-count');
    if (countEl) countEl.textContent = n === 0 ? 'Vide' : `${n} carte${n !== 1 ? 's' : ''}`;
    const wrap = document.getElementById('gm-deck-wrap');
    if (wrap) wrap.classList.toggle('empty', n === 0);
    const rBtn = document.getElementById('gm-reshuffle-btn');
    if (rBtn) rBtn.classList.toggle('visible', n === 0);
    const rrBtn = document.getElementById('gm-reshuffle-remaining-btn');
    if (rrBtn) rrBtn.classList.toggle('visible', n > 1 && n < ALL_CARDS.length - gmCardExcluded.size);
    gmUpdateClearBtn();
}

// Show or hide the GM clear-exclusions button based on whether any cards are excluded.
function gmUpdateClearBtn() { const btn = document.getElementById('gm-clear-exclusions-btn'); if (btn) btn.classList.toggle('visible', gmCardExcluded.size > 0); }

// Show a temporary card status message in the GM card tab.
function gmShowCardStatus(msg) {
    const el = document.getElementById('gm-card-status');
    if (!el) return;
    el.textContent = msg;
    clearTimeout(gmCardStatusTimer);
    gmCardStatusTimer = setTimeout(() => el.textContent = '', 2200);
}

// Render the face of a playing card into the GM private deck drawn-card element.
function gmRenderCardContent(card) {
    const el = document.getElementById('gm-drawn-card');
    if (!el) return;
    if (card.isJoker) {
        el.className = `flip-face ${card.jokerColor === 'red' ? 'c-red' : 'c-black'}`;
        el.innerHTML = `<div class="card-corner tl"><span class="rank" style="font-size:14px;color:var(--card-purple)">JKR</span></div><div class="card-center" style="flex-direction:column;gap:6px;"><span style="font-size:50px;line-height:1;color:var(--card-purple)">★</span><span style="font-family:'Cormorant Garamond',serif;font-size:10px;font-weight:700;letter-spacing:.12em;color:var(--card-purple)">${card.label.toUpperCase()}</span></div><div class="card-corner br"><span class="rank" style="font-size:14px;color:var(--card-purple)">JKR</span></div>`;
    } else {
        el.className = `flip-face ${card.suit.cls}`;
        el.innerHTML = `<div class="card-corner tl"><span class="rank">${card.rank}</span><span class="suit-small">${card.suit.sym}</span></div><div class="card-center">${card.suit.sym}</div><div class="card-corner br"><span class="rank">${card.rank}</span><span class="suit-small">${card.suit.sym}</span></div>`;
    }
}

// Render and flip a card into view on the GM deck stage.
async function gmRevealCard(card) {
    const flipWrap = document.getElementById('gm-flip-wrap');
    const drawnEl = document.getElementById('gm-drawn-card');
    gmRenderCardContent(card);
    drawnEl.classList.add('ready');
    const flipInner = flipWrap.querySelector('.flip-inner');
    flipInner.style.transition = 'none';
    flipWrap.classList.add('flipped');
    flipWrap.classList.remove('hidden');
    flipWrap.getBoundingClientRect();
    flipInner.style.transition = '';
    await delay(30);
    flipWrap.classList.remove('flipped');
}

// Draw the top card from the GM private deck and reveal it with a flip animation.
async function gmDrawCard() {
    if (gmCardDrawing || gmCardDeck.length === 0) return;
    gmCardDrawing = true;
    const flipWrap = document.getElementById('gm-flip-wrap');
    if (flipWrap) { flipWrap.classList.remove('flipped'); flipWrap.classList.add('hidden'); }
    const drawnEl = document.getElementById('gm-drawn-card');
    if (drawnEl) drawnEl.classList.remove('ready');
    const drawn = gmCardDeck.pop();
    gmCardDrawn.add(drawn.id);
    gmLastCardId = drawn.id;
    const pill = document.getElementById(`gm-pill-${drawn.id}`); if (pill) gmRefreshPill(pill, drawn.id);
    gmUpdateDeckCount();
    await gmRevealCard(drawn);
    gmShowCardStatus(drawn.isJoker ? drawn.label : `${drawn.rank} de ${SUIT_FR[drawn.suit.name] || drawn.suit.name}`);
    gmCardDrawing = false;
}

// Play the GM deck shuffle animation using ghost card elements.
async function gmAnimateShuffle() {
    const overlay = document.getElementById('gm-shuffle-overlay');
    const wrap = document.getElementById('gm-deck-wrap');
    if (!overlay || !wrap) { await delay(300); return; }
    const rect = wrap.getBoundingClientRect();
    const ghosts = [];
    for (let i = 0; i < 4; i++) {
        const g = document.createElement('div'); g.className = 'shuffle-ghost';
        g.appendChild(Object.assign(document.createElement('div'), { className: 'deck-pattern' }));
        g.style.cssText = `width:${rect.width}px;height:${rect.height}px;left:${rect.left}px;top:${rect.top}px;`;
        overlay.appendChild(g); ghosts.push(g);
    }
    const dirs = ['left', 'right', 'left', 'right'];
    ghosts.forEach((g, i) => { g.style.animation = `shuffle-${dirs[i]} 0.52s ${i * 0.08}s ease-in-out forwards`; });
    wrap.classList.remove('shuffling'); wrap.getBoundingClientRect(); wrap.classList.add('shuffling');
    await delay(680); ghosts.forEach(g => g.remove()); wrap.classList.remove('shuffling');
}

// Reshuffle all or remaining GM deck cards with animation.
async function gmManualReshuffle(remainingOnly) {
    if (gmCardDrawing) return;
    gmCardDrawing = true;
    const flipWrap = document.getElementById('gm-flip-wrap');
    if (flipWrap) { flipWrap.classList.remove('flipped'); flipWrap.classList.add('hidden'); }
    const drawnEl = document.getElementById('gm-drawn-card');
    if (drawnEl) drawnEl.classList.remove('ready');
    await gmAnimateShuffle();
    if (remainingOnly) { gmCardDeck = shuffle(gmCardDeck); }
    else { gmCardDrawn.clear(); gmCardDeck = shuffle([...ALL_CARDS].filter(c => !gmCardExcluded.has(c.id))); gmLastCardId = null; gmRefreshAllPills(); }
    gmUpdateDeckCount();
    gmShowCardStatus(remainingOnly ? '↺ Restant mélangé' : '↺ Mélangé');
    gmCardDrawing = false;
}

// ═══════════════════════════════════════════
//  GM FILE VIEWER
// ═══════════════════════════════════════════
// Open the GM file viewer modal for a file, rendering image/PDF/text inline.
function openGmFileViewer(fileId) {
    const f = gmFiles.find(f => f.id === fileId);
    if (!f) return;
    document.getElementById('gm-fv-title').textContent = f.name;
    const body = document.getElementById('gm-fv-body');
    body.innerHTML = '';
    if (f.type && f.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = f.url; img.className = 'fv-image';
        body.appendChild(img);
        wireImageZoom(img);
    } else if (f.type === 'application/pdf') {
        const iframe = document.createElement('iframe');
        iframe.src = f.url; iframe.className = 'fv-iframe';
        body.appendChild(iframe);
    } else if (f.type && f.type.startsWith('text/')) {
        const pre = document.createElement('pre');
        pre.className = 'fv-text'; pre.textContent = 'Chargement…';
        body.appendChild(pre);
        fetch(f.url).then(r => r.text()).then(t => { pre.textContent = t; }).catch(() => { pre.textContent = 'Erreur de chargement.'; });
    } else {
        const wrap = document.createElement('div');
        wrap.className = 'fv-unsupported';
        wrap.innerHTML = `<div class="fv-unsupported-icon">${_fileIcon(f.type)}</div><div class="fv-unsupported-name">${_escHtml(f.name)}</div><a class="fv-download-link" href="${f.url}" target="_blank" rel="noopener">Ouvrir dans un nouvel onglet</a>`;
        body.appendChild(wrap);
    }
    document.getElementById('gm-file-viewer-scrim').classList.add('show');
    document.getElementById('gm-file-viewer-modal').classList.add('show');
}

// Close the GM file viewer modal and clear its body.
function closeGmFileViewer() {
    document.getElementById('gm-file-viewer-scrim').classList.remove('show');
    document.getElementById('gm-file-viewer-modal').classList.remove('show');
    document.getElementById('gm-fv-body').innerHTML = '';
}

// Wire wheel-zoom (toward cursor), drag-to-pan and double-click reset onto a file-viewer image.
// The img is recreated on every open (body.innerHTML = ''), so no explicit teardown is needed.
function wireImageZoom(img) {
    let scale = 1, tx = 0, ty = 0;
    const apply = () => { img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; };
    img.addEventListener('wheel', e => {
        e.preventDefault();
        const ns = Math.min(6, Math.max(1, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        const rect = img.getBoundingClientRect();
        const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
        tx -= cx * (ns / scale - 1);
        ty -= cy * (ns / scale - 1);
        scale = ns;
        if (scale === 1) { tx = 0; ty = 0; }
        apply();
    }, { passive: false });
    img.addEventListener('mousedown', e => {
        if (scale === 1) return;
        e.preventDefault();
        const sx = e.clientX - tx, sy = e.clientY - ty;
        img.classList.add('panning');
        const move = ev => { tx = ev.clientX - sx; ty = ev.clientY - sy; apply(); };
        const up = () => { img.classList.remove('panning'); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    });
    img.addEventListener('dblclick', e => { e.preventDefault(); scale = 1; tx = 0; ty = 0; apply(); });
}

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
    const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
    gmPotions.push({ id, name, desc, ingredients, successChance });
    saveGMPotions();
    ['apf-name', 'apf-desc', 'apf-ingredients', 'apf-chance'].forEach(eid => { const el = document.getElementById(eid); if (el) el.value = ''; });
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
    gmPotions.forEach(p => {
        const card = document.createElement('div');
        card.className = 'gm-pot-card';
        card.innerHTML = `
            <div class="gm-pot-card-header">
                <span class="gm-pot-card-icon">⚗</span>
                <input class="gm-pot-name-input" value="${p.name.replace(/"/g,'&quot;')}" placeholder="Nom" oninput="updateGMPotion('${p.id}','name',this.value)" />
                <div class="gm-pot-chance-wrap"><input class="gm-pot-chance-badge" type="text" inputmode="numeric" value="${p.successChance || ''}" placeholder="—" oninput="this.value=this.value.replace(/[^0-9]/g,'');updateGMPotion('${p.id}','successChance',+this.value||0)" /><span class="gm-pot-chance-suffix">%</span></div>
            </div>
            <div class="gm-pot-card-body">
                <div class="gm-pot-field-row">
                    <span class="gm-pot-field-icon">✦</span>
                    <input class="gm-pot-text-input" value="${(p.desc||'').replace(/"/g,'&quot;')}" placeholder="Description / Effet" oninput="updateGMPotion('${p.id}','desc',this.value)" />
                </div>
                <div class="gm-pot-field-row">
                    <span class="gm-pot-field-icon">◈</span>
                    <input class="gm-pot-text-input" value="${(p.ingredients||'').replace(/"/g,'&quot;')}" placeholder="Ingrédients" oninput="updateGMPotion('${p.id}','ingredients',this.value)" />
                </div>
            </div>
            <button class="gm-pot-del-btn" onclick="removeGMPotion('${p.id}')">✕</button>`;
        list.appendChild(card);
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
        picker.innerHTML = campaigns.map(c => {
            const safeName = c.name.replace(/'/g, '\\\'').replace(/"/g, '&quot;');
            return `<button class="alchemy-import-option" onclick="importAlchemyFrom('${c.id}','${safeName}')">${c.name}</button>`;
        }).join('');
    }
    picker.style.display = '';
}

// Replace the current alchemy grimoire with recipes from another campaign.
function importAlchemyFrom(sourceId, sourceName) {
    document.getElementById('alchemy-import-picker').style.display = 'none';
    const sourcePotions = JSON.parse(localStorage.getItem('aria-gm-potions-' + sourceId) || '[]');
    if (!sourcePotions.length) { alert(`Aucune recette dans la campagne "${sourceName}".`); return; }
    if (!confirm(`Remplacer le grimoire actuel par les ${sourcePotions.length} recette(s) de "${sourceName}" ?`)) return;
    gmPotions.forEach(p => sbDelete('campaign_potions', 'id=eq.' + encodeURIComponent(p.id)));
    gmPotions = sourcePotions.map(p => ({
        ...p,
        id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)
    }));
    saveGMPotions();
    renderGMPotions();
}

// Grant or revoke a potion recipe for a player via Ably, toggling state.
function sendPotionGrant(playerId, potionId) {
    if (!ablyDamage) return;
    const player = players.get(playerId);
    if (!player) return;
    if (!player.potionRecipeIds) player.potionRecipeIds = [];
    const alreadyGranted = player.potionRecipeIds.includes(potionId);
    if (alreadyGranted) {
        console.log('[GM] sendPotionGrant: REVOKING potion', potionId, 'from', player.name);
        ablyDamage.publish('potion-revoke', { playerId: player.playerId, potionId });
        player.potionRecipeIds = player.potionRecipeIds.filter(id => id !== potionId);
    } else {
        const pot = gmPotions.find(p => p.id === potionId);
        if (!pot) return;
        console.log('[GM] sendPotionGrant: GRANTING potion', pot.name, 'to', player.name);
        ablyDamage.publish('potion-grant', { playerId: player.playerId, potion: { ...pot } });
        player.potionRecipeIds.push(potionId);
    }
    openPlayerDetails(playerId);
}
// Send a vial-grant message to give a player a quantity of empty vials.
function sendVialGrant(playerId, qty) {
    if (!ablyDamage) return;
    const p = players.get(playerId);
    if (!p) return;
    console.log('[GM] sendVialGrant:', qty, 'vials to', p.name);
    ablyDamage.publish('vial-grant', { playerId: p.playerId, qty });
}

// ═══════════════════════════════════════════
//  GM FILES
// ═══════════════════════════════════════════
// Escape HTML special characters for safe injection into innerHTML.
function _escHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// Render a skill/special percentage for the player-details modal, folding in the
// player's per-skill permanent modifier (s.bonus) and annotating it when non-zero.
function _pdmSkillPct(s) {
    const pct = +s.pct || 0;
    const b = +s.bonus || 0;
    if (!b) return _escHtml(pct) + '%';
    return `${_escHtml(pct + b)}% <span class="pdm-skill-mod" title="Modificateur permanent">${b > 0 ? '+' : ''}${b}</span>`;
}
// Return an emoji icon string for a file MIME type.
function _fileIcon(type) {
    if (!type) return '📄';
    if (type.startsWith('image/')) return '🖼';
    if (type === 'application/pdf') return '📕';
    if (type.startsWith('text/')) return '📝';
    return '📄';
}

// Persist GM files to localStorage and debounce Supabase sync.
function saveGmFiles() { localStorage.setItem(filesKey(), JSON.stringify(gmFiles)); debouncedSyncFiles(); }

// Persist the GM music playlists to localStorage and debounce Supabase sync.
function saveGMMusic() {
    if (!currentCampaignId) return;
    localStorage.setItem(musicKey(), JSON.stringify(gmPlaylists));
    debouncedSyncMusic();
}

// ═══════════════════════════════════════════
//  MUSIC AUDIO ENGINE
// ═══════════════════════════════════════════
let musicMasterVolume = parseInt(localStorage.getItem('aria-music-volume') || '80');
let musicFadeDuration = 3000;
let musicLoop         = false;
let musicCurrentIndex = -1;
let musicIsPlaying    = false;
let _musicCurrentSlot = 'A'; // 'A' or 'B'
let _musicFadeRaf     = null;
let _musicProgressRaf = null;

// ─── Playlist accessors ───
// gmPlaylists holds named playlists; the UI shows one (activePlaylistId) while
// playback tracks its own playlist (musicPlayingPlaylistId) + index. These helpers
// resolve the right track array for view vs. playback operations.
function _newPlaylist(name) {
    return { id: (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)),
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

// Slot descriptors
const _musicSlots = {
    A: { audio: null, ytEndedCb: null },
    B: { audio: null, ytEndedCb: null },
};

// YouTube IFrame API state
let _ytAPIReady       = false;
let _ytPendingCbs     = [];
let _ytSlotA          = null; // YT.Player instance
let _ytSlotB          = null;

// Lazily create and return the Audio element for a given slot (A or B).
function _getAudio(slot) {
    if (!_musicSlots[slot].audio) _musicSlots[slot].audio = new Audio();
    return _musicSlots[slot].audio;
}

// Set the volume (0–100) on a music slot's Audio element and YouTube player.
function _setSlotVol(slot, vol) {
    const v = Math.max(0, Math.min(100, vol));
    const audio = _musicSlots[slot].audio;
    if (audio) audio.volume = v / 100;
    const yt = slot === 'A' ? _ytSlotA : _ytSlotB;
    if (yt) { try { yt.setVolume(v); } catch(_) {} }
}

// Stop and clear a music slot: pause audio, stop YouTube, clear ended callback.
function _stopSlot(slot) {
    const audio = _musicSlots[slot].audio;
    if (audio) { audio.pause(); audio.onended = null; audio.src = ''; }
    const yt = slot === 'A' ? _ytSlotA : _ytSlotB;
    if (yt) { try { yt.stopVideo(); } catch(_) {} }
    _musicSlots[slot].ytEndedCb = null;
}

// Lazily load the YouTube IFrame API script and call back when it is ready.
function _ensureYTAPI(cb) {
    if (_ytAPIReady) { cb(); return; }
    _ytPendingCbs.push(cb);
    if (document.getElementById('yt-iframe-api')) return;
    window.onYouTubeIframeAPIReady = () => {
        _ytAPIReady = true;
        _ytPendingCbs.splice(0).forEach(fn => fn());
    };
    const s = document.createElement('script');
    s.id = 'yt-iframe-api';
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
}

// Ensure both YouTube player slots A and B are initialized, then call back.
function _ensureYTSlots(cb) {
    _ensureYTAPI(() => {
        if (_ytSlotA && _ytSlotB) { cb(); return; }
        let readyCount = 0;
        const onSlotReady = () => { readyCount++; if (readyCount === 2) cb(); };
        _ytSlotA = new YT.Player('yt-player-a', {
            width: '1', height: '1',
            playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0 },
            events: {
                onReady: onSlotReady,
                onStateChange: e => { if (e.data === YT.PlayerState.ENDED && _musicSlots.A.ytEndedCb) _musicSlots.A.ytEndedCb(); },
            },
        });
        _ytSlotB = new YT.Player('yt-player-b', {
            width: '1', height: '1',
            playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0 },
            events: {
                onReady: onSlotReady,
                onStateChange: e => { if (e.data === YT.PlayerState.ENDED && _musicSlots.B.ytEndedCb) _musicSlots.B.ytEndedCb(); },
            },
        });
    });
}

// Load a track into a slot at volume 0 and call onStarted once playback begins.
function _loadSlotAtZeroVol(track, slot, onStarted) {
    _setSlotVol(slot, 0);
    if (track.type === 'file') {
        const audio = _getAudio(slot);
        audio.onended = null;
        audio.src = track.url;
        audio.volume = 0;
        const p = audio.play();
        if (p) p.then(onStarted).catch(() => _showMusicUnlockPrompt(() => audio.play().then(onStarted)));
        else onStarted();
    } else {
        _ensureYTSlots(() => {
            const yt = slot === 'A' ? _ytSlotA : _ytSlotB;
            _musicSlots[slot].ytEndedCb = null;
            yt.loadVideoById(track.youtubeId);
            yt.setVolume(0);
            setTimeout(() => { try { yt.playVideo(); } catch(_) {} onStarted(); }, 800);
        });
    }
}

// Cross-fade volume from one audio slot to another over musicFadeDuration ms.
function _runCrossfade(fromSlot, toSlot, onDone) {
    if (_musicFadeRaf) { cancelAnimationFrame(_musicFadeRaf); _musicFadeRaf = null; }
    const start = performance.now();
    const fromStart = musicMasterVolume;
    function tick(now) {
        const t = Math.min(1, (now - start) / musicFadeDuration);
        _setSlotVol(fromSlot, (1 - t) * fromStart);
        _setSlotVol(toSlot, t * musicMasterVolume);
        if (t < 1) { _musicFadeRaf = requestAnimationFrame(tick); }
        else { _musicFadeRaf = null; _stopSlot(fromSlot); onDone(); }
    }
    _musicFadeRaf = requestAnimationFrame(tick);
}

// Register the "track ended" callback for a slot (audio onended or YouTube state change).
function _setSlotEndedCallback(slot, track, cb) {
    if (track.type === 'file') {
        const audio = _musicSlots[slot].audio;
        if (audio) audio.onended = cb;
    } else {
        _musicSlots[slot].ytEndedCb = cb;
    }
}

// Show a "click to enable audio" banner for browsers that block autoplay.
function _showMusicUnlockPrompt(onUnlock) {
    let el = document.getElementById('music-unlock-prompt');
    if (!el) {
        el = document.createElement('div');
        el.id = 'music-unlock-prompt';
        el.className = 'music-unlock-prompt';
        el.textContent = '▶ Cliquer pour activer le son';
        document.body.appendChild(el);
    }
    el.style.display = 'flex';
    const handler = () => { el.style.display = 'none'; el.removeEventListener('click', handler); onUnlock(); };
    el.addEventListener('click', handler);
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

// Start playing a track on the inactive slot and cross-fade in from the current slot.
function _musicTriggerPlay(track, index) {
    if (_musicFadeRaf) { cancelAnimationFrame(_musicFadeRaf); _musicFadeRaf = null; }
    // Disable auto-advance on current slot before transition
    const currentSlot = _musicCurrentSlot;
    const nextSlot = currentSlot === 'A' ? 'B' : 'A';
    _musicSlots[currentSlot].ytEndedCb = null;
    if (_musicSlots[currentSlot].audio) _musicSlots[currentSlot].audio.onended = null;

    musicCurrentIndex = index;
    musicIsPlaying    = true;
    renderMusicTab();

    _loadSlotAtZeroVol(track, nextSlot, () => {
        _runCrossfade(currentSlot, nextSlot, () => {
            _musicCurrentSlot = nextSlot;
            _setSlotEndedCallback(nextSlot, track, _musicAutoAdvance);
            renderMusicTab();
            _startMusicProgress();
        });
    });
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

    playlist.innerHTML = '';
    tracks.forEach((t, i) => {
        const isCurrent = viewingPlaying && i === musicCurrentIndex;
        const row = document.createElement('div');
        row.className = 'music-track-row' + (isCurrent ? ' active' : '');
        const indicator = (isCurrent && musicIsPlaying) ? '▶' : '○';
        const badge = t.type === 'youtube' ? 'youtube' : 'fichier';
        row.innerHTML =
            `<span class="music-track-indicator">${indicator}</span>` +
            `<span class="music-track-name" onclick="musicSelectTrack(${i})">${_escHtml(t.name)}</span>` +
            `<span class="music-track-badge">${badge}</span>` +
            `<button class="music-track-rename" onclick="musicRenameTrack(${i})" title="Renommer">✎</button>` +
            `<button class="music-track-delete" onclick="musicDeleteTrack(${i})">✕</button>`;
        playlist.appendChild(row);
    });
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
    bar.innerHTML = '';
    gmPlaylists.forEach(pl => {
        const isActive  = pl.id === activePlaylistId;
        const isPlaying = pl.id === musicPlayingPlaylistId && musicIsPlaying;
        const chip = document.createElement('div');
        chip.className = 'music-pl-chip' + (isActive ? ' active' : '') + (isPlaying ? ' playing' : '');
        let html =
            `<span class="music-pl-launch" onclick="musicLaunchPlaylist('${pl.id}')" title="Lancer cette playlist">▶</span>` +
            `<span class="music-pl-name" onclick="musicSelectPlaylist('${pl.id}')">${_escHtml(pl.name)}</span>` +
            `<span class="music-pl-count">${pl.tracks.length}</span>`;
        if (isActive) {
            html +=
                `<button class="music-pl-edit" onclick="musicRenamePlaylist('${pl.id}')" title="Renommer">✎</button>` +
                `<button class="music-pl-del" onclick="musicDeletePlaylist('${pl.id}')" title="Supprimer"${gmPlaylists.length <= 1 ? ' disabled' : ''}>✕</button>`;
        }
        chip.innerHTML = html;
        bar.appendChild(chip);
    });
    const add = document.createElement('button');
    add.className = 'music-pl-add';
    add.title = 'Nouvelle playlist';
    add.textContent = '＋';
    add.onclick = musicAddPlaylist;
    bar.appendChild(add);
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
                    tracks.push({ id: crypto.randomUUID(), name: title || videoId, type: 'youtube', url: null, youtubeId: videoId, path: null });
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
        dest.push({ id: crypto.randomUUID(), name, type: 'youtube', url: null, youtubeId: videoId, path: null });
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
        dest.push({ id: crypto.randomUUID(), name, type: 'youtube', url: null, youtubeId: videoId, path: null });
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
        const id   = crypto.randomUUID();
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
let gmNotesList = [];
let gmCurrentNoteId = null;

// Generate a new UUID for a GM note.
function _gmNoteId() {
    return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Load GM notes from localStorage for the current campaign, migrating plain-string format if needed.
function loadGMNotes() {
    const raw = localStorage.getItem(gmNotesKey());
    if (!raw) {
        gmNotesList = [];
    } else {
        try {
            const parsed = JSON.parse(raw);
            gmNotesList = Array.isArray(parsed) ? parsed : [{ id: _gmNoteId(), name: 'Notes', content: raw }];
        } catch(e) {
            gmNotesList = [{ id: _gmNoteId(), name: 'Notes', content: raw }];
        }
    }
    gmCurrentNoteId = gmNotesList.length > 0 ? gmNotesList[0].id : null;
    renderGMNotesList();
    loadGMNoteContent();
}

// Save the current GM notes list to localStorage.
function persistGMNotes() {
    localStorage.setItem(gmNotesKey(), JSON.stringify(gmNotesList));
}

// Render the GM notes sidebar list, highlighting the currently selected note.
function renderGMNotesList() {
    const list = document.getElementById('gm-notes-list');
    if (!list) return;
    list.innerHTML = '';
    gmNotesList.forEach(note => {
        const item = document.createElement('div');
        item.className = 'notes-item' + (note.id === gmCurrentNoteId ? ' active' : '');
        const nameSpan = document.createElement('span');
        nameSpan.className = 'notes-item-name';
        nameSpan.textContent = note.name || 'Sans titre';
        nameSpan.addEventListener('click', () => selectGMNote(note.id));
        const delBtn = document.createElement('button');
        delBtn.className = 'notes-item-delete';
        delBtn.title = 'Supprimer';
        delBtn.textContent = '✕';
        delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteGMNote(note.id); });
        item.appendChild(nameSpan);
        item.appendChild(delBtn);
        list.appendChild(item);
    });
}

// Load the selected GM note's name and body into the editor fields.
function loadGMNoteContent() {
    const nameInput = document.getElementById('gm-notes-name-input');
    const area = document.getElementById('gm-notes-area');
    if (!nameInput || !area) return;
    const note = gmNotesList.find(n => n.id === gmCurrentNoteId);
    if (note) {
        nameInput.value = note.name;
        area.value = note.content;
        nameInput.disabled = false;
        area.disabled = false;
    } else {
        nameInput.value = '';
        area.value = '';
        nameInput.disabled = true;
        area.disabled = true;
    }
}

// Select a GM note by ID and display it in the editor.
function selectGMNote(id) {
    gmCurrentNoteId = id;
    renderGMNotesList();
    loadGMNoteContent();
    document.getElementById('gm-notes-area').focus();
}

// Add a new empty GM note, persist it, sync to Supabase, and select it.
function addGMNote() {
    const note = { id: _gmNoteId(), name: 'Nouvelle note', content: '' };
    gmNotesList.push(note);
    persistGMNotes();
    syncGMNote(note);
    selectGMNote(note.id);
    const nameInput = document.getElementById('gm-notes-name-input');
    if (nameInput) { nameInput.focus(); nameInput.select(); }
}

// Delete a GM note, remove it from Supabase, and select the adjacent note.
function deleteGMNote(id) {
    deleteGMNoteFromDB(id);
    const idx = gmNotesList.findIndex(n => n.id === id);
    gmNotesList = gmNotesList.filter(n => n.id !== id);
    gmCurrentNoteId = gmNotesList[Math.min(idx, gmNotesList.length - 1)]?.id || null;
    persistGMNotes();
    renderGMNotesList();
    loadGMNoteContent();
}

// Save the current GM note's content from the textarea and schedule Supabase sync.
function saveCurrentGMNote() {
    const note = gmNotesList.find(n => n.id === gmCurrentNoteId);
    if (!note) return;
    note.content = document.getElementById('gm-notes-area').value;
    persistGMNotes();
    debouncedSyncGMNote(note);
}

// Rename the current GM note from the name input and refresh the list.
function renameCurrentGMNote() {
    const note = gmNotesList.find(n => n.id === gmCurrentNoteId);
    if (!note) return;
    note.name = document.getElementById('gm-notes-name-input').value;
    persistGMNotes();
    renderGMNotesList();
    debouncedSyncGMNote(note);
}

// Upload a file to Supabase Storage (campaign-files bucket) and return its URL and path.
async function uploadFileToStorage(file) {
    const fileId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
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
    if (ablyDamage) ablyDamage.publish('file-revoke', { playerId: 'all', fileId });
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
        if (ablyDamage) ablyDamage.publish('file-revoke', { playerId: 'all', fileId });
    } else {
        console.log('[GM] grantFileToAll: GRANTING', f.name, 'to all online players');
        f.grantedTo = 'all';
        if (ablyDamage) {
            players.forEach(p => {
                if (p.online !== false && Date.now() - p.ts < PRESENCE_TIMEOUT) {
                    ablyDamage.publish('file-grant', { playerId: p.playerId, file: { id: f.id, name: f.name, type: f.type, url: f.url } });
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
        if (ablyDamage) ablyDamage.publish('file-revoke', { playerId: p.playerId, fileId });
    } else {
        console.log('[GM] grantFileToPlayer: GRANTING', f.name, 'to', p.name);
        f.grantedTo.push(charId);
        if (ablyDamage) ablyDamage.publish('file-grant', { playerId: p.playerId, file: { id: f.id, name: f.name, type: f.type, url: f.url } });
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
            ablyDamage.publish('file-grant', { playerId: playerData.playerId, file: { id: f.id, name: f.name, type: f.type, url: f.url } });
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
        const card = document.createElement('div');
        card.className = 'gm-file-card';
        const gName = fileGroupAssign[f.id] ? (fileGroups.find(g => g.id === fileGroupAssign[f.id]) || {}).name : '';
        card.innerHTML = `
            <span class="group-grip" draggable="true" title="Glisser vers un groupe" ondragstart="_groupDragStart(event,'${f.id}','file')" ondragend="_groupDragEnd(event)">⠿</span>
            <div class="gm-file-icon">${_fileIcon(f.type)}</div>
            <div class="gm-file-info">
                <div class="gm-file-name">${_escHtml(f.name)}</div>
                <div class="gm-file-grant-status">${grantLabel}${gName ? ` <span class="group-badge">${_escHtml(gName)}</span>` : ''}</div>
            </div>
            <div class="gm-file-actions">
                <button class="gm-file-open-btn" onclick="openGmFileViewer('${f.id}')" title="Ouvrir">Ouvrir</button>
                <button class="gm-file-btn${isAll ? ' active' : ''}" onclick="grantFileToAll('${f.id}')" title="${isAll ? 'Révoquer accès global' : 'Accorder à tous'}">🌍</button>
                <button class="gm-file-del-btn" onclick="removeGmFile('${f.id}')" title="Supprimer">✕</button>
            </div>`;
        list.appendChild(card);
    });
}
