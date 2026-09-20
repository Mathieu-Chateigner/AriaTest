"""Verifie le modele auth + RLS sur un projet Supabase ARIA.

    SUPABASE_URL=... SUPABASE_ANON=... SUPABASE_SERVICE=... python specs/auth_rls.check.py

Les cles ne sont PAS dans ce fichier : celle de service contourne RLS, donc elle
n'a rien a faire dans un depot. Recuperer les trois valeurs avec
    supabase projects api-keys --project-ref <ref>

L'ordre compte : chaque refus est verifie AVANT le rattachement de la cle, sinon
le compte la possede legitimement et l'assertion ne prouve rien. Le script nettoie
derriere lui (cles remises a owner null, comptes de test supprimes).
"""
import base64, json, os, urllib.request, urllib.error

URL = os.environ["SUPABASE_URL"].rstrip("/")
ANON = os.environ["SUPABASE_ANON"]
SR = os.environ["SUPABASE_SERVICE"]


def req(path, key, token=None, data=None, method=None, prefer=None):
    r = urllib.request.Request(URL + path,
                               data=json.dumps(data).encode() if data is not None else None,
                               method=method or ("POST" if data is not None else "GET"))
    r.add_header("apikey", key)
    r.add_header("Authorization", "Bearer " + (token or key))
    r.add_header("Content-Type", "application/json")
    if prefer:
        r.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(r) as resp:
            b = resp.read().decode()
            return resp.status, (json.loads(b) if b.strip() else None)
    except urllib.error.HTTPError as e:
        b = e.read().decode()
        try:
            return e.code, json.loads(b)
        except Exception:
            return e.code, b[:200]


fails = []


def check(label, cond, detail=""):
    print(("  OK   " if cond else "  FAIL ") + label + (("  <- " + str(detail)) if not cond and detail else ""))
    if not cond:
        fails.append(label)


def account(email):
    st, body = req("/auth/v1/signup", ANON, data={"email": email, "password": "Test-1234-aria"})
    if st != 200 or not (body or {}).get("access_token"):
        st, body = req("/auth/v1/token?grant_type=password", ANON,
                       data={"email": email, "password": "Test-1234-aria"})
    return (body or {}).get("access_token")


# Reset: drop any owner set by a previous run, and the probe row.
req("/rest/v1/characters?id=eq.rls-probe", SR, method="DELETE")
req("/rest/v1/saves?owner=not.is.null", SR, data=None, method="PATCH")
r = urllib.request.Request(URL + "/rest/v1/saves?owner=not.is.null", method="PATCH",
                           data=json.dumps({"owner": None}).encode())
for k, v in (("apikey", SR), ("Authorization", "Bearer " + SR), ("Content-Type", "application/json")):
    r.add_header(k, v)
try:
    urllib.request.urlopen(r).read()
except urllib.error.HTTPError as e:
    print("reset:", e.read().decode()[:120])

# Le test a besoin de deux cles appartenant a deux personnes differentes. Il les
# seme lui-meme plutot que de compter sur les donnees en place : sur un projet
# vide il ne prouvait rien, et sur un projet peuple il devait deviner lesquelles
# etaient jetables.
FIXTURES = ["00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000b2"]


def seed():
    for i, k in enumerate(FIXTURES):
        req("/rest/v1/saves", SR, data={"save_key": k, "type": "player"},
            prefer="resolution=merge-duplicates,return=minimal")
        req("/rest/v1/characters", SR,
            data={"id": "rls-fixture-%d" % i, "save_key": k, "name": "Fixture %d" % i},
            prefer="resolution=merge-duplicates,return=minimal")


def unseed():
    for i, k in enumerate(FIXTURES):
        req("/rest/v1/characters?id=eq.rls-fixture-%d" % i, SR, method="DELETE")
        req("/rest/v1/saves?save_key=eq." + k, SR, method="DELETE")


unseed()
seed()
mine, theirs = FIXTURES
print("cle A :", mine)
print("cle B :", theirs)
print()

tok = account("aria-rls-a@example.com")
check("inscription/connexion sans confirmation par mail", bool(tok))
if not tok:
    raise SystemExit("stop")

st, rows = req("/rest/v1/characters?select=id", ANON, tok)
check("un compte neuf ne voit aucun personnage", rows == [], rows)

# Denials, asserted while the account owns nothing.
st, rows = req("/rest/v1/characters?select=id&save_key=eq." + theirs, ANON, tok)
check("lecture refusee sous une cle non rattachee", rows == [], rows)
st, _ = req("/rest/v1/characters", ANON, tok,
            data={"id": "rls-probe", "save_key": theirs, "name": "probe"}, prefer="return=minimal")
check("ecriture refusee sous une cle non rattachee", st in (401, 403), st)

# Claim, then the tree opens up.
st, ok = req("/rest/v1/rpc/claim_save_key", ANON, tok, data={"p_key": mine})
check("claim_save_key rattache la cle", ok is True, (st, ok))
st, rows = req("/rest/v1/characters?select=id,name", ANON, tok)
check("voit son personnage apres rattachement", len(rows or []) == 1, rows)
st, notes = req("/rest/v1/character_notes?select=id", ANON, tok)
st, state = req("/rest/v1/character_state?select=character_id", ANON, tok)
check("les enfants suivent (notes + etat lisibles)", isinstance(notes, list) and isinstance(state, list))
st, rows = req("/rest/v1/characters?select=id&save_key=eq." + theirs, ANON, tok)
check("la cle d'un tiers reste invisible apres rattachement", rows == [], rows)

# A second account cannot take a key that is already claimed.
tok2 = account("aria-rls-b@example.com")
st, ok2 = req("/rest/v1/rpc/claim_save_key", ANON, tok2, data={"p_key": mine})
check("un second compte ne peut pas reprendre une cle deja rattachee", ok2 is False, ok2)
st, rows = req("/rest/v1/characters?select=id", ANON, tok2)
check("et ne voit toujours rien", rows == [], rows)

# The overlay path: anon, no session.
st, srow = req("/rest/v1/saves?select=save_key,ably_key,type&save_key=eq." + mine, ANON)
check("overlay anonyme lit toujours sa ligne saves", st == 200 and isinstance(srow, list), (st, srow))
st, d = req("/rest/v1/saves?select=data&save_key=eq." + mine, ANON)
check("mais pas la colonne data", st in (401, 403), st)

req("/rest/v1/characters?id=eq.rls-probe", SR, method="DELETE")
print()
print("ECHECS:", fails if fails else "aucun")

# Nettoyage : fixtures retirees, cles non reclamees, comptes de test supprimes.
unseed()
r = urllib.request.Request(URL + "/rest/v1/saves?owner=not.is.null", method="PATCH",
                           data=json.dumps({"owner": None}).encode())
for k, v in (("apikey", SR), ("Authorization", "Bearer " + SR), ("Content-Type", "application/json")):
    r.add_header(k, v)
try:
    urllib.request.urlopen(r).read()
except urllib.error.HTTPError as e:
    print("cleanup saves:", e.read().decode()[:120])

st, users = req("/auth/v1/admin/users", SR)
for u in (users or {}).get("users", []):
    if u["email"].startswith("aria-rls-"):
        req("/auth/v1/admin/users/" + u["id"], SR, method="DELETE")
        print("compte de test supprime :", u["email"])
