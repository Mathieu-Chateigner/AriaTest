// ═══════════════════════════════════════════
//  PANEL WIRING
// ═══════════════════════════════════════════
// Everything the two panels share lives in aria-shared.js, loaded before this file.
// The differences between them are these hooks, not forked copies of the functions.
ARIA.configure({
    role:         'player',
    tag:          'PLAYER',
    splitKey:     'aria-split-layout',
    defaultPane:  'tab-skills',
    joinCode:     () => character?.campaignKey || '',
    syncAll:      () => _syncAllPlayerData(),
    clearLocal:   () => _clearLocalPlayerData(),
    afterRestore: () => restoreLastCharacter(),
    onMusicPhase: (phase, track) => { if (phase === 'start') _updatePlayerMusicBar(track); },
});

// ═══════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════
const DEFAULT_CHAR_ANCIENT = {
    name: "", class: "", ariaType: 'ancient',
    stats: { FOR: 0, DEX: 0, END: 0, INT: 0, CHA: 0, PV: 0 },
    physical: { age: "", taille: "", poids: "", yeux: "", cheveux: "", signes: "", histoire: "" },
    inventory: [], weapons: [{ nom: '', degats: '' }, { nom: '', degats: '' }, { nom: '', degats: '' }],
    protection: { nom: '', valeur: 0 },
    skills: [
        { name: "Artisanat, construire", link: "DEX/INT", pct: 0 },
        { name: "Combat rapproché",      link: "FOR/DEX", pct: 0 },
        { name: "Combat à distance",     link: "FOR/DEX", pct: 0 },
        { name: "Connaissance de la nature", link: "DEX/INT", pct: 0 },
        { name: "Connaissance des secrets",  link: "INT/CHA", pct: 0 },
        { name: "Courir, sauter",        link: "DEX/END", pct: 0 },
        { name: "Discrétion",            link: "DEX/CHA", pct: 0 },
        { name: "Droit",                 link: "INT/CHA", pct: 0 },
        { name: "Esquiver",              link: "DEX/INT", pct: 0 },
        { name: "Intimider",             link: "FOR/CHA", pct: 0 },
        { name: "Lire, écrire",          link: "INT/CHA", pct: 0 },
        { name: "Mentir, convaincre",    link: "INT/CHA", pct: 0 },
        { name: "Perception",            link: "INT/CHA", pct: 0 },
        { name: "Piloter",               link: "DEX/END", pct: 0 },
        { name: "Psychologie",           link: "END/INT", pct: 0 },
        { name: "Réflexes",              link: "DEX/INT", pct: 0 },
        { name: "Serrures et pièges",    link: "DEX/END", pct: 0 },
        { name: "Soigner",               link: "INT/CHA", pct: 0 },
        { name: "Survie",                link: "END/INT", pct: 0 },
        { name: "Voler",                 link: "DEX/INT", pct: 0 },
    ],
    specials: [], campaignKey: '',
    money: { couronne: 0, orbe: 0, sceptre: 0, sou: 0 },
    vials: 0, potionRecipes: [], potions: [], karma: 0,
};

const DEFAULT_CHAR_CONTEMPORARY = {
    name: "", class: "", ariaType: 'contemporary',
    stats: { PV: 0 },
    physical: { age: "", taille: "", poids: "", yeux: "", cheveux: "", signes: "", histoire: "" },
    inventory: [], weapons: [{ nom: '', degats: '' }, { nom: '', degats: '' }, { nom: '', degats: '' }],
    protection: { nom: '', valeur: 0 },
    skills: [
        { name: "Courir, sauter",          link: "", pct: 0 },
        { name: "Discrétion",              link: "", pct: 0 },
        { name: "Intimider",               link: "", pct: 0 },
        { name: "Mentir, convaincre",      link: "", pct: 0 },
        { name: "Perception",              link: "", pct: 0 },
        { name: "Psychologie",             link: "", pct: 0 },
        { name: "Réflexes",               link: "", pct: 0 },
        { name: "Soigner",                 link: "", pct: 0 },
        { name: "Armes à feu",             link: "", pct: 0 },
        { name: "Bidouiller",              link: "", pct: 0 },
        { name: "Conduire un véhicule",    link: "", pct: 0 },
        { name: "Connaissance de la ville",link: "", pct: 0 },
        { name: "Être sympathique",        link: "", pct: 0 },
        { name: "Intuition",               link: "", pct: 0 },
        { name: "Médecine légale",         link: "", pct: 0 },
        { name: "Relations louches",       link: "", pct: 0 },
        { name: "Relations respectables",  link: "", pct: 0 },
        { name: "Tabasser",                link: "", pct: 0 },
    ],
    specials: [], campaignKey: '',
    money: { francs: 0 },
    vials: 0, potionRecipes: [], potions: [], karma: 0,
};

// Character will be loaded after selection
let character = null;
let currentCharId = null;

// Per-tab unique ID — persists across refreshes (sessionStorage) but differs between tabs
let playerId = sessionStorage.getItem('aria-player-id');
if (!playerId) { playerId = uid(); sessionStorage.setItem('aria-player-id', playerId); }

let bonusMalus = 0;
// Temporary bonus/malus that auto-expires after a set number of rolls (#11).
// bmNextValue is the modifier; bmNextCount is how many upcoming threshold rolls it
// still applies to. liveBM() = persistent + active temporary (used for live previews);
// _appliedBM is the total BM stamped onto the most recent doRoll, for the roll payload.
let bmNextValue = 0;
let bmNextCount = 0;
// Hidden-roll mode (#15): while armed, rolls publish to a GM-only channel so other
// players and the overlay never receive them. The roller still sees their own card.
let hiddenRollMode = false;
let _appliedBM = 0;
let rollFilter = new Set();
let rollDateFilter = '';   // 'YYYY-MM-DD' local date; empty = no date filter
let multiplier = 1;
let isRolling = false;
let pendingDddiceRoll = null;    // { skillName, threshold } waiting for RollFinished event
let pendingSecondaryRoll = null; // { callback, mapFn } for non-d100 dice (d6, d3, weapon formula…)
let dddiceRollSafetyTimer = null; // fallback timer in case RollFinished never fires
let ablyRolls = null, ablyCards = null, ablyDamage = null, ablyMusic = null, ablyRollsHidden = null;
let ablyPresence = null;     // the aria-presence channel — its presence set IS the roster

// ── PRESENCE ──────────────────────────────────────────────────────────────────
// Who is here is not something this app computes. Every participant enters the
// presence set of the campaign's `aria-presence` channel with their character
// payload as member data; Ably maintains the membership server-side and pushes
// enter/update/leave to everyone. `presence.get()` is the roster.
//
// Two properties of that set do the work three hand-rolled session registries,
// two grace periods and a heartbeat used to do:
//
//  · One character open in several tabs is several members sharing a clientId
//    (= charId) and differing by connectionId. There is nothing to reconcile, and
//    closing one tab cannot drop the character — the other member is still there.
//  · A refresh opens a NEW connection that enters before the old one is reaped
//    (Ably waits 15s after an abrupt disconnect), so the set is never empty across
//    a reload. Nothing has to be announced on unload, so nothing has to be undone
//    afterwards: no teardown message, no grace period to ignore it, and no
//    auto-re-entry to make that grace period reachable.
//
// Members are merged by clientId below — several tabs, plus the ghost of a tab
// that refreshed, are one participant; the newest `ts` wins.
let peerCameras = new Map(); // charId → { name, streamId }
let gmStreamId = '';
let vdoRoom = '';
let vdoRoomPassword = '';
// Presence density (design frame 25): 'reduit' (dots) | 'bandeau' (rail) | 'tablee' (stage)
let presenceMode = localStorage.getItem('aria-presence-mode') || 'bandeau';
let spotlightCharId = null;   // GM spotlight — that player's face goes big for everyone
let localStageSid = '';       // locally chosen big tile in Tablée (clicking a face)
// Player-side camera kill switch. The GM decides the room; this decides whether we
// publish into it at all. Persisted per character so it survives a refresh — a
// player who opted out must not be re-broadcast by the next page load.
let cameraOff = false;
function cameraOffKey() { return charKey('camera'); }
// Toggle the local camera. Off ⇒ push iframe goes to about:blank (webcam released)
// and presence advertises no stream ID, so no peer opens a viewer on a dead stream.
function toggleCamera() {
    cameraOff = !cameraOff;
    if (currentCharId) localStorage.setItem(cameraOffKey(), cameraOff ? '1' : '0');
    console.log('[VDO] camera', cameraOff ? 'OFF (local)' : 'ON');
    updatePushIframe();   // the lock stays ours; we just stop publishing into it
    sendPresence();
    updateCamerasTabVisibility();
}
// Derive the VDO.ninja push stream ID from the first 8 chars of the character UUID.
function derivedStreamId() {
    return 'aria-' + currentCharId.slice(0, 8);
}

// ── Single-pusher lock ─────────────────────────────────────────────────────────
// The push stream ID is a pure function of charId, so two tabs on one character
// would publish into the same VDO.ninja room under the same ID. Exactly one tab may
// own the webcam — which is precisely what an exclusive Web Lock is. The browser
// grants it to one holder, queues the others, and releases it when the holder's tab
// goes away, *including a crash*: there is no unload handler to miss and no TTL to
// wait out, and the next tab in the queue starts pushing the instant the holder dies.
//
// The lock answers "which tab pushes" and nothing else. "Is anyone pushing?" is
// `vdoRoom && !cameraOff` — shared state that every tab of the character evaluates
// identically — so all of them advertise the same streamId and no consumer can see it
// flip. Conflating those two questions is what the old claim record kept getting wrong.
let pushLockHeld = false;
let _pushLockRelease = null, _pushLockAbort = null;
// Get in line for the webcam. Called once per character; held for the tab's life.
function acquirePushLock() {
    releasePushLock();
    if (!currentCharId) return;
    // Web Locks needs a secure context with a real origin — from file:// it throws.
    // Nothing can push there anyway (getUserMedia refuses too), so assume sole
    // ownership rather than leaving the character with no pusher at all.
    if (!navigator.locks) { pushLockHeld = true; updatePushIframe(); return; }
    const ac = new AbortController();
    _pushLockAbort = ac;
    try {
        navigator.locks.request('aria-push-' + currentCharId, { mode: 'exclusive', signal: ac.signal },
            () => new Promise(release => {
                _pushLockAbort = null;
                _pushLockRelease = release;
                pushLockHeld = true;
                console.log('[VDO] push lock acquired — this tab owns the webcam');
                updatePushIframe();
                renderPresenceUI();
            })
        ).catch(() => {});   // AbortError when we left the queue before being granted
    } catch (_) { pushLockHeld = true; updatePushIframe(); }
}
// Leave the queue, or hand the lock to the next tab, on character switch.
function releasePushLock() {
    if (_pushLockAbort) { try { _pushLockAbort.abort(); } catch (_) {} _pushLockAbort = null; }
    if (_pushLockRelease) { _pushLockRelease(); _pushLockRelease = null; }
    pushLockHeld = false;
}
// True when this character's stream is being published, by this tab or a sibling —
// the precondition for a self tile, which is just a muted viewer of it. Every tab
// answers this identically because both terms are shared state, so the tile cannot
// flicker and no cross-tab liveness record is needed: the browser guarantees that
// some live tab holds the lock whenever any tab of this character is open.
function selfStreamLive() {
    return !!currentCharId && !!vdoRoom && !cameraOff;
}
// Set the VDO.ninja push iframe src — iframe is full-viewport before #app-wrapper in DOM so browser grants camera access.
function updatePushIframe() {
    const pushFrame = document.getElementById('vdo-push-frame');
    if (!pushFrame) { console.warn('[VDO] updatePushIframe: #vdo-push-frame not found'); return; }
    if (!vdoRoom || !currentCharId || cameraOff || !pushLockHeld) {
        // 'about:blank', never '' — an empty src resolves to the page's own URL and
        // would load a second copy of the whole app inside the hidden iframe.
        if (pushFrame.src && pushFrame.src !== 'about:blank') pushFrame.src = 'about:blank';
        updateCamerasTabVisibility();
        return;
    }
    const sid = derivedStreamId();
    // Blank &view: "no streams will play; only publishing will be allowed" — without it
    // the push page joins the room as a full client and downloads every guest's stream.
    let src = `https://vdo.ninja/?push=${sid}&room=${encodeURIComponent(vdoRoom)}&view&autostart&webcam&noaudio&cleanoutput`;
    if (vdoRoomPassword) src += `&password=${encodeURIComponent(vdoRoomPassword)}`;
    if (pushFrame.src !== src) pushFrame.src = src;
    updateCamerasTabVisibility();
}
let ablyInstance = null;
let currentHP = null;
const knownPlayers = {}; // { charId: { name } } — other players, from the presence set
let soignerTarget = null; // null = self, or { playerId, name }
let soignerPct = 0;

// Card state — initialized after character selection

// tab access granted by GM — stored per character in localStorage
let playerTabs = { cards: false, alchemy: false };

// files granted by GM — stored per character in localStorage
let playerFiles = [];

// pending craft recipe index — set before a roll, cleared by handleResult
let pendingCraft = null;

let syncTimer      = null;


// Read a per-character JSON key, tolerating absent or corrupt values.
function _charJSON(which, charId, fallback = null) {
    const raw = localStorage.getItem(charKey(which, charId));
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (_) { return fallback; }
}

// HP / cards / tabs live in three separate localStorage keys but one DB row. This
// is the only place that mapping is written; syncCharacterState and the full sync
// used to carry a copy each, one of them with the reads inlined as IIFEs.
function _charStateRow(charId) {
    const hp = localStorage.getItem(charKey('hp', charId));
    return {
        character_id: charId,
        hp:    hp !== null ? parseInt(hp) : null,
        cards: _charJSON('cards', charId),
        tabs:  _charJSON('tabs', charId),
        updated_at: _nowISO(),
    };
}

// Full sync of all characters, states, notes and files to Supabase.
async function _syncAllPlayerData() {
    if (!_supabaseReady()) return;
    const chars = getCharacters();
    await sbPutAll(ENT.character, chars, saveKey);
    await Promise.all(chars.map(c => sbUpsert('character_state', _charStateRow(c.id))));
    for (const c of chars) {
        const notes = _charJSON('notes', c.id, []);
        await sbPutAll(ENT.characterNote, Array.isArray(notes) ? notes : [], c.id, true);
        const files = _charJSON('files', c.id, []);
        await Promise.all((Array.isArray(files) ? files : []).map(f => sbPutFile(f, c.id)));
    }
}

let _charTimer = null;
// Debounced full character sync: waits 800ms after the last call before writing.
function debouncedSync() {
    clearTimeout(_charTimer);
    _charTimer = setTimeout(_syncAllPlayerData, 800);
}

let _stateTimer = null;
// Debounced sync of the current character's HP, cards, and tabs state.
function debouncedSyncState() {
    clearTimeout(_stateTimer);
    _stateTimer = setTimeout(() => syncCharacterState(currentCharId), 800);
}

let _noteTimer = null;
// Debounced sync of a single note to Supabase.
function debouncedSyncNote(note, position = 0) {
    clearTimeout(_noteTimer);
    _noteTimer = setTimeout(() => syncCharacterNote(note, position), 800);
}

// Sync HP, cards, and tabs for a character to the character_state table.
async function syncCharacterState(charId) {
    if (!_supabaseReady() || !charId) return;
    await sbUpsert('character_state', _charStateRow(charId));
}

// Upsert a single note to the character_notes table. The notes engine owns the list
// and passes the note's position in it.
async function syncCharacterNote(note, position = 0) {
    if (!_supabaseReady() || !currentCharId || !note?.id) return;
    await sbPut(ENT.characterNote, note, currentCharId, { position: Math.max(0, position) });
}

// Delete a note from the character_notes table by ID.
async function deleteCharacterNote(id) {
    if (!_supabaseReady()) return;
    await sbDelete(ENT.characterNote.table, 'id=eq.' + encodeURIComponent(id));
}

// Upsert a GM-granted file record for a character to Supabase.
async function syncCharacterFile(file, charId) {
    if (!_supabaseReady() || !charId || !file?.id) return;
    await sbPutFile(file, charId);
}

// Delete a granted file record from Supabase by file ID.
async function deleteCharacterFile(fileId) {
    if (!_supabaseReady()) return;
    await sbDelete(ENT.characterFile.table, 'id=eq.' + encodeURIComponent(fileId));
}

// Every per-character localStorage key, named once. charKey(which, id) is the only
// way to build one, and _CHAR_KEY_PREFIXES — the list every deletion path walks —
// is derived from the same table, so a new key cannot be added to one and forgotten
// in the other. That is exactly what happened to 'aria-camera-off-': the prefix list
// and deleteCharacter each spelled the keys out by hand, neither knew about it, and
// a deleted character leaked its camera kill switch forever.
const CHAR_KEYS = {
    hp:     'aria-current-hp-',
    cards:  'aria-cards-',
    notes:  'aria-notes-',
    files:  'aria-player-files-',
    rolls:  'aria-player-rolls-',
    tabs:   'aria-player-tabs-',
    camera: 'aria-camera-off-',
};
const _CHAR_KEY_PREFIXES = Object.values(CHAR_KEYS);

// Storage key for one character's slice of `which`; defaults to the open character.
function charKey(which, id = currentCharId) { return CHAR_KEYS[which] + id; }

// Remove every scoped key belonging to one character.
function _dropCharacterKeys(id) {
    _CHAR_KEY_PREFIXES.forEach(p => localStorage.removeItem(p + id));
}

// Remove all locally stored characters and their scoped keys (used when switching
// to a different save key, so the old key's data never merges into the new one).
function _clearLocalPlayerData() {
    getCharacters().forEach(c => _dropCharacterKeys(c.id));
    localStorage.removeItem('aria-characters');
}

// Group child rows by their parent id and write one localStorage key per parent.
// Every parent that had rows gets its key rewritten; parents with none are left
// alone here — deletions are handled by the orphan sweep on the character list.
function _storeByParent(which, entity, rows, parentCol) {
    const byParent = {};
    rows.forEach(row => (byParent[row[parentCol]] ||= []).push(fromRow(entity, row)));
    Object.entries(byParent).forEach(([pid, arr]) =>
        localStorage.setItem(charKey(which, pid), JSON.stringify(arr)));
}

// Load all player data (characters, states, notes, files) from Supabase into localStorage.
// Returns true when the load completed (even if the key has no data yet), false on error —
// callers must not push local data back up after a failed load.
async function loadFromSupabase() {
    if (!_supabaseReady()) return false;
    try {
        await runMigration(saveKey, 'player');
        const chars = await sbSelect(ENT.character.table, 'save_key=eq.' + encodeURIComponent(saveKey));
        if (!chars.length) return true;

        const dbChars = chars.map(row => fromRow(ENT.character, row));
        // Clean up scoped keys of characters deleted on another device (the list
        // below is overwritten, which would otherwise orphan their HP/cards/notes).
        const dbIds = new Set(dbChars.map(c => c.id));
        getCharacters().forEach(c => {
            if (!dbIds.has(c.id)) _dropCharacterKeys(c.id);
        });
        localStorage.setItem('aria-characters', JSON.stringify(dbChars));

        const ids = chars.map(c => c.id).join(',');
        const [states, notes, files] = await Promise.all([
            sbSelect('character_state', 'character_id=in.(' + ids + ')'),
            sbSelect(ENT.characterNote.table, 'character_id=in.(' + ids + ')&order=position.asc'),
            sbSelect(ENT.characterFile.table, 'character_id=in.(' + ids + ')'),
        ]);

        states.forEach(s => {
            if (s.hp !== null && s.hp !== undefined) localStorage.setItem(charKey('hp', s.character_id), s.hp);
            if (s.cards) localStorage.setItem(charKey('cards', s.character_id), JSON.stringify(s.cards));
            if (s.tabs)  localStorage.setItem(charKey('tabs',  s.character_id), JSON.stringify(s.tabs));
        });

        _storeByParent('notes', ENT.characterNote, notes, 'character_id');
        _storeByParent('files', ENT.characterFile, files, 'character_id');

        return true;
    } catch(e) { console.warn('[ARIA] Supabase load failed:', e); return false; }
}


// ═══════════════════════════════════════════
//  CHARACTER MANAGEMENT
// ═══════════════════════════════════════════
// Shorthands for the three keys the panel reaches for most often.
function hpKey()    { return charKey('hp'); }
function cardKey()  { return charKey('cards'); }
function notesKey() { return charKey('notes'); }

// Read the characters array from localStorage.
function getCharacters() { return JSON.parse(localStorage.getItem('aria-characters') || '[]'); }
// Write the characters array to localStorage and schedule a Supabase sync.
function saveCharacters(chars) { localStorage.setItem('aria-characters', JSON.stringify(chars)); debouncedSync(); }
// Persist the current character object back into the characters array in localStorage.
function saveCurrentCharacter() {
    if (!currentCharId) return;
    const chars = getCharacters();
    const idx = chars.findIndex(c => c.id === currentCharId);
    const entry = { ...character, id: currentCharId };
    if (idx >= 0) chars[idx] = entry;
    else chars.push(entry);
    saveCharacters(chars);
    // The GM's card, the overlay's widgets and the peers' labels all read this from
    // our presence data. The 5s heartbeat used to carry sheet edits to them within a
    // tick; publishing on save is what replaces it (debounced, since an edit touches
    // several fields — and the callers here are already behind a 700ms autosave).
    schedulePresence();
}

// Migrate a single legacy aria-character entry to the multi-character array format.
function migrateIfNeeded() {
    if (localStorage.getItem('aria-characters')) return;
    const oldChar = JSON.parse(localStorage.getItem('aria-character') || 'null');
    if (!oldChar) return;
    const id = uid();
    saveCharacters([{ ...oldChar, id }]);
    const oldHp = localStorage.getItem('aria-current-hp');
    if (oldHp !== null) localStorage.setItem(charKey('hp', id), oldHp);
    const oldCards = localStorage.getItem('aria-cards');
    if (oldCards !== null) localStorage.setItem(charKey('cards', id), oldCards);
}

// Load a character by ID into module state, initializing all derived fields.
function loadCharacterState(id) {
    const chars = getCharacters();
    const data = chars.find(c => c.id === id);
    if (!data) { console.warn('[PLAYER] loadCharacterState: character not found', id); return false; }
    currentCharId = id;
    character = { ...data };
    delete character.id;
    if (!character.physical) character.physical = { age:'', taille:'', poids:'', yeux:'', cheveux:'', signes:'', histoire:'' };
    if (character.physical.histoire === undefined) character.physical.histoire = '';
    if (!character.inventory) character.inventory = [];
    if (!character.weapons) character.weapons = [{ nom:'', degats:'', favourite: false }];
    else character.weapons.forEach(w => { if (w.favourite === undefined) w.favourite = false; });
    if (!character.protection) character.protection = { nom:'', valeur:0 };
    if (!character.potions) character.potions = [];
    if (!character.potionRecipes) character.potionRecipes = [];
    if (character.vials === undefined || character.vials === null) character.vials = 0;
    if (!character.ariaType) character.ariaType = 'ancient';
    if (!character.money) {
        character.money = character.ariaType === 'contemporary'
            ? { francs: 0 }
            : { couronne: 0, orbe: 0, sceptre: 0, sou: 0 };
    }
    if (!character.specials) character.specials = [];
    if (character.karma === undefined) character.karma = 0;
    deck.load(JSON.parse(localStorage.getItem(cardKey()) || 'null'));
    playerRollHistory = JSON.parse(localStorage.getItem(charKey('rolls', id)) || '[]');
    console.log('[PLAYER] loadCharacterState:', data.name, '| class:', data.class, '| charId:', id, '| campaignKey:', data.campaignKey || 'none', '| ariaType:', data.ariaType || 'ancient', '| skills:', (data.skills || []).length, '| potionRecipes:', (data.potionRecipes || []).length);
    return true;
}

// Render the character selection grid from localStorage.
function renderSelectionScreen() {
    const chars = getCharacters();
    const grid = document.getElementById('char-grid');
    grid.innerHTML = '';
    if (chars.length === 0) {
        grid.innerHTML = '<div class="sel-empty">Aucun personnage. Créez-en un pour commencer.</div>';
        return;
    }
    chars.forEach(c => {
        const contemporary = (c.ariaType || 'ancient') === 'contemporary';
        grid.append(el('div', { className: 'sel-card', onclick: () => selectCharacter(c.id) },
            el('button', { className: 'sel-card-delete', title: 'Supprimer', textContent: '×',
                onclick: e => { e.stopPropagation(); deleteCharacter(c.id); } }),
            el('div', { className: 'sel-card-head' },
                el('span', { className: 'sel-card-diamond' }),
                el('span', { className: 'sel-card-type' + (contemporary ? ' contemporary' : ''),
                    textContent: contemporary ? 'Contemporain' : 'Médiéval' })),
            el('div', null,
                el('div', { className: 'sel-card-name', textContent: c.name || '—' }),
                el('div', { className: 'sel-card-class', textContent: c.class || '' })),
            el('div', { className: 'sel-card-campaign' + (c.campaignKey ? '' : ' no-campaign'),
                textContent: c.campaignKey ? `Code · ${c.campaignKey}` : 'Sans campagne' }),
            el('div', { className: 'sel-card-cta', textContent: 'Incarner →' })));
    });
}

// Switch the UI to the character selection screen.
function showSelectionScreen() {
    document.getElementById('selection-screen').style.display = 'flex';
    document.getElementById('app-wrapper').style.display = 'none';
    document.getElementById('new-char-form').style.display = 'none';
    renderSelectionScreen();
    updateSaveKeyStatus();
}

// Switch the UI to the main app view.
function showApp() {
    document.getElementById('selection-screen').style.display = 'none';
    document.getElementById('app-wrapper').style.display = 'flex';
}

// Remembered across reloads so a refresh comes straight back into the character.
// beforeunload publishes `leave`, which drops this player's card and camera on the
// GM, on the overlay and on every peer — landing on the selection screen and waiting
// for a click stretched that gap out to however long the click took. Cleared by an
// explicit "changer de personnage", which is a deliberate exit.
const LAST_CHAR_KEY = 'aria-last-character';

// Re-enter the character this browser was last playing, if it still exists.
function restoreLastCharacter() {
    const id = localStorage.getItem(LAST_CHAR_KEY);
    if (!id) return false;
    const chars = JSON.parse(localStorage.getItem('aria-characters') || '[]');
    if (!chars.some(c => c.id === id)) { localStorage.removeItem(LAST_CHAR_KEY); return false; }
    console.log('[PLAYER] restoring last character:', id);
    selectCharacter(id);
    return true;
}

// Select a character, load its state, start the app, and lazily load roll history.
async function selectCharacter(id) {
    if (!loadCharacterState(id)) return;
    localStorage.setItem(LAST_CHAR_KEY, id);
    showApp();
    initApp();
    if (!localStorage.getItem(charKey('rolls', id))) {
        const rows = await loadCharacterRolls(id);
        if (rows.length) {
            playerRollHistory = rows.map(r => ({ ...fromRow(ENT.characterRoll, r), char: character.name, playerId }));
            if (playerRollHistory.length > PLAYER_ROLL_HISTORY_MAX) playerRollHistory.length = PLAYER_ROLL_HISTORY_MAX;
            localStorage.setItem(charKey('rolls', id), JSON.stringify(playerRollHistory));
            renderRollHistory();
        }
    }
}

// Delete a character from localStorage and Supabase, then re-render the selection screen.
function deleteCharacter(id) {
    if (!confirm('Supprimer ce personnage ? Cette action est irréversible.')) return;
    if (localStorage.getItem(LAST_CHAR_KEY) === id) localStorage.removeItem(LAST_CHAR_KEY);
    // The child tables come from ENT, so adding a character-scoped entity cannot
    // leave rows behind here. This used to be five hand-written sbDelete calls.
    sbDeleteCascade(ENT.character, 'character_id', id);
    const chars = getCharacters().filter(c => c.id !== id);
    saveCharacters(chars);
    _dropCharacterKeys(id);
    renderSelectionScreen();
}

// Show the new-character creation form.
function createCharacter() {
    document.getElementById('new-char-form').style.display = 'flex';
    document.getElementById('new-char-name').value = '';
    document.getElementById('new-char-class').value = '';
    document.getElementById('new-char-campaign').value = '';
    const defaultRadio = document.querySelector('input[name="new-char-type"][value="ancient"]');
    if (defaultRadio) defaultRadio.checked = true;
    document.getElementById('new-char-name').focus();
}

// Create a new character from form inputs and immediately select it.
function confirmCreateCharacter() {
    const name = document.getElementById('new-char-name').value.trim() || 'Nouveau personnage';
    const cls  = document.getElementById('new-char-class').value.trim();
    const campaignKey = document.getElementById('new-char-campaign').value.trim();
    const ariaType = document.querySelector('input[name="new-char-type"]:checked')?.value || 'ancient';
    const template = ariaType === 'contemporary' ? DEFAULT_CHAR_CONTEMPORARY : DEFAULT_CHAR_ANCIENT;
    const id = uid();
    const chars = getCharacters();
    chars.push({ ...JSON.parse(JSON.stringify(template)), name, class: cls, campaignKey, id });
    saveCharacters(chars);
    document.getElementById('new-char-form').style.display = 'none';
    selectCharacter(id);
}

// Hide the new-character form without creating.
function cancelCreateCharacter() {
    document.getElementById('new-char-form').style.display = 'none';
}

// Tear down the current session (Ably, dddice, music, VDO) and return to selection screen.
function switchCharacter() {
    if (currentCharId) saveCurrentCharacter();
    if (dddiceSDK) { try { dddiceSDK.disconnect?.(); } catch(_){} dddiceSDK = null; }
    clearTimeout(dddiceRollSafetyTimer);
    pendingDddiceRoll = null; pendingSecondaryRoll = null; dddiceAPI = null;
    currentHP = null; bonusMalus = 0; bmNextValue = 0; bmNextCount = 0; _appliedBM = 0; hiddenRollMode = false; rollFilter.clear();
    pendingCraft = null; soignerTarget = null;
    Object.keys(knownPlayers).forEach(k => delete knownPlayers[k]);
    resetSplitState();
    if (_musicFadeRaf) { cancelAnimationFrame(_musicFadeRaf); _musicFadeRaf = null; }
    _stopSlot('A'); _stopSlot('B'); musicIsPlaying = false;
    const musicBar = document.getElementById('music-bar');
    if (musicBar) musicBar.style.visibility = 'hidden';
    // Closing the connection leaves the presence set — Ably tells everyone, so there
    // is no departure message to publish and nothing to await before closing.
    if (ablyInstance) { try { ablyInstance.close(); } catch(_){} ablyInstance = null; }
    ablyRolls = null; ablyRollsHidden = null; ablyCards = null; ablyDamage = null; ablyMusic = null;
    ablyPresence = null; presenceEntered = false;
    releasePushLock();   // before resetCameraState: it blanks the push iframe
    resetCameraState();
    localStorage.removeItem(LAST_CHAR_KEY);   // deliberate exit — don't auto-re-enter
    showSelectionScreen();
}

// Forget everything about the current camera session: room, peers, GM stream,
// spotlight — then blank the push iframe (releasing the webcam) and re-render so the
// rail and Caméras viewer iframes are dropped. Clearing the state alone is not
// enough: their containers only go display:none, which hides the iframes while their
// WebRTC connections stay up.
//
// Shared by switchCharacter() and by saveConfig() when the join code changes, since
// both leave the current campaign. Callers are responsible for closing the OLD Ably
// connection (which leaves its presence set) — this function does not touch Ably.
function resetCameraState() {
    vdoRoom = '';
    vdoRoomPassword = '';
    updatePushIframe();       // → about:blank, camera released
    peerCameras.clear();
    gmStreamId = '';
    spotlightCharId = null;
    localStageSid = '';
    renderPresenceUI();
}

// ═══════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
    migrateIfNeeded();
    await tryRestoreSupabase();
});

// No `beforeunload` teardown, deliberately. Announcing a departure on unload cannot
// distinguish "closing the tab" from "refreshing", which is what forced a grace
// period to ignore the announcement and then auto-re-entry to make that grace period
// reachable — three mechanisms whose combined effect on a refresh was to do nothing.
// Ably reaps the dropped connection 15s later; a refresh has already re-entered under
// a new connectionId by then, so the presence set is never empty and nobody reacts.
// The Web Lock is released by the browser on unload, crash included.

// Initialize the full player app after a character is selected.
function initApp() {
    console.log('[PLAYER] initApp: char:', character.name, '| charId:', currentCharId, '| ablyKey:', config.ablyKey ? 'set' : 'MISSING', '| dddice:', config.dddiceKey ? 'set' : 'none');
    currentHP = null;
    cameraOff = localStorage.getItem(cameraOffKey()) === '1';
    playerTabs = JSON.parse(localStorage.getItem(charKey('tabs')) || '{"cards":false,"alchemy":false}');
    playerFiles = JSON.parse(localStorage.getItem(charKey('files')) || '[]');
    initCurrentHP();
    renderAll();
    deck.mount();
    loadConfigInputs();
    if (config.dddiceKey && config.dddiceRoom) initDddice();
    if (config.ablyKey) initAbly();
    applyTabVisibility();
    document.getElementById('tab-char').addEventListener('input', scheduleAutoSave);
    document.getElementById('tab-inventory').addEventListener('input', scheduleAutoSave);
    document.getElementById('tab-alchemy').addEventListener('input', scheduleAutoSave);
    notes.load();
    // No presence heartbeat: `presence.enter` in initAbly announces us once and
    // `presence.update` publishes on change. Nothing polls, and nothing expires.
    acquirePushLock();
    document.title = character.name ? `ARIA – ${character.name}` : 'ARIA – Joueur';
    updateOverlayEditorBtn();
    const volSlider = document.getElementById('music-bar-volume');
    if (volSlider) volSlider.value = String(musicMasterVolume);
    updatePushIframe();
    // No startSelfView() here: requesting the webcam at boot lit the camera LED even
    // when no VDO room existed and the Caméras tab was never opened. renderCamerasTab()
    // asks for it only when the tab is actually shown.
}

// Configure the overlay editor button href for this character.
function updateOverlayEditorBtn() {
    const btn = document.getElementById('btn-open-overlay-editor');
    if (!btn || !currentCharId) return;
    btn.style.display = '';
    btn.onclick = () => window.open('../views/aria-overlay-editor.html?type=player&id=' + currentCharId, '_blank');
}


// Apply the shared layout pass, then the player-specific pane work.
function renderTabLayout() {
    applyTabLayout();
    // Fill the cameras grid as soon as its pane opens (renders in place).
    if (openPanes.includes('tab-cameras')) renderCamerasTab();
    renderPresenceUI(); // the rail hides while the Cameras pane is open
    finishTabLayout();
}


// ═══════════════════════════════════════════
//  NOTES
// ═══════════════════════════════════════════
// The engine is makeNotes() in aria-shared.js; this is just the character-scoped
// wiring. The HTML calls notes.add() / notes.save() / notes.rename() directly.
const notes = makeNotes({
    key: notesKey,
    ids: { list: 'notes-list', name: 'notes-name-input', area: 'notes-area' },
    sync:     (note, pos) => syncCharacterNote(note, pos),
    syncSoon: (note, pos) => debouncedSyncNote(note, pos),
    remove:   id => deleteCharacterNote(id),
});

// Show/hide conditional tabs based on GM-granted access and character type.
function applyTabVisibility() {
    const btnCards = document.getElementById('tab-btn-cards');
    const btnAlchemy = document.getElementById('tab-btn-alchemy');
    const btnFiles = document.getElementById('tab-btn-files');
    if (!btnCards || !btnAlchemy) return;
    console.log('[PLAYER] applyTabVisibility: cards=', playerTabs.cards, '| alchemy=', playerTabs.alchemy, '| files=', playerFiles.length);
    btnCards.style.display = playerTabs.cards ? '' : 'none';
    btnAlchemy.style.display = playerTabs.alchemy ? '' : 'none';
    if (btnFiles) btnFiles.style.display = playerFiles.length > 0 ? '' : 'none';
    // If the currently active tab was just hidden, fall back to Compétences
    if (!playerTabs.cards && document.getElementById('tab-cards').classList.contains('active')) {
        switchTab('tab-skills', document.querySelector('.tab-btn'));
    }
    if (!playerTabs.alchemy && document.getElementById('tab-alchemy').classList.contains('active')) {
        switchTab('tab-skills', document.querySelector('.tab-btn'));
    }
    if (!playerFiles.length && document.getElementById('tab-files')?.classList.contains('active')) {
        switchTab('tab-skills', document.querySelector('.tab-btn'));
    }
    renderInventoryEditor();
    updateCamerasTabVisibility();
    const btnStats = document.getElementById('tab-btn-stats');
    if (btnStats) {
        const isContemporary = character.ariaType === 'contemporary';
        btnStats.style.display = isContemporary ? 'none' : '';
    }
    renderTabLayout(); // re-assert layout / prune panes whose tab was just hidden
}

// Show/hide the Cameras tab. Everything it can display needs a room: a viewer URL
// without &room cannot decrypt a stream pushed into one, so with no room every tile
// would be a black rectangle. gmStreamId and peer streamIds only ever arrive
// alongside a room, so requiring it here is making the implicit precondition
// explicit — and it drops the tab the moment the session ends instead of waiting out
// the 30s peerCameras prune, which is what left black tiles on screen.
function camerasAvailable() { return !!vdoRoom; }
function updateCamerasTabVisibility() {
    const hasAny = camerasAvailable();
    const btn = document.getElementById('tab-btn-cameras');
    if (!btn) return;
    btn.style.display = hasAny ? '' : 'none';
    if (!hasAny && openPanes.includes('tab-cameras')) {
        if (openPanes.length === 1) switchTab('tab-skills');
        else renderTabLayout(); // prunes the now-hidden cameras pane
    }
    if (document.getElementById('tab-cameras')?.classList.contains('active')) {
        renderCamerasTab();
    }
    renderPresenceUI();
}

// There is no native getUserMedia self-view. It used to exist as a fallback for
// "no VDO room", but the Caméras tab only appears once a room is known
// (camerasAvailable), so the fallback could never bootstrap — dead code that implied the app
// grabbed the webcam in cases where it never did. The self tile is a muted viewer
// of our own pushed stream; the push iframe owns the camera.

// ═══════════════════════════════════════════
//  PRESENCE LAYER (design frame 25) — three densities, no separate window.
//  Réduit: initials dots in the command bar. Bandeau: face rail docked right.
//  Tablée: the Caméras tab becomes a stage (big face + column of others).
// ═══════════════════════════════════════════
function setPresenceMode(m) {
    presenceMode = m;
    localStorage.setItem('aria-presence-mode', m);
    if (m === 'tablee') {
        const btn = document.getElementById('tab-btn-cameras');
        if (btn && btn.style.display !== 'none' && !openPanes.includes('tab-cameras')) {
            // switchTab is inert while a split is open — dock a cameras pane instead
            if (openPanes.length > 1) dockTab('tab-cameras', openPanes.length);
            else switchTab('tab-cameras', btn);
        }
    }
    renderPresenceUI();
    if (document.getElementById('tab-cameras')?.classList.contains('active')) renderCamerasTab();
}

// The stream ID currently spotlighted by the GM ('' if none / unknown).
function spotlightSid() {
    if (!spotlightCharId) return '';
    // selfStreamLive() answers "is the stream published"; a *tile* additionally needs
    // the room, because a viewer URL without &room can't decrypt a stream pushed into
    // a password-protected one. The two used to be one test — they are separate now
    // that selfStreamLive() is claim-only (see its comment).
    if (spotlightCharId === currentCharId) return (vdoRoom && selfStreamLive()) ? derivedStreamId() : '';
    return peerCameras.get(spotlightCharId)?.streamId || '';
}

// Below 900px the rail folds away — but that is a CSS rule
// (#presence-rail { display:none !important }), and renderPresenceUI() decided
// `show` from JS state alone, so its inline style.display lost to the !important
// while renderPresenceRail() went on opening a viewer iframe per peer into a rail
// nobody could see: invisible WebRTC connections and bandwidth, on top of the
// Caméras grid if that pane was open. matchMedia rather than a resize listener so
// it fires exactly on the breakpoint the stylesheet uses, and only on crossings.
const railNarrowMQ = window.matchMedia('(max-width: 900px)');
railNarrowMQ.addEventListener('change', () => renderPresenceUI());

// Sync the density pills, command-bar dots, and rail with the current mode.
function renderPresenceUI() {
    const hasAny = camerasAvailable();
    const ctl = document.getElementById('presence-ctl');
    if (ctl) ctl.style.display = hasAny ? '' : 'none';
    ['reduit', 'bandeau', 'tablee'].forEach(m =>
        document.getElementById('pres-pill-' + m)?.classList.toggle('active', presenceMode === m));
    // Camera kill switch — only meaningful while a room is active
    const camBtn = document.getElementById('pres-cam-toggle');
    if (camBtn) {
        camBtn.style.display = vdoRoom ? '' : 'none';
        camBtn.classList.toggle('off', cameraOff);
        camBtn.textContent = cameraOff ? '🚫' : '📹';
        camBtn.title = cameraOff ? 'Caméra coupée — cliquer pour rétablir' : 'Couper ma caméra';
    }
    // Réduit — initials dots in the command bar ("présence sans pixels")
    const dots = document.getElementById('tb-presence-dots');
    if (dots) {
        if (hasAny && presenceMode === 'reduit') {
            // Built with createElement/textContent: peer names come from presence
            // payloads (anyone with the Ably key can publish them).
            const people = [];
            if (gmStreamId) people.push({ name: 'MJ', spotlit: false });
            peerCameras.forEach((p, charId) => {
                if (charId !== currentCharId && p.streamId) people.push({ name: p.name || '?', spotlit: charId === spotlightCharId });
            });
            dots.innerHTML = '';
            people.forEach(pp => {
                const dot = document.createElement('span');
                // Réduit used to ignore the spotlight entirely — the GM highlighted a
                // player and this density showed nothing.
                dot.className = 'pres-dot' + (pp.spotlit ? ' spotlit' : '');
                dot.title = pp.spotlit ? pp.name + ' — spotlight MJ' : pp.name;
                dot.textContent = pp.name.slice(0, 2).toUpperCase();
                dots.appendChild(dot);
            });
            dots.style.display = people.length ? '' : 'none';
        } else {
            dots.style.display = 'none';
        }
    }
    // Bandeau — face rail docked to the right edge. Suppressed while the Caméras
    // pane is open: the rail and the grid would each open a viewer iframe on the
    // same streams, doubling the WebRTC connections (and the bandwidth) per peer.
    const rail = document.getElementById('presence-rail');
    const camsOpen = openPanes.includes('tab-cameras');
    if (rail) {
        const show = hasAny && presenceMode === 'bandeau' && !camsOpen && !railNarrowMQ.matches;
        rail.style.display = show ? '' : 'none';
        if (show) renderPresenceRail();
        // Viewer iframes only — safe to drop. clearKeyed, not innerHTML, so the
        // reconciler forgets the tiles too rather than holding detached nodes.
        else clearKeyed(document.getElementById('presence-rail-grid'));
    }
    // The other half of that rule. Nothing else prunes the Caméras grid:
    // renderCamerasTab() is the only function that removes cells, and it is
    // unreachable once the pane closes — renderTabLayout just drops the .active
    // class, and .tab-content{display:none} hides the iframes while leaving their
    // WebRTC connections up. So closing the pane in Bandeau mode gave *two* live
    // viewer iframes per stream (the rail rebuilds its own set), and a session that
    // ended left iframes loaded on dead streams for good. Every path that closes the
    // pane goes through renderTabLayout() → renderPresenceUI(), so this is the one
    // place that needs it. Per-cell widths from the resize handle are lost on
    // reopen — they already were whenever a peer reconnected.
    const camGrid = document.getElementById('cameras-grid');
    if (camGrid && !camsOpen && camGrid.childElementCount) camGrid.innerHTML = '';
    // Tablée — the cameras grid renders as a stage
    camGrid?.classList.toggle('stage-mode', presenceMode === 'tablee');
    if (presenceMode === 'tablee') applyStageMain();
}

// In-place render of the Bandeau rail tiles (self · GM · peers). Viewer iframes
// are keyed by stream ID and only re-src'd when their URL changes.
function renderPresenceRail() {
    const grid = document.getElementById('presence-rail-grid');
    if (!grid) return;
    const expected = new Map(); // sid → label
    // Every tile needs the room in its URL — see camerasAvailable(). The self tile
    // already required it; the GM and peer tiles did not, so a stale streamId
    // outlived the room and rendered as a black rectangle.
    if (vdoRoom && selfStreamLive()) expected.set(derivedStreamId(), (character.name || 'Vous'));
    if (vdoRoom && gmStreamId) expected.set(gmStreamId, 'MJ');
    if (vdoRoom) peerCameras.forEach((p, charId) => { if (p.streamId && charId !== currentCharId) expected.set(p.streamId, p.name || charId); });
    const spot = spotlightSid();
    // Keyed by stream ID: the tile (and the WebRTC connection inside it) survives
    // every re-render in which its stream is still expected. The iframe is only
    // re-src'd when the URL actually changes — re-assigning the same src reloads the
    // frame and drops the connection.
    reconcile(grid, expected, () => {
        const tile = el('div', { className: 'pr-tile' },
            el('iframe', { allow: 'autoplay' }),          // viewer-only permissions
            el('div', { className: 'pr-label' }));
        tile._frame = tile.firstChild;
        tile._label = tile.lastChild;
        return tile;
    }, (tile, label, sid) => {
        const isSelf = vdoRoom && currentCharId && !cameraOff && sid === derivedStreamId();
        setFrameSrc(tile._frame, vdoViewSrc(sid, !!isSelf));
        tile._label.textContent = label;
        tile.classList.toggle('spotlit', !!spot && sid === spot);
    });
}

// The stream ID a rendered camera cell is showing, read back off its iframe URL.
// '' when the cell has no iframe (placeholder) or the URL is unparseable.
function cellSid(cell) {
    const ifr = cell?.querySelector('iframe');
    try { return ifr ? new URL(ifr.src).searchParams.get('view') || '' : ''; } catch { return ''; }
}

// Tablée stage: pick the big tile — GM spotlight wins, then the locally clicked
// face, then the GM stream, then the first tile.
function applyStageMain() {
    const grid = document.getElementById('cameras-grid');
    if (!grid) return;
    const cells = [...grid.querySelectorAll('.camera-cell')];
    if (!cells.length) return;
    // Forget a locally-promoted tile once its stream is gone, otherwise the stale
    // choice silently wins again if that peer reconnects later.
    if (localStageSid && !cells.some(c => cellSid(c) === localStageSid)) localStageSid = '';
    const want = spotlightSid() || localStageSid || gmStreamId || '';
    let main = want ? cells.find(c => cellSid(c) === want) : null;
    if (!main) main = cells[0];
    cells.forEach(c => c.classList.toggle('stage-main', c === main));
}

// Build a VDO.ninja viewer URL; the room/password params are only appended once
// known (an empty `&room=` would make VDO.ninja try to join a room named "").
function vdoViewSrc(sid, muted) {
    let src = `https://vdo.ninja/?view=${encodeURIComponent(sid)}&autoplay&cleanoutput`;
    if (muted) src += '&muted';
    // &solo is required alongside &room: without it VDO.ninja ignores &view and
    // shows the "Join Room with Camera" landing page instead of the stream.
    if (vdoRoom) src += `&solo&room=${encodeURIComponent(vdoRoom)}`;
    if (vdoRoomPassword) src += `&password=${encodeURIComponent(vdoRoomPassword)}`;
    return src;
}

// Render/update the cameras grid: self-view, GM iframe, and peer VDO.ninja iframes.
function renderCamerasTab() {
    const grid = document.getElementById('cameras-grid');
    if (!grid) { console.warn('[VDO] renderCamerasTab: #cameras-grid not found'); return; }
    // Push failure used to be silent — the self tile just stayed black and the only
    // clue was a console line. getUserMedia needs a secure context, so the file://
    // case is detectable up front; a cut camera is stated too.
    const warn = document.getElementById('cameras-warning');
    if (warn) {
        let msg = '';
        if (vdoRoom && !window.isSecureContext) {
            msg = '⚠ Caméra indisponible : la page doit être servie en HTTPS (page GitHub Pages) — depuis un fichier local le navigateur refuse l’accès webcam. Vous voyez les autres, ils ne vous voient pas.';
        } else if (vdoRoom && cameraOff) {
            msg = '📹 Votre caméra est coupée — les autres ne vous voient pas. Bouton 🚫 dans la barre du haut pour rétablir.';
        } else if (vdoRoom && !pushLockHeld) {
            // Informational, not a failure: the stream is live, this tab just isn't
            // the one publishing it. Stated because the webcam LED belongs to the
            // other tab and that is otherwise puzzling. There is no "taking over"
            // state to report any more — the lock passes the instant its holder dies.
            msg = 'ℹ Ce personnage est aussi ouvert dans un autre onglet, qui diffuse la caméra. Celui-ci se contente de la regarder — une seule webcam par personnage.';
        }
        warn.textContent = msg;
        warn.style.display = msg ? '' : 'none';
    }
    // Self tile: a muted viewer of our own pushed stream. The camera itself belongs to
    // #vdo-push-frame; there is no native <video> path. No room or camera cut ⇒ nothing
    // is being published by any tab of this character, so no self tile.
    let selfCell = grid.querySelector('.camera-cell[data-self]');
    if (vdoRoom && selfStreamLive()) {   // room required — see spotlightSid()
        const sid = derivedStreamId();
        const viewSrc = vdoViewSrc(sid, true);
        if (!selfCell) {
            selfCell = document.createElement('div');
            selfCell.className = 'camera-cell';
            selfCell.dataset.self = '1';
            const wrap = document.createElement('div');
            wrap.className = 'camera-iframe-wrap';
            const iframe = document.createElement('iframe');
            iframe.allow = 'autoplay; fullscreen';
            iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
            iframe.src = viewSrc;
            wrap.appendChild(iframe);
            const labelEl = document.createElement('div');
            labelEl.className = 'camera-label';
            labelEl.textContent = character.name || 'Vous';
            selfCell.appendChild(wrap);
            selfCell.appendChild(labelEl);
            grid.insertBefore(selfCell, grid.firstChild);
        } else {
            const existingIframe = selfCell.querySelector('iframe');
            if (!existingIframe) {
                const wrap = selfCell.querySelector('.camera-iframe-wrap');
                if (wrap) wrap.innerHTML = '';
                const targetWrap = wrap || (() => { const w = document.createElement('div'); w.className = 'camera-iframe-wrap'; selfCell.insertBefore(w, selfCell.firstChild); return w; })();
                const iframe = document.createElement('iframe');
                iframe.allow = 'autoplay; fullscreen';
                iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
                iframe.src = viewSrc;
                targetWrap.appendChild(iframe);
            } else if (existingIframe.src !== viewSrc) {
                existingIframe.src = viewSrc;
            }
            const lbl = selfCell.querySelector('.camera-label');
            if (lbl) lbl.textContent = character.name || 'Vous';
        }
    } else if (selfCell) {
        selfCell.remove();
    }
    // Build expected map: streamId → display label. Gated on the room like the self
    // tile above — a viewer URL without &room can't decrypt a stream pushed into one,
    // so a streamId that outlived the room only ever renders black.
    const expected = new Map();
    if (vdoRoom && gmStreamId) expected.set(gmStreamId, 'MJ');
    if (vdoRoom) peerCameras.forEach((p, charId) => {
        if (p.streamId && charId !== currentCharId) expected.set(p.streamId, p.name);
    });
    // Remove cells whose stream ID is no longer needed (self-view cell is excluded)
    [...grid.querySelectorAll('.camera-cell:not([data-self])')].forEach(cell => {
        const iframe = cell.querySelector('.camera-iframe');
        try {
            const sid = iframe ? new URL(iframe.src).searchParams.get('view') || '' : '';
            if (!expected.has(sid)) cell.remove();
        } catch { cell.remove(); }
    });
    // Build set of currently rendered stream IDs
    const rendered = new Map();
    grid.querySelectorAll('.camera-cell:not([data-self])').forEach(cell => {
        const iframe = cell.querySelector('.camera-iframe');
        try {
            const sid = iframe ? new URL(iframe.src).searchParams.get('view') || '' : '';
            if (sid) rendered.set(sid, cell);
        } catch {}
    });
    // Update labels for existing cells; add cells for new stream IDs
    expected.forEach((label, sid) => {
        if (rendered.has(sid)) {
            const cell = rendered.get(sid);
            const labelEl = cell.querySelector('.camera-label');
            if (labelEl) labelEl.textContent = label;
            // Re-src the iframe if the expected URL changed (e.g. the room/password
            // arrived after the cell was first created with a room-less URL).
            const iframe = cell.querySelector('.camera-iframe');
            const expectedSrc = vdoViewSrc(sid, false);
            if (iframe && iframe.src !== expectedSrc) iframe.src = expectedSrc;
        } else {
            const iframeSrc = vdoViewSrc(sid, false);
            const cell = document.createElement('div');
            cell.className = 'camera-cell';
            const wrap = document.createElement('div');
            wrap.className = 'camera-iframe-wrap';
            const iframe = document.createElement('iframe');
            iframe.src = iframeSrc;
            // Viewer-only: no camera/mic/display-capture — only #vdo-push-frame needs those.
            iframe.allow = 'autoplay; fullscreen';
            iframe.allowFullscreen = true;
            iframe.className = 'camera-iframe';
            wrap.appendChild(iframe);
            const handle = document.createElement('div');
            handle.className = 'camera-resize-handle';
            handle.addEventListener('mousedown', e => {
                const startX = e.clientX;
                const startW = wrap.offsetWidth;
                const shield = document.createElement('div');
                shield.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;cursor:nwse-resize;';
                document.body.appendChild(shield);
                const onMove = ev => { wrap.style.width = Math.max(140, startW + ev.clientX - startX) + 'px'; };
                const onUp = () => { shield.remove(); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
                e.preventDefault();
            });
            wrap.appendChild(handle);
            const labelEl = document.createElement('div');
            labelEl.className = 'camera-label';
            labelEl.textContent = label;
            cell.appendChild(wrap);
            cell.appendChild(labelEl);
            grid.appendChild(cell);
        }
    });
    // GM spotlight in the grid. It already showed on the Réduit dots and the Bandeau
    // rail, and Tablée promotes it to the big tile — but the plain grid had no cue at
    // all, and renderPresenceUI() suppresses the rail while this pane is open, so a
    // player in Bandeau with Caméras docked saw the spotlight nowhere.
    const spot = spotlightSid();
    grid.querySelectorAll('.camera-cell').forEach(cell =>
        cell.classList.toggle('spotlit', !!spot && cellSid(cell) === spot));
    if (presenceMode === 'tablee') applyStageMain();
}

// Tablée: clicking a face promotes it to the big stage tile (frame 25).
window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('cameras-grid')?.addEventListener('click', e => {
        if (presenceMode !== 'tablee') return;
        const cell = e.target.closest('.camera-cell');
        if (!cell || cell.classList.contains('stage-main')) return;
        localStageSid = cellSid(cell);
        applyStageMain();
    });
});

// ═══════════════════════════════════════════
//  HP
// ═══════════════════════════════════════════
// Return the character's max HP from stats.PV, defaulting to 14 if unset.
function getMaxHP() { return character.stats.PV || 14; }
// Initialize currentHP from localStorage, defaulting to max HP if not stored.
function initCurrentHP() {
    if (currentHP === null) currentHP = parseInt(localStorage.getItem(hpKey()));
    if (currentHP === null || isNaN(currentHP)) currentHP = getMaxHP();
}
// Update the HP number, fraction label, bar fill, and color class.
function updateHPDisplay() {
    const max = getMaxHP(), cur = Math.max(0, Math.min(currentHP, max));
    const numEl = document.getElementById('hp-number');
    numEl.textContent = cur;
    document.getElementById('hp-fraction').textContent = `/ ${max} PV`;
    const pct = max > 0 ? cur / max : 0;
    numEl.className = 'hp-number' + (pct <= 0.25 ? ' critical' : pct <= 0.5 ? ' low' : '');
    const fill = document.getElementById('hp-bar-fill');
    fill.style.width = `${pct * 100}%`;
    fill.style.background = pct > 0.5 ? 'var(--success)' : pct > 0.25 ? '#e8a020' : 'var(--fail)';
}
// Animate the HP bar from its old value to the new value with a ghost trail.
function animateHPChange(hpBefore, hpAfter, maxHP) {
    const ghost = document.getElementById('hp-bar-ghost');
    const fill = document.getElementById('hp-bar-fill');
    const oldPct = maxHP > 0 ? hpBefore / maxHP : 0;
    ghost.style.transition = 'none';
    ghost.style.width = `${oldPct * 100}%`;
    fill.style.transition = 'none';
    fill.style.width = `${oldPct * 100}%`;
    void fill.offsetWidth;
    fill.style.transition = 'width 1.1s ease, background .3s';
    const newPct = maxHP > 0 ? hpAfter / maxHP : 0;
    fill.style.width = `${newPct * 100}%`;
    fill.style.background = newPct > 0.5 ? 'var(--success)' : newPct > 0.25 ? '#e8a020' : 'var(--fail)';
    setTimeout(() => { ghost.style.transition = 'width .4s ease'; ghost.style.width = `${newPct * 100}%`; }, 1200);
}

// ═══════════════════════════════════════════
//  DAMAGE ANIMATIONS (received from GM)
// ═══════════════════════════════════════════
// Apply incoming damage from the GM: update HP, animate bar, trigger VFX.
function handleGMDamage(data) {
    const { damage, hpBefore, hpAfter, maxHP } = data;
    console.log('[PLAYER] handleGMDamage: -', damage, 'PV |', hpBefore, '→', hpAfter, '/', maxHP, hpAfter <= 0 ? '| MORT' : '');
    animateHPChange(hpBefore, hpAfter, maxHP);
    currentHP = hpAfter;
    localStorage.setItem(hpKey(), currentHP); debouncedSyncState();
    updateHPDisplay();
    schedulePresence();   // was carried by the 5s heartbeat
    triggerDamageVFX(damage, false);
    showToast('gm-dmg-toast', `Dégâts reçus : -${damage} PV`);
    if (hpAfter <= 0) showMort();
}
// Apply incoming heal from the GM: update HP, animate bar, show heal number.
function handleGMHeal(data) {
    const { amount, hpBefore, hpAfter, maxHP } = data;
    console.log('[PLAYER] handleGMHeal: +', amount, 'PV |', hpBefore, '→', hpAfter, '/', maxHP);
    animateHPChange(hpBefore, hpAfter, maxHP);
    currentHP = hpAfter;
    localStorage.setItem(hpKey(), currentHP); debouncedSyncState();
    updateHPDisplay();
    schedulePresence();   // was carried by the 5s heartbeat
    showHealNumber(amount);
    showToast('gm-heal-toast', `♥ Soins reçus : +${amount} PV`);
}
// Trigger screen shake, red vignette flash, blood particles, and floating damage number.
function triggerDamageVFX(dmg, local) {
    // screen shake
    document.body.style.animation = 'none';
    void document.body.offsetWidth;
    const shake = document.createElement('style');
    shake.textContent = '@keyframes _shake{0%,100%{transform:translate(0,0)}20%{transform:translate(-5px,2px)}40%{transform:translate(5px,-2px)}60%{transform:translate(-4px,1px)}80%{transform:translate(4px,-1px)}}';
    document.head.appendChild(shake);
    document.body.style.animation = '_shake .4s ease';
    setTimeout(() => { document.body.style.animation = ''; shake.remove(); }, 400);
    // vignette
    const v = document.getElementById('dmg-vignette');
    v.classList.add('show');
    setTimeout(() => v.classList.remove('show'), 600);
    // blood particles
    spawnBloodParticles();
    // damage number
    spawnDmgNumber(`-${dmg}`, false);
}
// Show a floating green heal number on screen.
function showHealNumber(amt) { spawnDmgNumber(`+${amt}`, true); }
// Create and animate a floating damage or heal number element on screen.
function spawnDmgNumber(txt, isHeal) {
    const node = document.createElement('div');
    node.textContent = txt;
    node.style.cssText = `position:fixed;top:40%;left:50%;transform:translate(-50%,-50%);font-family:'Cormorant Garamond',serif;font-size:64px;font-weight:900;color:${isHeal ? '#4cff88' : '#ff4444'};text-shadow:0 0 20px ${isHeal ? 'rgba(76,255,136,.5)' : 'rgba(255,50,50,.6)'};pointer-events:none;z-index:900;transition:all .9s ease-out;`;
    document.body.appendChild(node);
    void node.offsetWidth;
    node.style.transform = 'translate(-50%,-120%)';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 1000);
}
// Spawn blood splatter particles on the player's damage canvas.
function spawnBloodParticles() {
    const canvas = document.getElementById('dmg-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    const particles = [];
    for (let i = 0; i < 40; i++) particles.push({
        x: Math.random() * canvas.width, y: Math.random() * canvas.height * .4,
        vx: (Math.random() - .5) * 4, vy: Math.random() * 5 + 2,
        r: Math.random() * 4 + 1, life: 1
    });
    function frame() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let alive = false;
        for (const p of particles) {
            p.x += p.vx; p.y += p.vy; p.vy += .18; p.life -= .025;
            if (p.life <= 0) continue;
            alive = true;
            ctx.globalAlpha = p.life;
            ctx.fillStyle = `hsl(${Math.floor(Math.random() * 15)},90%,30%)`;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        if (alive) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}
// Flash the MORT screen overlay for 4 seconds.
function showMort() {
    const m = document.getElementById('mort-screen');
    m.classList.add('show');
    setTimeout(() => m.classList.remove('show'), 4000);
}
let toastTimers = {};
// Show a toast notification by element ID for 3.5 seconds.
function showToast(id, msg) {
    clearTimeout(toastTimers[id]);
    const node = document.getElementById(id);
    node.textContent = msg;
    node.classList.add('show');
    toastTimers[id] = setTimeout(() => node.classList.remove('show'), 3500);
}

// ═══════════════════════════════════════════
//  BONUS / MALUS
// ═══════════════════════════════════════════
let otherRollToastTimer = null;
// Show a toast when another player makes a roll, displaying their name and result.
function showOtherRollToast(d) {
    const isDie = d.threshold === null;
    const type = isDie ? 'die' : classify(d.roll, d.threshold, d.success);
    const vcls = { success: 's', fail: 'f', 'crit-success': 'cs', 'crit-fail': 'cf' };
    const vlbl = { success: 'SUCCÈS', fail: 'ÉCHEC', 'crit-success': 'SUCCÈS CRITIQUE', 'crit-fail': 'ÉCHEC CRITIQUE' };
    const toast = document.getElementById('other-roll-toast');
    document.getElementById('ort-char').textContent = d.char || '?';
    document.getElementById('ort-skill').textContent = d.skillName;
    document.getElementById('ort-roll').textContent = d.roll != null ? d.roll : '';
    const vEl = document.getElementById('ort-verdict');
    if (isDie || d.roll == null) { vEl.textContent = ''; vEl.className = 'ort-verdict'; }
    else { vEl.textContent = vlbl[type]; vEl.className = `ort-verdict ${vcls[type]}`; }
    toast.classList.add('show');
    clearTimeout(otherRollToastTimer);
    otherRollToastTimer = setTimeout(() => toast.classList.remove('show'), 4000);
}

// Add a value to the current bonus/malus and refresh the display.
function addBM(v) { bonusMalus += v; updateBMDisplay(); }
// Reset the bonus/malus to 0 and refresh the display.
function resetBM() { bonusMalus = 0; updateBMDisplay(); }
// Active temporary modifier value (0 once it has expired).
function bmNextActive() { return bmNextCount > 0 ? bmNextValue : 0; }
// Persistent + active temporary modifier — for live percentage previews.
function liveBM() { return bonusMalus + bmNextActive(); }

// THE definition of a roll threshold. doRoll() rolls against this number and every
// live preview displays it, so the two cannot disagree.
//
// This expression used to be hand-written at nine call sites, and they had already
// drifted: the potion card floored at 0 while doRoll floored at 1, so a recipe could
// advertise "Succès 0%" and then roll against 1. Skills folded in the per-skill
// bonus, the potion preview silently didn't. CLAUDE.md carried a paragraph telling
// the reader to remember `liveBM() + karma` at each site — that paragraph was the
// bug report for this function's absence.
//
//   base   — skill/stat/recipe percentage
//   bonus  — per-skill permanent modifier (character.skills[n].bonus)
//   skipBM — Jet libre: the typed threshold is used raw, no BM, temp or karma
function rollThreshold(base, { bonus = 0, skipBM = false } = {}) {
    const n = skipBM ? base : base + bonus + liveBM() + (character?.karma ?? 0);
    return Math.max(1, Math.min(100, n));
}
// Arm a temporary modifier for the next N threshold rolls from the bar inputs.
function setBMNext() {
    const v = parseInt(document.getElementById('bm-next-val').value);
    const n = parseInt(document.getElementById('bm-next-count').value);
    if (isNaN(v) || v === 0 || isNaN(n) || n <= 0) return;
    bmNextValue = v;
    bmNextCount = Math.min(99, n);
    document.getElementById('bm-next-val').value = '';
    document.getElementById('bm-next-count').value = '';
    updateBMDisplay();
}
// Cancel the armed temporary modifier.
function clearBMNext() { bmNextValue = 0; bmNextCount = 0; updateBMDisplay(); }
// Toggle hidden-roll mode (#15): rolls go only to the GM until toggled off again.
function toggleHiddenRoll() { hiddenRollMode = !hiddenRollMode; updateHiddenRollBtn(); }
// Reflect the hidden-roll armed state on its toggle button.
function updateHiddenRollBtn() {
    const btn = document.getElementById('hidden-roll-btn');
    if (!btn) return;
    btn.classList.toggle('active', hiddenRollMode);
    btn.textContent = hiddenRollMode ? 'Jet caché ON' : 'Jet caché';
}
// Render the karma value display with appropriate positive/negative styling.
function renderKarma() {
    const node = document.getElementById('karma-display');
    if (!node) return;
    const k = character.karma ?? 0;
    node.textContent = (k > 0 ? '+' : '') + k;
    node.className = 'karma-display' + (k > 0 ? ' positive' : k < 0 ? ' negative' : '');
}
// Apply a custom ± value from the BM input to the current bonus/malus.
function addCustomBM(sign) {
    const v = parseInt(document.getElementById('bm-custom-val').value);
    if (!isNaN(v)) { bonusMalus += sign * Math.abs(v); updateBMDisplay(); }
}
// Update the BM display label and in-place refresh all affected skill percentages.
function updateBMDisplay() {
    const node = document.getElementById('bm-display');
    node.textContent = (bonusMalus > 0 ? '+' : '') + bonusMalus;
    node.className = 'bm-display' + (bonusMalus > 0 ? ' positive' : bonusMalus < 0 ? ' negative' : '');
    // Render the armed temporary modifier pill (next N rolls).
    const ns = document.getElementById('bm-next-status');
    if (ns) {
        if (bmNextCount > 0) {
            fill(ns,
                el('span', { className: 'bm-next-mod', textContent: `${bmNextValue > 0 ? '+' : ''}${bmNextValue}` }),
                el('span', { className: 'bm-next-cnt', textContent: `${bmNextCount} jet${bmNextCount > 1 ? 's' : ''}` }),
                el('button', { className: 'bm-next-clear', title: 'Annuler', textContent: '✕', onclick: clearBMNext }));
            ns.className = 'bm-next-status ' + (bmNextValue > 0 ? 'positive' : 'negative');
            ns.style.visibility = 'visible';
        } else {
            ns.innerHTML = '';
            ns.className = 'bm-next-status';
            ns.style.visibility = 'hidden';
        }
    }
    // Update only the percentage text in existing skill elements — no DOM rebuild.
    // Lookup by stored index, not name — duplicate names would all match the first entry.
    document.getElementById('skill-list').querySelectorAll('.skill-item').forEach(div => {
        const skill = (character.skills || [])[+div.dataset.skillIdx];
        if (skill) {
            const v = rollThreshold(skill.pct, { bonus: +skill.bonus || 0 });
            div.querySelector('.skill-pct').textContent = v + '%';
            const fill = div.querySelector('.skill-bar-fill');
            if (fill) fill.style.width = v + '%';
        }
    });
    document.getElementById('special-list').querySelectorAll('.skill-item').forEach(div => {
        const sp = (character.specials || [])[+div.dataset.skillIdx];
        if (sp) div.querySelector('.skill-pct').textContent = rollThreshold(sp.pct, { bonus: +sp.bonus || 0 }) + '%';
    });
    // Recipe cards render one .potion-card-chance each, in recipe order (stock
    // cards have no chance span), so the NodeList maps 1:1 onto potionRecipes.
    document.querySelectorAll('#potion-list .potion-card-chance').forEach((node, i) => {
        const r = (character.potionRecipes || [])[i];
        if (r) node.textContent = `Succès ${rollThreshold(r.successChance || 0)}%`;
    });
    updateHiddenRollBtn();
    renderStats();          // stat cards call rollThreshold() at render time
    renderCombatSidebar();
}

// ═══════════════════════════════════════════
//  RENDER
// ═══════════════════════════════════════════
// Full re-render of all player panel sections.
// ── RENDER ────────────────────────────────────────────────────────────────────
// Two tiers, because they have different re-entrancy rules — this is the whole
// reason the old code hand-picked a different subset of renderers at each of the
// twenty-odd mutation sites.
//
// renderDerived() draws the read-only views of `character`. Nothing in them holds a
// caret, so it is always safe to run, however often.
//
// renderEditors() writes into form fields. Running it while the user is typing in
// one of those fields resets the caret, so it runs only when the change came from
// somewhere else: a button, a GM message, a character switch.
function renderDerived() {
    updateTopbarIdentity();
    document.title = character.name ? `ARIA – ${character.name}` : 'ARIA – Joueur';
    renderSkills();
    renderStats();
    updateHPDisplay();
    renderInventorySidebar();
    renderCombatSidebar();
    renderPotions();
    renderPlayerFiles();
    renderKarma();
    updateBMDisplay();
}

// renderEditorForm() fans out to the weapons/inventory/skills/specials editors.
function renderEditors() {
    renderEditorForm();
}

function renderAll() {
    renderDerived();
    renderEditors();
}

// The single commit point after mutating `character`. Persist (which also
// republishes presence), then refresh the views — instead of every call site
// remembering which three of a dozen renderers its particular field feeds.
// Pass { editors: true } when the change did not come from typing inside an editor,
// i.e. when the form fields themselves need to be rewritten.
function commitCharacter({ editors = false } = {}) {
    saveCurrentCharacter();
    renderDerived();
    if (editors) renderEditors();
}

// Render the skills and specials lists (sorted) with effective percentages applied.
function renderSkills() {
    const list = document.getElementById('skill-list');
    list.innerHTML = '';
    (character.skills || []).map((skill, idx) => ({ skill, idx })).sort((a, b) => a.skill.name.localeCompare(b.skill.name, 'fr')).forEach(({ skill, idx }) => {
        const bonus = +skill.bonus || 0;
        const eff = rollThreshold(skill.pct, { bonus });
        const div = document.createElement('div');
        const isSoigner = skill.name === 'Soigner';
        div.className = 'skill-item' + (isSoigner ? ' soigner-skill' : '');
        div.dataset.skillName = skill.name;
        div.dataset.skillIdx = idx; // index into character.skills — survives duplicate names
        fill(div,
            el('span', { className: 'skill-name', textContent: skill.name }),
            bonus && el('span', { className: 'skill-mod', title: 'Modificateur permanent', textContent: `${bonus > 0 ? '+' : ''}${bonus}` }),
            skill.link && el('span', { className: 'skill-link', textContent: skill.link }),
            el('div', { className: 'skill-bar-wrap' }, el('div', { className: 'skill-bar-fill', style: { width: eff + '%' } })),
            el('span', { className: 'skill-pct', textContent: eff + '%' }));
        if (isSoigner) {
            div.addEventListener('click', () => openSoignerTargetPicker(skill.pct + bonus));
        } else {
            div.addEventListener('click', () => doRoll(skill.name, skill.pct + bonus));
        }
        list.appendChild(div);
    });
    const slist = document.getElementById('special-list');
    slist.innerHTML = '';
    (character.specials || []).map((sp, idx) => ({ sp, idx })).sort((a, b) => a.sp.name.localeCompare(b.sp.name, 'fr')).forEach(({ sp, idx }) => {
        const bonus = +sp.bonus || 0;
        const eff = rollThreshold(sp.pct, { bonus });
        const div = document.createElement('div');
        div.className = 'skill-item';
        div.dataset.skillName = sp.name;
        div.dataset.skillIdx = idx;
        div.style.borderColor = 'rgba(236,164,86,.3)';
        fill(div,
            el('span', { className: 'skill-link', style: { color: 'var(--ember2)' }, textContent: 'Spéciale' }),
            el('span', { className: 'skill-name', textContent: sp.name },
                sp.desc && el('span', { style: { fontSize: '12px', color: 'var(--parchment-dim)' }, textContent: ` — ${sp.desc}` })),
            bonus && el('span', { className: 'skill-mod', style: { color: 'var(--ember2)' }, title: 'Modificateur permanent',
                textContent: `${bonus > 0 ? '+' : ''}${bonus}` }),
            el('span', { className: 'skill-pct', style: { color: 'var(--ember2)' }, textContent: eff + '%' }));
        div.addEventListener('click', () => doRoll(sp.name, sp.pct + bonus));
        slist.appendChild(div);
    });
}

// Render the stat grid and multiplier bar; cleared for contemporary characters.
function renderStats() {
    if (character.ariaType === 'contemporary') {
        document.getElementById('mult-bar-btns').innerHTML = '';
        document.getElementById('stat-grid').innerHTML = '';
        return;
    }
    const bar = document.getElementById('mult-bar-btns');
    fill(bar, [1, 2, 3, 4, 5].map(m => el('button', {
        className: 'mult-btn' + (multiplier === m ? ' active' : ''),
        textContent: m > 1 ? '×' + m : '×1',
        onclick: () => setMult(m),
    })));
    const grid = document.getElementById('stat-grid');
    grid.innerHTML = '';
    ['FOR', 'DEX', 'END', 'INT', 'CHA'].forEach(key => {
        const val = character.stats[key] || 0;
        const threshold = rollThreshold(val * multiplier);
        const div = document.createElement('div');
        div.className = 'stat-card';
        div.onclick = () => rollStat(key, val);
        // Big number = the live roll threshold (value × multiplier); updates with the multiplier.
        fill(div,
            el('div', { className: 'stat-key', textContent: key }),
            el('div', { className: 'stat-val', textContent: threshold }, el('span', { className: 'stat-val-pct', textContent: '%' })),
            el('div', { className: 'stat-preview', textContent: `valeur ${val} · ×${multiplier}` }));
        grid.appendChild(div);
    });
}
// Set the stat roll multiplier and re-render the stat grid.
function setMult(m) {
    multiplier = m;
    renderStats();
}

// Update the unified command bar identity cluster: stacked name + class, plus campaign code.
function updateTopbarIdentity() {
    const nameEl = document.getElementById('tb-char-name');
    const classEl = document.getElementById('tb-char-class');
    if (nameEl) nameEl.textContent = character.name || '—';
    if (classEl) classEl.textContent = character.class || '';
    const codeEl = document.getElementById('tb-campaign-code');
    const codeSep = document.getElementById('tb-code-sep');
    if (codeEl) {
        const code = (character.campaignKey || '').trim().toUpperCase();
        const show = !!code;
        codeEl.textContent = show ? code : '—';
        codeEl.style.display = show ? '' : 'none';
        if (codeSep) codeSep.style.display = show ? '' : 'none';
    }
}

// Copy the campaign join code to the clipboard from the topbar chip.
function copyCampaignCode() {
    const code = (character.campaignKey || '').trim().toUpperCase();
    if (!code) return;
    navigator.clipboard?.writeText(code);
    const codeEl = document.getElementById('tb-campaign-code');
    if (codeEl) { const prev = codeEl.textContent; codeEl.textContent = 'Copié'; setTimeout(() => { codeEl.textContent = prev; }, 1000); }
}

const MONEY_COINS = [
    { key: 'couronne', label: 'Couronne', color: '#eca456' },
    { key: 'orbe',     label: 'Orbe',     color: '#b8c4cc' },
    { key: 'sceptre',  label: 'Sceptre',  color: '#c87533' },
    { key: 'sou',      label: 'Sou',      color: '#8a8a94' },
];
// Render the inventory sidebar with items, vials (if alchemy enabled), and money.
function renderInventorySidebar() {
    const body = document.getElementById('inv-sidebar-body');
    if (!body) return;  // inventory removed from the left sidebar (lives in the Inventaire tab)
    const items = character.inventory || [];
    const vials = character.vials ?? 0;
    const showVials = playerTabs.alchemy && vials > 0;
    if (!items.length && !showVials) { fill(body, el('div', { textContent: 'Vide', style: { fontFamily: "'Cormorant Garamond',serif", fontSize: '13px', color: 'var(--parchment-dim)', fontStyle: 'italic', opacity: '.5' } })); }
    else {
        const qty = n => el('span', { style: { color: 'var(--gold-dim)', fontFamily: "'Cormorant Garamond',serif", fontSize: '12px' }, textContent: '×' + n });
        const item = (name, n) => el('div', { className: 'inv-item' },
            el('span', { style: { fontStyle: 'italic' }, textContent: name }), qty(n));
        fill(body,
            showVials && item('Fioles vides', vials),
            items.map(it => item(it.name || '—', it.qty || 1)));
    }
    const moneyEl = document.getElementById('inv-money-display');
    if (moneyEl) {
        const m = character.money || {};
        if (character.ariaType === 'contemporary') {
            const f = m.francs ?? 0;
            fill(moneyEl, f > 0 && el('span', { style: { color: 'var(--parchment-dim)' }, title: 'Francs', textContent: `${f} F` }));
        } else {
            fill(moneyEl, MONEY_COINS.map(c => {
                const v = m[c.key] ?? 0;
                return v > 0 && el('span', { style: { color: c.color }, title: c.label, textContent: '●' + v });
            }));
        }
    }
}

// Render the combat sidebar as the design's three sections: Réactions · Protection · Armes.
function renderCombatSidebar() {
    const body = document.getElementById('combat-sidebar-body');
    if (!body) return;
    const effOf = sk => rollThreshold(sk.pct, { bonus: +sk.bonus || 0 });
    const section = (label, ...kids) => el('div', { className: 'sb-section' },
        el('div', { className: 'sb-label', textContent: label }), ...kids);

    // 1 · Reactions (Parade / Esquive) — two cards
    const allSkills = [...(character.skills || []), ...(character.specials || [])];
    const isContemporary = character.ariaType === 'contemporary';
    const parrySkill = allSkills.find(sk => isContemporary ? /tabasser/i.test(sk.name) : /combat.rapproch/i.test(sk.name));
    const dodgeSkill = allSkills.find(sk => isContemporary ? /réflexes/i.test(sk.name) : /esquiv/i.test(sk.name));
    const reactBtn = (sk, label) => el('button', { className: 'react-btn', textContent: label,
        onclick: () => doRoll(sk.name, sk.pct + (+sk.bonus || 0)) },
        el('span', { className: 'react-pct', textContent: effOf(sk) + '%' }));

    // 2 · Protection — name + value badge
    const prot = character.protection || {};
    const hasProt = (prot.nom && prot.nom.trim()) || prot.valeur;

    // 3 · Armes — favourited weapons, left-border rows
    const weapons = (character.weapons || []).filter(w => w.nom.trim() && w.favourite);

    fill(body,
        (parrySkill || dodgeSkill) && section('Réactions', el('div', { className: 'react-btns' },
            parrySkill && reactBtn(parrySkill, 'Parade'),
            dodgeSkill && reactBtn(dodgeSkill, dodgeSkill.name))),

        hasProt && section('Protection', el('div', { className: 'prot-row' },
            el('span', { className: 'prot-name', textContent: prot.nom || '—' }),
            prot.valeur && el('span', { className: 'prot-val-badge', textContent: prot.valeur }))),

        section('Armes', weapons.length
            ? weapons.map(w => {
                const hasFormula = w.degats && w.degats.trim();
                return el('div', {
                    className: 'weap-row' + (hasFormula ? ' weap-rollable' : ''),
                    onclick: hasFormula ? () => rollWeaponDamage(w.nom, w.degats) : null,
                },
                    el('span', { className: 'weap-name', textContent: w.nom }),
                    el('span', { className: 'weap-dmg' },
                        hasFormula && el('span', { className: 'weap-roll-hint', textContent: 'lancer' }),
                        w.degats || '—'));
            })
            : el('div', { className: 'sb-empty', textContent: 'Aucune arme' })));
}

// ═══════════════════════════════════════════
//  ROLLS
// ═══════════════════════════════════════════
// Execute a free-threshold roll from the "Jet libre" tab form.
function doFreeRoll() {
    const name = document.getElementById('free-name').value.trim() || 'Jet libre';
    const t = parseInt(document.getElementById('free-threshold').value);
    if (isNaN(t) || t < 1 || t > 100) { alert('Seuil invalide (1-100).'); return; }
    doRoll(name, t, true);
}
// Roll a single die via dddice (3D animation); falls back to Math.random when SDK not ready.
// d3 is simulated as d6 with ceil(v/2) mapping.
// Roll a single die via the dddice SDK; falls back to Math.random if the SDK is unavailable.
async function rollDieViaDddice(sides, callback) {
    if (!dddiceAPI || !dddiceSDK || pendingDddiceRoll || pendingSecondaryRoll) {
        callback(Math.floor(Math.random() * sides) + 1);
        return;
    }
    const dieType = sides === 3 ? 'd6' : `d${sides}`;
    const mapFn   = sides === 3 ? v => Math.ceil(v / 2) : null;
    pendingSecondaryRoll = { callback, mapFn, uuid: null };
    showDddiceCanvas();
    dddiceRollSafetyTimer = setTimeout(() => {
        if (pendingSecondaryRoll) {
            pendingSecondaryRoll = null;
            hideDddiceCanvas();
            const v = Math.floor(Math.random() * sides) + 1;
            callback(v);
        }
    }, 12000);
    try {
        const res = await dddiceSDK.roll([{ type: dieType, theme: dddiceAPI.theme }]);
        if (pendingSecondaryRoll) pendingSecondaryRoll.uuid = _ddRollUuid(res);
    } catch (e) {
        clearTimeout(dddiceRollSafetyTimer);
        pendingSecondaryRoll = null;
        hideDddiceCanvas();
        callback(Math.floor(Math.random() * sides) + 1);
    }
}
// Parse "2d6+2" → { dice: ['d6','d6'], modifier: 2 }
// Parse a dice formula string like "2d6+2" into a dice type array and a flat modifier.
function formulaToDiceSpec(formula) {
    const tokens = formula.replace(/\s+/g,'').toLowerCase().split(/(?=[+-])/);
    const dice = []; let modifier = 0;
    for (const token of tokens) {
        if (!token) continue;
        const sign = token[0] === '-' ? -1 : 1;
        const raw  = token.replace(/^[+-]/,'');
        const m = raw.match(/^(\d+)d(\d+)$/);
        if (m) { for (let i = 0; i < +m[1]; i++) dice.push(`d${m[2]}`); }
        else    { modifier += sign * (+raw || 0); }
    }
    return { dice, modifier };
}
// Roll a standard die (d4/d6/d8/d10/d12/d20) and publish the result.
function rollDie(sides) {
    if (pendingDddiceRoll || pendingSecondaryRoll) return;
    rollDieViaDddice(sides, result => {
        showDieCard(`d${sides}`, result);
        const dieData = { skillName: `d${sides}`, threshold: null, roll: result, success: null, char: character.name, bonusMalus: 0, playerId };
        publishRoll(dieData);
        pushRollHistory(dieData);
    });
}

// Parse and roll a dice formula like "2d6+2", "1d8-1", "3d4", "5"
// Evaluate a dice formula string (e.g. "2d6+2") and return total and breakdown.
function rollDiceFormula(formula) {
    const expr = (formula || '').replace(/\s+/g, '').toLowerCase();
    if (!expr) return { total: 0, breakdown: '0' };
    // Split on + or - keeping the sign with the following term
    const tokens = expr.split(/(?=[+-])/);
    let total = 0;
    const parts = [];
    for (const token of tokens) {
        if (!token) continue;
        const sign = token[0] === '-' ? -1 : 1;
        const raw = token.replace(/^[+-]/, '');
        const diceMatch = raw.match(/^(\d+)d(\d+)$/);
        if (diceMatch) {
            const count = parseInt(diceMatch[1]);
            const sides = parseInt(diceMatch[2]);
            const rolls = [];
            for (let i = 0; i < count; i++) rolls.push(Math.floor(Math.random() * sides) + 1);
            const sub = rolls.reduce((a, b) => a + b, 0);
            total += sign * sub;
            const prefix = sign < 0 ? '−' : parts.length ? '+' : '';
            parts.push(`${prefix}[${rolls.join('+')}]`);
        } else {
            const num = parseInt(raw);
            if (!isNaN(num)) {
                total += sign * num;
                parts.push(`${sign < 0 ? '−' : parts.length ? '+' : ''}${num}`);
            }
        }
    }
    return { total, breakdown: parts.join(' ') };
}

// Show a weapon damage result on the float card and publish it to Ably.
function _showWeaponDamageResult(name, formula, result) {
    const card = document.getElementById('float-roll-card');
    const scrim = document.getElementById('roll-scrim');
    card.className = 'float-roll-card';
    clearTimeout(floatCardTimer);
    document.getElementById('fc-char').textContent = name;
    document.getElementById('fc-skill').textContent = formula;
    document.getElementById('fc-roll').textContent = result.total;
    document.getElementById('fc-bonus').textContent = result.breakdown !== String(result.total) ? result.breakdown : '';
    const vEl = document.getElementById('fc-verdict');
    vEl.textContent = 'Dégâts'; vEl.className = 'fc-verdict fv-success';
    document.getElementById('fc-crit-sub').textContent = '';
    void card.offsetWidth;
    scrim.classList.add('show');
    card.classList.add('show');
    floatCardTimer = setTimeout(dismissFloatCard, 5000);
    publishRoll({ skillName: `${name} (dégâts)`, threshold: null, roll: result.total, success: null, char: character.name, bonusMalus: 0, playerId });
    pushRollHistory({ skillName: `${name} (dégâts)`, threshold: null, roll: result.total, success: null, char: character.name, bonusMalus: 0, playerId });
}
// Roll weapon damage via dddice SDK if available, otherwise fall back to local RNG.
async function rollWeaponDamage(name, formula) {
    if (!formula || !formula.trim()) return;
    if (pendingDddiceRoll || pendingSecondaryRoll || !dddiceAPI || !dddiceSDK) {
        _showWeaponDamageResult(name, formula, rollDiceFormula(formula));
        return;
    }
    const { dice, modifier } = formulaToDiceSpec(formula);
    if (!dice.length) { _showWeaponDamageResult(name, formula, rollDiceFormula(formula)); return; }
    pendingSecondaryRoll = {
        callback: diceTotal => {
            const total = diceTotal + modifier;
            const breakdown = modifier !== 0 ? `${diceTotal}${modifier > 0 ? '+' : ''}${modifier}` : String(diceTotal);
            _showWeaponDamageResult(name, formula, { total, breakdown });
        },
        mapFn: null,
        uuid: null
    };
    showDddiceCanvas();
    dddiceRollSafetyTimer = setTimeout(() => {
        if (pendingSecondaryRoll) {
            pendingSecondaryRoll = null;
            hideDddiceCanvas();
            _showWeaponDamageResult(name, formula, rollDiceFormula(formula));
        }
    }, 12000);
    try {
        const res = await dddiceSDK.roll(dice.map(d => ({ type: d, theme: dddiceAPI.theme })));
        if (pendingSecondaryRoll) pendingSecondaryRoll.uuid = _ddRollUuid(res);
    } catch (e) {
        clearTimeout(dddiceRollSafetyTimer);
        pendingSecondaryRoll = null;
        hideDddiceCanvas();
        _showWeaponDamageResult(name, formula, rollDiceFormula(formula));
    }
}
// Show a plain die result on the float roll card without a verdict.
function showDieCard(diceName, result) {
    const card = document.getElementById('float-roll-card');
    const scrim = document.getElementById('roll-scrim');
    card.className = 'float-roll-card';
    clearTimeout(floatCardTimer);
    document.getElementById('fc-char').textContent = '';
    document.getElementById('fc-skill').textContent = diceName;
    document.getElementById('fc-roll').textContent = result;
    document.getElementById('fc-bonus').textContent = '';
    const vEl = document.getElementById('fc-verdict');
    vEl.textContent = ''; vEl.className = 'fc-verdict';
    document.getElementById('fc-crit-sub').textContent = '';
    void card.offsetWidth;
    scrim.classList.add('show');
    card.classList.add('show');
    floatCardTimer = setTimeout(dismissFloatCard, 5000);
}
// Main skill/stat roll: compute effective threshold and trigger dddice or local RNG.
function doRoll(skillName, basePct, skipBM = false) {
    if (isRolling) return;
    const karma = character?.karma ?? 0;
    const tempBM = skipBM ? 0 : bmNextActive();
    _appliedBM = skipBM ? 0 : (bonusMalus + tempBM);
    // Same function the previews call — the displayed % IS the rolled threshold.
    const threshold = rollThreshold(basePct, { skipBM });
    console.log('[PLAYER] doRoll:', skillName, '| base:', basePct, '| BM:', bonusMalus, '| temp:', tempBM, '| karma:', karma, '| threshold:', threshold, '| via:', dddiceAPI ? 'dddice' : 'local');
    setRolling(true);
    // Consume one charge of the armed temporary modifier (BM-affected rolls only).
    if (!skipBM && bmNextCount > 0) {
        bmNextCount--;
        if (bmNextCount === 0) bmNextValue = 0;
        updateBMDisplay();
    }
    if (dddiceAPI) rollViaDddice(skillName, threshold);
    else setTimeout(() => handleResult(skillName, threshold, Math.floor(Math.random() * 100) + 1), 600);
}
// Roll a stat check using the current multiplier.
function rollStat(key, val) {
    doRoll(`${multiplier > 1 ? multiplier + '× ' : ''}${key}`, val * multiplier);
}
// ── ROLL HISTORY ─────────────────────────────
let playerRollHistory = [];
const PLAYER_ROLL_HISTORY_MAX = 100;

// Add a roll entry to the player roll history, persist it, and sync to Supabase.
function pushRollHistory(entry) {
    const stamped = { ...entry, ts: Date.now() };
    playerRollHistory.unshift(stamped);
    if (playerRollHistory.length > PLAYER_ROLL_HISTORY_MAX) playerRollHistory.pop();
    localStorage.setItem(charKey('rolls'), JSON.stringify(playerRollHistory));
    if (_supabaseReady()) sbInsert(ENT.characterRoll.table, toRow(ENT.characterRoll, stamped, currentCharId));
    renderRollHistory();
}

// Render the roll history list with day separators and active filter pills.
function renderRollHistory() {
    const list = document.getElementById('roll-history-list');
    if (!list) return;

    let filtered = playerRollHistory;
    if (rollFilter.size > 0) {
        filtered = filtered.filter(r => {
            const isDie = r.threshold === null;
            if (isDie) return rollFilter.has('die');
            const type = classify(r.roll, r.threshold, r.success);
            const isCrit    = type === 'crit-success' || type === 'crit-fail';
            const isSuccess = type === 'success'       || type === 'crit-success';
            const isFail    = type === 'fail'          || type === 'crit-fail';
            // Succès/Échec include their critical variants; Critique catches both crits.
            if (rollFilter.has('crit')    && isCrit)    return true;
            if (rollFilter.has('success') && isSuccess) return true;
            if (rollFilter.has('fail')    && isFail)    return true;
            return false;
        });
    }
    if (rollDateFilter) {
        filtered = filtered.filter(r => r.ts && localDateKey(r.ts) === rollDateFilter);
    }

    if (!filtered.length) {
        list.innerHTML = '<div class="roll-history-empty">Aucun jet pour l\'instant.</div>';
        return;
    }

    const days = new Map();
    filtered.forEach(r => {
        const label = r.ts
            ? new Date(r.ts).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
            : 'Session en cours';
        if (!days.has(label)) days.set(label, []);
        days.get(label).push(r);
    });

    list.innerHTML = '';
    let firstDay = true;
    days.forEach((entries, label) => {
        const hdr = document.createElement('div');
        hdr.className = 'rh-day-header' + (firstDay ? ' rh-day-header-first' : '');
        hdr.textContent = label;
        list.appendChild(hdr);
        firstDay = false;
        entries.forEach(r => {
            const isDie = r.threshold === null;
            const row = document.createElement('div');
            if (isDie) {
                row.className = 'rh-row rh-die';
                fill(row,
                    el('span', { className: 'rh-skill', textContent: r.skillName }),
                    el('span', { className: 'rh-roll', textContent: +r.roll || 0 }));
            } else {
                const type = classify(r.roll, r.threshold, r.success);
                const cls = { success: 'rh-success', fail: 'rh-fail', 'crit-success': 'rh-crit-success', 'crit-fail': 'rh-crit-fail' }[type] || '';
                const lbl = { success: 'SUCCÈS', fail: 'ÉCHEC', 'crit-success': 'SUCCÈS CRIT.', 'crit-fail': 'ÉCHEC CRIT.' }[type] || '';
                row.className = `rh-row ${cls}`;
                fill(row,
                    el('span', { className: 'rh-skill', textContent: r.skillName }),
                    el('span', { className: 'rh-roll', textContent: +r.roll || 0 }),
                    el('span', { className: 'rh-verdict', textContent: lbl }));
            }
            list.appendChild(row);
        });
    });
}

// Local 'YYYY-MM-DD' key for a timestamp, matching the value emitted by <input type="date">.
function localDateKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Apply / clear the history date filter.
function setRollDateFilter(v) {
    rollDateFilter = v || '';
    const clearBtn = document.getElementById('rh-date-clear');
    if (clearBtn) clearBtn.style.display = rollDateFilter ? '' : 'none';
    renderRollHistory();
}
function clearRollDateFilter() {
    rollDateFilter = '';
    const input = document.getElementById('rh-date-filter');
    if (input) input.value = '';
    const clearBtn = document.getElementById('rh-date-clear');
    if (clearBtn) clearBtn.style.display = 'none';
    renderRollHistory();
}

// Clear roll history from memory, localStorage, and reset all filter pills.
function clearRollHistory() {
    playerRollHistory = [];
    rollFilter.clear();
    localStorage.removeItem(charKey('rolls'));
    document.querySelectorAll('#rh-filter-bar .rf-pill').forEach(btn => btn.classList.remove('active'));
    const allBtn = document.getElementById('rfp-all');
    if (allBtn) allBtn.classList.add('active');
    clearRollDateFilter();
    renderRollHistory();
}

// Toggle a roll filter pill and re-render the history list.
function toggleRollFilter(key) {
    if (key === 'all') {
        rollFilter.clear();
    } else {
        if (rollFilter.has(key)) rollFilter.delete(key);
        else rollFilter.add(key);
    }
    document.querySelectorAll('#rh-filter-bar .rf-pill').forEach(btn => btn.classList.remove('active'));
    if (rollFilter.size === 0) {
        const allBtn = document.getElementById('rfp-all');
        if (allBtn) allBtn.classList.add('active');
    } else {
        rollFilter.forEach(k => { const node = document.getElementById('rfp-' + k); if (node) node.classList.add('active'); });
    }
    renderRollHistory();
}

// Process the final dice result: show float card, publish, update history, check side-effects.
function handleResult(skillName, threshold, roll) {
    const success = roll <= threshold;
    console.log('[PLAYER] handleResult:', skillName, '| roll:', roll, '| threshold:', threshold, '|', success ? 'SUCCÈS' : 'ÉCHEC', roll <= 10 && success ? '(CRITIQUE)' : roll >= 91 && !success ? '(CRITIQUE)' : '');
    const data = { skillName, threshold, roll, success, char: character.name, bonusMalus: _appliedBM, playerId, hidden: hiddenRollMode };
    setRolling(false);
    showFloatCard(data);
    if (hiddenRollMode) publishRollHidden(data); else publishRoll(data);
    pushRollHistory(data);
    if (skillName === 'Soigner') applySoigner(success);
    if (pendingCraft !== null) { applyCraft(success, pendingCraft); pendingCraft = null; }
}
// Open the Soigner target picker modal listing self and nearby players.
function openSoignerTargetPicker(pct) {
    soignerPct = pct;
    // knownPlayers is rebuilt from the presence set on every change, so everyone in
    // it is live by construction — there is no last-seen age left to filter on.
    const others = Object.entries(knownPlayers).map(([id, p]) => ({ id, name: p.name }));
    const container = document.getElementById('stm-targets');
    container.innerHTML = '';
    const selfBtn = document.createElement('button');
    selfBtn.className = 'stm-btn';
    selfBtn.textContent = `Soi-même (${character.name})`;
    selfBtn.onclick = () => { soignerTarget = null; closeSoignerTargetPicker(); doRoll('Soigner', soignerPct); };
    container.appendChild(selfBtn);
    others.forEach(({ id, name }) => {
        const btn = document.createElement('button');
        btn.className = 'stm-btn';
        btn.textContent = name;
        btn.onclick = () => { soignerTarget = { charId: id, name }; closeSoignerTargetPicker(); doRoll('Soigner', soignerPct); };
        container.appendChild(btn);
    });
    document.getElementById('soigner-scrim').classList.add('show');
    document.getElementById('soigner-target-modal').classList.add('show');
}
// Close the Soigner target picker modal.
function closeSoignerTargetPicker() {
    document.getElementById('soigner-scrim').classList.remove('show');
    document.getElementById('soigner-target-modal').classList.remove('show');
}
// Cancel Soigner target selection and close the modal.
function cancelSoigner() {
    soignerTarget = null;
    closeSoignerTargetPicker();
}
// Apply the Soigner result: heal (1d6) on success or damage (1d3) on failure, to self or a target.
function applySoigner(success) {
    const target = soignerTarget; // capture before async delay
    soignerTarget = null;
    // The effect fires after a delay + a dice animation — if the user switches
    // characters in that window, it must not apply to the newly loaded character.
    const charAtRoll = currentCharId;
    // Small delay so the float card resolves first, then roll the secondary die via dddice
    setTimeout(() => {
        if (currentCharId !== charAtRoll) return;
        if (success) {
            rollDieViaDddice(6, heal => {
                if (currentCharId !== charAtRoll) return;
                publishRoll({ skillName: 'Soigner (soins)', threshold: null, roll: heal, success: null, char: character.name, bonusMalus: 0, playerId });
                if (!target) {
                    const max = getMaxHP();
                    const before = currentHP;
                    const after = Math.min(max, before + heal);
                    animateHPChange(before, after, max);
                    currentHP = after;
                    localStorage.setItem(hpKey(), currentHP); debouncedSyncState();
                    updateHPDisplay();
                    showHealNumber(heal);
                    showToast('gm-heal-toast', `♥ Soins : +${heal} PV`);
                    sendPresence();
                } else {
                    if (ablyDamage) ablyDamage.publish('heal', { targetId: target.charId, amount: heal, source: 'player' });
                    showToast('gm-heal-toast', `♥ Soins : +${heal} PV → ${target.name}`);
                }
            });
        } else {
            rollDieViaDddice(3, dmg => {
                if (currentCharId !== charAtRoll) return;
                publishRoll({ skillName: 'Soigner (blessure)', threshold: null, roll: dmg, success: null, char: character.name, bonusMalus: 0, playerId });
                if (!target) {
                    const max = getMaxHP();
                    const before = currentHP;
                    const after = Math.max(0, before - dmg);
                    animateHPChange(before, after, max);
                    currentHP = after;
                    localStorage.setItem(hpKey(), currentHP); debouncedSyncState();
                    updateHPDisplay();
                    triggerDamageVFX(dmg, true);
                    showToast('gm-dmg-toast', `Blessure : -${dmg} PV`);
                    if (after <= 0) showMort();
                    sendPresence();
                } else {
                    if (ablyDamage) ablyDamage.publish('damage', { targetId: target.charId, damage: dmg, source: 'player' });
                    showToast('gm-dmg-toast', `Blessure : -${dmg} PV → ${target.name}`);
                }
            });
        }
    }, 1500);
}
let floatCardTimer = null;
// Show the floating roll result card with verdict text and crit particle effects.
function showFloatCard(data) {
    const card = document.getElementById('float-roll-card');
    const scrim = document.getElementById('roll-scrim');
    const type = classify(data.roll, data.threshold, data.success);
    card.className = 'float-roll-card';
    clearTimeout(floatCardTimer);
    document.getElementById('fc-char').textContent = data.char || '';
    document.getElementById('fc-skill').textContent = data.skillName;
    document.getElementById('fc-roll').textContent = data.roll;
    document.getElementById('fc-bonus').textContent = data.bonusMalus && data.bonusMalus !== 0 ? `(Modificateur : ${data.bonusMalus > 0 ? '+' : ''}${data.bonusMalus})` : '';
    const vEl = document.getElementById('fc-verdict');
    const sEl = document.getElementById('fc-crit-sub');
    sEl.textContent = '';
    switch (type) {
        case 'crit-success': vEl.textContent = 'SUCCÈS CRITIQUE'; vEl.className = 'fc-verdict fv-crit-success'; sEl.textContent = '✦ les dieux sourient ✦'; card.classList.add('crit-success'); spawnFcParticles('success'); break;
        case 'crit-fail': vEl.textContent = 'ÉCHEC CRITIQUE'; vEl.className = 'fc-verdict fv-crit-fail'; sEl.textContent = '✦ les dieux se détournent ✦'; card.classList.add('crit-fail'); spawnFcParticles('fail'); break;
        case 'success': vEl.textContent = 'SUCCÈS'; vEl.className = 'fc-verdict fv-success'; break;
        case 'fail': vEl.textContent = 'ÉCHEC'; vEl.className = 'fc-verdict fv-fail'; break;
    }
    void card.offsetWidth;
    scrim.classList.add('show');
    card.classList.add('show');
    const dur = (type === 'crit-success' || type === 'crit-fail') ? 8000 : 5000;
    floatCardTimer = setTimeout(dismissFloatCard, dur);
}
// Dismiss the float roll card with an exit animation and stop particles.
function dismissFloatCard() {
    clearTimeout(floatCardTimer);
    const card = document.getElementById('float-roll-card');
    const scrim = document.getElementById('roll-scrim');
    card.classList.remove('show');
    card.classList.add('leaving');
    scrim.classList.remove('show');
    stopFcParticles();
    setTimeout(() => { card.className = 'float-roll-card'; }, 320);
}
// Set the rolling lock state and toggle the rolling indicator chip.
function setRolling(v) {
    isRolling = v;
    document.getElementById('rolling-ind').classList.toggle('active', v);
}

// ═══════════════════════════════════════════
//  ROLL PARTICLES
// ═══════════════════════════════════════════
const fcCanvas = document.getElementById('fc-particles');
const fcCtx = fcCanvas.getContext('2d');
let fcParticles = [], fcAnimFrame = null;
// Resize the float card particle canvas to the window dimensions.
function resizeFcCanvas() { fcCanvas.width = window.innerWidth; fcCanvas.height = window.innerHeight; }
resizeFcCanvas();
window.addEventListener('resize', resizeFcCanvas);
// Spawn confetti particles on the float card canvas for crit success or fail.
function spawnFcParticles(type) {
    fcParticles = [];
    const cx = fcCanvas.width / 2, cy = fcCanvas.height / 2;
    for (let i = 0; i < 70; i++) {
        const angle = Math.random() * Math.PI * 2, speed = 2.5 + Math.random() * 5.5;
        let hue, sat, lit;
        if (type === 'success') { hue = Math.random() > .45 ? 110 + Math.random() * 30 : 42 + Math.random() * 15; sat = 80 + Math.random() * 20; lit = 55 + Math.random() * 35; }
        else { hue = Math.random() > .4 ? Math.random() * 15 : 18 + Math.random() * 12; sat = 85 + Math.random() * 15; lit = 45 + Math.random() * 35; }
        fcParticles.push({ x: cx, y: cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 1.5, r: 2.5 + Math.random() * 4, color: `hsl(${hue},${sat}%,${lit}%)`, alpha: 1, gravity: .1 + Math.random() * .1, decay: .011 + Math.random() * .014, star: Math.random() > .55 });
    }
    if (fcAnimFrame) cancelAnimationFrame(fcAnimFrame);
    loopFcParticles();
}
// rAF loop that updates and draws the float card particle system each frame.
function loopFcParticles() {
    fcCtx.clearRect(0, 0, fcCanvas.width, fcCanvas.height);
    fcParticles = fcParticles.filter(p => p.alpha > .02);
    for (const p of fcParticles) {
        p.x += p.vx; p.y += p.vy; p.vy += p.gravity; p.alpha -= p.decay;
        fcCtx.save(); fcCtx.globalAlpha = Math.max(0, p.alpha); fcCtx.fillStyle = p.color; fcCtx.shadowColor = p.color; fcCtx.shadowBlur = 8; fcCtx.translate(p.x, p.y);
        if (p.star) { drawFcStar(fcCtx, p.r); } else { fcCtx.beginPath(); fcCtx.arc(0, 0, p.r / 2, 0, Math.PI * 2); fcCtx.fill(); }
        fcCtx.restore();
    }
    if (fcParticles.length) fcAnimFrame = requestAnimationFrame(loopFcParticles);
    else { fcCtx.clearRect(0, 0, fcCanvas.width, fcCanvas.height); fcAnimFrame = null; }
}
// Draw a 4-pointed star for float card particle effects.
function drawFcStar(ctx, r) { const spikes = 4, out = r / 2, inn = r / 5; let rot = -Math.PI / 2; ctx.beginPath(); for (let i = 0; i < spikes * 2; i++) { const radius = i % 2 === 0 ? out : inn; ctx.lineTo(Math.cos(rot) * radius, Math.sin(rot) * radius); rot += Math.PI / spikes; } ctx.closePath(); ctx.fill(); }
// Stop the float card particle animation and clear the canvas.
function stopFcParticles() { if (fcAnimFrame) { cancelAnimationFrame(fcAnimFrame); fcAnimFrame = null; } fcCtx.clearRect(0, 0, fcCanvas.width, fcCanvas.height); fcParticles = []; }

// Connect to dddice and route finished rolls into this panel's pending state. The
// connection itself is initDddiceSDK() in aria-shared.js.
//
// Other participants' animations never show here: #dddice-wrap is visibility:hidden
// until this tab calls showDddiceCanvas() before rolling. The SDK holds the canvas
// element, not the wrapper, so it cannot override that.
async function initDddice() {
    const ok = await initDddiceSDK(roll => {
        // Ignore another participant's dice landing while ours is pending — only
        // enforced when both UUIDs are known (older SDK shapes skip the check).
        const finishedUuid = _ddRollUuid(roll);
        const pendingUuid = pendingDddiceRoll?.uuid ?? pendingSecondaryRoll?.uuid;
        if (pendingUuid && finishedUuid && finishedUuid !== pendingUuid) return;
        const settle = () => {
            clearTimeout(dddiceRollSafetyTimer);
            setTimeout(() => { dddiceSDK?.clear(); hideDddiceCanvas(); }, 1500);
        };
        if (pendingDddiceRoll) {
            const { skillName, threshold } = pendingDddiceRoll;
            pendingDddiceRoll = null;
            settle();
            const total = roll.total_value ?? 0;
            handleResult(skillName, threshold, total === 0 ? 100 : total);
        } else if (pendingSecondaryRoll) {
            const { callback, mapFn } = pendingSecondaryRoll;
            pendingSecondaryRoll = null;
            settle();
            const total = roll.total_value ?? 1;
            callback(mapFn ? mapFn(total) : total);
        }
        // else: not our roll — the canvas is already hidden, nothing to do
    });
    if (!ok) return;
    // Warm the 3D assets without creating a server-side roll, so the first real roll
    // is instant. loadThemeResources is an internal SDK method.
    try {
        if (typeof dddiceSDK.loadThemeResources === 'function') {
            await dddiceSDK.loadThemeResources([
                { type: 'd10x', theme: dddiceAPI.theme },
                { type: 'd10',  theme: dddiceAPI.theme },
            ]);
        }
    } catch (_) {}
}
// Show the dddice canvas wrapper (makes the 3D dice animation visible).
function showDddiceCanvas() { const w = document.getElementById('dddice-wrap'); if (w) w.style.visibility = 'visible'; }
// Hide the dddice canvas wrapper.
function hideDddiceCanvas() { const w = document.getElementById('dddice-wrap'); if (w) w.style.visibility = 'hidden'; }

// Trigger a d100 roll (d10x + d10) via the dddice SDK with a 12s safety fallback.
async function rollViaDddice(skillName, threshold) {
    if (!dddiceSDK) { handleResult(skillName, threshold, Math.floor(Math.random() * 100) + 1); return; }
    try {
        pendingDddiceRoll = { skillName, threshold, uuid: null };
        showDddiceCanvas();
        // Safety fallback: if RollFinished never fires (e.g. network drop after roll creation),
        // unblock the UI after 12s. Cleared by the RollFinished handler on success.
        dddiceRollSafetyTimer = setTimeout(() => {
            if (pendingDddiceRoll?.skillName === skillName) {
                pendingDddiceRoll = null;
                hideDddiceCanvas();
                handleResult(skillName, threshold, Math.floor(Math.random() * 100) + 1);
            }
        }, 12000);
        const res = await dddiceSDK.roll([{ type: 'd10x', theme: dddiceAPI.theme }, { type: 'd10', theme: dddiceAPI.theme }]);
        if (pendingDddiceRoll) pendingDddiceRoll.uuid = _ddRollUuid(res);
        // Do NOT clear the timer here — roll() resolves on API response (~200ms),
        // well before the animation ends. RollFinished handles the clear.
    } catch (e) { console.error('dddice roll:', e); pendingDddiceRoll = null; hideDddiceCanvas(); handleResult(skillName, threshold, Math.floor(Math.random() * 100) + 1); }
}

// ═══════════════════════════════════════════
//  MUSIC ENGINE (PLAYER)
// ═══════════════════════════════════════════
let _playerMusicList  = [];


// Advance to the next track when the current one ends; stops if the list is exhausted.
function _musicAutoAdvance() {
    if (!_playerMusicList.length) return;
    const nextIdx = musicCurrentIndex + 1 < _playerMusicList.length ? musicCurrentIndex + 1 : -1;
    if (nextIdx === -1) { musicIsPlaying = false; return; }
    _musicTriggerPlay(_playerMusicList[nextIdx], nextIdx);
}


// Update the music bar title and make it visible when a track starts.
function _updatePlayerMusicBar(track) {
    const bar   = document.getElementById('music-bar');
    const title = document.getElementById('music-bar-title');
    if (!bar || !title) return;
    if (track) {
        title.textContent = track.name;
        bar.style.visibility = 'visible';
    }
}

// Handle volume slider change: persist the value and apply it to the active slot.
function onMusicVolumeChange(val) {
    musicMasterVolume = parseInt(val);
    localStorage.setItem('aria-music-volume', String(musicMasterVolume));
    _musicMuted = false;            // moving the slider unmutes
    _updateMusicMuteIcon();
    _setSlotVol(_musicCurrentSlot, _musicEffVol());
}

// Toggle mute from the speaker icon — silences audio but leaves the slider untouched.
function toggleMusicMute() {
    _musicMuted = !_musicMuted;
    _setSlotVol(_musicCurrentSlot, _musicEffVol());
    _updateMusicMuteIcon();
}
function _updateMusicMuteIcon() {
    const ic = document.getElementById('music-bar-vol-icon');
    if (ic) {
        ic.textContent = _musicMuted ? '⊘' : '♪';
        ic.title = _musicMuted ? 'Réactiver le son' : 'Couper le son';
    }
}

// Initialize Ably channels and subscribe to all game events (rolls, damage, music, cards).
function initAbly() {
    console.log('[PLAYER] initAbly: connecting with key', config.ablyKey?.slice(0, 8) + '...', '| campaign channel suffix:', character.campaignKey || '(global)');
    try {
        // clientId is the character UUID: it is what identifies us in the presence
        // set, and what every consumer keys this participant by. Two tabs share it
        // and are told apart by the connectionId Ably assigns each connection, so
        // there is no per-tab id to invent, publish, or reconcile.
        ablyInstance = new Ably.Realtime({ key: config.ablyKey, clientId: currentCharId, transports: ['web_socket'] });
        ablyRolls = ablyInstance.channels.get(campaignChannel('aria-rolls'));
        ablyRollsHidden = ablyInstance.channels.get(campaignChannel('aria-rolls-hidden'));
        ablyCards = ablyInstance.channels.get(campaignChannel('aria-cards'));
        ablyDamage = ablyInstance.channels.get(campaignChannel('aria-damage'));
        ablyMusic = ablyInstance.channels.get(campaignChannel('aria-music'));
        ablyMusic.subscribe('music', msg => {
            const d = msg.data;
            if (!d) return;
            if (d.type === 'play' && d.track) {
                console.log('[PLAYER] music PLAY received:', d.track.name, '| fade:', d.fadeDuration);
                if (d.fadeDuration) musicFadeDuration = d.fadeDuration;
                const existingIdx = _playerMusicList.findIndex(t => t.id === d.track.id);
                if (existingIdx >= 0) {
                    if (musicCurrentIndex !== existingIdx || !musicIsPlaying) {
                        _musicTriggerPlay(_playerMusicList[existingIdx], existingIdx);
                    }
                } else {
                    _playerMusicList.push(d.track);
                    _musicTriggerPlay(d.track, _playerMusicList.length - 1);
                }
            } else if (d.type === 'stop') {
                console.log('[PLAYER] music STOP received');
                if (_musicFadeRaf) { cancelAnimationFrame(_musicFadeRaf); _musicFadeRaf = null; }
                _stopSlot('A');
                _stopSlot('B');
                musicIsPlaying = false;
                const bar = document.getElementById('music-bar');
                if (bar) bar.style.visibility = 'hidden';
            } else if (d.type === 'pause') {
                console.log('[PLAYER] music PAUSE received');
                const slot = _musicCurrentSlot;
                if (_musicSlots[slot].audio) _musicSlots[slot].audio.pause();
                const yt = slot === 'A' ? _ytSlotA : _ytSlotB;
                if (yt) { try { yt.pauseVideo(); } catch(_) {} }
                musicIsPlaying = false;
            } else if (d.type === 'resume') {
                console.log('[PLAYER] music RESUME received');
                const slot = _musicCurrentSlot;
                if (_musicSlots[slot].audio) _musicSlots[slot].audio.play().catch(() => _showMusicUnlockPrompt(() => _musicSlots[slot].audio?.play()));
                const yt = slot === 'A' ? _ytSlotA : _ytSlotB;
                if (yt) { try { yt.playVideo(); } catch(_) {} }
                musicIsPlaying = true;
            }
        });
        ablyInstance.connection.on('connected',    () => { console.log('[PLAYER] Ably connected'); setAblyStatus(true); sendPresence(); });
        ablyInstance.connection.on('failed',       () => { console.error('[PLAYER] Ably connection FAILED'); setAblyStatus(false); });
        ablyInstance.connection.on('disconnected', () => console.warn('[PLAYER] Ably disconnected'));
        ablyInstance.connection.on('suspended',    () => console.warn('[PLAYER] Ably suspended'));
        // The roster. Any change to the set — someone entered, left, or updated their
        // data — is re-read in full rather than patched, so there is no local replica
        // that can drift from the server's.
        ablyPresence = ablyInstance.channels.get(campaignChannel('aria-presence'));
        ablyPresence.presence.subscribe(() => refreshPresenceSet());
        sendPresence();
        // Targeted messages are addressed to the CHARACTER, not to one tab. Every tab
        // of a character receives and applies them, so a message can no longer be
        // delivered to the one tab that just closed — which is what the "repoint the
        // stored playerId at a surviving session" dance existed to avoid.
        const myId = currentCharId;
        ablyDamage.subscribe(msg => {
            const d = msg.data;
            if (!d) return;
            // Handle player-to-player heal/damage (from another player's Soigner)
            if (d.source === 'player') {
                if (d.targetId === myId) {
                    if (msg.name === 'heal') {
                        const amount = d.amount || 0;
                        const max = getMaxHP();
                        const before = currentHP;
                        const after = Math.min(max, before + amount);
                        handleGMHeal({ amount, hpBefore: before, hpAfter: after, maxHP: max });
                        sendPresence();
                    } else if (msg.name === 'damage') {
                        const damage = d.damage || 0;
                        const max = getMaxHP();
                        const before = currentHP;
                        const after = Math.max(0, before - damage);
                        handleGMDamage({ damage, hpBefore: before, hpAfter: after, maxHP: max });
                        sendPresence();
                    }
                }
                return;
            }
            if (msg.name === 'tab-config') {
                if (d.charId !== myId) return;
                console.log('[PLAYER] tab-config received:', JSON.stringify(d.tabs));
                playerTabs = { ...playerTabs, ...d.tabs };
                localStorage.setItem(charKey('tabs'), JSON.stringify(playerTabs));
                debouncedSyncState();
                applyTabVisibility();
                schedulePresence();   // `tabs` rides along in our presence data
                return;
            }
            if (msg.name === 'potion-grant') {
                if (d.charId !== myId) return;
                if (!d.potion) return;
                console.log('[PLAYER] potion-grant received:', d.potion.name);
                if (!character.potionRecipes) character.potionRecipes = [];
                if (!character.potionRecipes.find(r => r.id === d.potion.id)) {
                    character.potionRecipes.push({ ...d.potion });
                    saveCurrentCharacter();
                    renderPotions();
                    showToast('gm-heal-toast', `Recette reçue : ${d.potion.name}`);
                }
                return;
            }
            if (msg.name === 'potion-revoke') {
                if (d.charId !== myId) return;
                console.log('[PLAYER] potion-revoke received:', d.potionId);
                character.potionRecipes = (character.potionRecipes || []).filter(r => r.id !== d.potionId);
                saveCurrentCharacter();
                renderPotions();
                return;
            }
            if (msg.name === 'vial-grant') {
                if (d.charId !== myId) return;
                console.log('[PLAYER] vial-grant received:', d.qty, 'vials');
                character.vials = (character.vials ?? 0) + (d.qty || 1);
                saveCurrentCharacter();
                renderPotions();
                const n = d.qty || 1;
                showToast('gm-heal-toast', `${n} fiole${n > 1 ? 's' : ''} reçue${n > 1 ? 's' : ''}`);
                return;
            }
            if (msg.name === 'file-grant') {
                if (d.charId !== myId && d.charId !== 'all') return;
                if (!d.file?.id) return;
                console.log('[PLAYER] file-grant received:', d.file.name, '| for:', d.charId === 'all' ? 'all' : 'me');
                if (!playerFiles.find(f => f.id === d.file.id)) {
                    playerFiles.push(d.file);
                    localStorage.setItem(charKey('files'), JSON.stringify(playerFiles));
                    syncCharacterFile(d.file, currentCharId);
                    applyTabVisibility();
                    renderPlayerFiles();
                    showToast('gm-heal-toast', `Document reçu : ${d.file.name}`);
                }
                return;
            }
            if (msg.name === 'file-revoke') {
                if (d.charId !== myId && d.charId !== 'all') return;
                if (!d.fileId) return;
                console.log('[PLAYER] file-revoke received:', d.fileId);
                playerFiles = playerFiles.filter(f => f.id !== d.fileId);
                localStorage.setItem(charKey('files'), JSON.stringify(playerFiles));
                deleteCharacterFile(d.fileId);
                applyTabVisibility();
                renderPlayerFiles();
                return;
            }
            if (msg.name === 'karma-set') {
                if (d.charId !== myId) return;
                console.log('[PLAYER] karma-set received:', d.karma);
                character.karma = d.karma ?? 0;
                saveCurrentCharacter();
                renderKarma();
                updateBMDisplay();
                renderCombatSidebar();
                return;
            }
            if (d.targetId && d.targetId !== myId) return;
            if (msg.name === 'damage') { console.log('[PLAYER] GM damage received: -', d.damage, 'PV | HP:', d.hpBefore, '→', d.hpAfter, '/', d.maxHP); handleGMDamage(d); }
            if (msg.name === 'heal')   { console.log('[PLAYER] GM heal received: +',  d.amount,  'PV | HP:', d.hpBefore, '→', d.hpAfter, '/', d.maxHP); handleGMHeal(d); }
        });
        ablyRolls.subscribe('roll', msg => {
            const d = msg.data;
            // Rolls still carry the per-tab `playerId` — it is what suppresses the
            // toast for our OWN roll, and it is deliberately not the charId: a second
            // tab of this character should still be told about a roll made in the
            // first. (`myId` above is the charId, which addresses the character.)
            if (!d || d.playerId === playerId) return;
            console.log('[PLAYER] other player rolled:', d.char, '| skill:', d.skillName, '| roll:', d.roll, '| threshold:', d.threshold, '|', d.success ? 'SUCCÈS' : 'ÉCHEC');
            showOtherRollToast(d);
        });
        // Listen for other players' card draws
        ablyCards.subscribe('draw', msg => {
            const d = msg.data;
            if (!d || !d.playerName || d.playerName === character.name) return;
            const card = cardById(d.cardId);
            const label = card
                ? (card.isJoker ? card.label : `${card.rank} de ${SUIT_FR[card.suit.name] || card.suit.name}`)
                : d.cardId;
            showOtherRollToast({ char: d.playerName, skillName: '🃏 ' + label, roll: null, threshold: null, success: null });
        });
    } catch (e) { console.error('Ably:', e); setAblyStatus(false); }
}
// Publish a roll event to the aria-rolls Ably channel.
function publishRoll(data) { if (ablyRolls) ablyRolls.publish('roll', data); }
// Publish a hidden roll to the GM-only channel (other players + overlay never subscribe to it).
function publishRollHidden(data) { if (ablyRollsHidden) ablyRollsHidden.publish('roll', data); }
// Build and copy the OBS overlay URL for this player to the clipboard.
function copyOverlayUrl() {
    const base = window.location.href.replace(/aria-player\.html.*$/, 'aria-overlay.html');
    const params = new URLSearchParams({ mode: 'player', ably: config.ablyKey || '' });
    if (config.dddiceKey) params.set('dddice_key', config.dddiceKey);
    if (config.dddiceRoom) params.set('dddice_room', extractRoomSlug(config.dddiceRoom));
    if (currentCharId) params.set('overlay', 'player_' + currentCharId);  // loads this character's overlay editor layout
    if (character.campaignKey) params.set('campaign', character.campaignKey);  // scopes the rolls/cards/damage channels to this campaign
    const url = `${base}?${params}`;
    navigator.clipboard.writeText(url).then(() => {
        const btn = document.querySelector('.config-modal button[onclick="copyOverlayUrl()"]');
        const orig = btn.textContent;
        btn.textContent = '✓ Copié !';
        setTimeout(() => btn.textContent = orig, 2000);
    });
}
// Publish a card event (draw/reshuffle) to the aria-cards Ably channel.
function publishCard(type, extra = {}) {
    if (ablyCards) ablyCards.publish(type, { ...extra, ...deck.state() });
}
// ── Presence: publish ─────────────────────────────────────────────────────────
let presenceEntered = false;
let _presenceTimer = null;
// The member data this tab publishes. Sent on entry and on every change — never on
// a timer, so a table sitting still costs nothing.
function presenceData() {
    // Advertise a stream ID only while this character's camera is actually being
    // published: an ID nobody is pushing makes every receiver open a viewer iframe on
    // a dead stream — a black box on the GM's card, on each peer's rail, and on the
    // OBS output. selfStreamLive() is shared state, so every tab of this character
    // publishes the same value and the tile cannot flip between them.
    return {
        role: 'player',
        charId: currentCharId, name: character.name, charClass: character.class,
        hp: currentHP, maxHP: getMaxHP(), stats: character.stats,
        protection: character.protection,
        skills: character.skills,
        specials: character.specials,
        weapons: character.weapons,
        inventory: character.inventory,
        potions: character.potions,
        vials: character.vials ?? 0,
        potionRecipeIds: (character.potionRecipes || []).map(r => r.id),
        tabs: playerTabs,
        money: character.money || { couronne: 0, orbe: 0, sceptre: 0, sou: 0 },
        karma: character.karma ?? 0,
        campaignKey: character.campaignKey || '',
        ariaType: character.ariaType || 'ancient',
        streamId: selfStreamLive() ? derivedStreamId() : '',
        ts: Date.now(),
    };
}
// Announce ourselves, or republish after a change. `enter` is only used once; the
// SDK re-enters automatically after a reconnect, so there is no resend loop here.
function sendPresence() {
    if (!ablyPresence) return;
    const d = presenceData();
    if (presenceEntered) {
        ablyPresence.presence.update(d).catch(err => console.error('[PLAYER] presence update:', err));
    } else {
        ablyPresence.presence.enter(d).then(
            () => { presenceEntered = true; console.log('[PLAYER] entered presence as', currentCharId); },
            err => console.error('[PLAYER] presence enter:', err));
    }
}
// Coalesce bursts — editing the character sheet touches several fields in a row.
function schedulePresence() {
    clearTimeout(_presenceTimer);
    _presenceTimer = setTimeout(sendPresence, 250);
}

// Collapse members to participants. Several tabs of one person share a clientId and
// differ by connectionId; so does the ghost of a tab that refreshed, until Ably reaps
// it 15s later. Newest ts wins, which is always a live tab.
function _mergeMembers(members) {
    const byId = new Map();
    (members || []).forEach(m => {
        const key = m.clientId || '';
        const d = m.data || {};
        if (!key) return;
        const prev = byId.get(key);
        if (!prev || (d.ts || 0) >= (prev.ts || 0)) byId.set(key, d);
    });
    return byId;
}
function applyPresenceSet(members) {
    const byId = _mergeMembers(members);
    // The GM decides the room, the MJ tile and the spotlight. No members ⇒ no GM ⇒
    // no session: the room goes and the push iframe stops. A GM refresh does not
    // reach this state, because the reconnected tab has already entered by the time
    // the dropped connection is reaped.
    const gm = [...byId.values()].find(d => d.role === 'gm');
    const room = gm ? (gm.vdoRoom || '') : '';
    const pw = gm ? (gm.vdoRoomPassword || '') : '';
    const roomChanged = room !== vdoRoom || pw !== vdoRoomPassword;
    vdoRoom = room;
    vdoRoomPassword = pw;
    gmStreamId = gm ? (gm.streamId || '') : '';
    spotlightCharId = gm ? (gm.spotlightCharId || null) : null;
    // Peers, for the camera tiles and the Soigner target picker. Both are keyed by
    // charId: Soigner now targets the character, so every tab of the target applies
    // the HP change and none of them can be addressed after closing.
    peerCameras.clear();
    Object.keys(knownPlayers).forEach(k => delete knownPlayers[k]);
    byId.forEach((d, charId) => {
        if (d.role !== 'player' || charId === currentCharId) return;
        knownPlayers[charId] = { name: d.name };
        if (d.streamId) peerCameras.set(charId, { name: d.name || charId, streamId: d.streamId });
    });
    // The room is what decides whether we publish at all, so a change to it changes
    // the stream ID we advertise — say so now rather than leaving receivers to guess.
    if (roomChanged) { updatePushIframe(); sendPresence(); }
    updateCamerasTabVisibility();   // → renderPresenceUI + renderCamerasTab
}
// Update the Ably status dot and text labels in the topbar and config modal.
function setAblyStatus(ok) {
    // classList (not className=) so extra classes like .tb-conn-dot on the topbar dot survive.
    ['ably-dot', 'cfg-ably-dot2'].forEach(id => { const node = document.getElementById(id); if (node) { node.classList.add('status-dot'); node.classList.remove('connected', 'error'); node.classList.add(ok ? 'connected' : 'error'); } });
    ['ably-status', 'cfg-ably-status2'].forEach(id => { const node = document.getElementById(id); if (node) node.textContent = ok ? 'Ably connecté' : 'Ably erreur'; });
}

window.addEventListener('storage', e => {
    if (e.key === 'aria-config') {
        const newCfg = JSON.parse(e.newValue || '{}');
        config = { ...config, ...newCfg };
        applyTheme(!!config.lightMode);
        return;
    }
    // The kill switch is per-character localStorage state, and selfStreamLive() reads
    // it — so every tab of this character has to agree on it or they would advertise
    // different stream IDs under the same clientId and the tile would flip between
    // them. (`storage` fires only in the *other* tabs, so this never re-enters the
    // tab that made the change.)
    if (currentCharId && e.key === cameraOffKey()) {
        const off = e.newValue === '1';
        if (off === cameraOff) return;
        cameraOff = off;
        console.log('[VDO] camera', cameraOff ? 'OFF' : 'ON', '(synced from another tab)');
        updatePushIframe();
        sendPresence();
        updateCamerasTabVisibility();
    }
});
// Populate the config modal inputs from the current config and character.
function loadConfigInputs() {
    const idEl = document.getElementById('cfg-identity-display');
    if (idEl) idEl.textContent = character.name || '—';
    document.getElementById('cfg-campaign-key').value = character.campaignKey || '';
    document.getElementById('cfg-dddice-theme').value = config.dddiceTheme || '';
    document.getElementById('cfg-light-mode').checked = !!config.lightMode;
}
// Save config modal changes to localStorage and reinitialize Ably and dddice.
function saveConfig() {
    const newCampaignKey = document.getElementById('cfg-campaign-key').value.trim().toUpperCase();
    // Editing the join code re-subscribes every channel onto another campaign's
    // suffix (campaignChannel() reads character.campaignKey), so it is a campaign
    // switch and needs the same teardown switchCharacter does — otherwise the push
    // iframe goes on broadcasting the webcam into the room of the campaign just left
    // and the old table's peer tiles stay live. Leaving the old campaign's presence
    // set is handled by closing the old connection.
    const campaignChanged = newCampaignKey !== (character.campaignKey || '');
    character.campaignKey = newCampaignKey;
    saveCurrentCharacter();
    config = {
        ...config,
        dddiceTheme: document.getElementById('cfg-dddice-theme').value || '',
        lightMode: document.getElementById('cfg-light-mode').checked,
    };
    localStorage.setItem('aria-config', JSON.stringify(config));
    teardownDddice();
    clearTimeout(dddiceRollSafetyTimer);
    pendingDddiceRoll = null;
    // Close the old Ably connection before reinit — nulling the refs without closing
    // leaves the old WebSocket subscribed, duplicating every incoming message. The
    // close is also what leaves the old campaign's presence set, so there is nothing
    // to publish first and nothing to await before closing.
    if (ablyInstance) { try { ablyInstance.close(); } catch (_) {} }
    ablyRolls = null; ablyRollsHidden = null; ablyCards = null; ablyDamage = null; ablyMusic = null; ablyInstance = null;
    ablyPresence = null; presenceEntered = false;
    if (campaignChanged) {
        resetCameraState();
        // Soigner targets are campaign-scoped too; the new campaign's presence set
        // repopulates the picker.
        Object.keys(knownPlayers).forEach(k => delete knownPlayers[k]);
    }
    if (config.dddiceKey && config.dddiceRoom) initDddice();
    if (config.ablyKey) initAbly();
}

// ═══════════════════════════════════════════
//  CHARACTER EDITOR
// ═══════════════════════════════════════════
// Populate all character editor form inputs from the current character object.
function renderEditorForm() {
    document.getElementById('ed-name').value = character.name;
    document.getElementById('ed-class').value = character.class || '';
    const attrsBlock = document.getElementById('cs-attrs-block');
    if (attrsBlock) {
        attrsBlock.querySelectorAll('.cs-attr:not(.cs-attr-pv)').forEach(node => {
            node.style.display = character.ariaType === 'contemporary' ? 'none' : '';
        });
    }
    if (character.ariaType !== 'contemporary') {
        document.getElementById('ed-for').value = character.stats.FOR ?? 0;
        document.getElementById('ed-dex').value = character.stats.DEX ?? 0;
        document.getElementById('ed-end').value = character.stats.END ?? 0;
        document.getElementById('ed-int').value = character.stats.INT ?? 0;
        document.getElementById('ed-cha').value = character.stats.CHA ?? 0;
    }
    document.getElementById('ed-pv').value = character.stats.PV ?? 0;
    const p = character.physical || {};
    document.getElementById('ed-age').value = p.age || '';
    document.getElementById('ed-taille').value = p.taille || '';
    document.getElementById('ed-poids').value = p.poids || '';
    document.getElementById('ed-yeux').value = p.yeux || '';
    document.getElementById('ed-cheveux').value = p.cheveux || '';
    document.getElementById('ed-signes').value = p.signes || '';
    document.getElementById('ed-histoire').value = p.histoire || '';
    const prot = character.protection || {};
    document.getElementById('ed-prot-nom').value = prot.nom || '';
    document.getElementById('ed-prot-val').value = prot.valeur || 0;
    renderWeaponsEditor();
    renderInventoryEditor();
    renderSkillsEditor();
    renderSpecialsEditor();
}
// Render the weapons editor list with name, damage, and favourite star toggle.
function renderWeaponsEditor() {
    const list = document.getElementById('weapons-editor-list');
    if (!list) return;
    list.innerHTML = '';
    (character.weapons || []).forEach((w, i) => {
        const row = document.createElement('div');
        row.className = 'weap-row';
        fill(row,
            el('input', { className: 'editor-input', value: w.nom, placeholder: "Nom de l'arme",
                oninput: e => { character.weapons[i].nom = e.target.value; renderCombatSidebar(); } }),
            el('input', { className: 'editor-input weap-dmg', value: w.degats, placeholder: 'ex: 2d6+2',
                oninput: e => { character.weapons[i].degats = e.target.value; renderCombatSidebar(); } }),
            el('button', { className: 'weap-fav-btn' + (w.favourite ? ' active' : ''), textContent: '★',
                title: 'Équipée (affichée dans la barre de combat)', onclick: () => toggleWeaponFavourite(i) }),
            el('button', { className: 'del-btn', textContent: '✕', onclick: () => removeWeapon(i) }));
        list.appendChild(row);
    });
}
// Add a new empty weapon slot and re-render the weapons editor.
function addWeapon() {
    if (!character.weapons) character.weapons = [];
    character.weapons.push({ nom: '', degats: '', favourite: false });
    commitCharacter({ editors: true });
}
// Remove a weapon by index and re-render the editor and combat sidebar.
function removeWeapon(i) {
    character.weapons.splice(i, 1);
    commitCharacter({ editors: true });
}
// Toggle a weapon's equipped (favourite) status and refresh both editor and combat sidebar.
function toggleWeaponFavourite(i) {
    character.weapons[i].favourite = !character.weapons[i].favourite;
    commitCharacter({ editors: true });
}
// Render the money editor fields based on character type (ancient coins vs. contemporary francs).
function renderMoneyEditor() {
    const node = document.getElementById('inv-money-editor');
    if (!node) return;
    const m = character.money || {};
    // Each denomination is its own box: label on the left, − value + on the right (value editable).
    const coinBox = (key, label, color) => el('div', { className: 'money-box' },
        el('span', { className: 'money-box-label', textContent: label },
            color && el('span', { className: 'money-box-dot', style: { color }, textContent: '●' })),
        el('div', { className: 'money-box-ctrl' },
            el('button', { className: 'qty-btn', textContent: '−', onclick: () => bumpMoney(key, -1) }),
            el('input', { className: 'money-box-input', type: 'text', inputMode: 'numeric', value: m[key] ?? 0,
                oninput: e => updateMoney(key, e.target.value) }),
            el('button', { className: 'qty-btn', textContent: '+', onclick: () => bumpMoney(key, 1) })));
    fill(node, el('div', { className: 'inv-money-grid' },
        character.ariaType === 'contemporary'
            ? coinBox('francs', 'Francs', '')
            : MONEY_COINS.map(c => coinBox(c.key, c.label, c.color))));
}
// Update a single money denomination value (from the editable field).
function updateMoney(key, val) {
    if (!character.money) {
        character.money = character.ariaType === 'contemporary'
            ? { francs: 0 }
            : { couronne: 0, orbe: 0, sceptre: 0, sou: 0 };
    }
    character.money[key] = parseInt(val.replace(/[^0-9]/g, '')) || 0;
    commitCharacter();   // typed into the money field — leave the editors alone
}
// Increment/decrement a money denomination via the +/- buttons.
function bumpMoney(key, delta) {
    if (!character.money) {
        character.money = character.ariaType === 'contemporary'
            ? { francs: 0 }
            : { couronne: 0, orbe: 0, sceptre: 0, sou: 0 };
    }
    character.money[key] = Math.max(0, (character.money[key] || 0) + delta);
    commitCharacter({ editors: true });
}
// Render the inventory editor list with item rows and vials counter if alchemy is enabled.
function renderInventoryEditor() {
    renderMoneyEditor();
    const list = document.getElementById('inv-editor-list');
    if (!list) return;
    list.innerHTML = '';
    // Name stays editable; quantity is adjusted only via the +/- buttons.
    const qtyCtrl = (value, dec, inc, decDisabled) => el('div', { className: 'inv-qty-ctrl' },
        el('button', { className: 'qty-btn', textContent: '−', disabled: !!decDisabled, onclick: dec }),
        el('span', { className: 'inv-qty-val', textContent: value }),
        el('button', { className: 'qty-btn', textContent: '+', onclick: inc }));
    fill(list, (character.inventory || []).map((it, i) => el('div', { className: 'inv-row' },
        el('input', { className: 'inv-name-input', value: it.name || '', placeholder: "Nom de l'objet",
            oninput: e => { character.inventory[i].name = e.target.value; } }),
        qtyCtrl(it.qty || 1, () => bumpInventoryQty(i, -1), () => bumpInventoryQty(i, 1)),
        el('button', { className: 'del-btn', textContent: '✕', onclick: () => removeInventoryRow(i) }))));
    if (playerTabs.alchemy) {
        const v = character.vials ?? 0;
        list.insertBefore(el('div', { className: 'inv-row inv-row-vials' },
            el('span', { className: 'inv-vials-name', textContent: 'Fioles vides' }),
            qtyCtrl(v, () => changeVials(-1), () => changeVials(1), v <= 0),
            el('span')), list.firstChild);
    }
}
// Adjust an inventory item's quantity via the +/- buttons (min 0).
function bumpInventoryQty(i, delta) {
    if (!character.inventory[i]) return;
    character.inventory[i].qty = Math.max(0, (character.inventory[i].qty || 0) + delta);
    commitCharacter({ editors: true });
}
// Add a new empty inventory item and refresh the editor and sidebar.
function addInventoryRow() { character.inventory.push({ name: '', qty: 1 }); commitCharacter({ editors: true }); }
// Remove an inventory item by index and refresh the editor and sidebar.
function removeInventoryRow(i) { character.inventory.splice(i, 1); commitCharacter({ editors: true }); }

// ── POTIONS ──────────────────────────────────
// Render the alchemy tab: vials counter, known recipes, and crafted potions stock.
function renderPotions() {
    const container = document.getElementById('potion-list');
    const empty = document.getElementById('alchemy-empty');
    if (!container) return;
    const recipes = character.potionRecipes || [];
    const potions = character.potions || [];
    const vials = character.vials ?? 0;

    container.innerHTML = '';

    // Vials counter
    container.append(el('div', { className: 'alchemy-vials' },
        el('span', { className: 'alchemy-vials-label', textContent: 'Fioles vides' }),
        el('div', { className: 'alchemy-vials-ctrl' },
            el('button', { className: 'qty-btn', textContent: '−', disabled: vials <= 0, onclick: () => changeVials(-1) }),
            el('span', { className: 'vial-count', textContent: vials }),
            el('button', { className: 'qty-btn', textContent: '+', onclick: () => changeVials(1) }))));

    // Recipes section — card grid (design frame 09)
    if (recipes.length) {
        const hdr = document.createElement('div');
        hdr.className = 'alchemy-section-hdr';
        hdr.textContent = 'Recettes connues';
        container.appendChild(hdr);
        const grid = document.createElement('div');
        grid.className = 'potion-grid';
        recipes.forEach((r, i) => {
            const chance = rollThreshold(r.successChance || 0);
            const meta = [r.ingredients || '', r.desc || ''].filter(Boolean).join(' — ');
            grid.append(el('div', { className: 'potion-card' },
                el('div', { className: 'potion-card-top' },
                    el('span', { className: 'potion-card-name', textContent: r.name })),
                el('div', { className: 'potion-card-desc', textContent: meta || '\u00a0' }),
                el('div', { className: 'potion-card-foot' },
                    el('span', { className: 'potion-card-chance', textContent: `Succès ${chance}%` }),
                    el('button', { className: 'potion-card-action', textContent: 'Créer →',
                        disabled: vials <= 0 || isRolling, onclick: () => craftPotion(i) }))));
        });
        container.appendChild(grid);
    }

    // Crafted potions section — card grid
    const stock = potions.filter(p => p.name);
    if (stock.length) {
        const hdr = document.createElement('div');
        hdr.className = 'alchemy-section-hdr';
        hdr.textContent = 'Potions en stock';
        container.appendChild(hdr);
        const grid = document.createElement('div');
        grid.className = 'potion-grid';
        potions.forEach((p, i) => {
            if (!p.name) return;
            grid.append(el('div', { className: 'potion-card' + (!p.qty ? ' depleted' : '') },
                el('div', { className: 'potion-card-top' },
                    el('span', { className: 'potion-card-name', textContent: p.name }),
                    el('span', { className: 'potion-card-qty' + (!p.qty ? ' depleted' : ''), textContent: `×${p.qty ?? 0}` })),
                el('div', { className: 'potion-card-desc', textContent: p.desc || '\u00a0' }),
                el('div', { className: 'potion-card-foot' },
                    el('button', { className: 'potion-card-del', title: 'Retirer', textContent: '✕', onclick: () => removePotion(i) }),
                    el('button', { className: 'potion-card-action use', textContent: 'Utiliser →',
                        disabled: !p.qty, onclick: () => usePotion(i) }))));
        });
        container.appendChild(grid);
    }

    const hasContent = recipes.length > 0 || stock.length > 0;
    if (empty) empty.style.display = hasContent ? 'none' : '';
}


// Increment or decrement the vials counter and update all related views.
function changeVials(delta) {
    character.vials = Math.max(0, (character.vials ?? 0) + delta);
    commitCharacter({ editors: true });
}
// Toggle the custom potion add form visibility.
function toggleCustomPotionForm() {
    const form = document.getElementById('custom-potion-form');
    if (!form) return;
    form.style.display = form.style.display === 'none' ? '' : 'none';
}
// Add a custom (non-recipe) potion to stock from the form inputs.
function addCustomPotion() {
    const name = (document.getElementById('cpf-name')?.value || '').trim();
    if (!name) return;
    const desc = (document.getElementById('cpf-desc')?.value || '').trim();
    if (!character.potions) character.potions = [];
    const existing = character.potions.find(p => p.name === name && !p.recipeId);
    if (existing) { existing.qty = (existing.qty || 0) + 1; }
    else { character.potions.push({ name, desc, qty: 1 }); }
    document.getElementById('cpf-name').value = '';
    document.getElementById('cpf-desc').value = '';
    saveCurrentCharacter();
    renderPotions();
    sendPresence();
}
// Spend a vial and trigger a craft skill roll for the given recipe index.
function craftPotion(recipeIdx) {
    if ((character.vials ?? 0) <= 0 || isRolling) return;
    const recipe = (character.potionRecipes || [])[recipeIdx];
    if (!recipe) return;
    character.vials = (character.vials ?? 0) - 1;
    saveCurrentCharacter();
    // Store the recipe id, not the index — a potion-revoke arriving before the
    // roll resolves would shift indexes and credit the wrong recipe.
    pendingCraft = recipe.id;
    doRoll(recipe.name, recipe.successChance || 0);
}
// Apply the craft roll result: add to stock on success, show toast, update inventory.
function applyCraft(success, recipeId) {
    const charAtRoll = currentCharId; // bail if the user switches characters mid-delay
    setTimeout(() => {
        if (currentCharId !== charAtRoll) return;
        const recipe = (character.potionRecipes || []).find(r => r.id === recipeId);
        if (!recipe) return;
        if (success) {
            if (!character.potions) character.potions = [];
            const existing = character.potions.find(p => p.recipeId === recipe.id);
            if (existing) {
                existing.qty = (existing.qty || 0) + 1;
            } else {
                character.potions.push({ recipeId: recipe.id, name: recipe.name, qty: 1 });
            }
            if (!character.inventory) character.inventory = [];
            const invEntry = character.inventory.find(i => i.name === recipe.name);
            if (invEntry) { invEntry.qty = (invEntry.qty || 0) + 1; }
            else { character.inventory.push({ name: recipe.name, qty: 1 }); }
            showToast('gm-heal-toast', `${recipe.name} créée avec succès !`);
        } else {
            showToast('gm-dmg-toast', `Création échouée — fiole brisée`);
        }
        saveCurrentCharacter();
        renderPotions();
        renderInventoryEditor();
        renderInventorySidebar();
        sendPresence();
    }, 1500);
}
// Remove a crafted potion from stock by index.
function removePotion(i) {
    if (!character.potions) return;
    character.potions.splice(i, 1);
    saveCurrentCharacter();
    renderPotions();
}
// Consume one unit of a potion, decrement inventory, and show a toast.
function usePotion(i) {
    const p = character.potions[i];
    if (!p || !p.qty) return;
    p.qty--;
    const invEntry = (character.inventory || []).find(it => it.name === p.name);
    if (invEntry && invEntry.qty > 0) invEntry.qty--;
    saveCurrentCharacter();
    renderPotions();
    renderInventoryEditor();
    renderInventorySidebar();
    showToast('gm-heal-toast', `${p.name || 'Potion'} utilisée${p.qty > 0 ? ` (×${p.qty} restante${p.qty > 1 ? 's' : ''})` : ' — épuisée'}`);
}
// Render the skills percentage editor list, sorted alphabetically.
function renderSkillsEditor() {
    const list = document.getElementById('skills-editor-list');
    if (!list) return;
    list.innerHTML = '';
    (character.skills || []).map((sk, i) => ({ sk, i }))
        .sort((a, b) => a.sk.name.localeCompare(b.sk.name, 'fr'))
        .forEach(({ sk, i }) => {
            const row = document.createElement('div');
            row.className = 'skill-editor-row';
            fill(row,
                el('span', { className: 'sname', textContent: sk.name }),
                el('input', { className: 'spct', type: 'text', inputMode: 'numeric', value: sk.pct, title: 'Seuil de base (%)',
                    oninput: e => { e.target.value = e.target.value.replace(/[^0-9]/g, ''); character.skills[i].pct = +e.target.value || 0; } }),
                el('input', { className: 'smod', type: 'text', inputMode: 'numeric', value: sk.bonus ? sk.bonus : '',
                    placeholder: 'mod', title: 'Modificateur permanent (±)',
                    oninput: e => { e.target.value = e.target.value.replace(/[^0-9-]/g, '').replace(/(?!^)-/g, ''); character.skills[i].bonus = parseInt(e.target.value) || 0; } }));
            list.appendChild(row);
        });
}
// Render the special skills editor list with name, percentage, and description inputs.
function renderSpecialsEditor() {
    const list = document.getElementById('specials-editor-list');
    if (!list) return;
    list.innerHTML = '';
    (character.specials || []).forEach((sp, i) => {
        const row = document.createElement('div');
        row.className = 'specials-row';
        fill(row,
            el('input', { value: sp.name || '', placeholder: 'Nom',
                oninput: e => { character.specials[i].name = e.target.value; } }),
            el('input', { type: 'text', inputMode: 'numeric', value: sp.pct || 0,
                oninput: e => { e.target.value = e.target.value.replace(/[^0-9]/g, ''); character.specials[i].pct = +e.target.value || 0; } }),
            el('input', { type: 'text', inputMode: 'numeric', value: sp.bonus ? sp.bonus : '', placeholder: 'mod',
                title: 'Modificateur permanent (±)',
                oninput: e => { e.target.value = e.target.value.replace(/[^0-9-]/g, '').replace(/(?!^)-/g, ''); character.specials[i].bonus = parseInt(e.target.value) || 0; } }),
            el('input', { value: sp.desc || '', placeholder: 'Description',
                oninput: e => { character.specials[i].desc = e.target.value; } }),
            el('button', { className: 'del-btn', textContent: '✕', onclick: () => removeSpecial(i) }));
        list.appendChild(row);
    });
}
// Add a new empty special skill entry and re-render.
function addSpecialRow() { character.specials.push({ name: '', desc: '', pct: 0 }); commitCharacter({ editors: true }); }
// Remove a special skill by index and re-render.
function removeSpecial(i) { character.specials.splice(i, 1); commitCharacter({ editors: true }); }
// Read all character editor form inputs back into the character object.
function readEditorInputs() {
    character.name = document.getElementById('ed-name').value.trim();
    character.class = document.getElementById('ed-class').value.trim();
    if (character.ariaType !== 'contemporary') {
        character.stats.FOR = +document.getElementById('ed-for').value;
        character.stats.DEX = +document.getElementById('ed-dex').value;
        character.stats.END = +document.getElementById('ed-end').value;
        character.stats.INT = +document.getElementById('ed-int').value;
        character.stats.CHA = +document.getElementById('ed-cha').value;
    }
    character.stats.PV = +document.getElementById('ed-pv').value;
    character.physical = {
        age: document.getElementById('ed-age').value.trim(),
        taille: document.getElementById('ed-taille').value.trim(),
        poids: document.getElementById('ed-poids').value.trim(),
        yeux: document.getElementById('ed-yeux').value.trim(),
        cheveux: document.getElementById('ed-cheveux').value.trim(),
        signes: document.getElementById('ed-signes').value.trim(),
        histoire: document.getElementById('ed-histoire').value.trim(),
    };
    character.protection = { nom: document.getElementById('ed-prot-nom').value.trim(), valeur: +document.getElementById('ed-prot-val').value || 0 };
}

let autoSaveTimer = null;
// Debounce an auto-save of the character after 700ms of inactivity.
function scheduleAutoSave() {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(autoSaveChar, 700);
}
// Auto-save: read editor inputs, adjust HP if max PV changed, and refresh the UI.
function autoSaveChar() {
    if (!document.getElementById('tab-char')?.classList.contains('active')) {
        saveCurrentCharacter();
        return;
    }
    initCurrentHP();
    const oldMax = character.stats.PV;
    readEditorInputs();
    const newMax = character.stats.PV;
    if (newMax !== oldMax) {
        if (newMax > oldMax) {
            currentHP = Math.min(newMax, currentHP + (newMax - oldMax));
        } else {
            currentHP = Math.min(currentHP, newMax);
        }
        localStorage.setItem(hpKey(), currentHP);
    }
    // Derived views only — the caret is in an editor field right now. That rule used
    // to be an inlined list of renderers here; it is commitCharacter's default.
    commitCharacter();
    sendPresence();   // immediate, rather than the 250ms debounce saveCurrentCharacter arms
    flashSaveStatus();
}
let saveStatusTimer = null;
// Briefly flash the "saved" status indicator in the character editor.
function flashSaveStatus() {
    const node = document.getElementById('cs-save-status');
    if (!node) return;
    node.classList.add('show');
    clearTimeout(saveStatusTimer);
    saveStatusTimer = setTimeout(() => node.classList.remove('show'), 2000);
}

// ═══════════════════════════════════════════
//  CARD SYSTEM
// ═══════════════════════════════════════════
// The engine is makeDeck() in aria-shared.js. The player's deck is the shared one:
// persisted per character and mirrored to the table over Ably.
const deck = makeDeck({
    persist: saveCardState,
    publish: (type, extra) => publishCard(type, { ...extra, playerName: character.name }),
    fly: animateFly,
    announce: async remainingOnly => {
        const flash = document.getElementById('reshuffle-flash');
        document.getElementById('reshuffle-msg').textContent = remainingOnly ? '↺ Restant mélangé' : '↺ Mélangé';
        flash.classList.add('show');
        await delay(900);
        flash.classList.remove('show');
    },
});

// Persist the deck state and schedule the Supabase state sync.
function saveCardState() {
    localStorage.setItem(cardKey(), JSON.stringify(deck.state()));
    debouncedSyncState();
}

// Animate a card flying from the deck position to the stage area.
async function animateFly() {
    const stage = document.querySelector('.card-stage');
    const wrap = document.getElementById('deck-wrap');
    const flyEl = document.getElementById('fly-card');
    const deckRect = wrap.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const cw = deckRect.width, ch = deckRect.height, sx = deckRect.left, sy = deckRect.top;
    const ex = stageRect.left + (stageRect.width - cw) / 2, ey = stageRect.top + (stageRect.height - ch) / 2;
    const mx = (sx + ex) / 2, my = Math.min(sy, ey) - 30;
    flyEl.style.cssText = `left:${sx}px;top:${sy}px;width:${cw}px;height:${ch}px;opacity:1;`;
    flyEl.style.setProperty('--fly-x0', '0px'); flyEl.style.setProperty('--fly-y0', '0px');
    flyEl.style.setProperty('--fly-xm', `${mx - sx}px`); flyEl.style.setProperty('--fly-ym', `${my - sy}px`);
    flyEl.style.setProperty('--fly-x1', `${ex - sx}px`); flyEl.style.setProperty('--fly-y1', `${ey - sy}px`);
    flyEl.classList.remove('flying'); flyEl.getBoundingClientRect(); flyEl.classList.add('flying');
    await delay(430); flyEl.classList.remove('flying'); flyEl.style.opacity = '0';
}

// ═══════════════════════════════════════════
//  PLAYER FILES
// ═══════════════════════════════════════════
// Return a short uppercase type tag for a file MIME type (mono label, no emoji).
function _pfFileIcon(type) {
    if (!type) return 'DOC';
    if (type.startsWith('image/')) return 'IMG';
    if (type === 'application/pdf') return 'PDF';
    if (type.startsWith('text/')) return 'TXT';
    return 'DOC';
}

// Render the GM-granted files list in the Fichiers tab.
function renderPlayerFiles() {
    const list = document.getElementById('player-files-list');
    const empty = document.getElementById('player-files-empty');
    if (!list) return;
    list.innerHTML = '';
    if (!playerFiles.length) {
        if (empty) empty.style.display = '';
        return;
    }
    if (empty) empty.style.display = 'none';
    // Files are granted by the GM over Ably — name and id are remote strings.
    playerFiles.forEach(f => {
        list.append(el('div', { className: 'player-file-row' },
            el('div', { className: 'pf-icon', textContent: _pfFileIcon(f.type) }),
            el('div', { className: 'pf-name', textContent: f.name }),
            el('button', { className: 'pf-open-btn', textContent: 'Ouvrir', onclick: () => openFileViewer(f.id) })));
    });
}

// Open the file viewer modal for a player file, rendering image/PDF/text inline.
function openFileViewer(fileId) {
    const f = playerFiles.find(f => f.id === fileId);
    if (!f) return;
    document.getElementById('fv-title').textContent = f.name;
    const body = document.getElementById('fv-body');
    body.innerHTML = '';
    const url = _safeUrl(f.url);
    // f.type can be missing on a malformed grant or an old row — guard like the GM viewer.
    if (url && f.type && f.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = url;
        img.className = 'fv-image';
        body.appendChild(img);
        wireImageZoom(img);
    } else if (url && f.type === 'application/pdf') {
        const iframe = document.createElement('iframe');
        iframe.src = url;
        iframe.className = 'fv-iframe';
        body.appendChild(iframe);
    } else if (url && f.type && f.type.startsWith('text/')) {
        const pre = document.createElement('pre');
        pre.className = 'fv-text';
        pre.textContent = 'Chargement…';
        body.appendChild(pre);
        fetch(url)
            .then(r => r.text())
            .then(text => { pre.textContent = text; })
            .catch(() => { pre.textContent = 'Erreur de chargement.'; });
    } else {
        body.append(el('div', { className: 'fv-unsupported' },
            el('div', { className: 'fv-unsupported-icon', textContent: _pfFileIcon(f.type) }),
            el('div', { className: 'fv-unsupported-name', textContent: f.name }),
            url && el('a', { className: 'fv-download-link', href: url, target: '_blank', rel: 'noopener',
                textContent: 'Ouvrir dans un nouvel onglet' })));
    }
    document.getElementById('file-viewer-scrim').classList.add('show');
    document.getElementById('file-viewer-modal').classList.add('show');
}

// Close the file viewer modal and clear its body.
function closeFileViewer() {
    document.getElementById('file-viewer-scrim').classList.remove('show');
    document.getElementById('file-viewer-modal').classList.remove('show');
    document.getElementById('fv-body').innerHTML = '';
}

