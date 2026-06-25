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

let overlayConfig = { widgets: [] };
const presenceCache = new Map();
const rollHistory = [];
const ROLL_HISTORY_MAX = 20;

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
    dmgCh.subscribe('damage', msg => showDamage(msg.data));
    dmgCh.subscribe('heal', msg => showHeal(msg.data));
    dmgCh.subscribe('presence', msg => {
        const d = msg.data;
        if (d?.charId) {
            presenceCache.set(d.charId, d);
            updateWidgetData();
        }
    });
    // Live monster HP — the GM publishes monster-state on the (campaign-scoped) damage
    // channel, so it must be received here, not on aria-overlay-config.
    dmgCh.subscribe('monster-state', msg => {
        if (!OVERLAY_ID || msg.data.overlayId !== OVERLAY_ID) return;
        const widget = overlayConfig.widgets.find(w => w.type === 'monster_list');
        if (!widget) return;
        widget.config = { ...widget.config, monsters: msg.data.monsters };
        updateWidgetData();
    });

    if (OVERLAY_ID) {
        const cfgCh = ably.channels.get('aria-overlay-config');
        cfgCh.subscribe('layout-update', msg => {
            if (msg.data.overlayId !== OVERLAY_ID) return;
            overlayConfig = msg.data.config;
            renderWidgetLayer();
        });
        cfgCh.subscribe('content-update', msg => {
            if (msg.data.overlayId !== OVERLAY_ID) return;
            const widget = overlayConfig.widgets.find(w => w.id === msg.data.widgetId);
            if (!widget) return;
            widget.config = { ...widget.config, content: msg.data.content };
            const el = document.querySelector(`.overlay-widget[data-widget-id="${msg.data.widgetId}"]`);
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
        ? `(Modificateur : ${data.bonusMalus > 0 ? '+' : ''}${data.bonusMalus})` : '';
    document.getElementById('card-bonus').textContent = bm;

    const verdictEl = document.getElementById('card-verdict');
    const subEl = document.getElementById('card-crit-sub');
    subEl.textContent = '';

    switch (type) {
        case 'die':
            verdictEl.textContent = '';
            verdictEl.className = 'card-verdict';
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
            break;
        case 'fail':
            verdictEl.textContent = 'ÉCHEC';
            verdictEl.className = 'card-verdict verdict-fail';
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
    // Reconstruct card info from id
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
        const suitName = parts.slice(1).join('-');
        const suit = SUITS_MAP[suitName] || { sym: '?', cls: 'pc-black' };
        colorCls = suit.cls;
        const suitNames = { spades: 'Pique', clubs: 'Trèfle', hearts: 'Cœur', diamonds: 'Carreau' };
        label = `${rank} de ${suitNames[suitName] || suitName}`;
        html = `
          <div class="pc-corner tl"><span class="pc-rank">${rank}</span><span class="pc-suit-small">${suit.sym}</span></div>
          <div class="pc-center">${suit.sym}</div>
          <div class="pc-corner br"><span class="pc-rank">${rank}</span><span class="pc-suit-small">${suit.sym}</span></div>`;
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
            const p = [...presenceCache.values()][0];
            if (!p) return '<div class="ow-char-name">—</div>';
            return `<div class="ow-char-name">${esc(p.name)}${p.charClass ? ' — ' + esc(p.charClass) : ''}</div>`;
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
            const sid = cfg.streamId || '';
            if (!sid) return '<div class="ow-camera-empty">—</div>';
            return `<iframe src="https://vdo.ninja/?view=${encodeURIComponent(sid)}&autoplay&cleanoutput&transparent" allow="autoplay; fullscreen; display-capture; picture-in-picture; screen-wake-lock" allowfullscreen style="width:100%;height:100%;border:none;"></iframe>`;
        }
        default: return '';
    }
}

// Rebuild all persistent overlay widget DOM elements and apply event widget positions.
function renderWidgetLayer() {
    const container = document.getElementById('overlay-widgets');
    container.innerHTML = '';
    for (const widget of overlayConfig.widgets) {
        if (!widget.visible) continue;
        if (widget.category === 'event') continue;
        const el = document.createElement('div');
        el.className = 'overlay-widget';
        el.dataset.widgetId = widget.id;
        el.style.left    = widget.x + '%';
        el.style.top     = widget.y + '%';
        el.style.width   = widget.w + '%';
        el.style.height  = widget.h + '%';
        el.style.opacity = widget.config?.opacity ?? 1;
        el.style.fontSize = (widget.config?.fontSize ?? 14) + 'px';
        el.innerHTML = renderWidgetContent(widget);
        container.appendChild(el);
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
        el.innerHTML = renderWidgetContent(widget);
    });
}

// Load the overlay layout config from Supabase on startup.
async function loadOverlayConfig() {
    if (!OVERLAY_ID) return;
    const rows = await sbSelect('overlay_configs', 'id=eq.' + encodeURIComponent(OVERLAY_ID));
    if (rows.length && rows[0].config) {
        overlayConfig = rows[0].config;
        renderWidgetLayer();
    }
}

if (OVERLAY_ID) loadOverlayConfig();
