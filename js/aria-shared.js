// ═══════════════════════════════════════════
//  ARIA — SHARED RUNTIME
// ═══════════════════════════════════════════
// Loaded before aria-player.js / aria-gm.js on their respective pages. It holds
// everything the two panels had byte-identical copies of: the DOM builder, the
// split-pane engine, the music transport, the save-key gateway, the card deck and
// the small utilities. Only ONE panel script ever shares a page with this file, so
// a name declared here must not also be declared in either panel.
//
// Per-panel differences go through the ARIA object below rather than through a
// forked copy of the function. Each panel calls ARIA.configure() near the top of
// its own file, before anything here is invoked.

// ═══════════════════════════════════════════
//  PANEL HOOKS
// ═══════════════════════════════════════════
const ARIA = {
    role:        'player',            // 'player' | 'gm' — the saves table's type column
    tag:         'ARIA',              // console log prefix
    splitKey:    'aria-split-layout', // localStorage key for the pane layout
    defaultPane: 'tab-skills',        // pane to fall back to when none are open
    joinCode:    () => '',            // active campaign join code, for channel scoping
    syncAll:     async () => {},      // full push of local data to Supabase
    clearLocal:  () => {},            // drop this save key's local data on key switch
    afterRestore: () => {},           // re-enter the last character/campaign on load
    onMusicPhase: () => {},           // ('start'|'faded', track) — refresh panel music UI
    configure(opts) { Object.assign(ARIA, opts); initSplitState(); },
};

// ═══════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════
// There is deliberately no _escHtml / _escJs here.
//
// Both panels used to carry a copy of each, applied at ~70 call sites, plus the rule
// that _escJs output must be wrapped in _escHtml because the HTML parser decodes an
// attribute before the JS engine sees it. All of that existed because data was being
// concatenated into markup and then into inline handler source. Nothing does that any
// more: every render builds elements with el(), where a value assigned to textContent
// is text and a function assigned to onclick is a reference. If you find yourself
// reaching for an escape helper, you are about to reintroduce the thing it defends
// against — build the node instead.

// Allow only http(s) URLs from remote-controlled records. File grants travel over
// Ably and file rows live in Supabase — a javascript: URL assigned to iframe.src
// would execute in this origin.
function _safeUrl(u) { const s = String(u ?? '').trim(); return /^https?:\/\//i.test(s) ? s : ''; }

// Coerce a remote-supplied value to a finite number, or null. Presence payloads are
// remote-controlled (anyone with the Ably key can publish), and these land in
// arithmetic and in element sizing.
function _finiteNum(v) { if (v === null || v === undefined || v === '') return null; const n = +v; return Number.isFinite(n) ? n : null; }

// Shape check for remote-supplied ids. They key Maps and dataset attributes; a
// value of the wrong shape is a malformed message, not an escaping problem.
function _isIdToken(v) { return /^[A-Za-z0-9_-]{1,64}$/.test(String(v)); }

// _nowISO() lives in aria-supabase.js — it is part of the persistence layer and
// that file loads first on every page, including the two that have no shared.js.

// Id for a locally created record. crypto.randomUUID needs a secure context, so
// file:// falls back to timestamp + random. This expression was pasted inline
// thirteen times across the two panels — nine of them in aria-gm.js alone, one of
// which sat below that file's own _uid() helper.
function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Promise that resolves after ms milliseconds.
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ARIA result class for a d100 roll against a threshold.
function classify(roll, threshold, success) {
    if (roll <= 10 && success) return 'crit-success';
    if (roll >= 91 && !success) return 'crit-fail';
    return success ? 'success' : 'fail';
}

// Does one roll entry pass the Succès / Échec / Critique / Dés pill filter? An empty
// filter set passes everything, and Succès / Échec include their critical variants —
// which is what the pill labels promise.
//
// Both panels show the same five pills, and each used to carry its own predicate.
// They had drifted: the GM's ended in `rollFilter.has(type)`, so a critical success
// was hidden while the "Succès" pill was lit, and a critical failure while "Échec"
// was. One definition, so the pills cannot mean two things again.
function rollPassesFilter(entry, filter) {
    if (!filter.size) return true;
    if (entry.threshold === null) return filter.has('die');
    const type = classify(entry.roll, entry.threshold, entry.success);
    if (filter.has('crit')    && (type === 'crit-success' || type === 'crit-fail')) return true;
    if (filter.has('success') && (type === 'success'      || type === 'crit-success')) return true;
    if (filter.has('fail')    && (type === 'fail'         || type === 'crit-fail')) return true;
    return false;
}

// ── Dice formulas ─────────────────────────────────────────────────────────────
// Split a formula ("2d6+2", "1d8-1", "3d4", "5") into signed terms. One tokenizer
// behind both consumers: rollDiceFormula, which rolls locally, and
// formulaToDiceSpec, which hands the dice to dddice and keeps the flat modifier.
// The grammar used to be written out three times — once per panel plus the dddice
// variant — and the panels' two copies had already drifted on the empty case.
function _diceTerms(formula) {
    const expr = String(formula ?? '').replace(/\s+/g, '').toLowerCase();
    if (!expr) return [];
    return expr.split(/(?=[+-])/).filter(Boolean).map(token => {
        const sign = token[0] === '-' ? -1 : 1;
        const raw  = token.replace(/^[+-]/, '');
        const m    = raw.match(/^(\d+)d(\d+)$/);
        return m ? { sign, count: +m[1], sides: +m[2] } : { sign, flat: parseInt(raw) };
    });
}

// Evaluate a dice formula locally. `breakdown` shows each dice term's individual
// rolls, e.g. "[3+5] +2".
function rollDiceFormula(formula) {
    let total = 0;
    const parts = [];
    for (const t of _diceTerms(formula)) {
        const lead = t.sign < 0 ? '−' : parts.length ? '+' : '';
        if (t.sides) {
            const rolls = Array.from({ length: t.count }, () => 1 + Math.floor(Math.random() * t.sides));
            total += t.sign * rolls.reduce((a, b) => a + b, 0);
            parts.push(`${lead}[${rolls.join('+')}]`);
        } else if (!isNaN(t.flat)) {
            total += t.sign * t.flat;
            parts.push(`${lead}${t.flat}`);
        }
    }
    return { total, breakdown: parts.join(' ') };
}

// Flatten a formula into the dice list dddice needs plus the flat modifier. dddice
// rolls only positive dice, so a subtracted dice term ("2d6-1d4") cannot be
// expressed and its sign is dropped here, exactly as before; such formulas are
// vanishingly rare for weapon damage.
// ponytail: sign dropped on dice terms, split the roll if a formula ever needs it.
function formulaToDiceSpec(formula) {
    const dice = []; let modifier = 0;
    for (const t of _diceTerms(formula)) {
        if (t.sides) { for (let i = 0; i < t.count; i++) dice.push(`d${t.sides}`); }
        else if (!isNaN(t.flat)) modifier += t.sign * t.flat;
    }
    return { dice, modifier };
}

// Accept either a full dddice room URL or a bare slug.
function extractRoomSlug(val) {
    if (!val) return '';
    const m = val.match(/\/room\/([^/?#]+)/);
    return m ? m[1] : val.trim();
}

// Extract a roll UUID from either the sdk.roll() response or a RollFinished payload.
// RollFinished fires for EVERY roll in the shared room; matching UUIDs stops another
// participant's dice from being consumed as this tab's pending result.
function _ddRollUuid(r) { return r?.uuid ?? r?.data?.uuid ?? null; }

// Scope a channel name to the active campaign. An empty join code falls back to the
// bare global channel (backward compatible; unlinked players).
function campaignChannel(base) {
    const t = (ARIA.joinCode() || '').trim().toUpperCase();
    return t ? `${base}-${t}` : base;
}

// ═══════════════════════════════════════════
//  DOM BUILDER
// ═══════════════════════════════════════════
// el('button', { className:'pc-btn', textContent:'☀', onclick: () => f(id) }, child)
//
// This exists so that data never becomes markup. textContent cannot be XSSed, and a
// function assigned to onclick is a reference rather than a source string, so ids do
// not have to survive a trip through the HTML parser and then the JS parser. That
// removes the whole escape-then-escape-again discipline the string templates needed,
// along with the CSS.escape on the selectors used to find those nodes again — hold
// the element instead of looking it up.
//
// props are assigned directly onto the element, so anything the DOM exposes works:
// className, textContent, id, title, src, onclick, value, placeholder. Two keys get
// special handling: `style` and `dataset` take an object, and `class` is accepted as
// an alias for className. Children may be nodes, strings, or null/false/undefined
// (skipped), which makes conditional children read as `cond && el(...)`.
function el(tag, props = null, ...kids) {
    const n = document.createElement(tag);
    if (props) {
        for (const [k, v] of Object.entries(props)) {
            if (v === null || v === undefined) continue;
            if (k === 'style' || k === 'dataset') Object.assign(n[k], v);
            else if (k === 'class') n.className = v;
            else n[k] = v;
        }
    }
    append(n, kids);
    return n;
}

// Append children to a node, flattening arrays and skipping empty values.
function append(parent, kids) {
    for (const k of kids) {
        if (k === null || k === undefined || k === false || k === '') continue;
        if (Array.isArray(k)) append(parent, k);
        else parent.append(k);
    }
    return parent;
}

// Replace a node's children in one shot. The DOM equivalent of `innerHTML = ...`,
// without the parse step — and without detaching anything that was already correct
// when used through the keyed reconciler below.
function fill(node, ...kids) {
    if (!node) return node;
    node.replaceChildren();
    append(node, kids);
    return node;
}

// Keyed in-place reconciliation of a container's children.
//
// Removing an iframe from the DOM terminates its WebRTC connection, so a container
// holding camera tiles can never be rebuilt wholesale. Every such render used to
// hand-roll this: build the element as a template string on first sight, then a
// second parallel branch that reached back in with querySelector to update each
// field individually. Two representations of one element, kept in step by hand.
//
// Here `create` runs once per key and `update` runs on every pass, so there is one
// description of the element and the identity of the DOM node is preserved.
//   items  — iterable of [key, data]
//   create — (key, data) => Element   (called once; the element is retained)
//   update — (element, data, key) => void   (optional; called on every pass)
function reconcile(container, items, create, update) {
    if (!container) return;
    if (!container._ariaKeyed) container._ariaKeyed = new Map();
    const live = container._ariaKeyed;
    const seen = new Set();
    for (const [key, data] of items) {
        seen.add(key);
        let node = live.get(key);
        // Recreate when the node is missing or no longer a child of this container —
        // something outside cleared it. Testing parentNode rather than isConnected
        // matters: a container that is itself detached (a closed pane, a fragment
        // being built) has children that are all !isConnected, and treating those as
        // dead would recreate and append a duplicate on every single pass.
        if (node && node.parentNode !== container) { node = null; live.delete(key); }
        if (!node) {
            node = create(key, data);
            if (!node) { seen.delete(key); continue; }
            live.set(key, node);
            container.append(node);
        }
        if (update) update(node, data, key);
    }
    for (const [key, node] of live) {
        if (!seen.has(key)) { node.remove(); live.delete(key); }
    }
}

// The element reconcile() created for a key, or null. This is why the renders no
// longer need CSS.escape: an id that has to survive a CSS selector must be escaped
// (and an unescaped quote *throws*, which used to propagate out of the forEach and
// freeze the whole tab), but a Map key is just a value.
function keyedNode(container, key) {
    return container?._ariaKeyed?.get(key) ?? null;
}

// Drop every reconciled child of a container and forget the keys. Used where the
// iframes genuinely must go — a closed pane, a cleared room — so the next open
// rebuilds from scratch rather than reviving stale nodes.
function clearKeyed(container) {
    if (!container) return;
    container.replaceChildren();
    container._ariaKeyed?.clear();
}

// Point an iframe at a URL only when it differs. Re-assigning the same src reloads
// the frame and kills the WebRTC connection behind it, so every camera path has to
// check first.
function setFrameSrc(frame, src) {
    if (frame && frame.src !== src) frame.src = src;
}

// ═══════════════════════════════════════════
//  CARD DECK
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
function shuffle(a) { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

// Build a freshly shuffled deck of all 54 cards.
function buildDeck() { return shuffle([...ALL_CARDS]); }

// Render the face of a playing card into the shared drawn-card element.
function renderCardContent(card) {
    renderCardFace(document.getElementById('drawn-card'), card);
}

// Render a card face into any element (the player deck and the GM private deck
// each have their own).
function renderCardFace(face, card) {
    if (!face) return;
    const corner = (pos, rank, sym, purple) => el('div', { className: 'card-corner ' + pos },
        el('span', { className: 'rank', style: purple ? { fontSize: '14px', color: 'var(--card-purple)' } : null, textContent: rank }),
        sym && el('span', { className: 'suit-small', textContent: sym }));
    if (card.isJoker) {
        face.className = `flip-face ${card.jokerColor === 'red' ? 'c-red' : 'c-black'}`;
        fill(face,
            corner('tl', 'JKR', null, true),
            el('div', { className: 'card-center', style: { flexDirection: 'column', gap: '6px' } },
                el('span', { style: { fontSize: '50px', lineHeight: '1', color: 'var(--card-purple)' }, textContent: '★' }),
                el('span', { style: { fontFamily: "'Cormorant Garamond',serif", fontSize: '10px', fontWeight: '700', letterSpacing: '.12em', color: 'var(--card-purple)' }, textContent: card.label.toUpperCase() })),
            corner('br', 'JKR', null, true));
    } else {
        face.className = `flip-face ${card.suit.cls}`;
        fill(face,
            corner('tl', card.rank, card.suit.sym),
            el('div', { className: 'card-center', textContent: card.suit.sym }),
            corner('br', card.rank, card.suit.sym));
    }
}

// Human label for a card, for status lines.
function cardLabel(card) {
    return card.isJoker ? card.label : `${card.rank} de ${SUIT_FR[card.suit.name] || card.suit.name}`;
}

// ═══════════════════════════════════════════
//  DECK ENGINE
// ═══════════════════════════════════════════
// A deck with a draw stage and a "suivi du talon" pill tracker. The player has one
// (shared with the table over Ably, persisted per character); the GM has a private
// one. Both used to be written out in full — ~180 lines each, `gm`-prefixed — and
// the copies had diverged in ways that were all bugs in the GM's:
//
//   * gmTogglePill had no `if (drawing) return` guard, so clicking a pill during a
//     draw mutated the deck under the animation.
//   * gmMakePill never called refreshPill on the element it had just created, so a
//     freshly built tracker rendered every drawn/excluded card as untouched. A
//     gmRefreshAllPills() call bolted onto the end of gmManualReshuffle hid it.
//   * gmTogglePill / gmClearExclusions showed no status line where the player's did.
//
// The two decks differ in four real ways, and only those are hooks.
//   prefix   — element id prefix: '' for the player, 'gm-' for the GM
//   persist  — () => void        save state (player: localStorage + Supabase)
//   publish  — (type, extra)     mirror the action over Ably (player only)
//   fly      — async () => void  card-flies-from-deck animation (player only)
//   announce — (remainingOnly)   post-reshuffle feedback; defaults to the status line
function makeDeck({ prefix = '', persist, publish, fly, announce } = {}) {
    let deck = [], drawn = new Set(), excluded = new Set(), lastCardId = null;
    let drawing = false, statusTimer = null;

    const $ = id => document.getElementById(prefix + id);
    const pillEl = id => document.getElementById(`${prefix}pill-${id}`);

    // ── state ────────────────────────────────────────────────────────────────
    // The shape the player persists and publishes; also what load() accepts back.
    function state() {
        return { excluded: [...excluded], drawn: [...drawn], deckIds: deck.map(c => c.id), lastCardId };
    }

    function load(saved) {
        deck = saved?.deckIds?.map(cid => cardById(cid)).filter(Boolean) || buildDeck();
        drawn = new Set(saved?.drawn || []);
        excluded = new Set(saved?.excluded || []);
        lastCardId = saved?.lastCardId || null;
        drawing = false;
    }

    function reset() { load(null); }

    // Build the tracker, sync the counters, and re-show the last drawn card.
    function mount() {
        buildTracker();
        updateCount();
        if (lastCardId) restore();
    }

    // ── tracker ──────────────────────────────────────────────────────────────
    function buildTracker() {
        const container = $('tracker-suits');
        if (!container) return;
        const row = (symCls, sym, pills) => el('div', { className: 'suit-row-t' },
            el('span', { className: `suit-sym ${symCls}`, textContent: sym }),
            el('div', { className: 'rank-pills' }, pills));
        fill(container,
            SUITS.map(suit => row(suit.cls, suit.sym,
                RANKS.map(rank => makePill(`${rank}-${suit.name}`, rank, suit.pillCls)))),
            row('c-purple', '★', [makePill('joker-red', 'R★', 'is-joker'),
                                  makePill('joker-black', 'N★', 'is-joker')]));
    }

    function makePill(id, label, extraCls) {
        const p = el('span', {
            id: `${prefix}pill-${id}`,
            className: 'rank-pill' + (extraCls ? ' ' + extraCls : ''),
            textContent: label,
            onclick: () => togglePill(id),
        });
        refreshPill(p, id);
        return p;
    }

    function refreshPill(p, id) {
        p.classList.toggle('drawn', drawn.has(id));
        p.classList.toggle('excluded', excluded.has(id));
    }

    function refreshPillById(id) { const p = pillEl(id); if (p) refreshPill(p, id); }
    function refreshAllPills() { ALL_CARDS.forEach(c => refreshPillById(c.id)); }

    // Slide a card back into the deck at a random depth.
    function reinsert(card) { deck.splice(Math.floor(Math.random() * (deck.length + 1)), 0, card); }

    // Cycle a card: in deck → excluded → back in deck. A drawn card goes back too.
    function togglePill(id) {
        if (drawing) return;
        const card = cardById(id);
        if (!card) return;
        const name = cardLabel(card);
        if (excluded.has(id))     { excluded.delete(id); reinsert(card); status(`${name} re-inclus`); }
        else if (drawn.has(id))   { drawn.delete(id);    reinsert(card); status(`${name} remis`); }
        else                      { excluded.add(id);
                                    const i = deck.findIndex(c => c.id === id);
                                    if (i !== -1) deck.splice(i, 1);
                                    status(`${name} exclu`); }
        updateCount();
        refreshPillById(id);
        persist?.();
    }

    function clearExclusions() {
        if (drawing) return;
        excluded.forEach(id => { const c = cardById(id); if (c) reinsert(c); });
        excluded.clear();
        updateCount();
        refreshAllPills();
        status('Exclusions effacées');
        persist?.();
    }

    // ── chrome ───────────────────────────────────────────────────────────────
    function updateCount() {
        const n = deck.length;
        const count = $('deck-count');
        if (count) count.textContent = n === 0 ? 'Vide' : `${n} carte${n !== 1 ? 's' : ''}`;
        $('deck-wrap')?.classList.toggle('empty', n === 0);
        $('reshuffle-btn')?.classList.toggle('visible', n === 0);
        $('reshuffle-remaining-btn')?.classList.toggle('visible', n > 1 && n < ALL_CARDS.length - excluded.size);
        $('clear-exclusions-btn')?.classList.toggle('visible', excluded.size > 0);
    }

    function status(msg) {
        const node = $('card-status');
        if (!node) return;
        node.textContent = msg;
        clearTimeout(statusTimer);
        statusTimer = setTimeout(() => { node.textContent = ''; }, 2200);
    }

    // ── stage ────────────────────────────────────────────────────────────────
    // `.flipped` means "face showing" in both stylesheets (see the note in
    // aria-gm.css), so one implementation drives both stages.
    function hideStage() {
        const wrap = $('flip-wrap');
        if (wrap) { wrap.classList.remove('flipped'); wrap.classList.add('hidden'); }
        $('drawn-card')?.classList.remove('ready');
    }

    async function reveal(card) {
        const wrap = $('flip-wrap');
        const face = $('drawn-card');
        renderCardFace(face, card);
        face?.classList.add('ready');
        if (!wrap) return;
        wrap.classList.remove('hidden');
        wrap.getBoundingClientRect();
        await delay(30);
        wrap.classList.add('flipped');
    }

    // Re-show the last drawn card after a reload, with no flip animation.
    function restore() {
        const card = cardById(lastCardId);
        const wrap = $('flip-wrap');
        if (!card || !wrap) return;
        renderCardFace($('drawn-card'), card);
        $('drawn-card')?.classList.add('ready');
        wrap.classList.remove('hidden');
        wrap.style.transition = 'none';
        wrap.classList.add('flipped');
        wrap.getBoundingClientRect();
        wrap.style.transition = '';
    }

    async function animateShuffle() {
        const overlay = $('shuffle-overlay');
        const wrap = $('deck-wrap');
        if (!overlay || !wrap) { await delay(300); return; }
        const rect = wrap.getBoundingClientRect();
        const dirs = ['left', 'right', 'left', 'right'];
        const ghosts = dirs.map((dir, i) => {
            const g = el('div', { className: 'shuffle-ghost', style: {
                width: `${rect.width}px`, height: `${rect.height}px`,
                left: `${rect.left}px`, top: `${rect.top}px`,
                animation: `shuffle-${dir} 0.52s ${i * 0.08}s ease-in-out forwards`,
            } }, el('div', { className: 'deck-pattern' }));
            overlay.append(g);
            return g;
        });
        wrap.classList.remove('shuffling'); wrap.getBoundingClientRect(); wrap.classList.add('shuffling');
        await delay(680);
        ghosts.forEach(g => g.remove());
        wrap.classList.remove('shuffling');
    }

    // ── actions ──────────────────────────────────────────────────────────────
    async function draw() {
        if (drawing || deck.length === 0) return;
        drawing = true;
        hideStage();
        await fly?.();
        const card = deck.pop();
        drawn.add(card.id);
        lastCardId = card.id;
        refreshPillById(card.id);
        updateCount();
        await reveal(card);
        status(cardLabel(card));
        persist?.();
        publish?.('draw', { cardId: card.id });
        drawing = false;
    }

    async function reshuffle(remainingOnly) {
        if (drawing) return;
        drawing = true;
        hideStage();
        await animateShuffle();
        if (remainingOnly) {
            deck = shuffle(deck);
        } else {
            drawn.clear();
            deck = shuffle(ALL_CARDS.filter(c => !excluded.has(c.id)));
            lastCardId = null;
        }
        refreshAllPills();
        updateCount();
        persist?.();
        publish?.('reshuffle', {});
        if (announce) await announce(remainingOnly);
        else status(remainingOnly ? '↺ Restant mélangé' : '↺ Mélangé');
        drawing = false;
    }

    return { load, reset, mount, state, draw, reshuffle, clearExclusions, buildTracker, updateCount };
}

// ═══════════════════════════════════════════
//  NOTES
// ═══════════════════════════════════════════
// A named-notes list: sidebar on the left, name + body editor on the right. Both
// panels have exactly this widget — the player's scoped to a character, the GM's to
// a campaign — and each carried its own copy of all eight functions, identical but
// for a `gm` prefix, one storage key and three element ids. The copies had already
// started to drift (the GM's dropped the `Array.isArray` branch comment, the
// player's kept a redundant `notesList = parsed` assignment), which is exactly how
// a fix applied to one and not the other goes unnoticed.
//
//   key()     — localStorage key. Called on every access rather than captured: the
//               player's key follows the *current* character, which changes.
//   ids       — { list, name, area } element ids
//   sync      — (note, position) => void   persist one note remotely
//   syncSoon  — (note, position) => void   debounced variant, for keystrokes
//   remove    — (id) => void               drop one note remotely
function makeNotes({ key, ids, sync, syncSoon, remove }) {
    let list = [];
    let currentId = null;
    const $ = which => document.getElementById(ids[which]);
    const posOf = note => list.indexOf(note);
    const current = () => list.find(n => n.id === currentId) || null;

    function persist() { localStorage.setItem(key(), JSON.stringify(list)); }

    // A save written before notes were named is a bare string, not an array.
    function load() {
        const raw = localStorage.getItem(key());
        let parsed = null;
        if (raw) { try { parsed = JSON.parse(raw); } catch (_) {} }
        list = Array.isArray(parsed) ? parsed
             : raw ? [{ id: uid(), name: 'Notes', content: raw }]
             : [];
        currentId = list[0]?.id ?? null;
        render();
    }

    function renderList() {
        fill($('list'), list.map(note =>
            el('div', { className: 'notes-item' + (note.id === currentId ? ' active' : '') },
                el('span', { className: 'notes-item-name', textContent: note.name || 'Sans titre',
                    onclick: () => select(note.id) }),
                el('button', { className: 'notes-item-delete', title: 'Supprimer', textContent: '✕',
                    onclick: e => { e.stopPropagation(); del(note.id); } }))));
    }

    function renderEditor() {
        const nameInput = $('name'), area = $('area');
        if (!nameInput || !area) return;
        const note = current();
        nameInput.value = note ? note.name : '';
        area.value = note ? note.content : '';
        nameInput.disabled = area.disabled = !note;
    }

    function render() { renderList(); renderEditor(); }

    function select(id) {
        currentId = id;
        render();
        $('area')?.focus();
    }

    function add() {
        const note = { id: uid(), name: 'Nouvelle note', content: '' };
        list.push(note);
        persist();
        sync?.(note, posOf(note));
        select(note.id);
        const nameInput = $('name');
        if (nameInput) { nameInput.focus(); nameInput.select(); }
    }

    function del(id) {
        remove?.(id);
        const idx = list.findIndex(n => n.id === id);
        list = list.filter(n => n.id !== id);
        currentId = list[Math.min(idx, list.length - 1)]?.id ?? null;
        persist();
        render();
    }

    // Write the field the user is typing in back to the note. Only renderList() is
    // safe to call from here — renderEditor() would rewrite the field being typed
    // in and reset the caret, so rename() refreshes the list alone.
    function save() {
        const note = current();
        if (!note) return;
        note.content = $('area').value;
        persist();
        syncSoon?.(note, posOf(note));
    }

    function rename() {
        const note = current();
        if (!note) return;
        note.name = $('name').value;
        persist();
        renderList();
        syncSoon?.(note, posOf(note));
    }

    return { load, add, select, del, save, rename, get list() { return list; } };
}

// ═══════════════════════════════════════════
//  CAMERA (VDO.ninja push + view)
// ═══════════════════════════════════════════
// Both panels publish one webcam into the GM's VDO.ninja room and view everyone
// else's, and both carried a byte-identical copy of the whole mechanism under
// gm-prefixed names: the single-pusher Web Lock, the push/view URL builders, the
// kill switch, its cross-tab sync, and the 📹 button. That is precisely the
// duplication the deck and notes factories exist to prevent.
//
// What genuinely differs is the work after a state change — the player refreshes the
// Caméras tab and the presence rail, the GM its topbar button and the "Votre caméra"
// preview. That is the `onChange` hook, and nothing else is forked.
//
//   tag        — console prefix ('[VDO]' / '[GM]')
//   sidPrefix  — stream id prefix ('aria-' / 'aria-gm-')
//   lockPrefix — Web Lock name prefix ('aria-push-' / 'aria-gm-push-')
//   frameId    — element id of the hidden push iframe
//   ownerId()  — charId / campaignId; falsy when nothing is open
//   offKey()   — localStorage key for the kill switch, scoped to the owner
//   room()     — active VDO room name, '' when none
//   password() — room password, '' when none
//   onChange() — panel work after any state change (re-render tabs / preview)
//   announce() — republish presence so peers see the new advertised streamId
function makeCamera({ tag, sidPrefix, lockPrefix, frameId,
                      ownerId, offKey, room, password,
                      onChange = () => {}, announce = () => {} }) {
    let off = false, lockHeld = false, _release = null, _abort = null;

    // The stream id is a pure function of the owner UUID, so every tab of one
    // participant derives the same one — which is exactly why only one may push.
    const streamId = () => { const id = ownerId(); return id ? sidPrefix + id.slice(0, 8) : ''; };

    // "Is anyone publishing this stream?" Every term is state that all of the
    // participant's tabs read identically, so they advertise the same id and no
    // consumer can see it flip. Deliberately NOT gated on lockHeld: a non-holding tab
    // would then advertise '' under the same clientId as its pushing sibling.
    const live = () => !!ownerId() && !!room() && !off;

    const cam = {
        get off()      { return off; },
        get lockHeld() { return lockHeld; },
        streamId, live,

        // What presence advertises. Empty unless some tab is actually pushing — an id
        // nobody publishes makes every receiver open a viewer on a dead stream: a
        // black box on each peer's rail and, worse, on the OBS output.
        advertisedId() { return live() ? streamId() : ''; },

        // Viewer URL. &solo is required alongside &room — without it VDO.ninja
        // ignores &view and renders the "Join Room with Camera" landing page. The
        // password is required too: streams pushed into a protected room are
        // encrypted, so a bare ?view=SID stays black.
        viewSrc(sid, muted) {
            let src = `https://vdo.ninja/?view=${encodeURIComponent(sid)}&autoplay&cleanoutput`;
            if (muted) src += '&muted';
            if (room()) src += `&solo&room=${encodeURIComponent(room())}`;
            if (password()) src += `&password=${encodeURIComponent(password())}`;
            return src;
        },

        // ── Single-pusher lock ────────────────────────────────────────────────
        // Two tabs would publish into the same room under the same stream id. An
        // exclusive Web Lock names the one tab that owns the webcam: the browser
        // queues the others and releases it when the holder's tab goes away
        // *including a crash*, at which point the next in the queue starts pushing.
        // No TTL to tune, no claim record to read back, no "taking over" state.
        //
        // The lock answers "which tab pushes" and nothing else — see live().
        acquireLock() {
            cam.releaseLock();
            if (!ownerId()) return;
            // Web Locks needs a secure context with a real origin; from file:// it
            // throws. Nothing can push there anyway (getUserMedia refuses too), so
            // assume sole ownership rather than leaving nobody pushing at all.
            if (!navigator.locks) { lockHeld = true; onChange(); return; }
            const ac = new AbortController();
            _abort = ac;
            try {
                navigator.locks.request(lockPrefix + ownerId(), { mode: 'exclusive', signal: ac.signal },
                    () => new Promise(res => {
                        _abort = null; _release = res; lockHeld = true;
                        console.log(tag, 'push lock acquired — this tab owns the webcam');
                        onChange();
                    })
                ).catch(() => {});   // AbortError when we left the queue before being granted
            } catch (_) { lockHeld = true; onChange(); }
        },

        // Leave the queue, or hand the lock to the next tab, on owner switch.
        releaseLock() {
            if (_abort)   { try { _abort.abort(); } catch (_) {} _abort = null; }
            if (_release) { _release(); _release = null; }
            lockHeld = false;
        },

        // ── Kill switch ───────────────────────────────────────────────────────
        // Persisted per owner so a participant who opted out is not re-broadcast by
        // the next page load. The GM decides the room; each participant decides
        // whether to publish into it.
        loadOff() { off = localStorage.getItem(offKey()) === '1'; },

        toggle() {
            off = !off;
            if (ownerId()) localStorage.setItem(offKey(), off ? '1' : '0');
            console.log(tag, 'camera', off ? 'OFF (local)' : 'ON');
            onChange();      // the lock stays ours; we just stop publishing into it
            announce();
        },

        // live() reads the kill switch, so every tab of a participant must agree on
        // it — otherwise two tabs sharing a clientId would advertise different stream
        // ids and the tile would flip between them. `storage` fires only in the
        // *other* tabs, so this never re-enters the tab that made the change.
        // Returns true when it handled the event.
        syncFromStorage(e) {
            if (!ownerId() || e.key !== offKey()) return false;
            const v = e.newValue === '1';
            if (v === off) return false;
            off = v;
            console.log(tag, 'camera', off ? 'OFF' : 'ON', '(synced from another tab)');
            onChange();
            announce();
            return true;
        },

        // ── Push iframe ───────────────────────────────────────────────────────
        // Two separate questions. live() — is this stream being published at all, by
        // this tab or a sibling? — drives the self preview. `shouldPush` adds lock
        // ownership and drives the frame: a tab that isn't the pusher still views
        // what its sibling publishes.
        syncPushFrame() {
            const frame = document.getElementById(frameId);
            if (!frame) { console.warn(tag, 'push frame not found: #' + frameId); return; }
            if (!(live() && lockHeld)) {
                const why = off ? 'camera cut locally'
                          : !room() ? 'no vdoRoom'
                          : !ownerId() ? 'nothing open'
                          : 'another tab holds the push lock';
                console.log(tag, why, '— clearing push iframe');
                cam.blankPushFrame();
                return;
            }
            // Blank &view: "no streams will play; only publishing will be allowed" —
            // without it the push page joins as a full room client and downloads (and
            // renders) every other guest's video next to the self preview.
            let src = `https://vdo.ninja/?push=${streamId()}&room=${encodeURIComponent(room())}&view&autostart&webcam&noaudio&cleanoutput`;
            if (password()) src += `&password=${encodeURIComponent(password())}`;
            // Redacted: this log gets pasted into bug reports, and the room password
            // is enough to join the room and watch every player.
            console.log(tag, 'push:', src.replace(/([?&]password=)[^&]*/, '$1***'));
            if (frame.src !== src) frame.src = src;
        },

        // Blank the push iframe without touching the kill switch — for leaving a
        // character/campaign, where the owner id is about to stop resolving.
        // 'about:blank', never '': an empty src resolves to the page's own URL and
        // would load a second copy of the whole app inside the hidden iframe.
        blankPushFrame() {
            const frame = document.getElementById(frameId);
            if (frame && frame.src && frame.src !== 'about:blank') frame.src = 'about:blank';
        },

        // Sync the 📹 kill-switch button. Hidden while no room is set — nothing is
        // published either way then, so the control would be a no-op.
        renderToggle(btnId) {
            const btn = document.getElementById(btnId);
            if (!btn) return;
            btn.style.display = room() ? '' : 'none';
            btn.classList.toggle('off', off);
            btn.textContent = off ? '🚫' : '📹';
            btn.title = off ? 'Caméra coupée — cliquer pour rétablir' : 'Couper ma caméra';
        },
    };
    return cam;
}

// ═══════════════════════════════════════════
//  FILE VIEWER
// ═══════════════════════════════════════════
// The modal that previews a granted/uploaded file. Both panels had a line-for-line
// copy differing only in the `gm-` id prefix — the same shape makeDeck already
// takes a prefix for.
//
//   prefix — element id prefix: '' for the player, 'gm-' for the GM
//   files  — () => the list to look the id up in (playerFiles / gmFiles)
function makeFileViewer({ prefix = '', files }) {
    const $ = suffix => document.getElementById(prefix + suffix);
    return {
        open(fileId) {
            const f = files().find(x => x.id === fileId);
            if (!f) return;
            $('fv-title').textContent = f.name;
            const body = $('fv-body');
            fill(body);
            // f.type can be missing on a malformed grant or an old row — guard it.
            // The URL is remote-controlled (grants travel over Ably), so a
            // javascript: src would execute in this origin: _safeUrl or nothing.
            const url = _safeUrl(f.url);
            const type = f.type || '';
            if (url && type.startsWith('image/')) {
                const img = el('img', { className: 'fv-image', src: url });
                body.append(img);
                wireImageZoom(img);
            } else if (url && type === 'application/pdf') {
                body.append(el('iframe', { className: 'fv-iframe', src: url }));
            } else if (url && type.startsWith('text/')) {
                const pre = el('pre', { className: 'fv-text', textContent: 'Chargement…' });
                body.append(pre);
                fetch(url).then(r => r.text())
                    .then(t => { pre.textContent = t; })
                    .catch(() => { pre.textContent = 'Erreur de chargement.'; });
            } else {
                body.append(el('div', { className: 'fv-unsupported' },
                    el('div', { className: 'fv-unsupported-icon', textContent: fileIcon(type) }),
                    el('div', { className: 'fv-unsupported-name', textContent: f.name }),
                    url && el('a', { className: 'fv-download-link', href: url, target: '_blank',
                        rel: 'noopener', textContent: 'Ouvrir dans un nouvel onglet' })));
            }
            $('file-viewer-scrim').classList.add('show');
            $('file-viewer-modal').classList.add('show');
        },
        close() {
            $('file-viewer-scrim').classList.remove('show');
            $('file-viewer-modal').classList.remove('show');
            fill($('fv-body'));
        },
    };
}

// Three-letter badge for a MIME type, shown on file rows and in the viewer's
// unsupported-type fallback.
function fileIcon(type) {
    if (!type) return 'DOC';
    if (type.startsWith('image/')) return 'IMG';
    if (type === 'application/pdf') return 'PDF';
    if (type.startsWith('text/')) return 'TXT';
    return 'DOC';
}

// ═══════════════════════════════════════════
//  THEME / CONFIG MODAL
// ═══════════════════════════════════════════
let config = JSON.parse(localStorage.getItem('aria-config') || '{}');
if (config.lightMode) document.body.classList.add('light-mode');

function applyTheme(light) {
    document.body.classList.toggle('light-mode', !!light);
}

function toggleConfig() {
    document.getElementById('config-modal').classList.toggle('show');
    document.getElementById('config-scrim').classList.toggle('show');
}

// Update the dddice status dot and text labels in the topbar and config modal.
function setDddiceStatus(ok, detail) {
    ['dddice-dot', 'cfg-dddice-dot'].forEach(id => { const e = document.getElementById(id); if (e) e.className = 'status-dot ' + (ok ? 'connected' : 'error'); });
    ['dddice-status', 'cfg-dddice-status'].forEach(id => { const e = document.getElementById(id); if (e) e.textContent = ok ? `dddice: ${detail || 'connecté'}` : `Erreur: ${detail || 'dddice'}`; });
}

// Pan/zoom an <img> with the wheel and drag (file previews, monster art).
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
//  dddice
// ═══════════════════════════════════════════
// Everything up to and including the RollFinished subscription was written out in
// both panels. What actually differs between them is the RollFinished handler — the
// player matches the roll against its own pending state and hides its canvas
// wrapper, the GM resolves a monster attack — so that is the only hook.
let dddiceSDK = null;            // ThreeDDice SDK instance
let dddiceAPI = null;            // { key, room, theme } once connected
let dddiceResizeHandler = null;  // stored so it can be removed before re-registering

// Fetch the account's dice-box themes and fill the config modal's dropdown.
async function _dddiceThemes() {
    const res = await fetch('https://dddice.com/api/1.0/dice-box', {
        headers: { 'Authorization': `Bearer ${config.dddiceKey}`, 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`Dice box HTTP ${res.status}`);
    const themes = (await res.json()).data || [];
    if (!themes.length) throw new Error('Aucun thème.');
    return themes;
}

// Load the SDK, connect to the room, and subscribe onRollFinished. Resolves true
// once connected, false when dddice is unconfigured or the setup failed.
// Init order matters: .start() must precede .connect().
async function initDddiceSDK(onRollFinished) {
    const slug = extractRoomSlug(config.dddiceRoom);
    if (!config.dddiceKey || !slug) return false;
    try {
        const { ThreeDDice, ThreeDDiceRollEvent } = await import('https://esm.sh/dddice-js');
        const themes = await _dddiceThemes();

        const sel = document.getElementById('cfg-dddice-theme');
        fill(sel, themes.map(t => el('option', { value: t.id, textContent: t.name ? `${t.name} (${t.id})` : t.id })));
        sel.disabled = false;
        sel.value = config.dddiceTheme && themes.find(t => t.id === config.dddiceTheme) ? config.dddiceTheme : themes[0].id;

        dddiceSDK = new ThreeDDice(document.getElementById('dddice-canvas'), config.dddiceKey);
        dddiceSDK.start();
        await dddiceSDK.connect(slug);
        dddiceSDK.on(ThreeDDiceRollEvent.RollFinished, onRollFinished);

        // Keep the WebGL viewport in sync with the window. Removed before
        // re-registering because saveConfig() re-inits the SDK; only the GM used to
        // do this, so the player's dice rendered at a stale scale after a resize.
        if (dddiceResizeHandler) window.removeEventListener('resize', dddiceResizeHandler);
        dddiceResizeHandler = () => dddiceSDK?.resize();
        window.addEventListener('resize', dddiceResizeHandler);

        dddiceAPI = { key: config.dddiceKey, room: slug, theme: sel.value };
        setDddiceStatus(true, themes.find(t => t.id === sel.value)?.name || sel.value);
        sel.onchange = () => {
            if (dddiceAPI) dddiceAPI.theme = sel.value;
            config.dddiceTheme = sel.value;
            localStorage.setItem('aria-config', JSON.stringify(config));
        };
        return true;
    } catch (e) {
        console.error('dddice:', e);
        setDddiceStatus(false, e.message);
        dddiceSDK = null;
        dddiceAPI = null;
        return false;
    }
}

// Disconnect the SDK and drop the resize listener, before a re-init or a teardown.
function teardownDddice() {
    if (dddiceResizeHandler) { window.removeEventListener('resize', dddiceResizeHandler); dddiceResizeHandler = null; }
    try { dddiceSDK?.disconnect(); } catch (_) {}
    dddiceSDK = null;
    dddiceAPI = null;
}

// ═══════════════════════════════════════════
//  SAVE KEY GATEWAY
// ═══════════════════════════════════════════
let saveKey = localStorage.getItem('aria-save-key') || null;
let _pendingNewKey = null;

// Check whether Supabase sync is configured and a save key is available.
function _supabaseReady() { return !!SUPABASE_URL && !!SUPABASE_ANON_KEY && !!saveKey; }

// Show the two-panel gateway (new key + existing key) with a freshly generated key.
function showGateway() {
    _pendingNewKey = uid();
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
    await sbUpsert('saves', { save_key: saveKey, type: ARIA.role });
    await ARIA.syncAll();
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
    if (saveKey && key !== saveKey) ARIA.clearLocal();
    saveKey = key;
    localStorage.setItem('aria-save-key', key);
    await loadFromSupabase();
    hideGateway();
    showSelectionScreen();
}

// Update the save-key status label on the selection screen.
function updateSaveKeyStatus() {
    const label = document.getElementById('sel-save-label');
    if (!label) return;
    label.textContent = saveKey ? saveKey.slice(0, 8) + '…' : '—';
    label.className = 'sel-save-label' + (saveKey ? ' connected' : '');
}

// Show the gateway and focus the existing-key input so the user can switch keys.
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

// Cancel key entry: return to the gateway if no key exists, else just hide it.
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
    if (ok) ARIA.syncAll();
    // After showSelectionScreen so that screen stays the fallback when nothing is
    // remembered, and the place "changer de personnage/campagne" returns to.
    ARIA.afterRestore();
}

// ═══════════════════════════════════════════
//  SPLIT-PANE TAB ENGINE (design frames 22-24)
// ═══════════════════════════════════════════
// openPanes lists the open tabs left → right; paneWeights holds their relative
// widths (normalized to sum 100). Panes are the existing .tab-content divs
// (classes + inline grid placement only — never reparented, so camera iframes are
// untouched). No pane-count limit.
//
// renderTabLayout() is NOT here: each panel does its own post-layout work (the GM
// refreshes its player cards and push iframe, the player its cameras grid and
// presence rail). Everything below calls it by name, resolved at call time.
let openPanes = ['tab-skills'];
let paneWeights = [100];
let focusIdx = 0;

// Restore the persisted pane layout. Called from ARIA.configure(), once the panel
// has supplied its storage key (hidden tabs are pruned later, in renderTabLayout).
function initSplitState() {
    openPanes = [ARIA.defaultPane];
    paneWeights = [100];
    focusIdx = 0;
    try {
        const sl = JSON.parse(localStorage.getItem(ARIA.splitKey) || 'null');
        if (sl && Array.isArray(sl.panes) && sl.panes.length) {
            openPanes = [...new Set(sl.panes)];
            paneWeights = (Array.isArray(sl.weights) && sl.weights.length === openPanes.length)
                ? sl.weights.slice() : openPanes.map(() => 1);
        }
    } catch (_) {}
}

function _persistSplit() {
    localStorage.setItem(ARIA.splitKey, JSON.stringify({ panes: openPanes, weights: paneWeights.map(w => Math.round(w * 100) / 100) }));
}

function _normWeights() {
    const sum = paneWeights.reduce((a, b) => a + b, 0) || 1;
    paneWeights = paneWeights.map(w => w * 100 / sum);
}

// Back to a single default pane (character/campaign switch).
function resetSplitState() {
    openPanes = [ARIA.defaultPane]; paneWeights = [100]; focusIdx = 0;
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

// Shared half of renderTabLayout: prune hidden panes, apply classes and grid
// placement. Each panel's renderTabLayout calls this, then does its own work.
function applyTabLayout() {
    // Drop panes whose tab was hidden (conditional tabs set display:none on the button).
    for (let i = openPanes.length - 1; i >= 0; i--) {
        const btn = document.querySelector(`.tab-btn[data-tab="${openPanes[i]}"]`);
        if (!btn || btn.style.display === 'none' || !document.getElementById(openPanes[i])) {
            openPanes.splice(i, 1); paneWeights.splice(i, 1);
            if (focusIdx > i) focusIdx--;
        }
    }
    if (!openPanes.length) { openPanes = [ARIA.defaultPane]; paneWeights = [100]; }
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
}

// Finish a layout pass: rebuild the split chrome and persist. Panels call this at
// the end of their renderTabLayout, after their own pane-specific work.
function finishTabLayout() {
    updateSplitChrome();
    _persistSplit();
}

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
    content.querySelectorAll('.split-pane-hdr, .split-divider').forEach(e => e.remove());
    if (openPanes.length < 2) { content.style.gridTemplateColumns = ''; return; }
    _applySplitColumns();
    openPanes.forEach((id, i) => {
        const close = el('button', { className: 'sph-close', title: 'Fermer le panneau', textContent: '×',
            onmousedown: e => e.stopPropagation(), onclick: () => closePane(i) });
        const hdr = el('div', { className: 'split-pane-hdr', title: 'Glisser pour ré-ancrer',
            style: { gridColumn: String(2 * i + 1) }, onmousedown: e => startPaneDrag(e, i) },
            el('span', { className: 'sph-grip', textContent: '⋮⋮' }),
            el('span', { className: 'sph-label', textContent: tabLabel(id) }),
            el('span', { className: 'sph-spacer' }),
            el('span', { className: 'sph-focus', textContent: 'Focus' }),
            close);
        content.append(hdr);
        if (i < openPanes.length - 1) {
            content.append(el('div', {
                className: 'split-divider',
                title: 'Glisser pour répartir — double-clic : répartition égale',
                style: { gridColumn: String(2 * i + 2) },
                onmousedown: e => startDividerDrag(e, i),
                ondblclick: resetSplitRatio,
            }, el('span'), el('span'), el('span')));
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
//  MUSIC TRANSPORT
// ═══════════════════════════════════════════
// Two slots (A/B) so a track can be cross-faded into its successor. Each slot backs
// both an <audio> element (uploaded files) and a YouTube IFrame player. The GM drives
// this from the Musique tab and mirrors the commands over Ably; the player runs the
// same transport from the received commands.
let musicMasterVolume = parseInt(localStorage.getItem('aria-music-volume') || '80');
let musicFadeDuration = 3000;
let musicCurrentIndex = -1;
let musicIsPlaying = false;
let _musicCurrentSlot = 'A';
let _musicFadeRaf = null;
let _musicMuted = false;

const _musicSlots = {
    A: { audio: null, ytEndedCb: null },
    B: { audio: null, ytEndedCb: null },
};

let _ytAPIReady = false;
let _ytPendingCbs = [];
let _ytSlotA = null;   // YT.Player instance
let _ytSlotB = null;

// Effective output volume: 0 when muted, otherwise the master volume.
// Mute silences playback without moving the volume slider.
function _musicEffVol() { return _musicMuted ? 0 : musicMasterVolume; }

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
    if (yt) { try { yt.setVolume(v); } catch (_) {} }
}

// Stop and clear a music slot: pause audio, stop YouTube, clear ended callback.
function _stopSlot(slot) {
    const audio = _musicSlots[slot].audio;
    if (audio) { audio.pause(); audio.onended = null; audio.src = ''; }
    const yt = slot === 'A' ? _ytSlotA : _ytSlotB;
    if (yt) { try { yt.stopVideo(); } catch (_) {} }
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
                try { yt.playVideo(); } catch (_) {}
                onStarted();
                // Detect autoplay block: state stays unstarted/cued if the browser blocked it
                setTimeout(() => {
                    try {
                        const state = yt.getPlayerState();
                        if (state !== 1 && state !== 3) { // not playing or buffering
                            _showMusicUnlockPrompt(() => { try { yt.playVideo(); } catch (_) {} });
                        }
                    } catch (_) {}
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
    let prompt = document.getElementById('music-unlock-prompt');
    if (!prompt) {
        prompt = el('div', { id: 'music-unlock-prompt', className: 'music-unlock-prompt', textContent: '▶ Cliquer pour activer le son' });
        document.body.append(prompt);
    }
    prompt.style.display = 'flex';
    const handler = () => { prompt.style.display = 'none'; prompt.removeEventListener('click', handler); onUnlock(); };
    prompt.addEventListener('click', handler);
}

// Start a track in the idle slot and cross-fade into it. Auto-advance is armed onto
// _musicAutoAdvance, which each panel defines over its own queue. ARIA.onMusicPhase
// is the panel's chance to refresh its own UI — the player updates its music bar,
// the GM re-renders the Musique tab and starts its progress ticker.
function _musicTriggerPlay(track, index) {
    if (_musicFadeRaf) { cancelAnimationFrame(_musicFadeRaf); _musicFadeRaf = null; }
    const currentSlot = _musicCurrentSlot;
    const nextSlot = currentSlot === 'A' ? 'B' : 'A';
    // Disarm the outgoing slot before the transition, or its ended event fires
    // auto-advance a second time mid-crossfade.
    _musicSlots[currentSlot].ytEndedCb = null;
    if (_musicSlots[currentSlot].audio) _musicSlots[currentSlot].audio.onended = null;
    musicCurrentIndex = index;
    musicIsPlaying = true;
    ARIA.onMusicPhase('start', track);
    _loadSlotAtZeroVol(track, nextSlot, () => {
        _runCrossfade(currentSlot, nextSlot, () => {
            _musicCurrentSlot = nextSlot;
            _setSlotEndedCallback(nextSlot, track, _musicAutoAdvance);
            ARIA.onMusicPhase('faded', track);
        });
    });
}

// ═══════════════════════════════════════════
//  PRESENCE
// ═══════════════════════════════════════════
// Re-read the whole presence set rather than patching a local copy, so no app can
// drift from the server's view. applyPresenceSet is panel-specific.
async function refreshPresenceSet() {
    if (!ablyPresence) return;
    try { applyPresenceSet(await ablyPresence.presence.get()); }
    catch (err) { console.error(`[${ARIA.tag}] presence get:`, err); }
}
