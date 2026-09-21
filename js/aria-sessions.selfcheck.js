// Self-check for the pure logic in aria-sessions.js — la prochaine occurrence d'une
// séance récurrente et le chevauchement horaire, qui sont les deux seules règles de
// cette page qu'on ne voit pas en la regardant :
//
//     node js/aria-sessions.selfcheck.js
//
// Même forme que aria-shared.selfcheck.js : pas de framework, pas de build. Les deux
// fichiers sont évalués dans la même portée (aria-sessions.js est un script classique
// qui lit ARIA et makeChat de l'autre), avec les globales que leur chargement touche
// remplacées par des bouchons.
const assert = require('assert');
const fs = require('fs');

const _listeners = {};
global.window = { addEventListener(type, fn) { (_listeners[type] ||= []).push(fn); } };
const _store = new Map();
global.localStorage = {
    getItem: k => (_store.has(k) ? _store.get(k) : null),
    setItem: (k, v) => _store.set(k, String(v)),
    removeItem: k => _store.delete(k),
};
// sxInit() s'exécute au chargement. Sans session il s'arrête à la première ligne,
// après un seul getElementById : c'est tout ce qu'il faut bouchonner.
global.document = {
    getElementById: () => ({ style: {}, textContent: '' }),
    addEventListener() {},
    body: { classList: { add() {}, toggle() {} } },
};
global.sbSignedIn = () => false;
global.sbUserId = () => null;
global.sbUserEmail = () => '';

const src = fs.readFileSync(__dirname + '/aria-shared.js', 'utf8')
          + '\n' + fs.readFileSync(__dirname + '/aria-sessions.js', 'utf8');
const { sxNextStart, sxOverlap, sxParseRoles, sxMandatoryForced } =
    new Function(src + '\nreturn { sxNextStart, sxOverlap, sxParseRoles, sxMandatoryForced };')();

const mk = (iso, recurrence, duration_min) => ({ starts_at: iso, recurrence, duration_min });
const HOUR = 3600e3;

// ── Prochaine occurrence ──────────────────────────────────────────────────────
// Un one shot ne bouge jamais : sa date est son annonce, passée ou non (le tableau
// le retire par sxIsOver, il ne le décale pas).
assert.strictEqual(sxNextStart(mk('2020-01-03T19:00:00Z', 'once', 120)),
                   Date.parse('2020-01-03T19:00:00Z'));

// Une séance récurrente passée se reporte, et retombe sur le même jour de semaine à
// la même heure LOCALE — c'est pour ça que le calcul passe par setDate plutôt que par
// une addition de millisecondes, qui dériverait d'une heure à chaque changement d'heure.
for (const rec of ['weekly', 'biweekly', 'monthly']) {
    const s = mk('2020-01-03T19:00:00Z', rec, 120);
    const first = new Date(Date.parse(s.starts_at));
    const next = new Date(sxNextStart(s));
    assert.ok(next.getTime() + 120 * 60e3 >= Date.now(), rec + ' : occurrence encore passée');
    assert.strictEqual(next.getHours(), first.getHours(), rec + ' : heure locale décalée');
    assert.strictEqual(next.getMinutes(), first.getMinutes(), rec + ' : minutes décalées');
    if (rec !== 'monthly') assert.strictEqual(next.getDay(), first.getDay(), rec + ' : jour de semaine décalé');
    else assert.strictEqual(next.getDate(), first.getDate(), 'monthly : quantième décalé');
}

// Une séance récurrente encore en cours ne se reporte pas : on ne renvoie pas les
// inscrits à la semaine prochaine pendant qu'ils jouent.
{
    const now = new Date(Date.now() - HOUR);
    const s = mk(now.toISOString(), 'weekly', 180);
    assert.strictEqual(sxNextStart(s), now.getTime());
}

// ── Chevauchement ─────────────────────────────────────────────────────────────
// La règle : on ne peut pas être à deux tables en même temps. Une séance qui commence
// exactement quand l'autre finit ne chevauche pas — sinon deux soirées d'affilée
// deviendraient impossibles.
const a = mk('2026-09-25T17:00:00Z', 'once', 120);   // 17:00 → 19:00
assert.ok(sxOverlap(a, mk('2026-09-25T18:00:00Z', 'once', 60)), 'début dans a');
assert.ok(sxOverlap(a, mk('2026-09-25T16:00:00Z', 'once', 120)), 'fin dans a');
assert.ok(sxOverlap(a, mk('2026-09-25T16:00:00Z', 'once', 300)), 'a inclus');
assert.ok(!sxOverlap(a, mk('2026-09-25T19:00:00Z', 'once', 60)), 'juste après');
assert.ok(!sxOverlap(a, mk('2026-09-25T15:00:00Z', 'once', 120)), 'juste avant');
assert.ok(sxOverlap(a, a), 'une séance chevauche elle-même');

// ── Personnages proposés ──────────────────────────────────────────────────────
// « * » en tête marque un rôle obligatoire, et disparaît du nom.
{
    const roles = sxParseRoles("* Kaelen\nYrsa\n\n  * Bron  \n");
    assert.strictEqual(roles.length, 3);
    assert.deepStrictEqual(roles.map(r => r.name), ['Kaelen', 'Yrsa', 'Bron']);
    assert.deepStrictEqual(roles.map(r => r.mandatory), [true, false, true]);
    assert.strictEqual(new Set(roles.map(r => r.id)).size, 3, 'ids non uniques');
    assert.deepStrictEqual(sxParseRoles(''), []);
}

// ── Rôles obligatoires ────────────────────────────────────────────────────────
// « Obligatoire » veut dire pourvu à la fin, pas pourvu en premier. Sur 5 places et
// 2 rôles obligatoires, le menu reste libre tant qu'il reste plus de 2 places ;
// les 2 dernières ne peuvent plus servir qu'à pourvoir les rôles restants.
{
    const seats = n => sxMandatoryForced(n, 2);
    assert.deepStrictEqual([5, 4, 3].map(seats), [false, false, false], 'encore libre au-dessus du seuil');
    assert.deepStrictEqual([2, 1].map(seats), [true, true], '2 dernières réservées');

    // Un rôle obligatoire pris entre-temps rend une place à la liberté.
    assert.strictEqual(sxMandatoryForced(2, 1), false, '2 places, 1 rôle : encore libre');
    assert.strictEqual(sxMandatoryForced(1, 1), true, 'dernière place, dernier rôle');

    // Sans rôle obligatoire vacant, rien n'est jamais forcé — pas même sur la
    // dernière place, ni sur une séance déjà complète.
    assert.strictEqual(sxMandatoryForced(1, 0), false);
    assert.strictEqual(sxMandatoryForced(0, 0), false);

    // Un rôle obligatoire pris pendant la phase libre REPOUSSE la fenêtre réservée
    // d'une place, puisque `unfilled` est recompté à chaque fois et non figé à la
    // création. Cinq places, deux rôles obligatoires, le premier inscrit prend
    // Kaelen de lui-même : plus rien n'est forcé jusqu'à la dernière place.
    const ladder = (seats, unfilled) => sxMandatoryForced(seats, unfilled);
    assert.deepStrictEqual([[5,2],[4,1],[3,1],[2,1],[1,1]].map(a => ladder(...a)),
                           [false, false, false, false, true], 'un obligatoire pris tôt');
    // Les deux pris tôt : aucune place n'est jamais réservée.
    assert.deepStrictEqual([[3,0],[2,0],[1,0]].map(a => ladder(...a)),
                           [false, false, false], 'les deux obligatoires pris tôt');
}

console.log('aria-sessions self-check: all assertions passed');
