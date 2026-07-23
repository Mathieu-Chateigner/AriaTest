// ═══════════════════════════════════════════
//  CONSTANTS
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

// Escape user-supplied strings before injecting into innerHTML (XSS guard).
function _escHtml(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
// Escape a string for embedding inside a single-quoted JS literal in an inline
// handler attribute. Always wrap the result in _escHtml too, since the HTML
// parser decodes the attribute before the JS engine sees it.
function _escJs(s) { return String(s ?? '').replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
// Allow only http(s) URLs from remote-controlled records. File grants travel over
// Ably and file rows live in Supabase — a javascript: URL assigned to iframe.src
// would execute in this origin.
function _safeUrl(u) { const s = String(u ?? '').trim(); return /^https?:\/\//i.test(s) ? s : ''; }

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
if (!playerId) { playerId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 9); sessionStorage.setItem('aria-player-id', playerId); }

let config = JSON.parse(localStorage.getItem('aria-config') || '{}');
if (config.lightMode) document.body.classList.add('light-mode');
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
let dddiceAPI = null;
let dddiceSDK = null;            // ThreeDDice SDK instance
let pendingDddiceRoll = null;    // { skillName, threshold } waiting for RollFinished event
let pendingSecondaryRoll = null; // { callback, mapFn } for non-d100 dice (d6, d3, weapon formula…)
let dddiceRollSafetyTimer = null; // fallback timer in case RollFinished never fires
let ablyRolls = null, ablyCards = null, ablyDamage = null, ablyMusic = null, ablyRollsHidden = null;
let peerCameras = new Map(); // charId → { name, streamId }
let gmStreamId = '';
let gmPresenceTs = 0;         // last gm-presence heartbeat — the GM broadcast is expired like a peer
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
function cameraOffKey() { return 'aria-camera-off-' + currentCharId; }
// Toggle the local camera. Off ⇒ push iframe goes to about:blank (webcam released)
// and presence advertises no stream ID, so no peer opens a viewer on a dead stream.
function toggleCamera() {
    cameraOff = !cameraOff;
    if (currentCharId) localStorage.setItem(cameraOffKey(), cameraOff ? '1' : '0');
    console.log('[VDO] camera', cameraOff ? 'OFF (local)' : 'ON');
    updatePushIframe();
    sendPresence();
    updateCamerasTabVisibility();
}
// Derive the VDO.ninja push stream ID from the first 8 chars of the character UUID.
function derivedStreamId() {
    return 'aria-' + currentCharId.slice(0, 8);
}
// Set the VDO.ninja push iframe src — iframe is full-viewport before #app-wrapper in DOM so browser grants camera access.
function updatePushIframe() {
    const pushFrame = document.getElementById('vdo-push-frame');
    if (!pushFrame) { console.warn('[VDO] updatePushIframe: #vdo-push-frame not found'); return; }
    if (!vdoRoom || !currentCharId || cameraOff) {
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
let presenceIntervalId = null;
const knownPlayers = {}; // { playerId: { name, ts } } — other players seen via presence
let soignerTarget = null; // null = self, or { playerId, name }
let soignerPct = 0;

// Card state — initialized after character selection
let cardDeck = null, cardDrawn = null, cardExcluded = null, lastCardId = null;
let cardDrawing = false;
let cardStatusTimer = null;

// tab access granted by GM — stored per character in localStorage
let playerTabs = { cards: false, alchemy: false };

// files granted by GM — stored per character in localStorage
let playerFiles = [];

// pending craft recipe index — set before a roll, cleared by handleResult
let pendingCraft = null;

let saveKey        = localStorage.getItem('aria-save-key') || null;
let _pendingNewKey = null;
let syncTimer      = null;

// ═══════════════════════════════════════════
//  CLOUD SAVE — per-entity sync
// ═══════════════════════════════════════════
// Check whether Supabase sync is configured and a save key is available.
function _supabaseReady() { return !!SUPABASE_URL && !!SUPABASE_ANON_KEY && !!saveKey; }

// Return the current UTC time as an ISO 8601 string.
function _nowISO() { return new Date().toISOString(); }

// Convert a character object into a Supabase characters table row.
function _charToRow(char) {
    return {
        id: char.id, save_key: saveKey, name: char.name, class: char.class,
        campaign_key: char.campaignKey || null,
        aria_type: char.ariaType || 'ancient',
        stats: char.stats || null, physical: char.physical || null,
        skills: char.skills || null, specials: char.specials || null,
        weapons: char.weapons || null, protection: char.protection || null,
        inventory: char.inventory || null, potion_recipes: char.potionRecipes || null,
        vials: char.vials || 0,
        potions: char.potions || null,
        money: char.money || null,
        karma: char.karma ?? 0,
        updated_at: _nowISO(),
    };
}

// Full sync of all characters, states, and notes to Supabase.
async function _syncAllPlayerData() {
    if (!_supabaseReady()) return;
    const chars = getCharacters();
    await Promise.all(chars.map(c => sbUpsert('characters', _charToRow(c))));
    await Promise.all(chars.map(c => sbUpsert('character_state', {
        character_id: c.id,
        hp:    (() => { const v = localStorage.getItem('aria-current-hp-'   + c.id); return v !== null ? parseInt(v) : null; })(),
        cards: (() => { const v = localStorage.getItem('aria-cards-'        + c.id); return v ? JSON.parse(v) : null; })(),
        tabs:  (() => { const v = localStorage.getItem('aria-player-tabs-'  + c.id); return v ? JSON.parse(v) : null; })(),
        updated_at: _nowISO(),
    })));
    const now = _nowISO();
    for (const c of chars) {
        const rawNotes = localStorage.getItem('aria-notes-' + c.id);
        if (rawNotes) {
            let notes = [];
            try { const p = JSON.parse(rawNotes); notes = Array.isArray(p) ? p : []; } catch(e) {}
            await Promise.all(notes.map((n, i) => sbUpsert('character_notes', {
                id: n.id, character_id: c.id, name: n.name || '',
                content: n.content || '', position: i, updated_at: now,
            })));
        }
        const rawFiles = localStorage.getItem('aria-player-files-' + c.id);
        if (rawFiles) {
            let files = [];
            try { files = JSON.parse(rawFiles) || []; } catch(e) {}
            await Promise.all(files.map(f => sbUpsert('character_files', {
                id: f.id, character_id: c.id, file_id: f.id,
                name: f.name || '', type: f.type || '', url: f.url || '', updated_at: now,
            })));
        }
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
function debouncedSyncNote(note) {
    clearTimeout(_noteTimer);
    _noteTimer = setTimeout(() => syncCharacterNote(note), 800);
}

// Sync HP, cards, and tabs for a character to the character_state table.
async function syncCharacterState(charId) {
    if (!_supabaseReady() || !charId) return;
    const hp    = localStorage.getItem('aria-current-hp-'  + charId);
    const cards = localStorage.getItem('aria-cards-'       + charId);
    const tabs  = localStorage.getItem('aria-player-tabs-' + charId);
    await sbUpsert('character_state', {
        character_id: charId,
        hp:    hp    !== null ? parseInt(hp) : null,
        cards: cards ? JSON.parse(cards) : null,
        tabs:  tabs  ? JSON.parse(tabs)  : null,
        updated_at: _nowISO(),
    });
}

// Upsert a single note to the character_notes table.
async function syncCharacterNote(note) {
    if (!_supabaseReady() || !currentCharId || !note?.id) return;
    await sbUpsert('character_notes', {
        id: note.id, character_id: currentCharId,
        name: note.name || '', content: note.content || '',
        position: notesList.indexOf(note),
        updated_at: _nowISO(),
    });
}

// Delete a note from the character_notes table by ID.
async function deleteCharacterNote(id) {
    if (!_supabaseReady()) return;
    await sbDelete('character_notes', 'id=eq.' + encodeURIComponent(id));
}

// Upsert a GM-granted file record for a character to Supabase.
async function syncCharacterFile(file, charId) {
    if (!_supabaseReady() || !charId || !file?.id) return;
    await sbUpsert('character_files', {
        id: file.id, character_id: charId, file_id: file.id,
        name: file.name || '', type: file.type || '', url: file.url || '',
        updated_at: _nowISO(),
    });
}

// Delete a granted file record from Supabase by file ID.
async function deleteCharacterFile(fileId) {
    if (!_supabaseReady()) return;
    await sbDelete('character_files', 'id=eq.' + encodeURIComponent(fileId));
}

// Per-character localStorage key prefixes (everything scoped by charId).
const _CHAR_KEY_PREFIXES = ['aria-current-hp-', 'aria-cards-', 'aria-notes-', 'aria-player-files-', 'aria-player-rolls-', 'aria-player-tabs-'];

// Remove all locally stored characters and their scoped keys (used when switching
// to a different save key, so the old key's data never merges into the new one).
function _clearLocalPlayerData() {
    getCharacters().forEach(c => _CHAR_KEY_PREFIXES.forEach(p => localStorage.removeItem(p + c.id)));
    localStorage.removeItem('aria-characters');
}

// Load all player data (characters, states, notes, files) from Supabase into localStorage.
// Returns true when the load completed (even if the key has no data yet), false on error —
// callers must not push local data back up after a failed load.
async function loadFromSupabase() {
    if (!_supabaseReady()) return false;
    try {
        await runMigration(saveKey, 'player');
        const chars = await sbSelect('characters', 'save_key=eq.' + encodeURIComponent(saveKey));
        if (!chars.length) return true;

        const dbChars = chars.map(row => ({
            id: row.id, name: row.name, class: row.class,
            campaignKey: row.campaign_key || '',
            ariaType: row.aria_type || 'ancient',
            stats: row.stats || {}, physical: row.physical || {},
            skills: row.skills || [], specials: row.specials || [],
            weapons: row.weapons || [], protection: row.protection || {},
            inventory: row.inventory || [],
            potionRecipes: row.potion_recipes || [],
            vials: row.vials || 0,
            potions: row.potions || [],
            money: row.money || null,
            karma: row.karma ?? 0,
        }));
        // Clean up scoped keys of characters deleted on another device (the list
        // below is overwritten, which would otherwise orphan their HP/cards/notes).
        const dbIds = new Set(dbChars.map(c => c.id));
        getCharacters().forEach(c => {
            if (!dbIds.has(c.id)) _CHAR_KEY_PREFIXES.forEach(p => localStorage.removeItem(p + c.id));
        });
        localStorage.setItem('aria-characters', JSON.stringify(dbChars));

        const ids = chars.map(c => c.id).join(',');
        const [states, notes, files] = await Promise.all([
            sbSelect('character_state', 'character_id=in.(' + ids + ')'),
            sbSelect('character_notes', 'character_id=in.(' + ids + ')&order=position.asc'),
            sbSelect('character_files', 'character_id=in.(' + ids + ')'),
        ]);

        states.forEach(s => {
            if (s.hp    !== null && s.hp    !== undefined) localStorage.setItem('aria-current-hp-'   + s.character_id, s.hp);
            if (s.cards) localStorage.setItem('aria-cards-'       + s.character_id, JSON.stringify(s.cards));
            if (s.tabs)  localStorage.setItem('aria-player-tabs-' + s.character_id, JSON.stringify(s.tabs));
        });

        const notesByChar = {};
        notes.forEach(n => {
            if (!notesByChar[n.character_id]) notesByChar[n.character_id] = [];
            notesByChar[n.character_id].push({ id: n.id, name: n.name, content: n.content });
        });
        Object.entries(notesByChar).forEach(([cid, arr]) =>
            localStorage.setItem('aria-notes-' + cid, JSON.stringify(arr)));

        const filesByChar = {};
        files.forEach(f => {
            if (!filesByChar[f.character_id]) filesByChar[f.character_id] = [];
            filesByChar[f.character_id].push({ id: f.file_id, name: f.name, type: f.type, url: f.url });
        });
        Object.entries(filesByChar).forEach(([cid, arr]) =>
            localStorage.setItem('aria-player-files-' + cid, JSON.stringify(arr)));

        return true;
    } catch(e) { console.warn('[ARIA] Supabase load failed:', e); return false; }
}

// Show the two-panel gateway (new key + existing key, side by side) with a freshly generated key.
function showGateway() {
    _pendingNewKey = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    document.getElementById('gateway-key-display').textContent = _pendingNewKey;
    const cancel = document.getElementById('gateway-cancel');
    if (cancel) cancel.style.display = saveKey ? '' : 'none';
    document.getElementById('file-gateway').style.display = 'flex';
}

// Both panels are always visible; just focus the existing-key input.
function showGatewayExisting() {
    document.getElementById('file-gateway').style.display = 'flex';
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
    await sbUpsert('saves', { save_key: saveKey, type: 'player' });
    await _syncAllPlayerData();
    hideGateway();
    showSelectionScreen();
}

// Load data from Supabase using an existing save key entered by the user.
async function submitExistingKey() {
    const input = document.getElementById('gateway-key-input');
    const key = input ? input.value.trim() : '';
    if (!key) return;
    // Verify the key exists before adopting it — a typo would otherwise push the
    // previous key's local data under a brand-new key on the next sync.
    const rows = await sbSelect('saves', 'save_key=eq.' + encodeURIComponent(key) + '&select=save_key');
    if (!rows.length) { alert('Clé introuvable. Vérifiez la clé saisie.'); return; }
    // Switching keys: drop the old key's local data so it never merges into the new one.
    if (saveKey && key !== saveKey) _clearLocalPlayerData();
    saveKey = key;
    localStorage.setItem('aria-save-key', key);
    await loadFromSupabase();
    hideGateway();
    showSelectionScreen();
}

// Update the save-key status label on the character selection screen.
function updateSaveKeyStatus() {
    const label = document.getElementById('sel-save-label');
    if (!label) return;
    label.textContent = saveKey ? saveKey.slice(0, 8) + '…' : '—';
    label.className = 'sel-save-label' + (saveKey ? ' connected' : '');
}

// Show the existing-key form so the user can switch to a different save key.
function changeSaveKey() {
    showGateway();
    const input = document.getElementById('gateway-key-input');
    if (input) input.focus();
}

// Copy the current save key to the clipboard.
function copySaveKey() {
    if (!saveKey) return;
    navigator.clipboard.writeText(saveKey).catch(() => {});
    const btns = document.querySelectorAll('.sel-save-btn');
    const copyBtn = [...btns].find(b => b.textContent === 'Copier');
    if (copyBtn) { copyBtn.textContent = 'Copié !'; setTimeout(() => { copyBtn.textContent = 'Copier'; }, 2000); }
}

// Cancel key entry: return to gateway if no key exists, else just hide it.
function cancelGateway() {
    if (saveKey) { hideGateway(); } else { showGateway(); }
}

// On load: restore from Supabase if a save key exists, otherwise show the gateway.
async function tryRestoreSupabase() {
    if (!saveKey) { showGateway(); return; }
    const ok = await loadFromSupabase();
    hideGateway();
    showSelectionScreen();
    // Only push local data back up if the load succeeded — after a failed (offline)
    // load, syncing would overwrite newer remote data with stale local state.
    if (ok) _syncAllPlayerData();
}

// ═══════════════════════════════════════════
//  CHARACTER MANAGEMENT
// ═══════════════════════════════════════════
// Return the localStorage key for the current character's HP.
function hpKey()    { return 'aria-current-hp-' + currentCharId; }
// Return the localStorage key for the current character's card deck state.
function cardKey()  { return 'aria-cards-'       + currentCharId; }
// Return the localStorage key for the current character's notes.
function notesKey() { return 'aria-notes-'       + currentCharId; }

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
}

// Migrate a single legacy aria-character entry to the multi-character array format.
function migrateIfNeeded() {
    if (localStorage.getItem('aria-characters')) return;
    const oldChar = JSON.parse(localStorage.getItem('aria-character') || 'null');
    if (!oldChar) return;
    const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
    saveCharacters([{ ...oldChar, id }]);
    const oldHp = localStorage.getItem('aria-current-hp');
    if (oldHp !== null) localStorage.setItem('aria-current-hp-' + id, oldHp);
    const oldCards = localStorage.getItem('aria-cards');
    if (oldCards !== null) localStorage.setItem('aria-cards-' + id, oldCards);
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
    const saved = JSON.parse(localStorage.getItem(cardKey()) || 'null');
    cardDeck = saved?.deckIds?.map(cid => cardById(cid)).filter(Boolean) || buildDeck();
    cardDrawn = new Set(saved?.drawn || []);
    cardExcluded = new Set(saved?.excluded || []);
    lastCardId = saved?.lastCardId || null;
    playerRollHistory = JSON.parse(localStorage.getItem('aria-player-rolls-' + id) || '[]');
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
        const card = document.createElement('div');
        card.className = 'sel-card';
        const campBadge = c.campaignKey ? `<div class="sel-card-campaign">Code · ${_escHtml(c.campaignKey)}</div>` : `<div class="sel-card-campaign no-campaign">Sans campagne</div>`;
        const typeBadge = (c.ariaType || 'ancient') === 'contemporary'
            ? `<span class="sel-card-type contemporary">Contemporain</span>`
            : `<span class="sel-card-type">Médiéval</span>`;
        card.innerHTML = `<button class="sel-card-delete" onclick="event.stopPropagation();deleteCharacter('${_escHtml(_escJs(c.id))}')" title="Supprimer">&times;</button><div class="sel-card-head"><span class="sel-card-diamond"></span>${typeBadge}</div><div><div class="sel-card-name">${_escHtml(c.name || '—')}</div><div class="sel-card-class">${_escHtml(c.class || '')}</div></div>${campBadge}<div class="sel-card-cta">Incarner &rarr;</div>`;
        card.addEventListener('click', () => selectCharacter(c.id));
        grid.appendChild(card);
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

// Select a character, load its state, start the app, and lazily load roll history.
async function selectCharacter(id) {
    if (!loadCharacterState(id)) return;
    showApp();
    initApp();
    if (!localStorage.getItem('aria-player-rolls-' + id)) {
        const rows = await loadCharacterRolls(id);
        if (rows.length) {
            playerRollHistory = rows.map(r => ({
                skillName:  r.skill_name,
                threshold:  r.threshold,
                roll:       r.roll,
                success:    r.success,
                char:       character.name,
                bonusMalus: r.bonus_malus,
                playerId,
                ts:         r.ts,
            }));
            if (playerRollHistory.length > PLAYER_ROLL_HISTORY_MAX) playerRollHistory.length = PLAYER_ROLL_HISTORY_MAX;
            localStorage.setItem('aria-player-rolls-' + id, JSON.stringify(playerRollHistory));
            renderRollHistory();
        }
    }
}

// Delete a character from localStorage and Supabase, then re-render the selection screen.
function deleteCharacter(id) {
    if (!confirm('Supprimer ce personnage ? Cette action est irréversible.')) return;
    sbDelete('characters',      'id=eq.'           + encodeURIComponent(id));
    sbDelete('character_state', 'character_id=eq.' + encodeURIComponent(id));
    sbDelete('character_notes', 'character_id=eq.' + encodeURIComponent(id));
    sbDelete('character_files', 'character_id=eq.' + encodeURIComponent(id));
    sbDelete('character_rolls', 'character_id=eq.' + encodeURIComponent(id));
    const chars = getCharacters().filter(c => c.id !== id);
    saveCharacters(chars);
    localStorage.removeItem('aria-current-hp-' + id);
    localStorage.removeItem('aria-cards-' + id);
    localStorage.removeItem('aria-notes-' + id);
    localStorage.removeItem('aria-player-files-' + id);
    localStorage.removeItem('aria-player-rolls-' + id);
    localStorage.removeItem('aria-player-tabs-' + id);
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
    const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
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
    if (presenceIntervalId) { clearInterval(presenceIntervalId); presenceIntervalId = null; }
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
    const doCloseAbly = () => {
        if (ablyInstance) { try { ablyInstance.close(); } catch(_){} ablyInstance = null; }
        ablyRolls = null; ablyRollsHidden = null; ablyCards = null; ablyDamage = null; ablyMusic = null;
    };
    if (ablyDamage) {
        try { ablyDamage.publish('leave', { playerId }).then(doCloseAbly, doCloseAbly); } catch(_){ doCloseAbly(); }
    } else {
        doCloseAbly();
    }
    vdoRoom = '';
    vdoRoomPassword = '';
    updatePushIframe();
    peerCameras.clear();
    gmStreamId = '';
    gmPresenceTs = 0;
    spotlightCharId = null;
    localStageSid = '';
    showSelectionScreen();
}

// ═══════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
    migrateIfNeeded();
    await tryRestoreSupabase();
});

// Closing the tab left the GM showing our card (and peers showing our camera tile)
// until the 30s presence sweep. Best-effort only: the browser may kill the page
// before the publish reaches the wire, which is exactly what the sweep still covers.
window.addEventListener('beforeunload', () => {
    if (ablyDamage) { try { ablyDamage.publish('leave', { playerId }); } catch (_) {} }
});

// Initialize the full player app after a character is selected.
function initApp() {
    console.log('[PLAYER] initApp: char:', character.name, '| charId:', currentCharId, '| ablyKey:', config.ablyKey ? 'set' : 'MISSING', '| dddice:', config.dddiceKey ? 'set' : 'none');
    currentHP = null;
    cameraOff = localStorage.getItem(cameraOffKey()) === '1';
    playerTabs = JSON.parse(localStorage.getItem('aria-player-tabs-' + currentCharId) || '{"cards":false,"alchemy":false}');
    playerFiles = JSON.parse(localStorage.getItem('aria-player-files-' + currentCharId) || '[]');
    initCurrentHP();
    renderAll();
    buildTracker();
    updateDeckCount();
    if (lastCardId) restoreCard();
    loadConfigInputs();
    if (config.dddiceKey && config.dddiceRoom) initDddice();
    if (config.ablyKey) initAbly();
    applyTabVisibility();
    document.getElementById('tab-char').addEventListener('input', scheduleAutoSave);
    document.getElementById('tab-inventory').addEventListener('input', scheduleAutoSave);
    document.getElementById('tab-alchemy').addEventListener('input', scheduleAutoSave);
    loadNotes();
    if (presenceIntervalId) clearInterval(presenceIntervalId);
    presenceIntervalId = setInterval(() => { sendPresence(); prunePeers(); }, 5000);
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

// ═══════════════════════════════════════════
//  TABS — MULTI-PANE SPLIT VIEW (design frames 22-24)
//  openPanes lists the open tabs left → right; paneWeights holds their relative
//  widths (normalized to sum 100). Panes are the existing .tab-content divs
//  (classes + inline grid placement only — never reparented, so camera iframes
//  and per-tab JS are untouched). No pane-count limit.
// ═══════════════════════════════════════════
let openPanes = ['tab-skills'];
let paneWeights = [100];
let focusIdx = 0;

// Restore the persisted pane layout (hidden tabs are pruned in renderTabLayout).
try {
    const _sl = JSON.parse(localStorage.getItem('aria-split-layout') || 'null');
    if (_sl && Array.isArray(_sl.panes) && _sl.panes.length) {
        openPanes = [...new Set(_sl.panes)];
        paneWeights = (Array.isArray(_sl.weights) && _sl.weights.length === openPanes.length)
            ? _sl.weights.slice() : openPanes.map(() => 1);
    }
} catch(_) {}

function _persistSplit() {
    localStorage.setItem('aria-split-layout', JSON.stringify({ panes: openPanes, weights: paneWeights.map(w => Math.round(w * 100) / 100) }));
}
function _normWeights() {
    const sum = paneWeights.reduce((a, b) => a + b, 0) || 1;
    paneWeights = paneWeights.map(w => w * 100 / sum);
}
// Back to a single default pane (character switch).
function resetSplitState() {
    openPanes = ['tab-skills']; paneWeights = [100]; focusIdx = 0;
}

// Click on a tab button: classic tab switch — but only in single-pane mode.
// Once a split is open, panes change through drag-to-dock only. Exception:
// under the 900px breakpoint the split collapses to the single tab bar
// (pane headers hidden), so clicks must keep working there.
function switchTab(id, _btn) {
    if (openPanes.length > 1) {
        if (window.innerWidth > 900) return;
        const j = openPanes.indexOf(id);
        if (j > 0) {           // move the clicked pane to the visible front slot
            openPanes.unshift(openPanes.splice(j, 1)[0]);
            paneWeights.unshift(paneWeights.splice(j, 1)[0]);
        } else if (j < 0) {
            openPanes[0] = id; // replace the visible pane, keep the others
        }
    } else {
        openPanes[0] = id;
    }
    focusIdx = 0;
    renderTabLayout();
}

// Apply classes + grid placement to tab buttons and content panes.
function renderTabLayout() {
    // Drop panes whose tab was hidden (conditional tabs set display:none on the button).
    for (let i = openPanes.length - 1; i >= 0; i--) {
        const btn = document.querySelector(`.tab-btn[data-tab="${openPanes[i]}"]`);
        if (!btn || btn.style.display === 'none' || !document.getElementById(openPanes[i])) {
            openPanes.splice(i, 1); paneWeights.splice(i, 1);
            if (focusIdx > i) focusIdx--;
        }
    }
    if (!openPanes.length) { openPanes = ['tab-skills']; paneWeights = [100]; }
    if (focusIdx >= openPanes.length) focusIdx = openPanes.length - 1;
    _normWeights();
    const split = openPanes.length > 1;
    const content = document.querySelector('.content');
    content?.classList.toggle('split-mode', split);
    document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === openPanes[focusIdx]);
        b.classList.toggle('open', b.dataset.tab !== openPanes[focusIdx] && openPanes.includes(b.dataset.tab));
    });
    document.querySelectorAll('.tab-content').forEach(t => {
        const i = openPanes.indexOf(t.id);
        t.classList.toggle('active', i >= 0);
        t.classList.toggle('split-primary', i === 0);
        if (i >= 0 && split) { t.style.gridColumn = String(2 * i + 1); t.style.gridRow = '3'; }
        else { t.style.gridColumn = ''; t.style.gridRow = ''; }
    });
    // Fill the cameras grid as soon as its pane opens (renders in place —
    // heartbeats would otherwise leave a freshly docked pane empty for up to 5s).
    if (openPanes.includes('tab-cameras')) renderCamerasTab();
    renderPresenceUI(); // the rail hides while the Caméras pane is open — see below
    updateSplitChrome();
    _persistSplit();
}

// ═══════════════════════════════════════════
//  DRAG-TO-DOCK SPLIT VIEW (design frames 22-24)
//  Drag a tab button — or an open pane's header — over the content region:
//  the targeted half of the hovered pane darkens; dropping inserts the tab
//  at that slot (left or right of any open pane).
// ═══════════════════════════════════════════
let _dockDrag = null;          // { tabId, label, started, startX, startY, insert }
let _dockSuppressClick = false;
let _dividerDrag = null;       // { idx } — divider between panes idx and idx+1

// Human label for a tab (the button's text).
function tabLabel(id) {
    const btn = document.querySelector(`.tab-btn[data-tab="${id}"]`);
    return btn ? btn.textContent.trim() : '';
}

// Rebuild the split chrome (pane headers + dividers) to match the pane list.
function updateSplitChrome() {
    const content = document.querySelector('.content');
    if (!content) return;
    content.querySelectorAll('.split-pane-hdr, .split-divider').forEach(el => el.remove());
    if (openPanes.length < 2) { content.style.gridTemplateColumns = ''; return; }
    _applySplitColumns();
    openPanes.forEach((id, i) => {
        const hdr = document.createElement('div');
        hdr.className = 'split-pane-hdr';
        hdr.title = 'Glisser pour ré-ancrer';
        hdr.style.gridColumn = String(2 * i + 1);
        hdr.innerHTML = '<span class="sph-grip">⋮⋮</span><span class="sph-label"></span><span class="sph-spacer"></span><span class="sph-focus">Focus</span><button class="sph-close" title="Fermer le panneau">×</button>';
        hdr.querySelector('.sph-label').textContent = tabLabel(id);
        hdr.addEventListener('mousedown', e => startPaneDrag(e, i));
        const close = hdr.querySelector('.sph-close');
        close.addEventListener('mousedown', e => e.stopPropagation());
        close.addEventListener('click', () => closePane(i));
        content.appendChild(hdr);
        if (i < openPanes.length - 1) {
            const div = document.createElement('div');
            div.className = 'split-divider';
            div.title = 'Glisser pour répartir — double-clic : répartition égale';
            div.style.gridColumn = String(2 * i + 2);
            div.innerHTML = '<span></span><span></span><span></span>';
            div.addEventListener('mousedown', e => startDividerDrag(e, i));
            div.addEventListener('dblclick', resetSplitRatio);
            content.appendChild(div);
        }
    });
    updateSplitFocus();
}
// Set the grid column template from the pane weights (light path for divider drag).
function _applySplitColumns() {
    const content = document.querySelector('.content');
    if (content) content.style.gridTemplateColumns = paneWeights.map(w => `minmax(0,${w.toFixed(2)}fr)`).join(' 9px ');
}
// Cosmetic "Focus" chip — marks the focused pane (frames 22/24).
function updateSplitFocus() {
    document.querySelectorAll('.content > .split-pane-hdr').forEach((h, i) =>
        h.querySelector('.sph-focus')?.classList.toggle('on', i === focusIdx));
}

// Close pane i; the remaining panes share the freed width.
function closePane(i) {
    if (openPanes.length <= 1) return;
    openPanes.splice(i, 1); paneWeights.splice(i, 1);
    if (focusIdx > i) focusIdx--;
    if (focusIdx >= openPanes.length) focusIdx = openPanes.length - 1;
    renderTabLayout();
}

// Dock a tab at insertion slot k (0..N, between existing panes). A panel never
// opens twice — if the tab is already open, its pane moves to the new slot.
function dockTab(id, k) {
    const j = openPanes.indexOf(id);
    if (j >= 0) {
        const w = paneWeights[j];
        openPanes.splice(j, 1); paneWeights.splice(j, 1);
        if (k > j) k--;
        openPanes.splice(k, 0, id); paneWeights.splice(k, 0, w);
    } else {
        openPanes.splice(k, 0, id);
        paneWeights.splice(k, 0, 100 / Math.max(1, openPanes.length - 1));
    }
    focusIdx = k;
    renderTabLayout();
}

// The dockable region: the content area below the tab strip (viewport coords).
function _dockRegion() {
    const content = document.querySelector('.content');
    if (!content) return null;
    const cr = content.getBoundingClientRect();
    const tabs = content.querySelector('.tabs');
    const top = tabs ? tabs.getBoundingClientRect().bottom : cr.top;
    if (cr.bottom - top < 60) return null;
    return { left: cr.left, right: cr.right, top, bottom: cr.bottom };
}

// Pane pixel edges across the dock region (accounts for the 9px dividers) — n+1 values.
function _paneEdges(region) {
    const n = openPanes.length;
    const inner = (region.right - region.left) - 9 * (n - 1);
    const sum = paneWeights.reduce((a, b) => a + b, 0) || 1;
    const edges = [region.left];
    let x = region.left;
    for (let i = 0; i < n; i++) {
        x += inner * paneWeights[i] / sum + (i < n - 1 ? 9 : 0);
        edges.push(i === n - 1 ? region.right : x);
    }
    return edges;
}

// Begin a potential drag from a tab button (starts after a 6px move threshold).
function _dockBegin(tabId, e) {
    _dockDrag = { tabId, label: tabLabel(tabId), started: false, startX: e.clientX, startY: e.clientY, insert: null };
}
// Begin re-anchoring an open pane by its header (frame 24: drag header to re-dock).
function startPaneDrag(e, idx) {
    if (e.button !== 0) return;
    const id = openPanes[idx];
    if (!id) return;
    e.preventDefault();
    focusIdx = idx;
    updateSplitFocus();
    _dockBegin(id, e);
}

function _dockMove(e) {
    if (!_dockDrag) return;
    if (!_dockDrag.started) {
        if (Math.abs(e.clientX - _dockDrag.startX) + Math.abs(e.clientY - _dockDrag.startY) < 6) return;
        _dockDrag.started = true;
        document.body.classList.add('dock-dragging');
        const ghost = document.getElementById('drag-ghost');
        const gl = document.getElementById('drag-ghost-label');
        if (gl) gl.textContent = _dockDrag.label;
        if (ghost) ghost.style.display = 'flex';
    }
    const ghost = document.getElementById('drag-ghost');
    if (ghost) { ghost.style.left = (e.clientX + 14) + 'px'; ghost.style.top = (e.clientY + 12) + 'px'; }
    const region = _dockRegion();
    const overlay = document.getElementById('dock-overlay');
    let insert = null, zone = null;
    if (region && e.clientX >= region.left && e.clientX <= region.right && e.clientY >= region.top && e.clientY <= region.bottom) {
        const edges = _paneEdges(region);
        let i = 0;
        while (i < openPanes.length - 1 && e.clientX >= edges[i + 1]) i++;
        const mid = (edges[i] + edges[i + 1]) / 2;
        insert = e.clientX < mid ? i : i + 1;
        zone = e.clientX < mid ? { left: edges[i], right: mid } : { left: mid, right: edges[i + 1] };
    }
    _dockDrag.insert = insert;
    if (overlay) {
        if (zone) {
            overlay.style.display = 'flex';
            overlay.style.left = zone.left + 'px';
            overlay.style.top = region.top + 'px';
            overlay.style.width = (zone.right - zone.left) + 'px';
            overlay.style.height = (region.bottom - region.top) + 'px';
            const lbl = document.getElementById('dock-label');
            if (lbl) lbl.textContent = _dockDrag.label;
        } else {
            overlay.style.display = 'none';
        }
    }
}

function _dockEnd() {
    if (!_dockDrag) return;
    const { tabId, started, insert } = _dockDrag;
    _dockDrag = null;
    if (!started) return; // plain click on the tab button — let it through
    _dockSuppressClick = true;
    // The click (if any) fires synchronously after mouseup; clear the flag right
    // after so an unrelated later click is never swallowed.
    setTimeout(() => { _dockSuppressClick = false; }, 0);
    document.body.classList.remove('dock-dragging');
    const ghost = document.getElementById('drag-ghost');
    if (ghost) ghost.style.display = 'none';
    const overlay = document.getElementById('dock-overlay');
    if (overlay) overlay.style.display = 'none';
    if (insert !== null) dockTab(tabId, insert);
}

// Divider drag (frame 22/23): resize the two panes around divider idx;
// double-click redistributes all panes equally.
function startDividerDrag(e, idx) {
    if (e.button !== 0) return;
    e.preventDefault();
    _dividerDrag = { idx };
    document.body.classList.add('dock-dragging');
}
function _dividerMove(e) {
    if (!_dividerDrag) return;
    const region = _dockRegion();
    if (!region) return;
    const i = _dividerDrag.idx;
    if (i >= openPanes.length - 1) return;
    const edges = _paneEdges(region);
    const span = edges[i + 2] - edges[i] - 9;   // px shared by the two panes
    if (span <= 0) return;
    const px = Math.min(Math.max(e.clientX - edges[i], span * 0.15), span * 0.85);
    const pairW = paneWeights[i] + paneWeights[i + 1];
    paneWeights[i] = pairW * px / span;
    paneWeights[i + 1] = pairW - paneWeights[i];
    _applySplitColumns();
}
function _dividerEnd() {
    if (!_dividerDrag) return;
    _dividerDrag = null;
    document.body.classList.remove('dock-dragging');
    _persistSplit();
}
function resetSplitRatio() {
    paneWeights = openPanes.map(() => 100 / openPanes.length);
    _applySplitColumns();
    _persistSplit();
}

// Global listeners for the dock/divider engines (registered once at load).
window.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            _dockBegin(btn.dataset.tab, e);
        });
    });
    document.addEventListener('mousemove', e => { _dockMove(e); _dividerMove(e); });
    // Chromium suppresses the compat mouseup after a preventDefault'd mousedown
    // drag (pane headers) — listen to pointerup too; both enders are idempotent.
    document.addEventListener('mouseup', () => { _dockEnd(); _dividerEnd(); });
    document.addEventListener('pointerup', () => { _dockEnd(); _dividerEnd(); });
    // After a real drag, swallow the click that would otherwise switch tabs.
    document.addEventListener('click', e => {
        if (_dockSuppressClick) { e.stopPropagation(); e.preventDefault(); _dockSuppressClick = false; }
    }, true);
    // Track which pane holds focus (drives the Focus chip and tab-click target).
    document.querySelector('.content')?.addEventListener('mousedown', e => {
        if (openPanes.length < 2) return;
        const pane = e.target.closest('.tab-content');
        if (!pane) return;
        const i = openPanes.indexOf(pane.id);
        if (i >= 0) { focusIdx = i; updateSplitFocus(); }
    });
});
// ═══════════════════════════════════════════
//  NOTES
// ═══════════════════════════════════════════
let notesList = [];
let currentNoteId = null;

// Load notes from localStorage for the current character, migrating plain-string format if needed.
function loadNotes() {
    const raw = localStorage.getItem(notesKey());
    if (!raw) {
        notesList = [];
    } else {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                notesList = parsed;
            } else {
                // Migrate from plain string
                notesList = [{ id: _noteId(), name: 'Notes', content: raw }];
            }
        } catch(e) {
            // Plain string (not JSON)
            notesList = [{ id: _noteId(), name: 'Notes', content: raw }];
        }
    }
    currentNoteId = notesList.length > 0 ? notesList[0].id : null;
    renderNotesList();
    loadNoteContent();
}

// Generate a new UUID for a note.
function _noteId() {
    return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Save the current notes list to localStorage.
function persistNotes() {
    localStorage.setItem(notesKey(), JSON.stringify(notesList));
}

// Render the notes sidebar list, highlighting the currently selected note.
function renderNotesList() {
    const list = document.getElementById('notes-list');
    if (!list) return;
    list.innerHTML = '';
    notesList.forEach(note => {
        const item = document.createElement('div');
        item.className = 'notes-item' + (note.id === currentNoteId ? ' active' : '');
        const nameSpan = document.createElement('span');
        nameSpan.className = 'notes-item-name';
        nameSpan.textContent = note.name || 'Sans titre';
        nameSpan.addEventListener('click', () => selectNote(note.id));
        const delBtn = document.createElement('button');
        delBtn.className = 'notes-item-delete';
        delBtn.title = 'Supprimer';
        delBtn.textContent = '✕';
        delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteNote(note.id); });
        item.appendChild(nameSpan);
        item.appendChild(delBtn);
        list.appendChild(item);
    });
}

// Load the selected note's name and body into the editor fields.
function loadNoteContent() {
    const nameInput = document.getElementById('notes-name-input');
    const area = document.getElementById('notes-area');
    if (!nameInput || !area) return;
    const note = notesList.find(n => n.id === currentNoteId);
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

// Select a note by ID and display it in the editor.
function selectNote(id) {
    currentNoteId = id;
    renderNotesList();
    loadNoteContent();
    document.getElementById('notes-area').focus();
}

// Add a new empty note, persist it, sync to Supabase, and select it.
function addNote() {
    const note = { id: _noteId(), name: 'Nouvelle note', content: '' };
    notesList.push(note);
    persistNotes();
    syncCharacterNote(note);
    selectNote(note.id);
    const nameInput = document.getElementById('notes-name-input');
    if (nameInput) { nameInput.focus(); nameInput.select(); }
}

// Delete a note, remove it from Supabase, and select the adjacent note.
function deleteNote(id) {
    deleteCharacterNote(id);
    const idx = notesList.findIndex(n => n.id === id);
    notesList = notesList.filter(n => n.id !== id);
    currentNoteId = notesList[Math.min(idx, notesList.length - 1)]?.id || null;
    persistNotes();
    renderNotesList();
    loadNoteContent();
}

// Save the current note's content from the textarea and schedule a Supabase sync.
function saveCurrentNote() {
    const note = notesList.find(n => n.id === currentNoteId);
    if (!note) return;
    note.content = document.getElementById('notes-area').value;
    persistNotes();
    debouncedSyncNote(note);
}

// Rename the current note from the name input and refresh the list.
function renameCurrentNote() {
    const note = notesList.find(n => n.id === currentNoteId);
    if (!note) return;
    note.name = document.getElementById('notes-name-input').value;
    persistNotes();
    renderNotesList();
    debouncedSyncNote(note);
}

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

// Show/hide the Cameras tab based on whether any active stream IDs are known.
function updateCamerasTabVisibility() {
    const peers = [...peerCameras.values()];
    const hasAny = !!gmStreamId || !!vdoRoom || peers.some(p => p.streamId);
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
// "no VDO room", but the Caméras tab only appears when a room or a peer stream is
// known, so the fallback could never bootstrap — dead code that implied the app
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
    if (spotlightCharId === currentCharId) return (currentCharId && !cameraOff) ? derivedStreamId() : '';
    return peerCameras.get(spotlightCharId)?.streamId || '';
}

// Sync the density pills, command-bar dots, and rail with the current mode.
function renderPresenceUI() {
    const peers = [...peerCameras.values()];
    const hasAny = !!gmStreamId || !!vdoRoom || peers.some(p => p.streamId);
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
    if (rail) {
        const show = hasAny && presenceMode === 'bandeau' && !openPanes.includes('tab-cameras');
        rail.style.display = show ? '' : 'none';
        if (show) renderPresenceRail();
        else { const g = document.getElementById('presence-rail-grid'); if (g) g.innerHTML = ''; } // viewer iframes only — safe to drop
    }
    // Tablée — the cameras grid renders as a stage
    document.getElementById('cameras-grid')?.classList.toggle('stage-mode', presenceMode === 'tablee');
    if (presenceMode === 'tablee') applyStageMain();
}

// In-place render of the Bandeau rail tiles (self · GM · peers). Viewer iframes
// are keyed by stream ID and only re-src'd when their URL changes.
function renderPresenceRail() {
    const grid = document.getElementById('presence-rail-grid');
    if (!grid) return;
    const expected = new Map(); // sid → label
    if (vdoRoom && currentCharId && !cameraOff) expected.set(derivedStreamId(), (character.name || 'Vous'));
    if (gmStreamId) expected.set(gmStreamId, 'MJ');
    peerCameras.forEach((p, charId) => { if (p.streamId && charId !== currentCharId) expected.set(p.streamId, p.name || charId); });
    [...grid.querySelectorAll('.pr-tile')].forEach(t => { if (!expected.has(t.dataset.sid)) t.remove(); });
    const spot = spotlightSid();
    expected.forEach((label, sid) => {
        const isSelf = vdoRoom && currentCharId && !cameraOff && sid === derivedStreamId();
        const src = vdoViewSrc(sid, !!isSelf);
        let tile = grid.querySelector(`.pr-tile[data-sid="${CSS.escape(sid)}"]`);
        if (!tile) {
            tile = document.createElement('div');
            tile.className = 'pr-tile';
            tile.dataset.sid = sid;
            const iframe = document.createElement('iframe');
            iframe.src = src;
            iframe.allow = 'autoplay';
            const lab = document.createElement('div');
            lab.className = 'pr-label';
            lab.textContent = label;
            tile.appendChild(iframe);
            tile.appendChild(lab);
            grid.appendChild(tile);
        } else {
            const iframe = tile.querySelector('iframe');
            if (iframe && iframe.src !== src) iframe.src = src;
            const lab = tile.querySelector('.pr-label');
            if (lab) lab.textContent = label;
        }
        tile.classList.toggle('spotlit', !!spot && sid === spot);
    });
}

// Tablée stage: pick the big tile — GM spotlight wins, then the locally clicked
// face, then the GM stream, then the first tile.
function applyStageMain() {
    const grid = document.getElementById('cameras-grid');
    if (!grid) return;
    const cells = [...grid.querySelectorAll('.camera-cell')];
    if (!cells.length) return;
    const sidOf = cell => {
        const ifr = cell.querySelector('iframe');
        try { return ifr ? new URL(ifr.src).searchParams.get('view') || '' : ''; } catch { return ''; }
    };
    const want = spotlightSid() || localStageSid || gmStreamId || '';
    let main = want ? cells.find(c => sidOf(c) === want) : null;
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
        }
        warn.textContent = msg;
        warn.style.display = msg ? '' : 'none';
    }
    // Self tile: a muted viewer of our own pushed stream. The camera itself belongs to
    // #vdo-push-frame; there is no native <video> path. No room, or camera cut ⇒ no self tile.
    let selfCell = grid.querySelector('.camera-cell[data-self]');
    if (vdoRoom && currentCharId && !cameraOff) {
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
    // Build expected map: streamId → display label
    const expected = new Map();
    if (gmStreamId) expected.set(gmStreamId, 'MJ');
    peerCameras.forEach((p, charId) => {
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
    if (presenceMode === 'tablee') applyStageMain();
}

// Tablée: clicking a face promotes it to the big stage tile (frame 25).
window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('cameras-grid')?.addEventListener('click', e => {
        if (presenceMode !== 'tablee') return;
        const cell = e.target.closest('.camera-cell');
        if (!cell || cell.classList.contains('stage-main')) return;
        const ifr = cell.querySelector('iframe');
        try { localStageSid = ifr ? new URL(ifr.src).searchParams.get('view') || '' : ''; } catch { localStageSid = ''; }
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
    const el = document.createElement('div');
    el.textContent = txt;
    el.style.cssText = `position:fixed;top:40%;left:50%;transform:translate(-50%,-50%);font-family:'Cormorant Garamond',serif;font-size:64px;font-weight:900;color:${isHeal ? '#4cff88' : '#ff4444'};text-shadow:0 0 20px ${isHeal ? 'rgba(76,255,136,.5)' : 'rgba(255,50,50,.6)'};pointer-events:none;z-index:900;transition:all .9s ease-out;`;
    document.body.appendChild(el);
    void el.offsetWidth;
    el.style.transform = 'translate(-50%,-120%)';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 1000);
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
    const el = document.getElementById(id);
    el.textContent = msg;
    el.classList.add('show');
    toastTimers[id] = setTimeout(() => el.classList.remove('show'), 3500);
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
    const el = document.getElementById('karma-display');
    if (!el) return;
    const k = character.karma ?? 0;
    el.textContent = (k > 0 ? '+' : '') + k;
    el.className = 'karma-display' + (k > 0 ? ' positive' : k < 0 ? ' negative' : '');
}
// Apply a custom ± value from the BM input to the current bonus/malus.
function addCustomBM(sign) {
    const v = parseInt(document.getElementById('bm-custom-val').value);
    if (!isNaN(v)) { bonusMalus += sign * Math.abs(v); updateBMDisplay(); }
}
// Update the BM display label and in-place refresh all affected skill percentages.
function updateBMDisplay() {
    const el = document.getElementById('bm-display');
    el.textContent = (bonusMalus > 0 ? '+' : '') + bonusMalus;
    el.className = 'bm-display' + (bonusMalus > 0 ? ' positive' : bonusMalus < 0 ? ' negative' : '');
    const bm = liveBM();
    // Render the armed temporary modifier pill (next N rolls).
    const ns = document.getElementById('bm-next-status');
    if (ns) {
        if (bmNextCount > 0) {
            ns.innerHTML = `<span class="bm-next-mod">${bmNextValue > 0 ? '+' : ''}${bmNextValue}</span><span class="bm-next-cnt">${bmNextCount} jet${bmNextCount > 1 ? 's' : ''}</span><button class="bm-next-clear" onclick="clearBMNext()" title="Annuler">✕</button>`;
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
            const v = Math.max(1, Math.min(100, skill.pct + (+skill.bonus || 0) + bm + (character?.karma ?? 0)));
            div.querySelector('.skill-pct').textContent = v + '%';
            const fill = div.querySelector('.skill-bar-fill');
            if (fill) fill.style.width = v + '%';
        }
    });
    document.getElementById('special-list').querySelectorAll('.skill-item').forEach(div => {
        const sp = (character.specials || [])[+div.dataset.skillIdx];
        if (sp) div.querySelector('.skill-pct').textContent = Math.max(1, Math.min(100, sp.pct + (+sp.bonus || 0) + bm + (character?.karma ?? 0))) + '%';
    });
    // Recipe cards render one .potion-card-chance each, in recipe order (stock
    // cards have no chance span), so the NodeList maps 1:1 onto potionRecipes.
    document.querySelectorAll('#potion-list .potion-card-chance').forEach((el, i) => {
        const r = (character.potionRecipes || [])[i];
        if (r) el.textContent = `Succès ${Math.max(0, Math.min(100, (r.successChance || 0) + bm + (character?.karma ?? 0)))}%`;
    });
    updateHiddenRollBtn();
    renderStats();          // stat-card thresholds bake in liveBM() + karma at render time
    renderCombatSidebar();
}

// ═══════════════════════════════════════════
//  RENDER
// ═══════════════════════════════════════════
// Full re-render of all player panel sections.
function renderAll() {
    updateTopbarIdentity();
    document.title = character.name ? `ARIA – ${character.name}` : 'ARIA – Joueur';
    renderSkills();
    renderStats();
    updateHPDisplay();
    renderInventorySidebar();
    renderCombatSidebar();
    renderPotions();
    renderEditorForm();
    renderPlayerFiles();
    renderKarma();
    updateBMDisplay();
}

// Render the skills and specials lists (sorted) with effective percentages applied.
function renderSkills() {
    const list = document.getElementById('skill-list');
    list.innerHTML = '';
    (character.skills || []).map((skill, idx) => ({ skill, idx })).sort((a, b) => a.skill.name.localeCompare(b.skill.name, 'fr')).forEach(({ skill, idx }) => {
        const bonus = +skill.bonus || 0;
        const eff = Math.max(1, Math.min(100, skill.pct + bonus + liveBM() + (character.karma ?? 0)));
        const div = document.createElement('div');
        const isSoigner = skill.name === 'Soigner';
        div.className = 'skill-item' + (isSoigner ? ' soigner-skill' : '');
        div.dataset.skillName = skill.name;
        div.dataset.skillIdx = idx; // index into character.skills — survives duplicate names
        const modBadge = bonus ? `<span class="skill-mod" title="Modificateur permanent">${bonus > 0 ? '+' : ''}${bonus}</span>` : '';
        div.innerHTML = `<span class="skill-name">${_escHtml(skill.name)}</span>${modBadge}${skill.link ? `<span class="skill-link">${_escHtml(skill.link)}</span>` : ''}<div class="skill-bar-wrap"><div class="skill-bar-fill" style="width:${eff}%"></div></div><span class="skill-pct">${eff}%</span>`;
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
        const eff = Math.max(1, Math.min(100, sp.pct + bonus + liveBM() + (character.karma ?? 0)));
        const div = document.createElement('div');
        div.className = 'skill-item';
        div.dataset.skillName = sp.name;
        div.dataset.skillIdx = idx;
        div.style.borderColor = 'rgba(236,164,86,.3)';
        const modBadge = bonus ? `<span class="skill-mod" style="color:var(--ember2)" title="Modificateur permanent">${bonus > 0 ? '+' : ''}${bonus}</span>` : '';
        div.innerHTML = `<span class="skill-link" style="color:var(--ember2)">Spéciale</span><span class="skill-name">${_escHtml(sp.name)}${sp.desc ? ` <span style="font-size:12px;color:var(--parchment-dim)">— ${_escHtml(sp.desc)}</span>` : ''}</span>${modBadge}<span class="skill-pct" style="color:var(--ember2)">${eff}%</span>`;
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
    bar.innerHTML = [1, 2, 3, 4, 5].map(m =>
        `<button class="mult-btn${multiplier === m ? ' active' : ''}" onclick="setMult(${m})">${m > 1 ? '×' + m : '×1'}</button>`
    ).join('');
    const grid = document.getElementById('stat-grid');
    grid.innerHTML = '';
    ['FOR', 'DEX', 'END', 'INT', 'CHA'].forEach(key => {
        const val = character.stats[key] || 0;
        // Same formula as doRoll: base + persistent/temp BM + karma, clamped 1–100.
        const threshold = Math.max(1, Math.min(100, val * multiplier + liveBM() + (character.karma ?? 0)));
        const div = document.createElement('div');
        div.className = 'stat-card';
        div.onclick = () => rollStat(key, val);
        // Big number = the live roll threshold (value × multiplier); updates with the multiplier.
        div.innerHTML = `<div class="stat-key">${key}</div>
          <div class="stat-val">${threshold}<span class="stat-val-pct">%</span></div>
          <div class="stat-preview">valeur ${val} · ×${multiplier}</div>`;
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
    if (!items.length && !showVials) { body.innerHTML = `<div style="font-family:'Cormorant Garamond',serif;font-size:13px;color:var(--parchment-dim);font-style:italic;opacity:.5;">Vide</div>`; }
    else {
        let html = showVials ? `<div class="inv-item"><span style="font-style:italic">Fioles vides</span><span style="color:var(--gold-dim);font-family:'Cormorant Garamond',serif;font-size:12px;">×${vials}</span></div>` : '';
        html += items.map(it => `<div class="inv-item"><span style="font-style:italic">${_escHtml(it.name || '—')}</span><span style="color:var(--gold-dim);font-family:'Cormorant Garamond',serif;font-size:12px;">×${it.qty || 1}</span></div>`).join('');
        body.innerHTML = html;
    }
    const moneyEl = document.getElementById('inv-money-display');
    if (moneyEl) {
        const m = character.money || {};
        if (character.ariaType === 'contemporary') {
            const f = m.francs ?? 0;
            moneyEl.innerHTML = f > 0 ? `<span style="color:var(--parchment-dim);" title="Francs">${f} F</span>` : '';
        } else {
            const parts = MONEY_COINS.map(c => {
                const v = m[c.key] ?? 0;
                return v > 0 ? `<span style="color:${c.color};" title="${c.label}">●${v}</span>` : '';
            }).filter(Boolean);
            moneyEl.innerHTML = parts.join('');
        }
    }
}

// Render the combat sidebar as the design's three sections: Réactions · Protection · Armes.
function renderCombatSidebar() {
    const body = document.getElementById('combat-sidebar-body');
    if (!body) return;
    let html = '';

    // 1 · Réactions (Parade / Esquive) — two cards
    const allSkills = [...(character.skills || []), ...(character.specials || [])];
    const isContemporary = character.ariaType === 'contemporary';
    const parrySkill = allSkills.find(s => isContemporary ? /tabasser/i.test(s.name) : /combat.rapproch/i.test(s.name));
    const dodgeSkill = allSkills.find(s => isContemporary ? /réflexes/i.test(s.name) : /esquiv/i.test(s.name));
    if (parrySkill || dodgeSkill) {
        html += `<div class="sb-section"><div class="sb-label">Réactions</div><div class="react-btns">`;
        if (parrySkill) {
            const pb = +parrySkill.bonus || 0;
            const eff = Math.max(1, Math.min(100, parrySkill.pct + pb + liveBM() + (character.karma ?? 0)));
            html += `<button class="react-btn" onclick="doRoll('${_escHtml(_escJs(parrySkill.name))}',${parrySkill.pct + pb})">Parade<span class="react-pct">${eff}%</span></button>`;
        }
        if (dodgeSkill) {
            const db = +dodgeSkill.bonus || 0;
            const eff = Math.max(1, Math.min(100, dodgeSkill.pct + db + liveBM() + (character.karma ?? 0)));
            html += `<button class="react-btn" onclick="doRoll('${_escHtml(_escJs(dodgeSkill.name))}',${dodgeSkill.pct + db})">${_escHtml(dodgeSkill.name)}<span class="react-pct">${eff}%</span></button>`;
        }
        html += `</div></div>`;
    }

    // 2 · Protection — name + value badge
    const prot = character.protection || {};
    if ((prot.nom && prot.nom.trim()) || prot.valeur) {
        html += `<div class="sb-section"><div class="sb-label">Protection</div><div class="prot-row"><span class="prot-name">${_escHtml(prot.nom || '—')}</span>${prot.valeur ? `<span class="prot-val-badge">${_escHtml(prot.valeur)}</span>` : ''}</div></div>`;
    }

    // 3 · Armes — favourited weapons, left-border rows
    const weapons = (character.weapons || []).filter(w => w.nom.trim() && w.favourite);
    html += `<div class="sb-section"><div class="sb-label">Armes</div>`;
    if (weapons.length) {
        weapons.forEach(w => {
            const hasFormula = w.degats && w.degats.trim();
            const rollAttr = hasFormula ? ` onclick="rollWeaponDamage('${_escHtml(_escJs(w.nom))}','${_escHtml(_escJs(w.degats))}')"` : '';
            const rollableClass = hasFormula ? ' weap-rollable' : '';
            const hint = hasFormula ? `<span class="weap-roll-hint">lancer</span>` : '';
            html += `<div class="weap-row${rollableClass}"${rollAttr}><span class="weap-name">${_escHtml(w.nom)}</span><span class="weap-dmg">${hint}${_escHtml(w.degats || '—')}</span></div>`;
        });
    } else {
        html += `<div class="sb-empty">Aucune arme</div>`;
    }
    html += `</div>`;

    body.innerHTML = html;
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
    const threshold = skipBM ? Math.max(1, Math.min(100, basePct)) : Math.max(1, Math.min(100, basePct + bonusMalus + tempBM + karma));
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
    localStorage.setItem('aria-player-rolls-' + currentCharId, JSON.stringify(playerRollHistory));
    if (_supabaseReady()) sbInsert('character_rolls', {
        character_id: currentCharId,
        skill_name:   stamped.skillName  || '',
        threshold:    stamped.threshold  ?? null,
        roll:         stamped.roll,
        success:      stamped.success    ?? null,
        bonus_malus:  stamped.bonusMalus || 0,
        ts:           stamped.ts,
    });
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
                row.innerHTML = `<span class="rh-skill">${_escHtml(r.skillName)}</span><span class="rh-roll">${+r.roll || 0}</span>`;
            } else {
                const type = classify(r.roll, r.threshold, r.success);
                const cls = { success: 'rh-success', fail: 'rh-fail', 'crit-success': 'rh-crit-success', 'crit-fail': 'rh-crit-fail' }[type] || '';
                const lbl = { success: 'SUCCÈS', fail: 'ÉCHEC', 'crit-success': 'SUCCÈS CRIT.', 'crit-fail': 'ÉCHEC CRIT.' }[type] || '';
                row.className = `rh-row ${cls}`;
                row.innerHTML = `<span class="rh-skill">${_escHtml(r.skillName)}</span><span class="rh-roll">${+r.roll || 0}</span><span class="rh-verdict">${lbl}</span>`;
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
    localStorage.removeItem('aria-player-rolls-' + currentCharId);
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
        rollFilter.forEach(k => { const el = document.getElementById('rfp-' + k); if (el) el.classList.add('active'); });
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
    const now = Date.now();
    const others = Object.entries(knownPlayers)
        .filter(([, p]) => now - p.ts < 30000)
        .map(([id, p]) => ({ id, name: p.name }));
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
        btn.onclick = () => { soignerTarget = { playerId: id, name }; closeSoignerTargetPicker(); doRoll('Soigner', soignerPct); };
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
                    if (ablyDamage) ablyDamage.publish('heal', { targetId: target.playerId, amount: heal, source: 'player' });
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
                    if (ablyDamage) ablyDamage.publish('damage', { targetId: target.playerId, damage: dmg, source: 'player' });
                    showToast('gm-dmg-toast', `Blessure : -${dmg} PV → ${target.name}`);
                }
            });
        }
    }, 1500);
}
// Classify a d100 roll as success, fail, crit-success, or crit-fail.
function classify(roll, threshold, success) {
    if (roll <= 10 && success) return 'crit-success';
    if (roll >= 91 && !success) return 'crit-fail';
    return success ? 'success' : 'fail';
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

// ═══════════════════════════════════════════
//  DDDICE
// ═══════════════════════════════════════════
// Extract the dddice room slug from a full URL or return the raw value.
function extractRoomSlug(val) {
    if (!val) return '';
    const m = val.match(/\/room\/([^/?#]+)/);
    return m ? m[1] : val.trim();
}
// Extract a roll UUID from either the sdk.roll() response or a RollFinished payload.
// RollFinished fires for EVERY roll in the shared room; matching UUIDs stops another
// participant's dice from being consumed as this tab's pending result.
function _ddRollUuid(r) { return r?.uuid ?? r?.data?.uuid ?? null; }
// Initialize the dddice SDK: fetch available themes, create the canvas renderer, and connect to the room.
async function initDddice() {
    const slug = extractRoomSlug(config.dddiceRoom);
    if (!config.dddiceKey || !slug) return;
    try {
        // Load the dddice browser SDK (embeds 3D dice renderer)
        const { ThreeDDice, ThreeDDiceRollEvent } = await import('https://esm.sh/dddice-js');

        // Fetch available themes for the dropdown
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

        // Create the SDK renderer on the canvas, connect to the room
        const canvas = document.getElementById('dddice-canvas');
        dddiceSDK = new ThreeDDice(canvas, config.dddiceKey);
        dddiceSDK.start();
        await dddiceSDK.connect(slug);

        // When the 3D animation finishes, read the result and handle it.
        // Only act when this tab initiated the roll (pending state is set).
        // Other players' roll animations never show because the wrapper div is visibility:hidden
        // by default and only shown when this tab calls showDddiceCanvas() before rolling.
        // The SDK holds a ref to the canvas element only, not the wrapper — so it cannot
        // override the wrapper's visibility.
        dddiceSDK.on(ThreeDDiceRollEvent.RollFinished, (roll) => {
            // Ignore other participants' rolls landing while ours is pending —
            // only enforced when both UUIDs are known (older SDK shapes skip the check).
            const finishedUuid = _ddRollUuid(roll);
            const pendingUuid = pendingDddiceRoll?.uuid ?? pendingSecondaryRoll?.uuid;
            if (pendingUuid && finishedUuid && finishedUuid !== pendingUuid) return;
            if (pendingDddiceRoll) {
                clearTimeout(dddiceRollSafetyTimer);
                const { skillName, threshold } = pendingDddiceRoll;
                pendingDddiceRoll = null;
                setTimeout(() => { dddiceSDK?.clear(); hideDddiceCanvas(); }, 1500);
                const total = roll.total_value ?? 0;
                handleResult(skillName, threshold, total === 0 ? 100 : total);
            } else if (pendingSecondaryRoll) {
                clearTimeout(dddiceRollSafetyTimer);
                const { callback, mapFn } = pendingSecondaryRoll;
                pendingSecondaryRoll = null;
                setTimeout(() => { dddiceSDK?.clear(); hideDddiceCanvas(); }, 1500);
                const total = roll.total_value ?? 1;
                callback(mapFn ? mapFn(total) : total);
            }
            // else: not our roll — canvas is already hidden, nothing to do
        });

        dddiceAPI = { key: config.dddiceKey, room: slug, theme: sel.value };
        setDddiceStatus(true, themes.find(t => t.id === sel.value)?.name || sel.value);
        sel.onchange = () => { if (dddiceAPI) dddiceAPI.theme = sel.value; config.dddiceTheme = sel.value; localStorage.setItem('aria-config', JSON.stringify(config)); };

        // Preload 3D assets without creating a server-side roll, so the first real roll is instant.
        // loadThemeResources is an internal SDK method — call it directly to warm up models/textures/sounds.
        try {
            if (typeof dddiceSDK.loadThemeResources === 'function') {
                await dddiceSDK.loadThemeResources([
                    { type: 'd10x', theme: dddiceAPI.theme },
                    { type: 'd10', theme: dddiceAPI.theme }
                ]);
            }
        } catch (_) {}
    } catch (e) { console.error('dddice:', e); setDddiceStatus(false, e.message); dddiceSDK = null; dddiceAPI = null; }
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
// Update the dddice status dot and text labels in the topbar and config modal.
function setDddiceStatus(ok, detail) {
    const d = ['dddice-dot', 'cfg-dddice-dot'], s = ['dddice-status', 'cfg-dddice-status'];
    d.forEach(id => { const el = document.getElementById(id); if (el) el.className = 'status-dot ' + (ok ? 'connected' : 'error'); });
    s.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ok ? `dddice: ${detail || 'connecté'}` : `Erreur: ${detail || 'dddice'}`; });
}

// ═══════════════════════════════════════════
//  MUSIC ENGINE (PLAYER)
// ═══════════════════════════════════════════
let _playerMusicList  = [];
let musicMasterVolume = parseInt(localStorage.getItem('aria-music-volume') || '80');
let musicFadeDuration = 3000;
let musicCurrentIndex = -1;
let musicIsPlaying    = false;
let _musicCurrentSlot = 'A';
let _musicFadeRaf     = null;
let _musicMuted       = false;

// Effective output volume: 0 when muted, otherwise the master volume.
// Mute silences playback without moving the volume slider.
function _musicEffVol() { return _musicMuted ? 0 : musicMasterVolume; }

const _musicSlots = {
    A: { audio: null, ytEndedCb: null },
    B: { audio: null, ytEndedCb: null },
};
let _ytAPIReady   = false;
let _ytPendingCbs = [];
let _ytSlotA      = null;
let _ytSlotB      = null;

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
            setTimeout(() => {
                try { yt.playVideo(); } catch(_) {}
                onStarted();
                // Detect autoplay block: state stays unstarted/cued if browser blocked it
                setTimeout(() => {
                    try {
                        const state = yt.getPlayerState();
                        if (state !== 1 && state !== 3) { // not playing or buffering
                            _showMusicUnlockPrompt(() => { try { yt.playVideo(); } catch(_) {} });
                        }
                    } catch(_) {}
                }, 1500);
            }, 800);
        });
    }
}

// Cross-fade volume from one audio slot to another over musicFadeDuration ms.
function _runCrossfade(fromSlot, toSlot, onDone) {
    if (_musicFadeRaf) { cancelAnimationFrame(_musicFadeRaf); _musicFadeRaf = null; }
    const start = performance.now();
    const fromStart = _musicEffVol();
    function tick(now) {
        const t = Math.min(1, (now - start) / musicFadeDuration);
        _setSlotVol(fromSlot, (1 - t) * fromStart);
        _setSlotVol(toSlot, t * _musicEffVol());
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

// Advance to the next track when the current one ends; stops if the list is exhausted.
function _musicAutoAdvance() {
    if (!_playerMusicList.length) return;
    const nextIdx = musicCurrentIndex + 1 < _playerMusicList.length ? musicCurrentIndex + 1 : -1;
    if (nextIdx === -1) { musicIsPlaying = false; return; }
    _musicTriggerPlay(_playerMusicList[nextIdx], nextIdx);
}

// Start playing a track on the inactive slot and cross-fade in from the current slot.
function _musicTriggerPlay(track, index) {
    if (_musicFadeRaf) { cancelAnimationFrame(_musicFadeRaf); _musicFadeRaf = null; }
    const currentSlot = _musicCurrentSlot;
    const nextSlot    = currentSlot === 'A' ? 'B' : 'A';
    _musicSlots[currentSlot].ytEndedCb = null;
    if (_musicSlots[currentSlot].audio) _musicSlots[currentSlot].audio.onended = null;
    musicCurrentIndex = index;
    musicIsPlaying    = true;
    _updatePlayerMusicBar(track);
    _loadSlotAtZeroVol(track, nextSlot, () => {
        _runCrossfade(currentSlot, nextSlot, () => {
            _musicCurrentSlot = nextSlot;
            _setSlotEndedCallback(nextSlot, track, _musicAutoAdvance);
        });
    });
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

// ═══════════════════════════════════════════
//  ABLY
// ═══════════════════════════════════════════
// Suffix a base Ably channel name with this character's campaign join code so each
// campaign runs on its own isolated channels (rolls/cards/damage/music). Empty key →
// global channel (backward compatible). The GM and overlay derive the same suffix.
function campaignChannel(base) {
    const t = (character.campaignKey || '').trim().toUpperCase();
    return t ? `${base}-${t}` : base;
}
// Initialize Ably channels and subscribe to all game events (rolls, damage, music, cards).
function initAbly() {
    console.log('[PLAYER] initAbly: connecting with key', config.ablyKey?.slice(0, 8) + '...', '| campaign channel suffix:', character.campaignKey || '(global)');
    try {
        ablyInstance = new Ably.Realtime({ key: config.ablyKey, transports: ['web_socket'] });
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
        // Listen for GM damage/heal targeted at this player
        const myId = playerId;
        ablyDamage.subscribe(msg => {
            const d = msg.data;
            if (!d) return;
            // Track other players' presence for Soigner targeting
            if (msg.name === 'presence' && d.playerId && d.playerId !== myId) {
                knownPlayers[d.playerId] = { name: d.name, ts: Date.now() };
                if (d.charId) {
                    if (d.streamId) peerCameras.set(d.charId, { name: d.name || d.charId, streamId: d.streamId, playerId: d.playerId, ts: Date.now() });
                    else peerCameras.delete(d.charId);
                    updateCamerasTabVisibility();
                }
                return;
            }
            // A peer switched character: drop their Soigner entry and camera tile
            // immediately (the GM does the same with its player card).
            if (msg.name === 'leave') {
                if (d.playerId && d.playerId !== myId) {
                    delete knownPlayers[d.playerId];
                    for (const [cid, pc] of peerCameras) {
                        if (pc.playerId === d.playerId) peerCameras.delete(cid);
                    }
                    updateCamerasTabVisibility();
                }
                return;
            }
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
                if (d.playerId !== myId) return;
                console.log('[PLAYER] tab-config received:', JSON.stringify(d.tabs));
                playerTabs = { ...playerTabs, ...d.tabs };
                localStorage.setItem('aria-player-tabs-' + currentCharId, JSON.stringify(playerTabs));
                debouncedSyncState();
                applyTabVisibility();
                return;
            }
            if (msg.name === 'potion-grant') {
                if (d.playerId !== myId) return;
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
                if (d.playerId !== myId) return;
                console.log('[PLAYER] potion-revoke received:', d.potionId);
                character.potionRecipes = (character.potionRecipes || []).filter(r => r.id !== d.potionId);
                saveCurrentCharacter();
                renderPotions();
                return;
            }
            if (msg.name === 'vial-grant') {
                if (d.playerId !== myId) return;
                console.log('[PLAYER] vial-grant received:', d.qty, 'vials');
                character.vials = (character.vials ?? 0) + (d.qty || 1);
                saveCurrentCharacter();
                renderPotions();
                const n = d.qty || 1;
                showToast('gm-heal-toast', `${n} fiole${n > 1 ? 's' : ''} reçue${n > 1 ? 's' : ''}`);
                return;
            }
            if (msg.name === 'file-grant') {
                if (d.playerId !== myId && d.playerId !== 'all') return;
                if (!d.file?.id) return;
                console.log('[PLAYER] file-grant received:', d.file.name, '| for:', d.playerId === 'all' ? 'all' : 'me');
                if (!playerFiles.find(f => f.id === d.file.id)) {
                    playerFiles.push(d.file);
                    localStorage.setItem('aria-player-files-' + currentCharId, JSON.stringify(playerFiles));
                    syncCharacterFile(d.file, currentCharId);
                    applyTabVisibility();
                    renderPlayerFiles();
                    showToast('gm-heal-toast', `Document reçu : ${d.file.name}`);
                }
                return;
            }
            if (msg.name === 'file-revoke') {
                if (d.playerId !== myId && d.playerId !== 'all') return;
                if (!d.fileId) return;
                console.log('[PLAYER] file-revoke received:', d.fileId);
                playerFiles = playerFiles.filter(f => f.id !== d.fileId);
                localStorage.setItem('aria-player-files-' + currentCharId, JSON.stringify(playerFiles));
                deleteCharacterFile(d.fileId);
                applyTabVisibility();
                renderPlayerFiles();
                return;
            }
            if (msg.name === 'karma-set') {
                if (d.playerId !== myId) return;
                console.log('[PLAYER] karma-set received:', d.karma);
                character.karma = d.karma ?? 0;
                saveCurrentCharacter();
                renderKarma();
                updateBMDisplay();
                renderCombatSidebar();
                return;
            }
            if (msg.name === 'spotlight') {
                console.log('[VDO] spotlight received:', d.charId || '(cleared)');
                spotlightCharId = d.charId || null;
                renderPresenceUI();
                if (document.getElementById('tab-cameras')?.classList.contains('active')) applyStageMain();
                return;
            }
            if (msg.name === 'gm-presence') {
                gmPresenceTs = Date.now();
                gmStreamId = d.streamId || '';
                if (d.spotlightCharId !== undefined) spotlightCharId = d.spotlightCharId || null;
                if (d.vdoRoom !== undefined) {
                    vdoRoom = d.vdoRoom || '';
                    vdoRoomPassword = d.vdoRoomPassword || '';
                    updatePushIframe();
                }
                updateCamerasTabVisibility();
                return;
            }
            if (d.targetId && d.targetId !== myId) return;
            if (msg.name === 'damage') { console.log('[PLAYER] GM damage received: -', d.damage, 'PV | HP:', d.hpBefore, '→', d.hpAfter, '/', d.maxHP); handleGMDamage(d); }
            if (msg.name === 'heal')   { console.log('[PLAYER] GM heal received: +',  d.amount,  'PV | HP:', d.hpBefore, '→', d.hpAfter, '/', d.maxHP); handleGMHeal(d); }
        });
        ablyRolls.subscribe('roll', msg => {
            const d = msg.data;
            if (!d || d.playerId === myId) return;
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
    if (ablyCards) ablyCards.publish(type, { ...extra, excluded: [...cardExcluded], drawn: [...cardDrawn], deckIds: cardDeck.map(c => c.id), lastCardId });
}
// Drop peers whose heartbeats stopped (tab closed without a leave message) so
// stale camera tiles don't linger and the Caméras tab can auto-hide. Runs on the
// same 5s interval as the presence heartbeat.
function prunePeers() {
    const now = Date.now();
    let changed = false;
    peerCameras.forEach((p, cid) => {
        if (now - (p.ts || 0) > 30000) { peerCameras.delete(cid); changed = true; }
    });
    // Expire the GM the same way. Without this the cached vdoRoom lives forever:
    // the MJ tile stays on screen and — worse — the push iframe keeps broadcasting
    // the player's webcam long after the GM closed the session.
    if ((gmStreamId || vdoRoom) && gmPresenceTs && now - gmPresenceTs > 30000) {
        console.log('[VDO] gm-presence expired (30s) — clearing room + stopping push');
        gmStreamId = '';
        vdoRoom = '';
        vdoRoomPassword = '';
        spotlightCharId = null;
        updatePushIframe();   // → about:blank, camera released
        changed = true;
    }
    Object.entries(knownPlayers).forEach(([id, p]) => {
        if (now - (p.ts || 0) > 60000) delete knownPlayers[id];
    });
    if (changed) updateCamerasTabVisibility();
}
// Publish the player's full presence heartbeat to the aria-damage channel.
function sendPresence() {
    if (!ablyDamage) return;
    // Only advertise a stream ID while the push iframe is actually publishing. Sending
    // it unconditionally made the GM (and every peer) open a viewer iframe on a stream
    // nobody was pushing — a permanent black box per player.
    const sid = (vdoRoom && !cameraOff) ? derivedStreamId() : '';
    ablyDamage.publish('presence', {
        playerId, charId: currentCharId, name: character.name, charClass: character.class,
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
        streamId: sid,
    }).catch(err => console.error('[ARIA] publish error:', err));
}
// Update the Ably status dot and text labels in the topbar and config modal.
function setAblyStatus(ok) {
    // classList (not className=) so extra classes like .tb-conn-dot on the topbar dot survive.
    ['ably-dot', 'cfg-ably-dot2'].forEach(id => { const el = document.getElementById(id); if (el) { el.classList.add('status-dot'); el.classList.remove('connected', 'error'); el.classList.add(ok ? 'connected' : 'error'); } });
    ['ably-status', 'cfg-ably-status2'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ok ? 'Ably connecté' : 'Ably erreur'; });
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
    character.campaignKey = document.getElementById('cfg-campaign-key').value.trim().toUpperCase();
    saveCurrentCharacter();
    config = {
        ...config,
        dddiceTheme: document.getElementById('cfg-dddice-theme').value || '',
        lightMode: document.getElementById('cfg-light-mode').checked,
    };
    localStorage.setItem('aria-config', JSON.stringify(config));
    if (dddiceSDK) { try { dddiceSDK.disconnect?.(); } catch (_) {} dddiceSDK = null; }
    clearTimeout(dddiceRollSafetyTimer);
    pendingDddiceRoll = null;
    // Close the old Ably connection before reinit — nulling the refs without closing
    // leaves the old WebSocket subscribed, duplicating every incoming message.
    if (ablyInstance) { try { ablyInstance.close(); } catch (_) {} }
    dddiceAPI = null; ablyRolls = null; ablyRollsHidden = null; ablyCards = null; ablyDamage = null; ablyMusic = null; ablyInstance = null;
    if (config.dddiceKey && config.dddiceRoom) initDddice();
    if (config.ablyKey) initAbly();
}
// Toggle the config modal and scrim visibility.
function toggleConfig() {
    document.getElementById('config-modal').classList.toggle('show');
    document.getElementById('config-scrim').classList.toggle('show');
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
        attrsBlock.querySelectorAll('.cs-attr:not(.cs-attr-pv)').forEach(el => {
            el.style.display = character.ariaType === 'contemporary' ? 'none' : '';
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
        row.innerHTML = `<input class="editor-input" value="${_escHtml(w.nom)}" placeholder="Nom de l'arme" oninput="character.weapons[${i}].nom=this.value;renderCombatSidebar()" /><input class="editor-input weap-dmg" value="${_escHtml(w.degats)}" placeholder="ex: 2d6+2" oninput="character.weapons[${i}].degats=this.value;renderCombatSidebar()" /><button class="weap-fav-btn${w.favourite ? ' active' : ''}" title="Équipée (affichée dans la barre de combat)" onclick="toggleWeaponFavourite(${i})">★</button><button class="del-btn" onclick="removeWeapon(${i})">✕</button>`;
        list.appendChild(row);
    });
}
// Add a new empty weapon slot and re-render the weapons editor.
function addWeapon() {
    if (!character.weapons) character.weapons = [];
    character.weapons.push({ nom: '', degats: '', favourite: false });
    renderWeaponsEditor();
    saveCurrentCharacter();
}
// Remove a weapon by index and re-render the editor and combat sidebar.
function removeWeapon(i) {
    character.weapons.splice(i, 1);
    renderWeaponsEditor();
    renderCombatSidebar();
    saveCurrentCharacter();
}
// Toggle a weapon's equipped (favourite) status and refresh both editor and combat sidebar.
function toggleWeaponFavourite(i) {
    character.weapons[i].favourite = !character.weapons[i].favourite;
    renderWeaponsEditor();
    renderCombatSidebar();
    saveCurrentCharacter();
}
// Render the money editor fields based on character type (ancient coins vs. contemporary francs).
function renderMoneyEditor() {
    const el = document.getElementById('inv-money-editor');
    if (!el) return;
    const m = character.money || {};
    // Each denomination is its own box: label on the left, − value + on the right (value editable).
    const coinBox = (key, label, color) => `
        <div class="money-box">
            <span class="money-box-label">${color ? `<span class="money-box-dot" style="color:${color}">●</span>` : ''}${label}</span>
            <div class="money-box-ctrl">
                <button class="qty-btn" onclick="bumpMoney('${key}',-1)">−</button>
                <input class="money-box-input" type="text" inputmode="numeric" value="${m[key] ?? 0}" oninput="updateMoney('${key}',this.value)" />
                <button class="qty-btn" onclick="bumpMoney('${key}',1)">+</button>
            </div>
        </div>`;
    if (character.ariaType === 'contemporary') {
        el.innerHTML = `<div class="inv-money-grid">${coinBox('francs', 'Francs', '')}</div>`;
    } else {
        el.innerHTML = `<div class="inv-money-grid">${MONEY_COINS.map(c => coinBox(c.key, c.label, c.color)).join('')}</div>`;
    }
}
// Update a single money denomination value (from the editable field).
function updateMoney(key, val) {
    if (!character.money) {
        character.money = character.ariaType === 'contemporary'
            ? { francs: 0 }
            : { couronne: 0, orbe: 0, sceptre: 0, sou: 0 };
    }
    character.money[key] = parseInt(val.replace(/[^0-9]/g, '')) || 0;
    saveCurrentCharacter();
    renderInventorySidebar();
}
// Increment/decrement a money denomination via the +/- buttons.
function bumpMoney(key, delta) {
    if (!character.money) {
        character.money = character.ariaType === 'contemporary'
            ? { francs: 0 }
            : { couronne: 0, orbe: 0, sceptre: 0, sou: 0 };
    }
    character.money[key] = Math.max(0, (character.money[key] || 0) + delta);
    saveCurrentCharacter();
    renderMoneyEditor();
    renderInventorySidebar();
}
// Render the inventory editor list with item rows and vials counter if alchemy is enabled.
function renderInventoryEditor() {
    renderMoneyEditor();
    const list = document.getElementById('inv-editor-list');
    if (!list) return;
    list.innerHTML = '';
    (character.inventory || []).forEach((it, i) => {
        const row = document.createElement('div');
        row.className = 'inv-row';
        // Name stays editable; quantity is adjusted only via the +/- buttons (not a free input).
        row.innerHTML = `<input class="inv-name-input" value="${_escHtml(it.name || '')}" placeholder="Nom de l'objet" oninput="character.inventory[${i}].name=this.value" />
            <div class="inv-qty-ctrl">
                <button class="qty-btn" onclick="bumpInventoryQty(${i},-1)">−</button>
                <span class="inv-qty-val">${it.qty || 1}</span>
                <button class="qty-btn" onclick="bumpInventoryQty(${i},1)">+</button>
            </div>
            <button class="del-btn" onclick="removeInventoryRow(${i})">✕</button>`;
        list.appendChild(row);
    });
    if (playerTabs.alchemy) {
        const v = character.vials ?? 0;
        const vRow = document.createElement('div');
        vRow.className = 'inv-row inv-row-vials';
        vRow.innerHTML = `<span class="inv-vials-name">Fioles vides</span>
            <div class="inv-qty-ctrl">
                <button class="qty-btn" onclick="changeVials(-1)" ${v <= 0 ? 'disabled' : ''}>−</button>
                <span class="inv-qty-val">${v}</span>
                <button class="qty-btn" onclick="changeVials(1)">+</button>
            </div>
            <span></span>`;
        list.insertBefore(vRow, list.firstChild);
    }
}
// Adjust an inventory item's quantity via the +/- buttons (min 0).
function bumpInventoryQty(i, delta) {
    if (!character.inventory[i]) return;
    character.inventory[i].qty = Math.max(0, (character.inventory[i].qty || 0) + delta);
    saveCurrentCharacter();
    renderInventoryEditor();
    renderInventorySidebar();
}
// Add a new empty inventory item and refresh the editor and sidebar.
function addInventoryRow() { character.inventory.push({ name: '', qty: 1 }); renderInventoryEditor(); renderInventorySidebar(); }
// Remove an inventory item by index and refresh the editor and sidebar.
function removeInventoryRow(i) { character.inventory.splice(i, 1); renderInventoryEditor(); renderInventorySidebar(); }

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
    const vialsDiv = document.createElement('div');
    vialsDiv.className = 'alchemy-vials';
    vialsDiv.innerHTML = `
        <span class="alchemy-vials-label">Fioles vides</span>
        <div class="alchemy-vials-ctrl">
            <button class="qty-btn" onclick="changeVials(-1)" ${vials <= 0 ? 'disabled' : ''}>−</button>
            <span class="vial-count">${vials}</span>
            <button class="qty-btn" onclick="changeVials(1)">+</button>
        </div>`;
    container.appendChild(vialsDiv);

    // Recipes section — card grid (design frame 09)
    if (recipes.length) {
        const hdr = document.createElement('div');
        hdr.className = 'alchemy-section-hdr';
        hdr.textContent = 'Recettes connues';
        container.appendChild(hdr);
        const grid = document.createElement('div');
        grid.className = 'potion-grid';
        recipes.forEach((r, i) => {
            // Same modifiers as the roll itself (doRoll adds BM + karma to the threshold).
            const chance = Math.max(0, Math.min(100, (r.successChance || 0) + liveBM() + (character.karma ?? 0)));
            // Recipes arrive from the GM over Ably (potion-grant) — escape everything.
            const meta = [r.ingredients || '', r.desc || ''].filter(Boolean).join(' — ');
            const card = document.createElement('div');
            card.className = 'potion-card';
            card.innerHTML = `
                <div class="potion-card-top">
                    <span class="potion-card-name">${_escHtml(r.name)}</span>
                </div>
                <div class="potion-card-desc">${meta ? _escHtml(meta) : '&nbsp;'}</div>
                <div class="potion-card-foot">
                    <span class="potion-card-chance">Succès ${chance}%</span>
                    <button class="potion-card-action" onclick="craftPotion(${i})" ${vials <= 0 || isRolling ? 'disabled' : ''}>Créer →</button>
                </div>`;
            grid.appendChild(card);
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
            const card = document.createElement('div');
            card.className = 'potion-card' + (!p.qty ? ' depleted' : '');
            card.innerHTML = `
                <div class="potion-card-top">
                    <span class="potion-card-name">${_escHtml(p.name)}</span>
                    <span class="potion-card-qty${!p.qty ? ' depleted' : ''}">×${p.qty ?? 0}</span>
                </div>
                <div class="potion-card-desc">${p.desc ? _escHtml(p.desc) : '&nbsp;'}</div>
                <div class="potion-card-foot">
                    <button class="potion-card-del" onclick="removePotion(${i})" title="Retirer">✕</button>
                    <button class="potion-card-action use" onclick="usePotion(${i})" ${!p.qty ? 'disabled' : ''}>Utiliser →</button>
                </div>`;
            grid.appendChild(card);
        });
        container.appendChild(grid);
    }

    const hasContent = recipes.length > 0 || stock.length > 0;
    if (empty) empty.style.display = hasContent ? 'none' : '';
}


// Increment or decrement the vials counter and update all related views.
function changeVials(delta) {
    character.vials = Math.max(0, (character.vials ?? 0) + delta);
    saveCurrentCharacter();
    renderInventoryEditor();
    renderInventorySidebar();
    renderPotions();
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
            row.innerHTML = `<span class="sname">${_escHtml(sk.name)}</span><input class="spct" type="text" inputmode="numeric" value="${sk.pct}" title="Seuil de base (%)" oninput="this.value=this.value.replace(/[^0-9]/g,'');character.skills[${i}].pct=+this.value||0" /><input class="smod" type="text" inputmode="numeric" value="${sk.bonus ? sk.bonus : ''}" placeholder="mod" title="Modificateur permanent (±)" oninput="this.value=this.value.replace(/[^0-9-]/g,'').replace(/(?!^)-/g,'');character.skills[${i}].bonus=parseInt(this.value)||0" />`;
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
        row.innerHTML = `<input value="${_escHtml(sp.name || '')}" placeholder="Nom" oninput="character.specials[${i}].name=this.value" /><input type="text" inputmode="numeric" value="${sp.pct || 0}" oninput="this.value=this.value.replace(/[^0-9]/g,'');character.specials[${i}].pct=+this.value||0" /><input type="text" inputmode="numeric" value="${sp.bonus ? sp.bonus : ''}" placeholder="mod" title="Modificateur permanent (±)" oninput="this.value=this.value.replace(/[^0-9-]/g,'').replace(/(?!^)-/g,'');character.specials[${i}].bonus=parseInt(this.value)||0" /><input value="${_escHtml(sp.desc || '')}" placeholder="Description" oninput="character.specials[${i}].desc=this.value" /><button class="del-btn" onclick="removeSpecial(${i})">✕</button>`;
        list.appendChild(row);
    });
}
// Add a new empty special skill entry and re-render.
function addSpecialRow() { character.specials.push({ name: '', desc: '', pct: 0 }); renderSpecialsEditor(); }
// Remove a special skill by index and re-render.
function removeSpecial(i) { character.specials.splice(i, 1); renderSpecialsEditor(); }
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
    saveCurrentCharacter();
    // Refresh non-editor UI only — avoids rebuilding editor DOM and losing focus
    updateTopbarIdentity();
    document.title = character.name ? `ARIA – ${character.name}` : 'ARIA – Joueur';
    renderSkills();
    renderStats();
    updateHPDisplay();
    renderInventorySidebar();
    renderCombatSidebar();
    renderPotions();
    sendPresence();
    flashSaveStatus();
}
let saveStatusTimer = null;
// Briefly flash the "saved" status indicator in the character editor.
function flashSaveStatus() {
    const el = document.getElementById('cs-save-status');
    if (!el) return;
    el.classList.add('show');
    clearTimeout(saveStatusTimer);
    saveStatusTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

// ═══════════════════════════════════════════
//  CARD SYSTEM
// ═══════════════════════════════════════════
// Build the card tracker grid of suit rows and rank pills.
function buildTracker() {
    const container = document.getElementById('tracker-suits');
    container.innerHTML = '';
    for (const suit of SUITS) {
        const row = document.createElement('div'); row.className = 'suit-row-t';
        const sym = document.createElement('span'); sym.className = `suit-sym ${suit.cls}`; sym.textContent = suit.sym;
        row.appendChild(sym);
        const pills = document.createElement('div'); pills.className = 'rank-pills';
        for (const rank of RANKS) { pills.appendChild(makePill(`${rank}-${suit.name}`, rank, suit.pillCls)); }
        row.appendChild(pills); container.appendChild(row);
    }
    const jRow = document.createElement('div'); jRow.className = 'suit-row-t';
    const jSym = document.createElement('span'); jSym.className = 'suit-sym c-purple'; jSym.textContent = '★';
    jRow.appendChild(jSym);
    const jPills = document.createElement('div'); jPills.className = 'rank-pills';
    jPills.appendChild(makePill('joker-red', 'R★', 'is-joker'));
    jPills.appendChild(makePill('joker-black', 'N★', 'is-joker'));
    jRow.appendChild(jPills); container.appendChild(jRow);
}
// Create a rank pill element for the card tracker.
function makePill(id, label, extraCls) {
    const p = document.createElement('span');
    p.id = `pill-${id}`; p.className = 'rank-pill' + (extraCls ? ' ' + extraCls : ''); p.textContent = label;
    refreshPill(p, id); p.addEventListener('click', () => togglePill(id)); return p;
}
// Update a pill's visual state to reflect drawn/excluded/normal status.
function refreshPill(p, id) { const drawn = cardDrawn.has(id), excl = cardExcluded.has(id); p.classList.toggle('drawn', drawn); p.classList.toggle('excluded', excl); }
// Refresh all pills in the tracker to match the current deck state.
function refreshAllPills() { ALL_CARDS.forEach(c => { const p = document.getElementById(`pill-${c.id}`); if (p) refreshPill(p, c.id); }); }
// Cycle a card's state: normal → excluded → returned to deck, updating the deck.
function togglePill(id) {
    if (cardDrawing) return;
    const card = cardById(id);
    const name = card.isJoker ? card.label : `${card.rank} de ${SUIT_FR[card.suit.name] || card.suit.name}`;
    if (cardExcluded.has(id)) { cardExcluded.delete(id); cardDeck.splice(Math.floor(Math.random() * (cardDeck.length + 1)), 0, card); updateDeckCount(); showCardStatus(`${name} re-inclus`); }
    else if (cardDrawn.has(id)) { cardDrawn.delete(id); cardDeck.splice(Math.floor(Math.random() * (cardDeck.length + 1)), 0, card); updateDeckCount(); showCardStatus(`${name} remis`); }
    else { cardExcluded.add(id); const idx = cardDeck.findIndex(c => c.id === id); if (idx !== -1) { cardDeck.splice(idx, 1); updateDeckCount(); } showCardStatus(`${name} exclu`); }
    const p = document.getElementById(`pill-${id}`); if (p) refreshPill(p, id);
    updateClearBtn(); saveCardState();
}
// Remove all card exclusions and put excluded cards back in the deck.
function clearExclusions() { if (cardDrawing) return; cardExcluded.forEach(id => { const c = cardById(id); if (c) cardDeck.splice(Math.floor(Math.random() * (cardDeck.length + 1)), 0, c); }); cardExcluded.clear(); updateDeckCount(); refreshAllPills(); updateClearBtn(); saveCardState(); showCardStatus('Exclusions effacées'); }
// Persist the current card deck state (excluded, drawn, deckIds) to localStorage.
function saveCardState() { localStorage.setItem(cardKey(), JSON.stringify({ excluded: [...cardExcluded], drawn: [...cardDrawn], deckIds: cardDeck.map(c => c.id), lastCardId })); debouncedSyncState(); }
// Update the deck count label and toggle reshuffle/clear button visibility.
function updateDeckCount() {
    const n = cardDeck.length;
    document.getElementById('deck-count').textContent = n === 0 ? 'Vide' : `${n} carte${n !== 1 ? 's' : ''}`;
    document.getElementById('deck-wrap').classList.toggle('empty', n === 0);
    document.getElementById('reshuffle-btn').classList.toggle('visible', n === 0);
    document.getElementById('reshuffle-remaining-btn').classList.toggle('visible', n > 1 && n < ALL_CARDS.length - cardExcluded.size);
    updateClearBtn();
}
// Show or hide the clear-exclusions button based on whether any cards are excluded.
function updateClearBtn() { document.getElementById('clear-exclusions-btn').classList.toggle('visible', cardExcluded.size > 0); }
// Show a temporary status message in the card tab for 2.2 seconds.
function showCardStatus(msg) { const el = document.getElementById('card-status'); el.textContent = msg; clearTimeout(cardStatusTimer); cardStatusTimer = setTimeout(() => el.textContent = '', 2200); }
// Return a Promise that resolves after ms milliseconds.
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
// Render the face of a playing card into the drawn-card element.
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
// Restore the last drawn card display after a page reload without animation.
function restoreCard() {
    const card = cardById(lastCardId); if (!card) return;
    const flipWrap = document.getElementById('flip-wrap');
    renderCardContent(card);
    document.getElementById('drawn-card').classList.add('ready');
    flipWrap.classList.remove('hidden');
    flipWrap.style.transition = 'none';
    flipWrap.classList.add('flipped');
    flipWrap.getBoundingClientRect();
    flipWrap.style.transition = '';
}
// Play the card shuffle animation using ghost card elements.
async function animateShuffle() {
    const overlay = document.getElementById('shuffle-overlay');
    const wrap = document.getElementById('deck-wrap');
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
// Render a card face and flip it into view with a CSS transition.
async function revealCard(card) {
    const flipWrap = document.getElementById('flip-wrap');
    const drawnEl = document.getElementById('drawn-card');
    renderCardContent(card); drawnEl.classList.add('ready');
    flipWrap.classList.remove('hidden'); flipWrap.getBoundingClientRect();
    await delay(30); flipWrap.classList.add('flipped');
}
// Draw the top card from the deck with fly and flip animations, then publish to Ably.
async function drawCard() {
    if (cardDrawing || cardDeck.length === 0) return;
    cardDrawing = true;
    const flipWrap = document.getElementById('flip-wrap');
    flipWrap.classList.remove('flipped'); flipWrap.classList.add('hidden');
    document.getElementById('drawn-card').classList.remove('ready');
    await animateFly();
    const drawn = cardDeck.pop();
    cardDrawn.add(drawn.id); lastCardId = drawn.id;
    const pill = document.getElementById(`pill-${drawn.id}`); if (pill) refreshPill(pill, drawn.id);
    updateDeckCount(); await revealCard(drawn);
    showCardStatus(drawn.isJoker ? drawn.label : `${drawn.rank} de ${SUIT_FR[drawn.suit.name] || drawn.suit.name}`);
    saveCardState(); publishCard('draw', { cardId: drawn.id, playerName: character.name });
    cardDrawing = false;
}
// Reshuffle all or remaining cards with shuffle animation and publish to Ably.
async function manualReshuffle(remainingOnly) {
    if (cardDrawing) return;
    cardDrawing = true;
    const flipWrap = document.getElementById('flip-wrap');
    flipWrap.classList.remove('flipped');
    await delay(200); flipWrap.classList.add('hidden');
    document.getElementById('drawn-card').classList.remove('ready');
    await animateShuffle();
    if (remainingOnly) { cardDeck = shuffle(cardDeck); }
    else { cardDrawn.clear(); cardDeck = shuffle([...ALL_CARDS].filter(c => !cardExcluded.has(c.id))); lastCardId = null; }
    buildTracker(); updateDeckCount(); updateClearBtn(); saveCardState(); publishCard('reshuffle');
    const flash = document.getElementById('reshuffle-flash');
    document.getElementById('reshuffle-msg').textContent = remainingOnly ? '↺ Restant mélangé' : '↺ Mélangé';
    flash.classList.add('show'); await delay(900); flash.classList.remove('show');
    cardDrawing = false;
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
    playerFiles.forEach(f => {
        const row = document.createElement('div');
        row.className = 'player-file-row';
        row.innerHTML = `
            <div class="pf-icon">${_pfFileIcon(f.type)}</div>
            <div class="pf-name">${_escHtml(f.name)}</div>
            <button class="pf-open-btn" onclick="openFileViewer('${_escHtml(_escJs(f.id))}')">Ouvrir</button>`;
        list.appendChild(row);
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
        const wrap = document.createElement('div');
        wrap.className = 'fv-unsupported';
        wrap.innerHTML = `<div class="fv-unsupported-icon">${_pfFileIcon(f.type)}</div>
            <div class="fv-unsupported-name">${_escHtml(f.name)}</div>
            ${url ? `<a class="fv-download-link" href="${_escHtml(url)}" target="_blank" rel="noopener">Ouvrir dans un nouvel onglet</a>` : ''}`;
        body.appendChild(wrap);
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
