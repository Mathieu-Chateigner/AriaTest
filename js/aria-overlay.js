const params = new URLSearchParams(window.location.search);
const MODE = params.get('mode') || 'gm';
const ABLY_KEY = params.get('ably') || '';
const DDDICE_KEY = params.get('dddice_key') || '';
const DDDICE_ROOM = params.get('dddice_room') || '';
const OVERLAY_ID = params.get('overlay') || '';
// Campaign join code from the overlay URL (?campaign=XXXXX). Scopes the rolls/cards/damage
// channels so this overlay only shows events from its campaign. Empty → global channels.
const CAMPAIGN = (params.get('campaign') || '').trim().toUpperCase();
function campaignChannel(base) { return CAMPAIGN ? `${base}-${CAMPAIGN}` : base; }

// Escape any value before inserting into innerHTML. Presence/roll/monster data is
// remote-controlled (players broadcast their own character data over Ably), so every
// interpolated field below must be escaped to prevent on-stream XSS in OBS.
function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

let mapState = null;
// The overlay already knows whose it is: a player overlay shows that character's view, a
// GM overlay the table's. GM notes are in neither — they are never in the payload at all.
const MAP_CHAR_ID = OVERLAY_ID.startsWith('player_') ? OVERLAY_ID.slice(7) : null;

let overlayConfig = { widgets: [] };
// Set once a layout-update has been applied. loadOverlayConfig() runs at startup and
// awaits Supabase; the editor publishes over Ably and writes to the DB concurrently,
// so a layout-update arriving during that round-trip is newer than anything the read
// can return — and letting the stale row land would drop the OBS output back to the
// previous layout until the next edit.
let layoutFromAbly = false;
// Live participants, keyed by charId — a projection of the `aria-presence` channel's
// presence set, re-read whole on every change. The overlay only observes: it never
// enters the set, so it needs no clientId.
//
// What this replaces: a 60s last-seen cache, a per-character session registry, a 10s
// prune sweep and a `leave` subscription, all of which existed to answer "is this
// player still here" from a stream of heartbeats. Ably answers it. In particular a
// player closing one of two tabs no longer removes their face from the OBS output,
// because the other tab is still a member of the set.
const presenceCache = new Map();
const rollHistory = [];
const ROLL_HISTORY_MAX = 20;

// VDO.ninja room + password, cached from the GM's gm-presence broadcast. Camera
// widgets need them: streams pushed into a password-protected room are encrypted
// and a bare ?view=SID viewer stays black without &room + &password (&solo is
// required alongside &room or VDO.ninja shows its join page instead of the stream).
let vdoRoom = '';
let vdoRoomPassword = '';
// VDO.ninja sanitizes stream ids to [A-Za-z0-9_] before publishing, so a stream
// pushed as `aria-11b0286b` is announced as `aria_11b0286b`. Apply the same rule to
// every id we view or compare — a widget config saved by an older editor, or a peer
// on an older build, still carries hyphens and would never match.
const sidSafe = s => String(s || '').replace(/\W+/g, '_');

function vdoCamSrc(sid) {
    let src = `https://vdo.ninja/?view=${encodeURIComponent(sidSafe(sid))}&autoplay&cleanoutput&transparent`;
    if (vdoRoom) src += `&solo&room=${encodeURIComponent(vdoRoom)}`;
    if (vdoRoomPassword) src += `&password=${encodeURIComponent(vdoRoomPassword)}`;
    return src;
}
// The GM's own stream, taken from its presence member. Needed to decide whether a
// camera widget pointed at the GM is live, since the GM is kept out of presenceCache
// (that map is players). It goes when the GM leaves the set — a crash or a lost
// network is reported by Ably like any other departure, so no silence timer is
// needed to catch the case where a "session over" message would never have arrived.
let gmLiveStreamId = '';
// Stream IDs currently being pushed: the live players in the presence set, plus the
// GM. A widget pointing anywhere else is showing a stream nobody publishes.
function liveStreamIds() {
    const live = new Set();
    if (gmLiveStreamId) live.add(sidSafe(gmLiveStreamId));
    presenceCache.forEach(p => { if (p.streamId) live.add(sidSafe(p.streamId)); });
    return live;
}
// Bring one camera widget's element in line with the current room/liveness, doing
// the least possible to the DOM: a live iframe whose src is already right is left
// completely alone. Anything else (re-creating it, or even re-assigning the same
// src) tears down the WebRTC connection and blacks the tile out on stream for a
// second or two. `live` is a liveStreamIds() set, passed in so a caller looping
// over many widgets computes it once.
function syncCameraWidget(el, widget, live) {
    const sid = sidSafe(widget.config?.streamId);
    const iframe = el.querySelector('iframe');
    if (!sid || !live.has(sid)) {
        // Nobody is pushing this stream — show the (invisible) placeholder rather
        // than a black rectangle. Already a placeholder ⇒ nothing to do.
        if (iframe || !el.firstChild) el.innerHTML = '<div class="ow-camera-empty">—</div>';
        return;
    }
    const src = vdoCamSrc(sid);
    if (iframe) {
        if (iframe.src !== src) iframe.src = src;
    } else {
        el.innerHTML = renderWidgetContent(widget);
    }
}
// Re-src camera widget iframes after the room/password arrive, and swap them for a
// placeholder when their stream stops. Camera widgets are skipped by
// updateWidgetData to avoid iframe reloads on every presence tick, so without this
// a disconnected player left a black rectangle on stream forever.
function refreshCameraWidgets() {
    const live = liveStreamIds();
    document.querySelectorAll('.overlay-widget').forEach(el => {
        const widget = overlayConfig.widgets.find(w => w.id === el.dataset.widgetId);
        if (!widget || widget.type !== 'camera') return;
        syncCameraWidget(el, widget, live);
    });
}

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

// Create the <img> once and only re-assign src when it differs — the setFrameSrc guard,
// for the same reason: this output runs for hours and a reload is a visible flash. Only
// the zone and pin layers are rebuilt, and only when a state arrives. The image sits inside
// .ow-map-frame (shrink-wrapped to the rendered picture, like .aria-frame in the panels) —
// see the CSS comment above .ow-map-frame for why the layers must be inset:0 of THAT, not
// of the widget box.
function syncMapWidget(el, widget) {
    if (!mapState || !mapState.imageUrl) {
        console.log('[OVERLAY] map widget', widget.id, '→ placeholder | no active map');
        el.innerHTML = '';
        return;
    }
    let img = el.querySelector('img.ow-map-img');
    if (!img) {
        console.log('[OVERLAY] map widget', widget.id, '→ new image |', mapState.imageUrl);
        el.innerHTML = `<div class="ow-map"><div class="ow-map-frame"><img class="ow-map-img" src="${esc(mapState.imageUrl)}" alt=""><div class="ow-map-zones-wrap"></div><div class="ow-map-pins"></div></div></div>`;
        img = el.querySelector('img.ow-map-img');
    } else if (img.getAttribute('src') !== mapState.imageUrl) {
        console.log('[OVERLAY] map widget', widget.id, '→ re-src |', mapState.imageUrl);
        img.setAttribute('src', mapState.imageUrl);
    }
    el.querySelector('.ow-map-zones-wrap').innerHTML = _owZones(MAP_CHAR_ID);
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

let rollDismiss = null;
let cardDismiss = null;

// State for synchronising Ably roll data with the dddice animation
const pendingRollQueue = [];  // queue of roll payloads waiting for animation to finish
let diceFinished = false;     // set true when dddice RollFinished fires before Ably message arrives
let diceConnected = false;    // true once the dddice SDK is connected to the room

if (MODE === 'gm') document.getElementById('waiting').classList.add('show');

// ── ABLY ──────────────────────────────────
if (ABLY_KEY) {
    const ably = new Ably.Realtime({ key: ABLY_KEY, transports: ['web_socket'] });

    // Dice rolls
    const rollCh = ably.channels.get(campaignChannel('aria-rolls'));
    rollCh.subscribe('roll', msg => {
        rollHistory.push(msg.data);
        if (rollHistory.length > ROLL_HISTORY_MAX) rollHistory.shift();
        updateWidgetData();
        const data = msg.data;
        if (diceConnected) {
            // SDK is active: queue data and wait for RollFinished to display it
            pendingRollQueue.push(data);
            if (diceFinished) {
                // Animation already finished before Ably message arrived
                diceFinished = false;
                showRoll(pendingRollQueue.shift());
            } else {
                // Safety: if RollFinished never fires (e.g. SDK connected but not rendering),
                // fall back to showing the result after 8s
                setTimeout(() => {
                    const idx = pendingRollQueue.indexOf(data);
                    if (idx !== -1) {
                        pendingRollQueue.splice(idx, 1);
                        showRoll(data);
                    }
                }, 8000);
            }
        } else {
            // No SDK: fall back to the original 3s delay
            setTimeout(() => showRoll(data), 3000);
        }
    });

    // Card draws
    const cardCh = ably.channels.get(campaignChannel('aria-cards'));
    cardCh.subscribe('draw', msg => showDrawnCard(msg.data));
    cardCh.subscribe('reshuffle', msg => showReshuffle());

    // Damage
    const dmgCh = ably.channels.get(campaignChannel('aria-damage'));
    // Player-to-player Soigner events (source:'player') carry only targetId + amount —
    // no hpBefore/hpAfter/maxHP — so the HP bar animation can't be rendered for them.
    // The target's own presence heartbeat updates the HP widgets instead.
    dmgCh.subscribe('damage', msg => { if (msg.data?.source === 'player') return; showDamage(msg.data); });
    dmgCh.subscribe('heal', msg => { if (msg.data?.source === 'player') return; showHeal(msg.data); });
    // The roster. Re-read whole on any change to the set — a player entering,
    // updating their sheet, or disconnecting. There is no local liveness bookkeeping
    // left to drift, no sweep, and no departure message to interpret.
    const presCh = ably.channels.get(campaignChannel('aria-presence'));
    presCh.presence.subscribe(() => refreshPresenceSet());
    async function refreshPresenceSet() {
        try { applyPresenceSet(await presCh.presence.get()); }
        catch (err) { console.error('[OVERLAY] presence get:', err); }
    }
    function applyPresenceSet(members) {
        // Collapse members to participants: several tabs of one character share a
        // clientId and differ by connectionId, as does the ghost of a tab that
        // refreshed until Ably reaps it. Newest ts wins, which is always a live tab.
        const byId = new Map();
        (members || []).forEach(m => {
            const d = m.data || {};
            if (!m.clientId) return;
            const prev = byId.get(m.clientId);
            if (!prev || (d.ts || 0) >= (prev.ts || 0)) byId.set(m.clientId, d);
        });
        const gm = [...byId.values()].find(d => d.role === 'gm');
        // Only the GM's liveness is dropped when it leaves, never vdoRoom: clearing
        // the room changes every player's viewer URL (theirs lose &room) and would
        // re-src live iframes, flickering every camera on the OBS output. Their
        // streams stop being live on their own once they stop publishing.
        const gmSid = gm ? (gm.streamId || '') : '';
        const room = gm ? (gm.vdoRoom || '') : vdoRoom;
        const pw = gm ? (gm.vdoRoomPassword || '') : vdoRoomPassword;
        // Players only. The GM has no charId and must not become a face on stream.
        const before = new Map([...presenceCache].map(([id, p]) => [id, p.streamId || '']));
        presenceCache.clear();
        byId.forEach((d, charId) => {
            if (d.role === 'gm' || !d.charId) return;
            presenceCache.set(charId, d);
        });
        updateWidgetData();
        // Only touch the camera iframes when liveness or the room actually moved —
        // re-srcing an iframe that is already correct tears down its WebRTC
        // connection and blacks the tile out on stream for a second or two.
        let camsChanged = gmSid !== gmLiveStreamId || room !== vdoRoom || pw !== vdoRoomPassword
            || before.size !== presenceCache.size;
        if (!camsChanged) {
            for (const [id, p] of presenceCache) {
                if (before.get(id) !== (p.streamId || '')) { camsChanged = true; break; }
            }
        }
        gmLiveStreamId = gmSid;
        vdoRoom = room;
        vdoRoomPassword = pw;
        console.log('[OVERLAY] presence applied |', members?.length ?? 0, 'members |',
            'GM:', gm ? 'present' : 'absent (room kept from cache)',
            '| room:', vdoRoom || '(none — every camera widget stays a placeholder)',
            '| MJ stream:', gmLiveStreamId || '(none)',
            '| player streams:', [...presenceCache.values()].map(p => `${p.name}=${p.streamId || '-'}`).join(', ') || '(none)',
            '| camsChanged:', camsChanged);
        if (camsChanged) refreshCameraWidgets();
    }
    // Print the whole overlay-side camera path. Type ariaCamDiag() in the OBS browser
    // source console (right-click the source → Interact is not enough; use the
    // remote debugger), or just read the presence line above.
    window.ariaCamDiag = () => {
        console.log('[OVERLAY] room:', vdoRoom || '(none)', '| password:', vdoRoomPassword ? '(set)' : '(none)',
            '| MJ stream:', gmLiveStreamId || '(none)', '| live streams:', [...liveStreamIds()].join(', ') || '(none)');
        console.log('[OVERLAY] camera widgets:', overlayConfig.widgets.filter(w => w.type === 'camera')
            .map(w => ({ id: w.id, streamId: w.config?.streamId || '(unset)', live: liveStreamIds().has(w.config?.streamId || '') })));
        return 'see console';
    };
    // Live monster HP — the GM publishes monster-state on the (campaign-scoped) damage
    // channel, so it must be received here, not on aria-overlay-config.
    dmgCh.subscribe('monster-state', msg => {
        if (!OVERLAY_ID || msg.data.overlayId !== OVERLAY_ID) return;
        const widget = overlayConfig.widgets.find(w => w.type === 'monster_list');
        if (!widget) return;
        widget.config = { ...widget.config, monsters: msg.data.monsters };
        updateWidgetData();
    });

    // Map. `state` replaces wholesale; `request` at connect is what gets a restarted OBS
    // browser source its picture back mid-session.
    const mapCh = ably.channels.get(campaignChannel('aria-map'));
    mapCh.subscribe('state', msg => { mapState = msg.data || null; renderWidgetLayer(); });
    mapCh.publish('request', {});

    if (OVERLAY_ID) {
        const cfgCh = ably.channels.get('aria-overlay-config');
        cfgCh.subscribe('layout-update', msg => {
            if (msg.data.overlayId !== OVERLAY_ID) return;
            layoutFromAbly = true;
            overlayConfig = msg.data.config;
            renderWidgetLayer();
        });
        cfgCh.subscribe('content-update', msg => {
            if (msg.data.overlayId !== OVERLAY_ID) return;
            const widget = overlayConfig.widgets.find(w => w.id === msg.data.widgetId);
            if (!widget) return;
            widget.config = { ...widget.config, content: msg.data.content };
            // CSS.escape: widgetId is remote — a quote in it would throw inside querySelector.
            const el = document.querySelector(`.overlay-widget[data-widget-id="${CSS.escape(String(msg.data.widgetId))}"]`);
            if (el) el.innerHTML = renderWidgetContent(widget);
        });
    }
} else {
    console.warn('No Ably key. Pass ?ably=YOUR_KEY in the URL.');
}

// ── DDDICE SDK ─────────────────────────────
// Connects to the dddice room and renders incoming 3D dice rolls in the canvas.
// Pass ?dddice_key=YOUR_KEY&dddice_room=YOUR_ROOM_SLUG in the overlay URL.
// Extract the room slug from a full dddice/VDO.ninja URL or return the raw value.
function extractRoomSlug(val) {
    if (!val) return '';
    const m = val.match(/\/room\/([^/?#]+)/);
    return m ? m[1] : val.trim();
}

if (DDDICE_KEY && DDDICE_ROOM) {
    (async () => {
        try {
            const { ThreeDDice, ThreeDDiceRollEvent } = await import('https://esm.sh/dddice-js');
            const canvas = document.getElementById('dddice-canvas');
            const sdk = new ThreeDDice(canvas, DDDICE_KEY);
            sdk.start();
            await sdk.connect(extractRoomSlug(DDDICE_ROOM));
            diceConnected = true;

            sdk.on(ThreeDDiceRollEvent.RollFinished, () => {
                setTimeout(() => sdk.clear(), 1500);
                if (pendingRollQueue.length > 0) {
                    diceFinished = false;
                    showRoll(pendingRollQueue.shift());
                } else {
                    // Ably message hasn't arrived yet — flag it and wait briefly
                    diceFinished = true;
                    setTimeout(() => { diceFinished = false; }, 3000);
                }
            });
        } catch (e) {
            console.warn('dddice SDK failed to load, falling back to timer:', e);
            diceConnected = false;
        }
    })();
}

// ══════════════════════════════════════════
//  DICE ROLL DISPLAY
// ══════════════════════════════════════════
// Classify a d100 roll as success, fail, crit-success, or crit-fail.
function classify(roll, threshold, success) {
    if (roll <= 10 && success) return 'crit-success';
    if (roll >= 91 && !success) return 'crit-fail';
    return success ? 'success' : 'fail';
}

// Display a roll result card on the overlay with verdict and particle effects.
function showRoll(data) {
    // Hide card overlay if visible
    hideCard();

    const rollCard = document.getElementById('roll-card');
    const waiting = document.getElementById('waiting');
    const isDie = data.threshold === null;
    const type = isDie ? 'die' : classify(data.roll, data.threshold, data.success);

    rollCard.className = '';
    stopParticles();

    document.getElementById('card-char').textContent = data.char || '';
    document.getElementById('card-skill').textContent = data.skillName;
    document.getElementById('card-roll').textContent = data.roll;

    const bm = !isDie && data.bonusMalus && data.bonusMalus !== 0
        ? ` · mod ${data.bonusMalus > 0 ? '+' : ''}${data.bonusMalus}` : '';
    // Remote payload: only print the meta line when the threshold is a real number.
    const th = Number.isFinite(+data.threshold) && data.threshold !== null ? +data.threshold : null;
    document.getElementById('card-bonus').textContent = th === null ? '' : `seuil ${th} · d100${bm}`;

    const verdictEl = document.getElementById('card-verdict');
    const subEl = document.getElementById('card-crit-sub');
    subEl.textContent = '';

    switch (type) {
        case 'die':
            verdictEl.textContent = '';
            verdictEl.className = 'card-verdict';
            rollCard.classList.add('die');
            break;
        case 'crit-success':
            verdictEl.textContent = 'SUCCÈS CRITIQUE';
            verdictEl.className = 'card-verdict verdict-crit-success';
            subEl.textContent = '✦ les dieux sourient ✦';
            rollCard.classList.add('crit-success');
            spawnParticles('success');
            break;
        case 'crit-fail':
            verdictEl.textContent = 'ÉCHEC CRITIQUE';
            verdictEl.className = 'card-verdict verdict-crit-fail';
            subEl.textContent = '✦ les dieux se détournent ✦';
            rollCard.classList.add('crit-fail');
            spawnParticles('fail');
            break;
        case 'success':
            verdictEl.textContent = 'SUCCÈS';
            verdictEl.className = 'card-verdict verdict-success';
            rollCard.classList.add('success');
            break;
        case 'fail':
            verdictEl.textContent = 'ÉCHEC';
            verdictEl.className = 'card-verdict verdict-fail';
            rollCard.classList.add('fail');
            break;
    }

    waiting.classList.remove('show');
    void rollCard.offsetWidth;
    rollCard.classList.add('show');

    const dur = (type === 'crit-success' || type === 'crit-fail') ? 8000 : 6000;
    clearTimeout(rollDismiss);
    rollDismiss = setTimeout(() => {
        rollCard.className = '';
        stopParticles();
        if (MODE === 'gm') setTimeout(() => waiting.classList.add('show'), 300);
    }, dur);
}

// ══════════════════════════════════════════
//  PLAYING CARD DISPLAY
// ══════════════════════════════════════════
const SUITS_MAP = {
    spades: { sym: '♠', cls: 'pc-black' },
    clubs: { sym: '♣', cls: 'pc-black' },
    hearts: { sym: '♥', cls: 'pc-red' },
    diamonds: { sym: '♦', cls: 'pc-red' },
    joker: { sym: '★', cls: 'pc-purple' },
};

// Build the inner HTML and metadata for a playing card from its ID.
function buildPlayingCard(cardId) {
    // Reconstruct card info from id. cardId comes from a remote aria-cards message
    // (anyone with the Ably key can publish) — treat it as hostile: coerce to string
    // and escape the rank before it reaches innerHTML.
    cardId = String(cardId ?? '');
    const isJoker = cardId.startsWith('joker');
    let html = '', label = '', colorCls = '';

    if (isJoker) {
        const isRed = cardId === 'joker-red';
        colorCls = isRed ? 'pc-red' : 'pc-black';
        label = isRed ? 'Joker Rouge' : 'Joker Noir';
        html = `
          <div class="pc-corner tl"><span class="pc-rank" style="font-size:20px;color:var(--card-purple)">JKR</span></div>
          <div class="pc-center" style="flex-direction:column;gap:10px;">
            <span style="font-size:75px;line-height:1;color:var(--card-purple)">★</span>
            <span style="font-family:'Cormorant Garamond',serif;font-size:16px;font-weight:700;letter-spacing:.14em;color:var(--card-purple)">${label.toUpperCase()}</span>
          </div>
          <div class="pc-corner br"><span class="pc-rank" style="font-size:20px;color:var(--card-purple)">JKR</span></div>`;
    } else {
        const parts = cardId.split('-');
        const rank = parts[0];
        const safeRank = esc(rank);
        const suitName = parts.slice(1).join('-');
        const suit = SUITS_MAP[suitName] || { sym: '?', cls: 'pc-black' };
        colorCls = suit.cls;
        const suitNames = { spades: 'Pique', clubs: 'Trèfle', hearts: 'Cœur', diamonds: 'Carreau' };
        label = `${rank} de ${suitNames[suitName] || suitName}`;
        html = `
          <div class="pc-corner tl"><span class="pc-rank">${safeRank}</span><span class="pc-suit-small">${suit.sym}</span></div>
          <div class="pc-center">${suit.sym}</div>
          <div class="pc-corner br"><span class="pc-rank">${safeRank}</span><span class="pc-suit-small">${suit.sym}</span></div>`;
    }
    return { html, label, colorCls };
}

// Display a drawn playing card on the overlay.
function showDrawnCard(data) {
    // Hide dice roll if visible
    hideRoll();

    const overlay = document.getElementById('drawn-card-overlay');
    const cardEl = document.getElementById('play-card');
    const labelEl = document.getElementById('drawn-card-label');
    const waiting = document.getElementById('waiting');

    const { html, label, colorCls } = buildPlayingCard(data.cardId);
    cardEl.className = `play-card ${colorCls}`;
    cardEl.innerHTML = html;
    labelEl.textContent = label;

    waiting.classList.remove('show');
    overlay.classList.remove('show');
    void overlay.offsetWidth;
    overlay.classList.add('show');

    clearTimeout(cardDismiss);
    cardDismiss = setTimeout(() => {
        hideCard();
        if (MODE === 'gm') setTimeout(() => waiting.classList.add('show'), 300);
    }, 4000);
}

// Handle a deck reshuffle event by hiding any visible card.
function showReshuffle() {
    // Just briefly flash something on overlay if you want — for now, just hide card
    hideCard();
}

// Hide and reset the roll result card.
function hideRoll() {
    const rc = document.getElementById('roll-card');
    rc.className = '';
    stopParticles();
    clearTimeout(rollDismiss);
}

// Hide the drawn card overlay.
function hideCard() {
    document.getElementById('drawn-card-overlay').classList.remove('show');
    clearTimeout(cardDismiss);
}

// ══════════════════════════════════════════
//  PARTICLE SYSTEM
// ══════════════════════════════════════════
const canvas = document.getElementById('particles');
const ctx = canvas.getContext('2d');
let particles = [], animFrame = null;

// Resize the particle canvas to match the window dimensions.
function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
resize();
window.addEventListener('resize', resize);

// Spawn confetti particles from the center for crit success or fail.
function spawnParticles(type) {
    particles = [];
    const cx = canvas.width / 2, cy = canvas.height / 2;
    for (let i = 0; i < 70; i++) {
        const angle = Math.random() * Math.PI * 2, speed = 2.5 + Math.random() * 5.5;
        let hue, sat, lit;
        if (type === 'success') { hue = Math.random() > 0.45 ? 110 + Math.random() * 30 : 42 + Math.random() * 15; sat = 80 + Math.random() * 20; lit = 55 + Math.random() * 35; }
        else { hue = Math.random() > 0.4 ? Math.random() * 15 : 18 + Math.random() * 12; sat = 85 + Math.random() * 15; lit = 45 + Math.random() * 35; }
        particles.push({ x: cx, y: cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 1.5, r: 2.5 + Math.random() * 4, color: `hsl(${hue},${sat}%,${lit}%)`, alpha: 1, gravity: 0.1 + Math.random() * 0.1, decay: 0.011 + Math.random() * 0.014, star: Math.random() > 0.55 });
    }
    if (animFrame) cancelAnimationFrame(animFrame);
    loopParticles();
}
// rAF loop that updates and draws the particle system each frame.
function loopParticles() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles = particles.filter(p => p.alpha > 0.02);
    for (const p of particles) {
        p.x += p.vx; p.y += p.vy; p.vy += p.gravity; p.alpha -= p.decay;
        ctx.save(); ctx.globalAlpha = Math.max(0, p.alpha); ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 8; ctx.translate(p.x, p.y);
        if (p.star) { drawStar(ctx, p.r); } else { ctx.beginPath(); ctx.arc(0, 0, p.r / 2, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
    }
    if (particles.length) animFrame = requestAnimationFrame(loopParticles);
    else { ctx.clearRect(0, 0, canvas.width, canvas.height); animFrame = null; }
}
// Draw a 4-pointed star shape on a canvas context at the current transform.
function drawStar(ctx, r) { const spikes = 4, out = r / 2, inn = r / 5; let rot = -Math.PI / 2; ctx.beginPath(); for (let i = 0; i < spikes * 2; i++) { const radius = i % 2 === 0 ? out : inn; ctx.lineTo(Math.cos(rot) * radius, Math.sin(rot) * radius); rot += Math.PI / spikes; } ctx.closePath(); ctx.fill(); }
// Cancel the particle animation and clear the canvas.
function stopParticles() { if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; } ctx.clearRect(0, 0, canvas.width, canvas.height); particles = []; }

// ══════════════════════════════════════════
//  BLOOD PARTICLE SYSTEM
// ══════════════════════════════════════════
const dmgCanvas = document.getElementById('dmg-canvas');
const dmgCtx = dmgCanvas.getContext('2d');
let bloodParticles = [], bloodFrame = null;

// Resize the blood particle canvas to the window dimensions.
function resizeDmgCanvas() { dmgCanvas.width = window.innerWidth; dmgCanvas.height = window.innerHeight; }
resizeDmgCanvas();
window.addEventListener('resize', resizeDmgCanvas);

// Spawn blood splatter particles at a random position on screen.
function spawnBlood(count) {
    const cx = window.innerWidth * (0.3 + Math.random() * 0.4);
    const cy = window.innerHeight * (0.15 + Math.random() * 0.25);
    const colors = ['#cc0000', '#990000', '#ff2222', '#880000', '#dd1111', '#aa0000'];
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * 10;
        const isBlob = Math.random() < 0.4;
        bloodParticles.push({
            x: cx + (Math.random() - 0.5) * 60,
            y: cy + (Math.random() - 0.5) * 30,
            vx: Math.cos(angle) * speed * (0.5 + Math.random()),
            vy: Math.sin(angle) * speed - 4 - Math.random() * 6,
            gravity: 0.35 + Math.random() * 0.2,
            r: isBlob ? 6 + Math.random() * 14 : 2 + Math.random() * 5,
            alpha: 0.85 + Math.random() * 0.15,
            decay: 0.008 + Math.random() * 0.012,
            color: colors[Math.floor(Math.random() * colors.length)],
            blob: isBlob,
            rot: Math.random() * Math.PI * 2,
            rotV: (Math.random() - 0.5) * 0.2,
        });
    }
    if (!bloodFrame) loopBlood();
}

// rAF loop that updates and draws the blood particle system each frame.
function loopBlood() {
    dmgCtx.clearRect(0, 0, dmgCanvas.width, dmgCanvas.height);
    bloodParticles = bloodParticles.filter(p => p.alpha > 0.01);
    for (const p of bloodParticles) {
        p.x += p.vx; p.y += p.vy; p.vy += p.gravity;
        p.vx *= 0.98; p.alpha -= p.decay; p.rot += p.rotV;
        dmgCtx.save();
        dmgCtx.globalAlpha = Math.max(0, p.alpha);
        dmgCtx.fillStyle = p.color;
        dmgCtx.shadowColor = p.color;
        dmgCtx.shadowBlur = p.blob ? 12 : 4;
        dmgCtx.translate(p.x, p.y); dmgCtx.rotate(p.rot);
        if (p.blob) {
            dmgCtx.beginPath();
            dmgCtx.ellipse(0, 0, p.r, p.r * 0.6, 0, 0, Math.PI * 2);
        } else {
            dmgCtx.beginPath();
            dmgCtx.arc(0, 0, p.r, 0, Math.PI * 2);
        }
        dmgCtx.fill();
        dmgCtx.restore();
    }
    if (bloodParticles.length) bloodFrame = requestAnimationFrame(loopBlood);
    else { dmgCtx.clearRect(0, 0, dmgCanvas.width, dmgCanvas.height); bloodFrame = null; }
}

// ══════════════════════════════════════════
//  DAMAGE / HEAL DISPLAY
// ══════════════════════════════════════════
let dmgTimer = null;

// Display damage VFX: screen shake, red vignette, blood, number, and HP bar drain.
function showDamage(data) {
    clearTimeout(dmgTimer);

    const isDead = data.hpAfter <= 0;

    // 1 — screen shake
    document.body.classList.remove('shake');
    void document.body.offsetWidth; // reflow to restart animation
    document.body.classList.add('shake');
    setTimeout(() => document.body.classList.remove('shake'), 600);

    // 2 — red vignette
    const vig = document.getElementById('dmg-vignette');
    vig.classList.remove('flash');
    void vig.offsetWidth;
    vig.classList.add('flash');

    // 3 — blood particles
    spawnBlood(isDead ? 80 : 45);

    // 4 — damage number
    const numEl = document.getElementById('dmg-number');
    numEl.textContent = '-' + data.damage;
    numEl.classList.remove('show');
    void numEl.offsetWidth;
    numEl.classList.add('show');

    // 5 — HP bar
    const max = data.maxHP || 1;
    const pctBefore = Math.max(0, Math.min(100, (data.hpBefore / max) * 100));
    const pctAfter = Math.max(0, Math.min(100, (data.hpAfter / max) * 100));

    const wrap = document.getElementById('dmg-hpbar-wrap');
    const ghost = document.getElementById('dmg-hpbar-ghost');
    const fill = document.getElementById('dmg-hpbar-fill');
    const text = document.getElementById('dmg-hpbar-text');
    const name = document.getElementById('dmg-char-name');

    name.textContent = data.charName || '';
    ghost.style.width = pctBefore + '%';
    fill.style.width = pctBefore + '%'; // start at old value
    fill.style.transition = 'none';

    // colour the fill
    const fillColor = pctAfter > 60 ? 'linear-gradient(90deg,#1a5c2a,#2e8b57)'
        : pctAfter > 30 ? 'linear-gradient(90deg,#7a5500,#c8960a)'
            : 'linear-gradient(90deg,#7b1a1a,#c0392b)';
    fill.style.background = fillColor;
    text.textContent = `${data.hpAfter} / ${max} PV`;

    wrap.classList.remove('show');
    void wrap.offsetWidth;
    wrap.classList.add('show');

    // drain animation — brief delay so the ghost is visible first
    setTimeout(() => {
        fill.style.transition = 'width 1.1s cubic-bezier(0.4,0,0.2,1)';
        fill.style.width = pctAfter + '%';
    }, 80);

    // 6 — mort screen if HP = 0
    if (isDead) {
        const mort = document.getElementById('dmg-mort');
        document.getElementById('mort-char-name').textContent = data.charName || '';
        setTimeout(() => {
            mort.classList.remove('show');
            void mort.offsetWidth;
            mort.classList.add('show');
        }, 600);
        dmgTimer = setTimeout(() => {
            mort.classList.remove('show');
        }, 4200);
    } else {
        dmgTimer = setTimeout(() => {
            numEl.classList.remove('show');
            wrap.classList.remove('show');
        }, 4600);
    }
}

// Display heal VFX: green number and HP bar fill animation.
function showHeal(data) {
    clearTimeout(dmgTimer);

    const max = data.maxHP || 1;
    const pctAfter = Math.max(0, Math.min(100, (data.hpAfter / max) * 100));

    // green number
    const numEl = document.getElementById('heal-number');
    numEl.textContent = '+' + data.amount;
    numEl.classList.remove('show');
    void numEl.offsetWidth;
    numEl.classList.add('show');

    // HP bar (reuse damage bar, but animate upward)
    const wrap = document.getElementById('dmg-hpbar-wrap');
    const ghost = document.getElementById('dmg-hpbar-ghost');
    const fill = document.getElementById('dmg-hpbar-fill');
    const text = document.getElementById('dmg-hpbar-text');
    const name = document.getElementById('dmg-char-name');

    name.textContent = data.charName || '';
    ghost.style.width = Math.max(0, Math.min(100, (data.hpBefore / max) * 100)) + '%';
    ghost.style.background = 'rgba(76,175,119,0.25)'; // green ghost for heal
    fill.style.transition = 'none';
    fill.style.width = ghost.style.width;
    fill.style.background = 'linear-gradient(90deg,#1a5c2a,#2e8b57)';
    text.textContent = `${data.hpAfter} / ${max} PV`;

    wrap.classList.remove('show');
    void wrap.offsetWidth;
    wrap.classList.add('show');

    setTimeout(() => {
        fill.style.transition = 'width 1.1s cubic-bezier(0.4,0,0.2,1)';
        fill.style.width = pctAfter + '%';
    }, 80);

    dmgTimer = setTimeout(() => {
        numEl.classList.remove('show');
        wrap.classList.remove('show');
        ghost.style.background = ''; // reset
    }, 4200);
}

// ── OVERLAY CONFIG ────────────────────────────
// Return CSS position/size for an event widget type from the overlay config.
function getEventWidgetStyle(type) {
    const widget = overlayConfig.widgets.find(w => w.type === type && w.category === 'event');
    if (!widget) return null;
    return { left: widget.x + '%', top: widget.y + '%', width: widget.w + '%', height: widget.h + '%' };
}

// Apply an event widget's position from the overlay config to a DOM element.
function applyEventWidgetPosition(elId, widgetType) {
    const style = getEventWidgetStyle(widgetType);
    if (!style) return;
    const el = document.getElementById(elId);
    if (!el) return;
    Object.assign(el.style, style);
}

// Return the inner HTML for a given overlay widget based on live presence/roll data.
function renderWidgetContent(widget) {
    const cfg = widget.config || {};
    switch (widget.type) {
        case 'character_name': {
            // Lower-third nameplate — dark glass plate + accent edge (design frame 20)
            const p = [...presenceCache.values()][0];
            const name = p ? esc(p.name) : '—';
            const cls = (p && p.charClass) ? `<div class="ow-np-class">${esc(p.charClass)}</div>` : '';
            return `<div class="ow-nameplate"><div class="ow-np-edge"></div><div class="ow-np-body"><div class="ow-np-name">${name}</div>${cls}</div></div>`;
        }
        case 'hp_bar': {
            const p = cfg.charId ? presenceCache.get(cfg.charId) : [...presenceCache.values()][0];
            if (!p) return '<div class="ow-hp-wrap"><div class="ow-hp-label">—</div><div class="ow-hp-track"><div class="ow-hp-fill" style="width:0%"></div><div class="ow-hp-text">— PV</div></div></div>';
            const pct = Math.max(0, Math.min(100, (p.hp / (p.maxHP || 1)) * 100));
            const colorCls = pct > 60 ? '' : pct > 30 ? ' yellow' : ' red';
            return `<div class="ow-hp-wrap"><div class="ow-hp-label">${esc(p.name)}</div><div class="ow-hp-track"><div class="ow-hp-fill${colorCls}" style="width:${pct}%"></div><div class="ow-hp-text">${esc(p.hp)} / ${esc(p.maxHP)} PV</div></div></div>`;
        }
        case 'stats': {
            const p = cfg.charId ? presenceCache.get(cfg.charId) : [...presenceCache.values()][0];
            if (!p?.stats) return '<div class="ow-stats">—</div>';
            return `<div class="ow-stats">${['FOR','DEX','END','INT','CHA'].map(s => `<div class="ow-stat"><span class="ow-stat-label">${s}</span><span class="ow-stat-value">${esc(p.stats[s] ?? '—')}</span></div>`).join('')}</div>`;
        }
        case 'protection': {
            const p = cfg.charId ? presenceCache.get(cfg.charId) : [...presenceCache.values()][0];
            if (!p?.protection) return '<div class="ow-protection">—</div>';
            return `<div class="ow-protection">⊞ ${esc(p.protection.nom || '—')} — ${esc(p.protection.valeur ?? 0)}</div>`;
        }
        case 'skills': {
            const p = cfg.charId ? presenceCache.get(cfg.charId) : [...presenceCache.values()][0];
            if (!p?.skills?.length) return '<div class="ow-list">—</div>';
            return `<div class="ow-list">${p.skills.slice(0, cfg.maxItems || 10).map(s => `<div class="ow-list-item"><span class="ow-list-name">${esc(s.name)}</span><span class="ow-list-value">${esc(s.pct)}%</span></div>`).join('')}</div>`;
        }
        case 'weapons': {
            const p = cfg.charId ? presenceCache.get(cfg.charId) : [...presenceCache.values()][0];
            if (!p?.weapons?.length) return '<div class="ow-list">—</div>';
            return `<div class="ow-list">${p.weapons.filter(w => w.nom).map(w => `<div class="ow-list-item"><span class="ow-list-name">${esc(w.nom)}</span><span class="ow-list-value">${esc(w.degats)}</span></div>`).join('')}</div>`;
        }
        case 'inventory': {
            const p = cfg.charId ? presenceCache.get(cfg.charId) : [...presenceCache.values()][0];
            if (!p?.inventory?.length) return '<div class="ow-list">—</div>';
            return `<div class="ow-list">${p.inventory.slice(0, cfg.maxItems || 10).map(i => `<div class="ow-list-item"><span class="ow-list-name">${esc(i.name)}</span><span class="ow-list-value">×${esc(i.qty)}</span></div>`).join('')}</div>`;
        }
        case 'potions': {
            const p = cfg.charId ? presenceCache.get(cfg.charId) : [...presenceCache.values()][0];
            if (!p?.potions?.length) return '<div class="ow-list">—</div>';
            return `<div class="ow-list">${p.potions.slice(0, cfg.maxItems || 8).map(pt => `<div class="ow-list-item"><span class="ow-list-name">${esc(pt.name)}</span><span class="ow-list-value">×${esc(pt.qty ?? 1)}</span></div>`).join('')}</div>`;
        }
        case 'custom_text': return `<div class="ow-custom-text">${esc(cfg.content || '')}</div>`;
        case 'campaign_name': return `<div class="ow-campaign-name">${esc(cfg.content || '—')}</div>`;
        case 'player_hp_summary': {
            if (!presenceCache.size) return '<div class="ow-list">—</div>';
            return [...presenceCache.values()].map(p => {
                const pct = Math.max(0, Math.min(100, (p.hp / (p.maxHP || 1)) * 100));
                const colorCls = pct > 60 ? '' : pct > 30 ? ' yellow' : ' red';
                return `<div class="ow-hp-wrap" style="margin-bottom:4px"><div class="ow-hp-label">${esc(p.name)}</div><div class="ow-hp-track"><div class="ow-hp-fill${colorCls}" style="width:${pct}%"></div><div class="ow-hp-text">${esc(p.hp)} / ${esc(p.maxHP)} PV</div></div></div>`;
            }).join('');
        }
        case 'player_stats': {
            if (!presenceCache.size) return '<div>—</div>';
            return [...presenceCache.values()].map(p => `<div style="margin-bottom:6px"><div class="ow-char-name" style="font-size:0.8em">${esc(p.name)}</div><div class="ow-stats">${['FOR','DEX','END','INT','CHA'].map(s => `<div class="ow-stat"><span class="ow-stat-label">${s}</span><span class="ow-stat-value">${esc(p.stats?.[s] ?? '—')}</span></div>`).join('')}</div></div>`).join('');
        }
        case 'player_inventory': {
            if (!presenceCache.size) return '<div class="ow-list">—</div>';
            return [...presenceCache.values()].map(p => `<div style="margin-bottom:4px"><div style="font-family:'Cormorant Garamond',serif;font-size:0.7em;color:var(--parchment-dim)">${esc(p.name)}</div>${(p.inventory || []).slice(0, 5).map(i => `<div class="ow-list-item"><span class="ow-list-name">${esc(i.name)}</span><span class="ow-list-value">×${esc(i.qty)}</span></div>`).join('')}</div>`).join('');
        }
        case 'player_skills': {
            if (!presenceCache.size) return '<div class="ow-list">—</div>';
            return [...presenceCache.values()].map(p => `<div style="margin-bottom:4px"><div style="font-family:'Cormorant Garamond',serif;font-size:0.7em;color:var(--parchment-dim)">${esc(p.name)}</div>${(p.skills || []).slice(0, 5).map(s => `<div class="ow-list-item"><span class="ow-list-name">${esc(s.name)}</span><span class="ow-list-value">${esc(s.pct)}%</span></div>`).join('')}</div>`).join('');
        }
        case 'monster_list': {
            const monsters = cfg.monsters || [];
            if (!monsters.length) return '<div class="ow-list">—</div>';
            return monsters.map(m => {
                const pct = Math.max(0, Math.min(100, (m.pv / (m.maxPV || 1)) * 100));
                const colorCls = pct > 60 ? '' : pct > 30 ? ' yellow' : ' red';
                return `<div class="ow-hp-wrap" style="margin-bottom:4px"><div class="ow-hp-label">${esc(m.name)}</div><div class="ow-hp-track"><div class="ow-hp-fill${colorCls}" style="width:${pct}%"></div><div class="ow-hp-text">${esc(m.pv)} / ${esc(m.maxPV)} PV</div></div></div>`;
            }).join('');
        }
        case 'roll_history': {
            if (!rollHistory.length) return '<div class="ow-list">—</div>';
            const shown = rollHistory.slice(-(cfg.maxItems || 8)).reverse();
            return `<div class="ow-list">${shown.map(r => `<div class="ow-roll-row"><span class="ow-roll-char">${esc(r.char || '')}</span><span class="ow-roll-skill">${esc(r.skillName)}</span><span class="ow-roll-result ${r.success ? 'success' : 'fail'}">${esc(r.roll)}</span></div>`).join('')}</div>`;
        }
        case 'camera': {
            const sid = sidSafe(cfg.streamId);
            // Same liveness rule as refreshCameraWidgets, so a layout re-render can't
            // recreate an iframe on a stream nobody is pushing.
            if (!sid || !liveStreamIds().has(sid)) return '<div class="ow-camera-empty">—</div>';
            // Viewer-only: the overlay never publishes, so no capture permissions.
            return `<iframe src="${vdoCamSrc(sid)}" allow="autoplay; fullscreen" allowfullscreen style="width:100%;height:100%;border:none;"></iframe>`;
        }
        default: return '';
    }
}

// Reconcile the persistent overlay widgets in place, then apply the event widget
// positions. This used to start with
// `container.innerHTML = ''` and rebuild everything, which detached every camera
// iframe and killed its WebRTC stream. It runs on every `layout-update`, and the
// editor publishes one 1.5s after any drag/resize/property edit — so nudging a
// single widget blacked out every camera on the OBS output, live. updateWidgetData
// already skips camera widgets for exactly this reason; the layout path bypassed it.
//
// Existing elements are never re-appended: appendChild/insertBefore on a node that
// is already in the tree moves it, and moving an iframe reloads it — the very thing
// this avoids. New elements go on the end, which keeps DOM order matching
// overlayConfig.widgets because the editor only ever appends widgets, never reorders.
function renderWidgetLayer() {
    const container = document.getElementById('overlay-widgets');
    const wanted = overlayConfig.widgets.filter(w => w.visible && w.category !== 'event');
    const wantedIds = new Set(wanted.map(w => String(w.id)));
    // Drop widgets that were deleted or hidden. Their iframes die with them, which
    // is correct — the widget is gone.
    [...container.children].forEach(el => { if (!wantedIds.has(el.dataset.widgetId)) el.remove(); });
    const live = liveStreamIds();
    for (const widget of wanted) {
        // CSS.escape: widget ids arrive over Ably, and a quote would throw here.
        let el = container.querySelector(`.overlay-widget[data-widget-id="${CSS.escape(String(widget.id))}"]`);
        if (!el) {
            el = document.createElement('div');
            el.className = 'overlay-widget';
            el.dataset.widgetId = widget.id;
            container.appendChild(el);
        }
        // Geometry and style are safe to re-assign — they don't reload a child iframe.
        el.style.left    = widget.x + '%';
        el.style.top     = widget.y + '%';
        el.style.width   = widget.w + '%';
        el.style.height  = widget.h + '%';
        el.style.opacity = widget.config?.opacity ?? 1;
        el.style.fontSize = (widget.config?.fontSize ?? 14) + 'px';
        // Cameras go through the shared sync so a live, correctly-pointed iframe is
        // left untouched; everything else is cheap to re-render wholesale.
        if (widget.type === 'map')         syncMapWidget(el, widget);
        else if (widget.type === 'camera') syncCameraWidget(el, widget, live);
        else                               el.innerHTML = renderWidgetContent(widget);
    }
    applyEventWidgetPosition('roll-card', 'roll_card');
    applyEventWidgetPosition('drawn-card-overlay', 'card_draw');
    applyEventWidgetPosition('dmg-hpbar-wrap', 'hp_bar_animation');
    applyEventWidgetPosition('dmg-number', 'damage_number');
    applyEventWidgetPosition('heal-number', 'heal_number');
    applyEventWidgetPosition('dmg-mort', 'mort_screen');
}

// Refresh all widget inner HTML from the latest presence/roll data without rebuilding the layer.
function updateWidgetData() {
    document.querySelectorAll('.overlay-widget').forEach(el => {
        const widget = overlayConfig.widgets.find(w => w.id === el.dataset.widgetId);
        if (!widget) return;
        if (widget.type === 'camera') return;
        if (widget.type === 'map') return;   // updated by aria-map, not by presence
        el.innerHTML = renderWidgetContent(widget);
    });
}

// Load the overlay layout config from Supabase on startup.
async function loadOverlayConfig() {
    if (!OVERLAY_ID) return;
    const rows = await sbSelect('overlay_configs', 'id=eq.' + encodeURIComponent(OVERLAY_ID));
    // A live layout beat the round-trip — it wins, this read may predate the write.
    if (layoutFromAbly) return;
    if (rows.length && rows[0].config) {
        overlayConfig = rows[0].config;
        renderWidgetLayer();
    }
}

if (OVERLAY_ID) loadOverlayConfig();
