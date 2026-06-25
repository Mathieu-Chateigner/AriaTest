# Claude Code — implement the ARIA visual refonte

## Goal
Reskin the entire ARIA app with the new "cold-ink / single-accent / cinematic" design, on a **new branch called `new design`**. **Every existing feature must keep working** — this is a presentation refactor, not a rewrite.

## Hard rules (do not break functionality)
- Create and work on branch `new design` (`git checkout -b "new design"`). Do not touch `main`.
- The app is framework-free vanilla JS with real-time sync (Ably), Supabase persistence, in-place DOM updates, WebRTC/VDO.ninja iframes, dddice. **The JS reads elements by `id`, `class`, `data-*` and updates them in place.**
  - **Do NOT rename or remove any `id`, JS-referenced `class`, `data-*` attribute, or event hook.** Before changing any element, grep the JS (`js/aria-player.js`, `js/aria-gm.js`, etc.) for its id/class/selector.
  - Prefer changing **CSS only**. When markup must change (e.g. merging toolbars), keep the same hook elements and event bindings; move them, don't delete them.
  - Never re-create the DOM nodes that hold WebRTC/camera iframes — preserve them so streams don't drop (the codebase already does in-place updates for this reason).
- Work **one view at a time**, and after each, sanity-check that its scripts still load and its actions still fire. Commit per view with a clear message.

## Reference
A full visual mockup of all screens exists as a separate artifact (`Aria Refonte.dc.html`). It is a **design reference only** — do not copy its runtime (it's a self-contained component). Reproduce its *look* against the real files: `index.html`, `css/aria-*.css`, `views/aria-*.html`.

---

## Design system

### Fonts (add to `<head>`)
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600&family=Archivo:wght@400;500;600;700;800&display=swap" rel="stylesheet">
```
- **Cormorant Garamond** (serif) — wordmark, section/screen headers, character & item names, flavour text (use the *italic* for names/flavour).
- **Archivo** (grotesk) — all functional UI: labels, buttons, and especially **numbers** (`font-variant-numeric: tabular-nums` on every stat / HP / dice value).
- **ui-monospace / Menlo** — tiny uppercase meta labels, codes, timestamps (`letter-spacing: .16–.3em; text-transform: uppercase`).

### Color tokens — define once as CSS variables and theme them
Implement a **dark (default) and light theme**, toggled by a `data-theme="light"` attribute on `<html>` or `<body>` (persist the choice in localStorage). Put the player accent (ember) and GM accent (violet) in the same token set; **GM views use violet where player views use ember.**

```css
:root, [data-theme="dark"] {
  --ink:#050608; --bg:#0b0e13; --panel:#10141b; --raise:#161b25;
  --line:rgba(150,168,200,.10); --line2:rgba(150,168,200,.20);
  --text:#e8ebf1; --warm:#f3ede1; --dim:#868f9f; --faint:#586273;
  --ember:#eca456; --ember2:#f6c07e; --embersoft:rgba(236,164,86,.12);
  --violet:#a98bdd; --violet2:#c4aef0; --violetsoft:rgba(169,139,221,.12);
  --ok:#5bc98e; --bad:#e25a4f; --warn:#e9aa45;
  --field:rgba(0,0,0,.30); --field2:rgba(0,0,0,.25);
  --track:rgba(255,255,255,.06); --track2:rgba(255,255,255,.10);
}
[data-theme="light"] {
  --ink:#ddd4c2; --bg:#f4efe4; --panel:#fcf9f1; --raise:#fff;
  --line:rgba(70,56,30,.13); --line2:rgba(70,56,30,.24);
  --text:#2c2820; --warm:#1b1710; --dim:#6c6353; --faint:#9c917a;
  --ember:#a9620f; --ember2:#8a4f0c; --embersoft:rgba(169,98,15,.14);
  --violet:#6a47a3; --violet2:#523784; --violetsoft:rgba(106,71,163,.13);
  --ok:#2c8a57; --bad:#bd3528; --warn:#9c6c12;
  --field:rgba(50,38,14,.05); --field2:rgba(50,38,14,.035);
  --track:rgba(50,38,14,.10); --track2:rgba(50,38,14,.15);
}
```
**Principle: accent = action.** ~90% of every screen is near-monochrome (ink / panel / line / text). Ember (player) or violet (GM) is spent **only on the thing you act on** — the rollable skill, the live/just-changed value, the current turn, primary buttons. Don't tint structure.

### Surfaces & components
- Frames/cards: `background:var(--panel); border:1px solid var(--line); border-radius:4px;` Sharp corners (2–4px), never pill-rounded cards.
- Section header pattern: serif title + a `height:1px` line fading from `--line2` to transparent + a tiny mono caption (e.g. "cliquer pour lancer").
- Rows (skills, items, rolls): panel bg, a 2px **left border** that lights to the accent on hover, with a soft `--embersoft`/`--violetsoft` hover fill. Numbers right-aligned, big, tabular.
- Inputs: `background:var(--field); border:1px solid var(--line2); border-radius:3px;`.
- Buttons: primary = solid accent with `color:var(--ink)`; secondary = `1px solid var(--line2)` text button. Damage actions use `--bad`, heal uses `--ok`.
- HP color ramp: `>50% → --ok`, `25–50% → --warn`, `≤25% → --bad`. Apply to the number and the bar fill.
- **Atmosphere via material, not ornament:** a faint film-grain overlay on frames (`feTurbulence` SVG data-URI, `mix-blend-mode:soft-light; opacity:.05; pointer-events:none`) and a soft top vignette/glow. **Remove gem/filigree ornaments and all emoji icons** — replace emoji with thin monoline glyphs or small-caps text labels (emoji break the palette and render inconsistently).

### Type minimums
Slides/overlay text large; in-app functional text ≥13px; hit targets ≥40px.

---

## Per-view work + the layout fusions (do carefully, preserving JS hooks)
Apply the system to **all** views and tabs. The design also includes these structural changes — implement them by **moving** existing controls (keep their ids/handlers), not rebuilding:

- **Player shell:** merge the 3 stacked top bands (topbar + bonus/malus + music) into **one unified command bar** (brand · character · roll-modifier cluster · mini music chip · session code · status · settings). Keep every control's existing element + event binding.
- **GM:** merge the **`Jets`** and **`Jet MJ`** tabs into a single screen — roll console on the left, live roll feed on the right. Keep both feature sets' handlers; just co-locate them.
- **Notes:** one shared two-pane design (list + editor) for both Player and GM.
- **Onboarding:** keep the two steps clean — save-key screen → character/campaign selection.
- Cover every other tab too: Compétences, Caractéristiques (× multiplier), Jet libre, Inventaire, Cartes (tirage + talon tracker), Alchimie, Fiche personnage, Monstres, Fichiers, Musique, the player-detail modal, the **OBS overlay** (dark-glass roll card + lower-third nameplate — keep this dark in BOTH themes since it composites over video), and the overlay editor.

## Combat-feedback animations (GM player/monster cards)
Add event-driven motion to HP changes (CSS + small JS, hooked into the existing damage/heal update path — don't replace the sync logic, augment the DOM update):
- **Damage:** brief red flash overlay on the card + a short shake; number pops (scale) as it changes.
- **Crit:** stronger, ember-tinted flash.
- **Heal:** green pulse; number pops up.
- **Death (HP 0):** card desaturates (`filter:grayscale`) + dim, a "MORT" plate fades over the camera area.
- **Critical HP (≤25%, alive):** a slow looping red/ember **breathing glow** (`@keyframes`, inset box-shadow) — this is the ONLY looping animation; it's an ongoing alarm and must turn off the instant HP rises above 25%.
- Keep HP **numbers correct synchronously** on update; the flash/shake/glow are cosmetic layers. No neon skin — glow is a state signal only.

## Workflow
1. `git checkout -b "new design"`
2. Add a `:root` token layer + `[data-theme]` and a persisted dark/light toggle.
3. Reskin shared chrome (fonts, frames, buttons, inputs, grain) in the global CSS first.
4. Then view by view: `index.html` → player → GM → overlay → editor. After each, load it and confirm scripts run and actions fire; commit.
5. Do the toolbar/tab fusions last, moving (not deleting) hook elements; re-test the affected features (rolls, music, damage/heal sync, camera streams).
6. Open a PR from `new design` summarizing what changed and confirming each feature still works.

If anything in the JS makes a safe reskin impossible without a selector change, prefer **adding** a class alongside the existing hook rather than renaming it.
