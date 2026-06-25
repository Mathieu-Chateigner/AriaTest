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
//  MIGRATION — one-time blob → relational
// ═══════════════════════════════════════════
// One-time migration: moves old JSON blob data into the relational schema.
async function runMigration(saveKey, type) {
    try {
        if (type === 'player') {
            const flagRows = await sbSelect('saves', 'save_key=eq.' + encodeURIComponent(saveKey) + '&select=player_migrated_at');
            if (flagRows.length && flagRows[0].player_migrated_at) return;

            const blobRows = await sbSelect('saves', 'save_key=eq.' + encodeURIComponent(saveKey) + '&select=data');
            if (!blobRows.length || !blobRows[0].data) return;
            const blob = blobRows[0].data;
            const pd = blob.player || (Array.isArray(blob.characters) ? blob : null);
            if (!pd) return;

            const chars   = pd.characters || [];
            const perChar = pd.perChar    || {};
            const now     = new Date().toISOString();

            await Promise.all(chars.map(c => sbUpsert('characters', {
                id: c.id, save_key: saveKey, name: c.name, class: c.class,
                campaign_key: c.campaignKey || null,
                stats: c.stats || null, physical: c.physical || null,
                skills: c.skills || null, specials: c.specials || null,
                weapons: c.weapons || null, protection: c.protection || null,
                inventory: c.inventory || null, potion_recipes: c.potionRecipes || null,
                vials: c.vials || 0, updated_at: now,
            })));

            await Promise.all(chars.map(c => {
                const s = perChar[c.id] || {};
                return sbUpsert('character_state', {
                    character_id: c.id,
                    hp:    s.hp    !== undefined ? s.hp    : null,
                    cards: s.cards || null,
                    tabs:  s.tabs  || null,
                    updated_at: now,
                });
            }));

            for (const c of chars) {
                const s     = perChar[c.id] || {};
                const notes = Array.isArray(s.notes) ? s.notes : [];
                await Promise.all(notes.map((n, i) => sbUpsert('character_notes', {
                    id: n.id, character_id: c.id,
                    name: n.name || 'Note', content: n.content || '',
                    position: i, updated_at: now,
                })));
                const files = Array.isArray(s.files) ? s.files : [];
                await Promise.all(files.map(f => sbUpsert('character_files', {
                    id: f.id, character_id: c.id,
                    file_id: f.id, name: f.name || '', type: f.type || '', url: f.url || '',
                    updated_at: now,
                })));
            }

            await sbPatch('saves', { player_migrated_at: now }, 'save_key=eq.' + encodeURIComponent(saveKey));

        } else if (type === 'gm') {
            const flagRows = await sbSelect('saves', 'save_key=eq.' + encodeURIComponent(saveKey) + '&select=gm_migrated_at');
            if (flagRows.length && flagRows[0].gm_migrated_at) return;

            const blobRows = await sbSelect('saves', 'save_key=eq.' + encodeURIComponent(saveKey) + '&select=data');
            if (!blobRows.length || !blobRows[0].data) return;
            const blob = blobRows[0].data;
            const gd = blob.gm;
            if (!gd) return;

            const campaigns   = gd.campaigns   || [];
            const perCampaign = gd.perCampaign || {};
            const now         = new Date().toISOString();

            await Promise.all(campaigns.map(c => sbUpsert('campaigns', {
                id: c.id, save_key: saveKey, name: c.name,
                join_code: c.joinCode || null, updated_at: now,
            })));

            for (const c of campaigns) {
                const s = perCampaign[c.id] || {};

                const monsters = s.monsters || [];
                await Promise.all(monsters.map(m => sbUpsert('monsters', {
                    id: String(m.id), campaign_id: c.id, name: m.name,
                    pv: m.pv, max_pv: m.maxPV, armor: m.armor || 0,
                    stats: m.stats || null, attacks: m.attacks || null, updated_at: now,
                })));

                const potions = s.potions || [];
                await Promise.all(potions.map(p => sbUpsert('campaign_potions', {
                    id: p.id, campaign_id: c.id, name: p.name,
                    description: p.desc || '', ingredients: p.ingredients || null,
                    success_chance: p.successChance || 0, updated_at: now,
                })));

                const files = s.files || [];
                await Promise.all(files.map(f => sbUpsert('campaign_files', {
                    id: f.id, campaign_id: c.id, name: f.name,
                    type: f.type || '', url: f.url || '', path: f.path || '',
                    granted_to: f.grantedTo || [], updated_at: now,
                })));

                const knownPlayers = s.knownPlayers || {};
                await Promise.all(Object.values(knownPlayers).map(p => {
                    if (!p?.charId) return Promise.resolve();
                    return sbUpsert('campaign_known_players', {
                        id: p.charId + ':' + c.id,
                        campaign_id: c.id, char_id: p.charId,
                        data: p, updated_at: now,
                    }, 'campaign_id,char_id');
                }));

                const notes = s.notes || [];
                await Promise.all(notes.map((n, i) => sbUpsert('campaign_notes', {
                    id: n.id, campaign_id: c.id,
                    name: n.name || 'Note', content: n.content || '',
                    position: i, updated_at: now,
                })));

                const rolls = s.rolls || [];
                for (const r of rolls) {
                    await sbInsert('campaign_rolls', {
                        campaign_id: c.id,
                        skill_name: r.skillName || '',
                        threshold: r.threshold ?? null,
                        roll: r.roll,
                        success: !!r.success,
                        char_name: r.char || r.playerId || '',
                        bonus_malus: r.bonusMalus || 0,
                        created_at: r.receivedAt ? new Date(r.receivedAt).toISOString() : now,
                    });
                }

                const cardHistory = s.cardHistory || [];
                for (const entry of cardHistory) {
                    await sbInsert('campaign_card_history', {
                        campaign_id: c.id,
                        card_id: entry.cardId || '',
                        drawn_at: entry.ts ? new Date(entry.ts).toISOString() : now,
                    });
                }
            }

            await sbPatch('saves', { gm_migrated_at: now }, 'save_key=eq.' + encodeURIComponent(saveKey));
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
