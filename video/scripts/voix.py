#!/usr/bin/env python3
"""Génère la voix off, une scène = un fichier, depuis voix/script.md.

Synthèse LOCALE avec Piper (https://github.com/OHF-Voice/piper1-gpl) et la voix
fr_FR-siwis-medium (voir README.md › Licences). Rien ne part sur le réseau.

    python3 scripts/voix.py --modele /chemin/fr_FR-siwis-medium.onnx [--vitesse 1.06]

Sortie, pour chaque scène <id> :
  public/voix/<id>.wav   la voix (mono, 16 bits, fréquence du modèle) ;
  public/voix/<id>.json  le minutage des phrases { phrases: [{debut, fin}], duree }.

Le .json est facultatif : avec une autre voix (un autre moteur, un enregistrement
humain), dépose seulement les .wav ; le montage répartira les sous-titres au
prorata du texte. Ou fournis ton propre .json, même forme.
"""
import argparse
import json
import os
import re
import sys
import wave

import numpy as np

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.dirname(ICI)
SCRIPT = os.path.join(RACINE, "voix", "script.md")
PRONONCIATIONS = os.path.join(RACINE, "voix", "prononciations.json")
SORTIE = os.path.join(RACINE, "public", "voix")


def lire_script(chemin):
    """[(id, [phrase, …]), …] — mêmes règles que scripts/minutage.mjs."""
    scenes, courante = [], None
    with open(chemin, encoding="utf-8") as f:
        for ligne in f:
            ligne = ligne.rstrip("\n")
            m = re.match(r"^##\s+(\S+)\s*$", ligne)
            if m:
                courante = (m.group(1), [])
                scenes.append(courante)
            elif courante and ligne.startswith("- "):
                courante[1].append(ligne[2:].strip())
    return scenes


def prononcer(texte, remplacements):
    # Les clés les plus longues d'abord (« Claude Code » avant « Claude »).
    for cle in sorted(remplacements, key=len, reverse=True):
        texte = re.sub(r"(?<!\w)" + re.escape(cle) + r"(?!\w)", remplacements[cle], texte)
    return texte


def rogner(audio, sr, seuil=0.012, marge=0.03):
    """Retire le silence au début et à la fin d'une phrase (garde 30 ms)."""
    if audio.size == 0:
        return audio
    absolu = np.abs(audio.astype(np.float32) / 32768.0)
    fort = np.where(absolu > seuil)[0]
    if fort.size == 0:
        return audio[:0]
    m = int(marge * sr)
    return audio[max(0, fort[0] - m): min(audio.size, fort[-1] + m)]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--modele", default=os.environ.get("REMY_VOIX_MODELE") or os.path.join(RACINE, "voix", "modele", "fr_FR-siwis-medium.onnx"), help="chemin du .onnx Piper (défaut : voix/modele/, ou REMY_VOIX_MODELE)")
    p.add_argument("--vitesse", type=float, default=1.0, help="length_scale de Piper : > 1 = plus lent")
    p.add_argument("--pause", type=float, default=0.38, help="silence entre deux phrases, en secondes")
    p.add_argument("--scene", action="append", help="ne régénérer que cette scène (répétable)")
    a = p.parse_args()
    if not a.modele or not os.path.exists(a.modele):
        sys.exit("Modèle introuvable : passe --modele /chemin/fr_FR-siwis-medium.onnx (voir README.md › Voix).")

    from piper import PiperVoice, SynthesisConfig  # importé ici : --help marche sans Piper

    voix = PiperVoice.load(a.modele)
    config = SynthesisConfig(length_scale=a.vitesse, noise_scale=0.6, noise_w_scale=0.75)
    with open(PRONONCIATIONS, encoding="utf-8") as f:
        remplacements = json.load(f)["remplacements"]
    os.makedirs(SORTIE, exist_ok=True)

    for ident, phrases in lire_script(SCRIPT):
        if a.scene and ident not in a.scene:
            continue
        morceaux, minutage, t, sr = [], [], 0.0, None
        for i, phrase in enumerate(phrases):
            dit = prononcer(phrase, remplacements)
            bouts = []
            for chunk in voix.synthesize(dit, syn_config=config):
                sr = chunk.sample_rate
                bouts.append(np.frombuffer(chunk.audio_int16_bytes, dtype=np.int16))
            audio = rogner(np.concatenate(bouts) if bouts else np.zeros(0, np.int16), sr)
            if i > 0:
                silence = np.zeros(int(a.pause * sr), np.int16)
                morceaux.append(silence)
                t += silence.size / sr
            minutage.append({"debut": round(t, 3), "fin": round(t + audio.size / sr, 3)})
            morceaux.append(audio)
            t += audio.size / sr
        # 80 ms d'air à la fin : la dernière syllabe n'est jamais coupée.
        morceaux.append(np.zeros(int(0.08 * sr), np.int16))
        tout = np.concatenate(morceaux)
        with wave.open(os.path.join(SORTIE, f"{ident}.wav"), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes(tout.tobytes())
        with open(os.path.join(SORTIE, f"{ident}.json"), "w", encoding="utf-8") as f:
            json.dump({"duree": round(tout.size / sr, 3), "phrases": minutage,
                       "voix": os.path.basename(a.modele), "vitesse": a.vitesse}, f, ensure_ascii=False, indent=1)
        print(f"{ident}: {tout.size / sr:5.2f} s, {len(phrases)} phrases")


if __name__ == "__main__":
    main()
