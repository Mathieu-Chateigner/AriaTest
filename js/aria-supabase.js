// ═══════════════════════════════════════════
//  SUPABASE SHARED PRIMITIVES
//  Loaded before aria-player.js and aria-gm.js
// ═══════════════════════════════════════════
const SUPABASE_URL      = 'https://npybuksklkvdmbhyzdjs.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_hUkdwmlgNNhLXn6t38GHHg_N7XXVOn4';

// Internal Supabase REST fetch with API key auth headers.
function _sbFetch(path, options = {}) {
    return fetch(SUPABASE_URL + path, {
        ...options,
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });
}

// Upsert a row into a Supabase table, merging on conflict.
async function sbUpsert(table, row, onConflict) {
    const qs = onConflict ? '?on_conflict=' + onConflict : '';
    try {
        const res = await _sbFetch('/rest/v1/' + table + qs, {
            method: 'POST',
            headers: { 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify(row),
        });
        if (!res.ok) console.warn('[ARIA] sbUpsert failed:', table, await res.text());
        return res.ok;
    } catch(e) { console.warn('[ARIA] sbUpsert error:', table, e); return false; }
}

// Delete rows from a Supabase table matching a filter string.
async function sbDelete(table, filterStr) {
    try {
        const res = await _sbFetch('/rest/v1/' + table + '?' + filterStr, { method: 'DELETE' });
        if (!res.ok) console.warn('[ARIA] sbDelete failed:', table, await res.text());
    } catch(e) { console.warn('[ARIA] sbDelete error:', table, e); }
}

// Fetch rows from a Supabase table matching a filter string.
async function sbSelect(table, filterStr) {
    try {
        const res = await _sbFetch('/rest/v1/' + table + '?' + filterStr);
        if (!res.ok) { console.warn('[ARIA] sbSelect failed:', table, await res.text()); return []; }
        return await res.json();
    } catch(e) { console.warn('[ARIA] sbSelect error:', table, e); return []; }
}

// Insert a new row into a Supabase table.
async function sbInsert(table, row) {
    try {
        const res = await _sbFetch('/rest/v1/' + table, {
            method: 'POST',
            body: JSON.stringify(row),
        });
        if (!res.ok) console.warn('[ARIA] sbInsert failed:', table, await res.text());
    } catch(e) { console.warn('[ARIA] sbInsert error:', table, e); }
}

// Partially update rows in a Supabase table matching a filter.
async function sbPatch(table, row, filterStr) {
    try {
        const res = await _sbFetch('/rest/v1/' + table + '?' + filterStr, {
            method: 'PATCH',
            body: JSON.stringify(row),
        });
        if (!res.ok) console.warn('[ARIA] sbPatch failed:', table, await res.text());
    } catch(e) { console.warn('[ARIA] sbPatch error:', table, e); }
}

// ═══════════════════════════════════════════
//  ENTITY MAPPING
// ═══════════════════════════════════════════
// The camelCase-object ↔ snake_case-row mapping for each table, written once.
//
// It used to be written four times per entity — in runMigration, in the panel's
// sync{X}, again in the panel's _syncAll{X}Data, and once more reversed inside
// loadFromSupabase — about thirty hand-maintained copies in all. They drifted, and
// every compensating mechanism downstream (the "restore child tables
// unconditionally" rule, the resurrection bug behind it) was paying for that drift.
// Adding a column now means adding one line here.
//
// A field is `jsKey: 'column'`, or `jsKey: { col, to, from, def }` when it needs a
// coercion on write (`to`), on read (`from`), or a fallback for a null column
// (`def`, called if it is a function so each object gets its own array/object).
const _ENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

function _fieldSpec(spec) { return typeof spec === 'string' ? { col: spec } : spec; }

// Current UTC time as an ISO 8601 string.
function _nowISO() { return new Date().toISOString(); }

// Build a Supabase row from a JS object. `parentId` fills the entity's FK column;
// `extra` adds computed columns the object does not carry (notes/music `position`)
// and wins over the timestamp, so a replayed row can keep its original one.
// `entity.stamp` names the timestamp column, or is null for tables without one.
function toRow(entity, obj, parentId, extra = {}) {
    const row = {};
    for (const [key, raw] of Object.entries(entity.fields)) {
        const f = _fieldSpec(raw);
        const v = f.to ? f.to(obj[key], obj) : obj[key];
        row[f.col] = v === undefined ? null : v;
    }
    if (entity.parent) row[entity.parent] = parentId;
    const stamp = entity.stamp === undefined ? 'updated_at' : entity.stamp;
    return { ...row, ...(stamp ? { [stamp]: _nowISO() } : {}), ...extra };
}

// Build the JS object back from a Supabase row.
function fromRow(entity, row) {
    const obj = {};
    for (const [key, raw] of Object.entries(entity.fields)) {
        const f = _fieldSpec(raw);
        const v = row[f.col];
        if (f.from) { obj[key] = f.from(v, row); continue; }
        obj[key] = (v === null || v === undefined)
            ? (typeof f.def === 'function' ? f.def() : f.def)
            : v;
    }
    return obj;
}

// Upsert one object, and one array of objects (position = array index).
function sbPut(entity, obj, parentId, extra) {
    return sbUpsert(entity.table, toRow(entity, obj, parentId, extra), entity.onConflict);
}
function sbPutAll(entity, list, parentId, positioned = false) {
    return Promise.all((list || []).map((o, i) =>
        sbPut(entity, o, parentId, positioned ? { position: i } : undefined)));
}

const _str = v => v ?? '';
const _orNull = v => v || null;
const _arr = () => [];
const _obj = () => ({});

const ENT = {
    character: {
        table: 'characters', parent: 'save_key',
        fields: {
            id: 'id', name: 'name', class: 'class',
            campaignKey:   { col: 'campaign_key',   to: _orNull, def: '' },
            ariaType:      { col: 'aria_type',      to: v => v || 'ancient', def: 'ancient' },
            stats:         { col: 'stats',          to: _orNull, def: _obj },
            physical:      { col: 'physical',       to: _orNull, def: _obj },
            skills:        { col: 'skills',         to: _orNull, def: _arr },
            specials:      { col: 'specials',       to: _orNull, def: _arr },
            weapons:       { col: 'weapons',        to: _orNull, def: _arr },
            protection:    { col: 'protection',     to: _orNull, def: _obj },
            inventory:     { col: 'inventory',      to: _orNull, def: _arr },
            potionRecipes: { col: 'potion_recipes', to: _orNull, def: _arr },
            potions:       { col: 'potions',        to: _orNull, def: _arr },
            money:         { col: 'money',          to: _orNull, def: null },
            vials:         { col: 'vials',          to: v => v || 0, def: 0 },
            karma:         { col: 'karma',          to: v => v ?? 0, def: 0 },
        },
    },
    characterNote: {
        table: 'character_notes', parent: 'character_id',
        fields: { id: 'id', name: { col: 'name', to: _str, def: '' }, content: { col: 'content', to: _str, def: '' } },
    },
    // Written through _charStateRow() in aria-player.js rather than toRow(), because
    // its source is three separate localStorage keys rather than one object. Listed
    // here so the character delete cascade covers it.
    characterState: {
        table: 'character_state', parent: 'character_id', fields: {},
    },
    characterRoll: {
        table: 'character_rolls', parent: 'character_id', stamp: null,
        fields: {
            skillName:  { col: 'skill_name',  to: _str },
            threshold:  { col: 'threshold',   to: v => v ?? null },
            roll: 'roll',
            success:    { col: 'success',     to: v => v ?? null },
            bonusMalus: { col: 'bonus_malus', to: v => v || 0, def: 0 },
            ts: 'ts',
        },
    },
    characterFile: {
        table: 'character_files', parent: 'character_id',
        // `id` and `file_id` both carry the file's id; reads take file_id.
        fields: {
            id:   { col: 'file_id', to: v => v },
            name: { col: 'name', to: _str, def: '' }, type: { col: 'type', to: _str, def: '' }, url: { col: 'url', to: _str, def: '' },
        },
    },
    campaign: {
        table: 'campaigns', parent: 'save_key',
        fields: {
            id: 'id', name: 'name',
            joinCode:         { col: 'join_code',         to: _orNull, def: '' },
            vdoRoom:          { col: 'vdo_room',          to: _orNull, def: '' },
            vdoRoomPassword:  { col: 'vdo_room_password', to: _orNull, def: '' },
            ariaType:         { col: 'aria_type',         to: v => v || 'ancient', def: 'ancient' },
        },
    },
    monster: {
        table: 'monsters', parent: 'campaign_id',
        fields: {
            id:      { col: 'id', to: v => String(v) },
            name: 'name', pv: 'pv',
            maxPV:   { col: 'max_pv' },
            armor:   { col: 'armor',   to: v => v || 0, def: 0 },
            stats:   { col: 'stats',   to: _orNull, def: _obj },
            attacks: { col: 'attacks', to: _orNull, def: _arr },
        },
    },
    potion: {
        table: 'campaign_potions', parent: 'campaign_id',
        fields: {
            id: 'id', name: 'name',
            desc:          { col: 'description',    to: _str, def: '' },
            ingredients:   { col: 'ingredients',    to: _orNull, def: '' },
            successChance: { col: 'success_chance', to: v => v || 0, def: 0 },
        },
    },
    campaignFile: {
        table: 'campaign_files', parent: 'campaign_id',
        fields: {
            id: 'id', name: 'name',
            type:      { col: 'type', to: _str, def: '' }, url: { col: 'url', to: _str, def: '' }, path: { col: 'path', to: _str, def: '' },
            grantedTo: { col: 'granted_to', to: v => v || [], def: _arr },
        },
    },
    music: {
        table: 'campaign_music', parent: 'campaign_id',
        fields: {
            id: 'id', name: 'name', type: 'type',
            url:       { col: 'url',        to: _orNull, def: null },
            youtubeId: { col: 'youtube_id', to: _orNull, def: null },
            path:      { col: 'path',       to: _orNull, def: null },
        },
    },
    campaignNote: {
        table: 'campaign_notes', parent: 'campaign_id',
        fields: {
            id: 'id',
            name:    { col: 'name',    to: v => v || 'Note', def: 'Note' },
            content: { col: 'content', to: _str, def: '' },
        },
    },
    knownPlayer: {
        table: 'campaign_known_players', parent: 'campaign_id',
        onConflict: 'campaign_id,char_id',
        fields: {
            charId: { col: 'char_id' },
            data:   { col: 'data' },
        },
    },
    // Append-only log tables: no primary key of ours, stamped created_at.
    roll: {
        table: 'campaign_rolls', parent: 'campaign_id', stamp: 'created_at',
        fields: {
            skillName:  { col: 'skill_name', to: _str },
            threshold:  { col: 'threshold',  to: v => v ?? null },
            roll: 'roll',
            success:    { col: 'success',    to: v => !!v },
            char:       { col: 'char_name',  to: (v, o) => v || o.playerId || '' },
            bonusMalus: { col: 'bonus_malus', to: v => v || 0 },
        },
    },
    cardDraw: {
        table: 'campaign_card_history', parent: 'campaign_id', stamp: 'drawn_at',
        fields: { cardId: { col: 'card_id', to: _str } },
    },
};

// Every table whose rows hang off `parentCol`. Delete cascades are built from this
// rather than by listing the tables again — a new child entity is covered the
// moment it is added to ENT, instead of silently leaking rows until someone
// notices the delete path never learned about it.
function childTables(parentCol) {
    return Object.values(ENT).filter(e => e.parent === parentCol).map(e => e.table);
}

// Delete a parent row and every child row that references it.
function sbDeleteCascade(entity, parentCol, id) {
    const f = 'eq.' + encodeURIComponent(id);
    return Promise.all([
        sbDelete(entity.table, 'id=' + f),
        ...childTables(parentCol).map(t => sbDelete(t, parentCol + '=' + f)),
    ]);
}

// character_files needs its own primary key alongside file_id, and known_players a
// composite one. Both are computed from the object rather than stored on it.
function sbPutFile(file, charId) {
    return sbUpsert(ENT.characterFile.table,
        { ...toRow(ENT.characterFile, file, charId), id: file.id },
        ENT.characterFile.onConflict);
}
function sbPutKnownPlayer(charId, data, campaignId) {
    if (!_ENT_ID.test(String(charId))) return Promise.resolve(false);
    return sbUpsert(ENT.knownPlayer.table,
        { ...toRow(ENT.knownPlayer, { charId, data }, campaignId), id: charId + ':' + campaignId },
        ENT.knownPlayer.onConflict);
}

// ═══════════════════════════════════════════
//  MIGRATION — one-time blob → relational
// ═══════════════════════════════════════════
// One-time migration: moves old JSON blob data into the relational schema. Every
// mapping here now comes from ENT, so this cannot drift from the live sync path —
// which is what made the previous hand-written copy dangerous rather than merely
// verbose (it wrote `character_notes.name` defaulted to 'Note' where the live path
// defaulted to '', and it never learned about aria_type, potions, money or karma).
async function runMigration(saveKey, type) {
    const keyFilter = 'save_key=eq.' + encodeURIComponent(saveKey);

    // Read the blob once, and only if this save key has not been migrated yet.
    async function pendingBlob(flagCol) {
        const flagRows = await sbSelect('saves', keyFilter + '&select=' + flagCol);
        if (flagRows.length && flagRows[0][flagCol]) return null;
        const blobRows = await sbSelect('saves', keyFilter + '&select=data');
        return blobRows.length ? (blobRows[0].data || null) : null;
    }

    try {
        if (type === 'player') {
            const blob = await pendingBlob('player_migrated_at');
            if (!blob) return;
            const pd = blob.player || (Array.isArray(blob.characters) ? blob : null);
            if (!pd) return;
            const chars = pd.characters || [];
            const perChar = pd.perChar || {};

            await sbPutAll(ENT.character, chars, saveKey);
            await Promise.all(chars.map(c => {
                const s = perChar[c.id] || {};
                return sbUpsert('character_state', {
                    character_id: c.id,
                    hp: s.hp !== undefined ? s.hp : null,
                    cards: s.cards || null,
                    tabs: s.tabs || null,
                    updated_at: _nowISO(),
                });
            }));
            for (const c of chars) {
                const s = perChar[c.id] || {};
                await sbPutAll(ENT.characterNote, Array.isArray(s.notes) ? s.notes : [], c.id, true);
                await Promise.all((Array.isArray(s.files) ? s.files : []).map(f => sbPutFile(f, c.id)));
            }
            await sbPatch('saves', { player_migrated_at: _nowISO() }, keyFilter);

        } else if (type === 'gm') {
            const blob = await pendingBlob('gm_migrated_at');
            if (!blob?.gm) return;
            const campaigns = blob.gm.campaigns || [];
            const perCampaign = blob.gm.perCampaign || {};

            await sbPutAll(ENT.campaign, campaigns, saveKey);
            for (const c of campaigns) {
                const s = perCampaign[c.id] || {};
                await sbPutAll(ENT.monster, s.monsters, c.id);
                await sbPutAll(ENT.potion, s.potions, c.id);
                await sbPutAll(ENT.campaignFile, s.files, c.id);
                await sbPutAll(ENT.campaignNote, s.notes, c.id, true);
                await Promise.all(Object.values(s.knownPlayers || {})
                    .filter(p => p?.charId)
                    .map(p => sbPutKnownPlayer(p.charId, p, c.id)));
                // Append-only: replayed with their original timestamps.
                for (const r of (s.rolls || [])) {
                    await sbInsert(ENT.roll.table, toRow(ENT.roll, r, c.id,
                        r.receivedAt ? { created_at: new Date(r.receivedAt).toISOString() } : {}));
                }
                for (const entry of (s.cardHistory || [])) {
                    await sbInsert(ENT.cardDraw.table, toRow(ENT.cardDraw, entry, c.id,
                        entry.ts ? { drawn_at: new Date(entry.ts).toISOString() } : {}));
                }
            }
            await sbPatch('saves', { gm_migrated_at: _nowISO() }, keyFilter);
        }
    } catch(e) {
        console.warn('[ARIA] Migration failed:', e);
    }
}

// Load the 100 most recent rolls for a character from Supabase.
async function loadCharacterRolls(charId) {
    return await sbSelect('character_rolls',
        'character_id=eq.' + encodeURIComponent(charId) + '&order=ts.desc&limit=100'
    );
}
