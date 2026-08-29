// Self-check for the pure logic in aria-shared.js — the parts with real branching
// that no longer have a second copy to disagree with. Run it after touching the dice
// grammar or the roll-filter pills:
//
//     node js/aria-shared.selfcheck.js
//
// No framework and no build: it stubs the two browser globals aria-shared.js touches
// at load time, evals the file, and asserts. Everything else in that file needs a
// real DOM and is exercised by opening the panels.
const assert = require('assert');
const fs = require('fs');

// aria-shared.js is a classic script: eval it in this scope so its top-level
// declarations become visible here, with the globals it reads at load time stubbed.
global.window = { addEventListener() {} };
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const src = fs.readFileSync(__dirname + '/aria-shared.js', 'utf8');
const { rollDiceFormula, formulaToDiceSpec, rollPassesFilter, classify } =
    new Function(src + '\nreturn { rollDiceFormula, formulaToDiceSpec, rollPassesFilter, classify };')();

// ── Dice formulas ─────────────────────────────────────────────────────────────
// Flat terms are exact, so assert their totals directly.
assert.strictEqual(rollDiceFormula('5').total, 5);
assert.strictEqual(rollDiceFormula('2+3').total, 5);
assert.strictEqual(rollDiceFormula('10-4').total, 6);
assert.deepStrictEqual(rollDiceFormula(''), { total: 0, breakdown: '' });
assert.deepStrictEqual(rollDiceFormula(null), { total: 0, breakdown: '' });

// Dice terms are random, so assert the bounds and the breakdown shape instead.
for (let i = 0; i < 200; i++) {
    const r = rollDiceFormula('2d6+2');
    assert.ok(r.total >= 4 && r.total <= 14, 'total out of range: ' + r.total);
    assert.match(r.breakdown, /^\[\d+\+\d+\] \+2$/, 'bad breakdown: ' + r.breakdown);

    const neg = rollDiceFormula('1d4-1');
    assert.ok(neg.total >= 0 && neg.total <= 3, 'negative modifier: ' + neg.total);
    assert.match(neg.breakdown, /^\[\d+\] −1$/, 'bad breakdown: ' + neg.breakdown);
}
// Whitespace and case are normalised away.
assert.match(rollDiceFormula(' 3 D 4 ').breakdown, /^\[\d+\+\d+\+\d+\]$/);

// The dddice hand-off sees the same grammar: dice flattened, modifier kept.
assert.deepStrictEqual(formulaToDiceSpec('2d6+2'), { dice: ['d6', 'd6'], modifier: 2 });
assert.deepStrictEqual(formulaToDiceSpec('1d8-1'), { dice: ['d8'], modifier: -1 });
assert.deepStrictEqual(formulaToDiceSpec('5'),     { dice: [], modifier: 5 });
assert.deepStrictEqual(formulaToDiceSpec(''),      { dice: [], modifier: 0 });
// A bare number formula has no dice, which is the signal rollWeaponDamage uses to
// skip dddice and roll locally.
assert.strictEqual(formulaToDiceSpec('7').dice.length, 0);

// ── Roll filter pills ─────────────────────────────────────────────────────────
// The regression this replaced: the GM's copy ended in `has(type)`, so a critical
// success vanished while "Succès" was lit. Succès/Échec include their crits.
const critSuccess = { roll: 5,  threshold: 50, success: true  };   // <=10 and success
const critFail    = { roll: 95, threshold: 50, success: false };   // >=91 and failure
const plainOk     = { roll: 40, threshold: 50, success: true  };
const plainFail   = { roll: 60, threshold: 50, success: false };
const die         = { roll: 4,  threshold: null, success: null };
assert.strictEqual(classify(5, 50, true), 'crit-success');   // guards the fixtures
assert.strictEqual(classify(95, 50, false), 'crit-fail');

const S = (...k) => new Set(k);
// Empty filter passes everything, dice rolls included.
for (const e of [critSuccess, critFail, plainOk, plainFail, die])
    assert.ok(rollPassesFilter(e, S()), 'empty filter must pass everything');

assert.ok(rollPassesFilter(critSuccess, S('success')), 'Succès must include crit successes');
assert.ok(rollPassesFilter(critFail,    S('fail')),    'Échec must include crit failures');
assert.ok(rollPassesFilter(plainOk,     S('success')));
assert.ok(rollPassesFilter(plainFail,   S('fail')));
assert.ok(rollPassesFilter(critSuccess, S('crit')));
assert.ok(rollPassesFilter(critFail,    S('crit')));

assert.ok(!rollPassesFilter(plainFail, S('success')));
assert.ok(!rollPassesFilter(plainOk,   S('fail')));
assert.ok(!rollPassesFilter(plainOk,   S('crit')), 'a plain success is not a crit');
// Dice rolls (threshold null) answer only to the Dés pill.
assert.ok(rollPassesFilter(die, S('die')));
assert.ok(!rollPassesFilter(die, S('success')));
assert.ok(!rollPassesFilter(plainOk, S('die')));
// Pills combine as a union.
assert.ok(rollPassesFilter(die, S('success', 'die')));
assert.ok(rollPassesFilter(plainFail, S('success', 'fail')));

// ── Map filters (aria-supabase.js) ────────────────────────────────────────────
// Loaded by all four pages, so both filters are written once. They decide what each
// spectator sees; a divergence here is a leak on stream.
const sbSrc = fs.readFileSync(__dirname + '/aria-supabase.js', 'utf8');
const { visiblePois, fogZones } =
    new Function(sbSrc + '\nreturn { visiblePois, fogZones };')();

const poiA = { id: 'a', name: 'Taverne', x: 10, y: 10, publicDesc: 'ok', discoveredBy: ['alice'], zone: [] };
const poiB = { id: 'b', name: 'Crypte',  x: 20, y: 20, publicDesc: '',   discoveredBy: ['bob'],   zone: [[0,0],[10,0],[10,10]] };
const poiC = { id: 'c', name: 'Secret',  x: 30, y: 30, publicDesc: '',   discoveredBy: [],        zone: [] };
const mapState = { pois: [poiA, poiB, poiC], fog: [], positions: {}, players: {} };

// 1. A player sees only the POIs whose discoveredBy contains them.
assert.deepStrictEqual(visiblePois(mapState, 'alice').map(p => p.id), ['a']);
assert.deepStrictEqual(visiblePois(mapState, 'bob').map(p => p.id),   ['b']);
// 2. The table view (null charId) sees the union of every discovery.
assert.deepStrictEqual(visiblePois(mapState, null).map(p => p.id), ['a', 'b']);
// 3. A POI nobody has discovered appears in neither view.
assert.ok(!visiblePois(mapState, 'alice').some(p => p.id === 'c'));
assert.ok(!visiblePois(mapState, null).some(p => p.id === 'c'));
// 4. An empty pois list does not throw.
assert.deepStrictEqual(visiblePois({ pois: [] }, 'alice'), []);
assert.deepStrictEqual(visiblePois({ pois: [] }, null), []);

// state.pois carries what at least one player discovered, state.fog what nobody did but
// which has a zone. fogZones() recomposes, per spectator, the set of black districts.
const fogState = {
    pois: [poiA, poiB],                            // a: alice, b: bob (b has a zone)
    fog:  [{ id: 'd', zone: [[50,50],[60,50],[60,60]] }],   // nobody discovered d
};
// 5. A POI nobody discovered, with a zone, is in the fog.
assert.ok(fogZones(fogState, 'alice').some(z => z.id === 'd'));
assert.ok(fogZones(fogState, null).some(z => z.id === 'd'));
// 6. A POI Bob discovered and Alice did not is in Alice's fog, not in Bob's.
assert.ok(fogZones(fogState, 'alice').some(z => z.id === 'b'));
assert.ok(!fogZones(fogState, 'bob').some(z => z.id === 'b'));
// 7. An undiscovered POI WITHOUT a zone shows up nowhere — neither clear nor fogged.
assert.ok(!visiblePois(fogState, 'alice').some(p => p.id === 'c'));
assert.ok(!fogZones(fogState, 'alice').some(z => z.id === 'c'));
// 8. No fog entry carries a name or a description. This is the assertion that guards the
//    "geometry only" rule: a player must be able to draw a black district without
//    learning anything about what is in it.
for (const z of fogZones(fogState, 'alice')) {
    assert.deepStrictEqual(Object.keys(z).sort(), ['id', 'zone']);
    assert.strictEqual(z.name, undefined);
    assert.strictEqual(z.publicDesc, undefined);
}

console.log('aria-shared self-check: all assertions passed');
