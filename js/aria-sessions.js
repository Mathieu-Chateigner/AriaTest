// ═══════════════════════════════════════════
//  ARIA — RENDEZ-VOUS (tableau d'affichage des séances)
// ═══════════════════════════════════════════
// Chargé après aria-supabase.js et aria-shared.js. De shared, cette page ne se sert
// que de trois choses : el()/fill() pour construire le DOM sans jamais concaténer de
// markup, uid(), et surtout makeChat() — le fil « Général » et le fil privé avec le
// MJ sont exactement les mêmes objets que dans les deux panneaux (mêmes canaux Ably,
// même table campaign_chat, mêmes identifiants de fil), pas une seconde messagerie.
//
// Tout ce qui est propre à cette page porte le préfixe sx-, parce qu'un nom déclaré
// en haut de aria-shared.js et redéclaré ici serait une SyntaxError qui tuerait les
// deux fichiers (voir CLAUDE.md, « aria-shared.js »).
//
// Le tableau est public pour tout compte connecté : une annonce doit pouvoir être lue
// par ceux qu'on invite. L'écriture, elle, est nominative (specs/campaign_sessions.sql).

const SX_REC_LABEL = {
    once:     'One shot',
    weekly:   'Hebdomadaire',
    biweekly: 'Bimensuel',
    monthly:  'Mensuel',
};

let sxSessions = [];      // toutes les séances du tableau
let sxSignups  = [];      // toutes les inscriptions des séances affichées
let sxChatCode = '';      // code de campagne dont la discussion est ouverte
let sxSelf     = { id: '', name: '' };   // notre identité dans cette discussion
let sxAbly     = null;

// ARIA.joinCode() est ce qui nomme les canaux Ably et filtre la lecture de
// campaign_chat. Sur cette page, c'est la campagne dont la discussion est ouverte.
ARIA.joinCode = () => sxChatCode;
// makeChat() ne montre le fil courant que si son volet est ouvert ; ici il l'est
// toujours, la colonne de droite n'a rien d'autre à afficher.
openPanes = ['tab-chat'];

const sxChat = makeChat({
    selfId:   () => sxSelf.id,
    selfName: () => sxSelf.name,
    contacts: () => sxContacts(),
});

// ═══════════════════════════════════════════
//  DATES
// ═══════════════════════════════════════════
// Il n'y a pas de table d'occurrences : starts_at porte la première séance et
// recurrence la cadence, donc la prochaine date se calcule ici. On s'inscrit à la
// série, pas à une date (ponytail, voir specs/campaign_sessions.sql).
function sxNextStart(s) {
    const dur = (+s.duration_min || 0) * 60000;
    const d = new Date(Date.parse(s.starts_at) || 0);
    if (s.recurrence === 'once') return d.getTime();
    const now = Date.now();
    // setDate / setMonth plutôt qu'une addition de millisecondes : une séance
    // hebdomadaire doit rester à la même heure locale de part et d'autre d'un
    // changement d'heure.
    let guard = 0;
    while (d.getTime() + dur < now && guard++ < 600) {
        if (s.recurrence === 'monthly') d.setMonth(d.getMonth() + 1);
        else d.setDate(d.getDate() + (s.recurrence === 'biweekly' ? 14 : 7));
    }
    return d.getTime();
}

function sxEnd(s) { return sxNextStart(s) + (+s.duration_min || 0) * 60000; }

function sxIsOver(s) { return s.recurrence === 'once' && sxEnd(s) < Date.now(); }

const _sxFmt = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});
function sxWhen(s) {
    const t = sxNextStart(s);
    const h = Math.floor((+s.duration_min || 0) / 60), m = (+s.duration_min || 0) % 60;
    return _sxFmt.format(new Date(t)) + ' · ' + (h ? h + 'h' + (m ? String(m).padStart(2, '0') : '') : m + 'min');
}

// Deux séances se chevauchent si l'une commence avant que l'autre finisse.
function sxOverlap(a, b) {
    return sxNextStart(a) < sxEnd(b) && sxNextStart(b) < sxEnd(a);
}

// ═══════════════════════════════════════════
//  DONNÉES
// ═══════════════════════════════════════════
const sxById       = id => sxSessions.find(s => s.id === id);
const sxSignupsOf  = id => sxSignups.filter(g => g.session_id === id);
const sxMine       = id => sxSignupsOf(id).find(g => g.user_id === sbUserId());
const sxIsHost     = s  => s && s.host_id === sbUserId();

async function sxLoad() {
    sxSessions = await sbSelect('campaign_sessions', 'select=*&order=starts_at.asc');
    sxSessions = sxSessions.filter(s => !sxIsOver(s));
    sxSessions.sort((a, b) => sxNextStart(a) - sxNextStart(b));
    sxSignups = sxSessions.length
        ? await sbSelect('session_signups',
            'select=*&session_id=in.(' + sxSessions.map(s => encodeURIComponent(s.id)).join(',') + ')')
        : [];
}

// Les séances auxquelles je participe — celles que j'anime comprises : un MJ ne peut
// pas non plus mener deux tables à la même heure.
function sxMySessions() {
    return sxSessions.filter(s => sxIsHost(s) || sxMine(s.id));
}

// Les codes de campagne dont la discussion m'est ouverte.
function sxMyCodes() {
    return [...new Set(sxMySessions().map(s => (s.join_code || '').toUpperCase()).filter(Boolean))];
}

// ═══════════════════════════════════════════
//  PERSONNAGES
// ═══════════════════════════════════════════
// Deux origines, et la différence compte pour la discussion : un personnage proposé
// par l'hôte porte un id inventé ici, alors qu'un personnage déjà joué dans ce
// navigateur porte son vrai charId — celui dont le panneau joueur se sert comme
// identifiant de fil. S'inscrire avec le second fait que la conversation privée avec
// le MJ est *la même* des deux côtés.
function sxLocalCharacters() {
    try { return JSON.parse(localStorage.getItem('aria-characters') || '[]'); }
    catch (_) { return []; }
}

const sxRoles = s => Array.isArray(s.characters) ? s.characters : [];
const sxTakenBy = (id, roleId) => sxSignupsOf(id).find(g => g.char_id === roleId);

// « Obligatoire » veut dire pourvu à la fin, pas pourvu en premier : la table doit
// compter son prêtre et son éclaireuse au complet, peu importe dans quel ordre les
// joueurs arrivent. Tant qu'il reste plus de places que de rôles obligatoires
// vacants, chacun choisit librement ; dès que les deux nombres se rejoignent, les
// dernières places ne peuvent plus servir qu'à les pourvoir.
function sxFreeMandatory(s) {
    return sxRoles(s).filter(r => r.mandatory && !sxTakenBy(s.id, r.id));
}

const sxSeatsLeft = s => (+s.max_players || 0) - sxSignupsOf(s.id).length;

// Prendre un rôle optionnel laisserait seatsLeft - 1 places pour `unfilled` rôles
// obligatoires : c'est admissible tant que seatsLeft - 1 >= unfilled.
function sxMandatoryForced(seatsLeft, unfilled) { return unfilled > 0 && seatsLeft <= unfilled; }

// Ce que le menu déroulant propose à qui n'est pas encore inscrit.
function sxOptions(s) {
    const free = sxRoles(s).filter(r => !sxTakenBy(s.id, r.id));
    const mandatory = free.filter(r => r.mandatory);
    if (sxMandatoryForced(sxSeatsLeft(s), mandatory.length)) {
        return mandatory.map(r => ({ id: r.id, name: r.name, mandatory: true }));
    }
    const mine = sxLocalCharacters().map(c => ({ id: c.id, name: c.name + ' (mon personnage)' }));
    return [...free.map(r => ({ id: r.id, name: r.name })), ...mine,
            { id: '', name: 'Sans personnage' }];
}

// ═══════════════════════════════════════════
//  RENDU DU TABLEAU
// ═══════════════════════════════════════════
function sxRender() {
    const list = document.getElementById('sx-list');
    document.getElementById('sx-count').textContent =
        sxSessions.length ? sxSessions.length + ' annoncée' + (sxSessions.length > 1 ? 's' : '') : '';
    if (!sxSessions.length) {
        fill(list, el('div', { className: 'sx-empty', textContent: 'Aucun rendez-vous annoncé. Créez le premier.' }));
    } else {
        fill(list, sxSessions.map(sxCard));
    }
    sxRenderChatBar();
}

function sxCard(s) {
    const signups = sxSignupsOf(s.id);
    const mine = sxMine(s.id);
    const host = sxIsHost(s);
    const full = signups.length >= (+s.max_players || 0);

    return el('div', { className: 'sx-card' + (mine || host ? ' mine' : '') },
        el('div', { className: 'sx-card-head' },
            el('div', { className: 'sx-card-title', textContent: s.title || 'Séance' }),
            el('div', { className: 'sx-when', textContent: sxWhen(s) })),

        el('div', { className: 'sx-meta' },
            el('span', { className: 'sx-chip accent', textContent: s.join_code || '—' }),
            el('span', { className: 'sx-chip', textContent: SX_REC_LABEL[s.recurrence] || s.recurrence }),
            el('span', { className: 'sx-chip' + (full ? ' full' : ''),
                         textContent: signups.length + ' / ' + (s.max_players || 0) + ' joueurs' }),
            el('span', { className: 'sx-chip', textContent: 'MJ ' + (s.host_name || '—') })),

        s.description && el('div', { className: 'sx-desc', textContent: s.description }),

        sxRoles(s).length && el('div', { className: 'sx-roles' }, sxRoles(s).map(r => {
            const by = sxTakenBy(s.id, r.id);
            return el('div', { className: 'sx-role' + (r.mandatory ? ' mandatory' : '') + (by ? ' taken' : '') },
                el('span', { textContent: r.name }),
                r.mandatory && el('span', { className: 'sx-role-tag', textContent: 'obligatoire' }),
                by && el('span', { className: 'sx-role-by', textContent: '— ' + (by.player_name || 'pris') }));
        })),

        signups.length && el('div', { className: 'sx-players' }, signups.map(g => el('span', {
            className: 'sx-player' + (g.user_id === sbUserId() ? ' me' : ''),
            textContent: (g.player_name || '—') + (g.char_name ? ' · ' + g.char_name : ''),
        }))),

        sxActions(s, mine, host));
}

function sxActions(s, mine, host) {
    const row = el('div', { className: 'sx-actions' });

    if (mine) {
        row.append(
            el('span', { className: 'sx-note', textContent: 'Vous êtes inscrit' + (mine.char_name ? ' — ' + mine.char_name : '') + '.' }),
            el('button', { className: 'sx-btn ghost', textContent: 'Se désinscrire', onclick: () => sxLeave(s.id) }));
    } else if (host) {
        row.append(el('span', { className: 'sx-note', textContent: 'Vous animez cette séance.' }));
    } else {
        // Le bouton dit non pour les mêmes raisons que sxJoin(), parce que c'est la
        // même fonction — un « S'inscrire » actif qui finit sur une alerte est un
        // bouton qui ment.
        const hard = sxHardRefusal(s);
        const opts = sxOptions(s);
        const sel = el('select', { className: 'sx-select', id: 'sx-pick-' + s.id },
            opts.map(o => el('option', { value: o.id, textContent: o.name })));

        if (hard) {
            row.append(el('span', { className: 'sx-note bad', textContent: hard }));
        } else {
            const mand = sxFreeMandatory(s);
            const forced = sxMandatoryForced(sxSeatsLeft(s), mand.length);
            const plural = mand.length > 1 ? 's' : '';
            if (forced) row.append(el('span', { className: 'sx-note',
                textContent: 'Dernière' + (sxSeatsLeft(s) > 1 ? 's places' : ' place') + ' : réservée' + (sxSeatsLeft(s) > 1 ? 's' : '') +
                             ' au' + (plural ? 'x' : '') + ' rôle' + plural + ' obligatoire' + plural + '.' }));
            else if (mand.length) row.append(el('span', { className: 'sx-note',
                textContent: mand.length + ' rôle' + plural + ' obligatoire' + plural + ' encore à pourvoir.' }));
            row.append(sel);
        }
        row.append(el('button', {
            className: 'sx-btn', textContent: 'S’inscrire',
            disabled: !!hard,
            onclick: () => sxJoin(s.id),
        }));
    }

    if (host) row.append(el('button', { className: 'sx-btn danger', textContent: 'Supprimer', onclick: () => sxRemove(s.id) }));
    return row;
}

// ═══════════════════════════════════════════
//  INSCRIPTION
// ═══════════════════════════════════════════
// Toutes les règles d'inscription sont relues juste avant l'écriture, jamais sur
// l'état affiché. Un onglet montre ce qu'il a lu en arrivant, et deux fenêtres du
// même compte n'en sont pas au même point : celle qui n'a pas servi croit encore la
// séance vide, le rôle libre et l'horaire dégagé. Refuser sur ce qu'elle affiche
// reviendrait à ne rien refuser du tout.
//
// Ce qui est vraiment garanti reste la contrainte unique (session_id, user_id) :
// quoi qu'il arrive, un compte n'occupe qu'une place par séance. Le reste se joue
// sur une relecture, donc sur la milliseconde plutôt que sur la durée de vie d'un
// onglet, et l'insertion refusée est rapportée au lieu d'être avalée.
//
// Les refus qu'aucun choix de personnage ne peut lever : la carte s'en sert pour
// griser le bouton et dire pourquoi, sxJoin() pour refuser. Une seule définition,
// donc le bouton ne peut pas promettre ce que l'inscription refuse.
function sxHardRefusal(s) {
    if (sxMine(s.id)) return 'Vous êtes déjà inscrit à cette séance — peut-être depuis une autre fenêtre.';
    if (sxIsHost(s)) return 'Vous animez cette séance.';
    const clash = sxMySessions().find(o => sxOverlap(o, s));
    if (clash) return 'Chevauche « ' + (clash.title || 'une séance') + ' » (' + sxWhen(clash) + ').';
    if (sxSeatsLeft(s) <= 0) return 'Complet.';
    return '';
}

// Et ceux qui dépendent du personnage choisi, connus seulement au clic.
function sxJoinRefusal(s, charId) {
    const hard = sxHardRefusal(s);
    if (hard) return hard;
    if (charId && sxTakenBy(s.id, charId)) return 'Ce personnage vient d’être pris.';
    if (sxMandatoryForced(sxSeatsLeft(s), sxFreeMandatory(s).length)
        && !sxRoles(s).some(r => r.id === charId && r.mandatory)) {
        return 'Il ne reste plus que des places réservées aux personnages obligatoires.';
    }
    return '';
}

async function sxJoin(id) {
    // Le menu est lu avant la relecture : sxRender() le remplace, et sa valeur est
    // le choix du joueur, pas un fait du serveur.
    const sel = document.getElementById('sx-pick-' + id);
    const charId = sel ? sel.value : '';
    const charName = sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].text.replace(' (mon personnage)', '') : '';

    await sxLoad();
    const s = sxById(id);
    if (!s) { sxRender(); alert('Cette séance n’existe plus.'); return; }
    const refusal = sxJoinRefusal(s, charId);
    if (refusal) { sxRender(); alert(refusal); return; }

    const ok = await sbInsert('session_signups', {
        id: id + ':' + sbUserId(),
        session_id: id,
        player_name: sxMyName(),
        char_id: charId || null,
        char_name: charId ? charName : null,
    });
    await sxRefresh();
    if (!ok) {
        alert('Inscription refusée — la séance a changé entre-temps. Le tableau est à jour.');
        return;
    }
    // S'inscrire ouvre la discussion de la campagne : c'est le point de la manœuvre.
    sxOpenChat((s.join_code || '').toUpperCase());
}

async function sxLeave(id) {
    await sbDelete('session_signups', 'id=eq.' + encodeURIComponent(id + ':' + sbUserId()));
    await sxRefresh();
    if (!sxMyCodes().includes(sxChatCode)) sxOpenChat(sxMyCodes()[0] || '');
}

async function sxRemove(id) {
    const s = sxById(id);
    if (!s || !confirm('Supprimer « ' + (s.title || 'cette séance') + ' » et toutes ses inscriptions ?')) return;
    await sbDelete('campaign_sessions', 'id=eq.' + encodeURIComponent(id));
    await sxRefresh();
    if (!sxMyCodes().includes(sxChatCode)) sxOpenChat(sxMyCodes()[0] || '');
}

async function sxRefresh() {
    await sxLoad();
    sxRender();
}

function sxMyName() {
    return (sbUserEmail() || '').split('@')[0] || 'Joueur';
}

// ═══════════════════════════════════════════
//  FORMULAIRE
// ═══════════════════════════════════════════
function sxOpenForm() {
    const now = new Date(Date.now() + 36e5);
    now.setMinutes(0, 0, 0);
    // toISOString() donnerait l'heure UTC, et datetime-local attend l'heure locale.
    const pad = n => String(n).padStart(2, '0');
    document.getElementById('sx-f-when').value =
        `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    ['title', 'desc', 'chars'].forEach(k => document.getElementById('sx-f-' + k).value = '');
    document.getElementById('sx-f-dur').value = '180';
    document.getElementById('sx-f-max').value = '5';
    document.getElementById('sx-f-rec').value = 'once';
    sxFormError('');

    // Les campagnes du MJ vivent dans ce navigateur : proposer leur code évite de le
    // recopier à la main, là où une faute de frappe créerait une campagne fantôme.
    let mine = [];
    try { mine = JSON.parse(localStorage.getItem('aria-gm-campaigns') || '[]'); } catch (_) {}
    const codes = mine.filter(c => c.joinCode);
    document.getElementById('sx-f-code').value = codes.length ? codes[0].joinCode : '';
    document.getElementById('sx-f-code-hint').textContent = codes.length
        ? 'Vos campagnes : ' + codes.map(c => c.joinCode + ' (' + c.name + ')').join(', ')
        : 'Le code que les joueurs saisissent pour lier leur personnage.';

    document.getElementById('sx-scrim').classList.add('show');
    document.getElementById('sx-f-title').focus();
}

function sxCloseForm() { document.getElementById('sx-scrim').classList.remove('show'); }
function sxScrimClick(e) { if (e.target === document.getElementById('sx-scrim')) sxCloseForm(); }

function sxFormError(msg) {
    const box = document.getElementById('sx-f-err');
    box.textContent = msg;
    box.style.display = msg ? '' : 'none';
}

// « * Kaelen » → { id, name:'Kaelen', mandatory:true }
function sxParseRoles(text) {
    return String(text || '').split('\n').map(l => l.trim()).filter(Boolean).map(line => {
        const mandatory = line.startsWith('*');
        return { id: uid(), name: line.replace(/^\*\s*/, '').slice(0, 80), mandatory };
    });
}

async function sxSubmitForm() {
    const v = k => document.getElementById('sx-f-' + k).value.trim();
    const title = v('title'), code = v('code'), when = v('when');
    if (!title) return sxFormError('Un titre, au moins.');
    if (!/^[A-Z0-9]{3,5}$/.test(code)) return sxFormError('Code de campagne : 3 à 5 caractères.');
    const t = Date.parse(when);
    if (!t) return sxFormError('Date et heure requises.');
    const dur = +v('dur') || 0, max = +v('max') || 0;
    if (dur < 15) return sxFormError('Durée : 15 minutes au minimum.');
    if (max < 1) return sxFormError('Il faut au moins une place.');

    const btn = document.getElementById('sx-f-save');
    btn.disabled = true;
    await sbInsert('campaign_sessions', {
        id: uid(),
        join_code: code,
        title,
        description: v('desc') || null,
        host_name: sxMyName(),
        starts_at: new Date(t).toISOString(),
        duration_min: dur,
        recurrence: document.getElementById('sx-f-rec').value,
        max_players: max,
        characters: sxParseRoles(v('chars')),
    });
    btn.disabled = false;
    sxCloseForm();
    await sxRefresh();
    sxOpenChat(code);
}

// ═══════════════════════════════════════════
//  DISCUSSION
// ═══════════════════════════════════════════
// Une campagne, deux fils : « Général » et le privé avec le MJ. Ce sont ceux des
// panneaux — makeChat() dérive l'id d'un fil privé des deux identités triées, donc
// les deux bouts le calculent pareil sans registre à partager.
//
// Notre identité dépend du rôle tenu dans cette campagne : l'hôte est 'gm' pour tout
// le monde (c'est ce que le panneau MJ publie), un joueur est son personnage. Sans
// personnage, un id stable dérivé du compte, pour que le fil survive au rechargement.
function sxIdentity(code) {
    const host = sxSessions.find(s => (s.join_code || '').toUpperCase() === code && sxIsHost(s));
    if (host) return { id: 'gm', name: host.host_name || sxMyName() };
    const g = sxSignups.find(x => x.user_id === sbUserId()
        && (sxById(x.session_id)?.join_code || '').toUpperCase() === code);
    if (g && g.char_id) return { id: g.char_id, name: g.char_name || sxMyName() };
    return { id: 'u_' + String(sbUserId() || '').replace(/-/g, '').slice(0, 16), name: sxMyName() };
}

// Les correspondants de la colonne de gauche. Un joueur n'en a qu'un : le MJ. L'hôte
// voit tous ses inscrits — ceux qui ont pris un personnage, seuls à avoir un fil.
function sxContacts() {
    if (!sxChatCode) return [];
    if (sxSelf.id === 'gm') {
        const seen = new Set();
        return sxSignups.filter(g => {
            const s = sxById(g.session_id);
            if (!s || (s.join_code || '').toUpperCase() !== sxChatCode) return false;
            if (!g.char_id || seen.has(g.char_id)) return false;
            seen.add(g.char_id);
            return true;
        }).map(g => ({ id: g.char_id, name: g.char_name || g.player_name || '—', online: false }));
    }
    return [{ id: 'gm', name: 'MJ', online: false }];
}

function sxOpenChat(code) {
    code = (code || '').toUpperCase();
    sxChat.reset();
    sxChatCode = code;
    sxSelf = code ? sxIdentity(code) : { id: '', name: '' };
    const has = !!code;
    document.getElementById('sx-chat-wrap').style.display = has ? '' : 'none';
    document.getElementById('sx-chat-none').style.display = has ? 'none' : '';
    sxRenderChatBar();
    if (!has) return;
    sxChat.attach(sxAbly);
    sxChat.load();
}

function sxRenderChatBar() {
    fill(document.getElementById('sx-chat-codes'), sxMyCodes().map(c => el('button', {
        className: 'sx-code-chip' + (c === sxChatCode ? ' active' : ''),
        textContent: c,
        onclick: () => sxOpenChat(c),
    })));
}

// ═══════════════════════════════════════════
//  DÉMARRAGE
// ═══════════════════════════════════════════
async function sxInit() {
    if (!sbSignedIn()) {
        document.getElementById('sx-gate').style.display = '';
        return;
    }
    document.getElementById('sx-layout').style.display = '';
    document.getElementById('sx-new-btn').style.display = '';
    document.getElementById('sx-mail').textContent = sbUserEmail();

    await sbSyncAblyKey();
    await sxRefresh();

    // Le clientId n'est ici qu'une étiquette de connexion : cette page n'entre dans
    // aucun ensemble de présence, et un message de chat porte son authorId. Notre
    // identité de fil, elle, change avec la campagne ouverte — la connexion, non.
    if (config.ablyKey && window.Ably) {
        try {
            sxAbly = new Ably.Realtime({ key: config.ablyKey, clientId: 'rdv-' + uid().slice(0, 8) });
        } catch (e) { console.error('[SESSIONS] Ably:', e); }
    }
    sxOpenChat(sxMyCodes()[0] || '');
}

// Se déconnecter dans un autre onglet doit se voir ici : sans session, la page ne
// peut plus rien lire ni écrire.
window.addEventListener('storage', e => { if (e.key === 'aria-session') location.reload(); });

// Une fenêtre laissée de côté affiche ce qu'elle a lu en arrivant. Si l'inscription
// s'est faite dans l'autre, elle montre encore la place libre et le bouton actif —
// sxJoin() relit avant d'écrire, donc rien ne passe, mais autant que le tableau
// redevienne vrai au moment où on le regarde. La page est un tableau d'affichage :
// une relecture au retour suffit, il n'y a rien à abonner en temps réel.
//
// Les deux événements, parce qu'ils ne couvrent pas le même cas : deux fenêtres
// côte à côte restent toutes deux `visible`, et seul `focus` distingue celle où l'on
// clique ; changer d'onglet dans une même fenêtre, à l'inverse, passe par
// `visibilitychange`. Un aller-retour rapide peut relire deux fois, ce qui coûte
// deux requêtes et rend le même tableau.
const sxRefreshOnReturn = () => { if (!document.hidden && sbSignedIn()) sxRefresh(); };
window.addEventListener('focus', sxRefreshOnReturn);
document.addEventListener('visibilitychange', sxRefreshOnReturn);

sxInit();
