#!/usr/bin/env python3
# Résumé des parcours (CI) : lit les pièces exportées du .xcresult
# (xcresulttool export attachments) et l'état de chaque test, range les
# captures sous leur nom « Pnn-étape » et écrit resume.md + resume.json.
#   python3 resume.py <pieces> <tests.json> <dossier-sortie>
import json
import os
import re
import shutil
import sys

pieces, fichier_tests, sortie = sys.argv[1], sys.argv[2], sys.argv[3]
captures = os.path.join(sortie, "captures")
os.makedirs(captures, exist_ok=True)


def charger(chemin):
    try:
        with open(chemin, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


# Les pièces : n'importe où dans le manifeste, un objet avec « exportedFileName ».
def pieces_de(noeud, test=None):
    if isinstance(noeud, dict):
        test = noeud.get("testIdentifier", test)
        if "exportedFileName" in noeud:
            yield test, noeud
        for v in noeud.values():
            yield from pieces_de(v, test)
    elif isinstance(noeud, list):
        for v in noeud:
            yield from pieces_de(v, test)


manifeste = charger(os.path.join(pieces, "manifest.json")) or []
mesures = {}
for test, p in pieces_de(manifeste):
    fichier = os.path.join(pieces, p["exportedFileName"])
    if not os.path.exists(fichier):
        continue
    nom = p.get("suggestedHumanReadableName") or p["exportedFileName"]
    base, ext = os.path.splitext(nom)
    # « P03-02-et-maintenant_0_3F2A…​ » → « P03-02-et-maintenant »
    base = re.sub(r"_\d+_[0-9A-Fa-f-]{36}$", "", base)
    if ext.lower() == ".json" or base.endswith("-mesures"):
        m = charger(fichier)
        if isinstance(m, dict) and m.get("id"):
            mesures[m["id"]] = m
        continue
    if ext.lower() in (".png", ".jpg", ".jpeg", ".heic"):
        shutil.copyfile(fichier, os.path.join(captures, base + ext.lower()))

# L'état des tests (xcresulttool get test-results tests).
etats = {}
echecs = {}


def parcourir(n):
    if isinstance(n, dict):
        if n.get("nodeType") == "Test Case":
            nom = n.get("name", "")
            etats[nom] = n.get("result", "?")
            msgs = [c.get("name", "") for c in n.get("children", []) if c.get("nodeType") == "Failure Message"]
            if msgs:
                echecs[nom] = msgs
        for v in n.values():
            parcourir(v)
    elif isinstance(n, list):
        for v in n:
            parcourir(v)


parcourir(charger(fichier_tests) or {})


def etat_de(m):
    test = (m.get("test") or "")
    for nom, e in etats.items():
        if nom and nom.split("(")[0] in test:
            return e, echecs.get(nom, [])
    return ("Passed" if m.get("reussi") else "Failed"), []


lignes = ["# Parcours de l'app iPhone (simulateur, tour de démo)", "",
          "| Parcours | Résultat | Gestes | Durée | Étapes | Constats |", "|---|---|--:|--:|--:|---|"]
resume = []
for pid in sorted(mesures):
    m = mesures[pid]
    etat, msgs = etat_de(m)
    constats = [c for c in m.get("constats", []) if not c.startswith("note : ")]
    notes = [c[7:] for c in m.get("constats", []) if c.startswith("note : ")]
    lignes.append(f"| {pid} {m.get('titre', '')} | {etat} | {m.get('gestes', 0)} | {m.get('secondes', 0):.0f} s | "
                  f"{len(m.get('etapes', []))} | {len(constats)} |")
    resume.append({**m, "etat": etat, "echecs": msgs, "constatsApp": constats, "notes": notes})

sans_mesures = [n for n in etats if not any((n.split("(")[0] in (m.get("test") or "")) for m in mesures.values())]
for n in sans_mesures:
    lignes.append(f"| {n} | {etats[n]} | — | — | — | — |")

lignes += ["", "## Étapes", ""]
for r in resume:
    lignes.append(f"### {r['id']} — {r.get('titre', '')} ({r['etat']})")
    for e in r.get("etapes", []):
        lignes.append(f"- {e['numero']:02d} {e['etape']} : {e['gestes']} geste(s), +{e['secondes']} s (total {e['secondesCumulees']} s)")
    for c in r["constatsApp"]:
        lignes.append(f"- **Constat** : {c}")
    for n in r["notes"]:
        lignes.append(f"- Note : {n}")
    for f in r["echecs"]:
        lignes.append(f"- Échec : {f}")
    lignes.append("")

total = len(etats) or len(resume)
reussis = sum(1 for e in etats.values() if e in ("Passed", "Expected Failure"))
lignes.insert(1, f"{reussis}/{total} parcours réussis · {sum(r.get('gestes', 0) for r in resume)} gestes · "
                 f"{sum(r.get('secondes', 0) for r in resume):.0f} s joués · {sum(len(r['constatsApp']) for r in resume)} constats")
with open(os.path.join(sortie, "resume.md"), "w", encoding="utf-8") as f:
    f.write("\n".join(lignes) + "\n")
with open(os.path.join(sortie, "resume.json"), "w", encoding="utf-8") as f:
    json.dump({"tests": etats, "parcours": resume}, f, ensure_ascii=False, indent=2)
print("\n".join(lignes[:4 + len(resume) + len(sans_mesures)]))
