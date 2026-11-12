# Vidéo de présentation de Rémy

Une vidéo d'annonce de ~99 s (1920 × 1080, 30 i/s, en français), **programmée**
avec [Remotion](https://www.remotion.dev) : chaque scène est un composant React,
la voix off est synthétisée **localement**, la musique et les bruitages sont
**générés par le code** (aucun échantillon). Toutes les données montrées sont
fictives (Sam, Léa, Hugo, « Boutiques », « Voyage à Porto »…).

Ce dossier est autonome : son propre `package.json`, son propre `node_modules`.
Il ne touche pas au reste du dépôt.

## Installer

```bash
cd video
npm ci                 # Remotion 4.0.539, React 19
npm run installer-voix # une fois : Piper (Python, dans .venv-voix/) + la voix française (~63 Mo, voix/modele/)
```

Il faut Node 18+, Python 3.9+ et `ffmpeg`/`ffprobe` dans le `PATH`.
Remotion télécharge son navigateur (Chrome Headless Shell) au premier rendu ;
pour utiliser un Chromium déjà installé :
`export REMOTION_NAVIGATEUR=/chemin/vers/chrome-headless-shell`.

## Fabriquer la vidéo

```bash
npm run voix     # voix/script.md → public/voix/<scène>.wav (+ .json : minutage des phrases)
npm run rendu    # minutage → musique et bruitages → images → niveau final
                 # → sortie/remy-presentation.mp4 (REMY_SORTIE=/autre/dossier pour changer)
npm run studio   # prévisualiser et retoucher dans le navigateur (Remotion Studio)
npm run images -- /tmp/planche --scenes   # 3 images fixes par scène, pour relire vite
npm run verifier # TypeScript
```

Sans fichiers de voix, la vidéo se rend quand même (muette côté voix, sous-titrée,
durées estimées sur le texte).

## Comment c'est rangé

| Fichier | Rôle |
|---|---|
| `voix/script.md` | **Le texte unique** de la voix off et des sous-titres : une section `##` par scène, une ligne `- ` par phrase |
| `voix/prononciations.json` | Orthographes « à prononcer » pour la synthèse (« Rémy » → « Rémi », « Motion » → « Mo-cheune »…), jamais montrées à l'écran |
| `scripts/voix.py` | Synthèse Piper, un fichier par scène, minutage des phrases |
| `scripts/minutage.mjs` | Lit les durées **réelles** des fichiers de voix → `public/minutage.json` |
| `src/montage.js` | La ligne de temps : silences avant/après chaque scène, **repères** (apparitions et bruitages, relatifs aux phrases). Lu par la vidéo ET par la bande-son |
| `scripts/sons.mjs` | Musique (nappe, basse, percussions légères, montée avant le logo) baissée sous la voix, et bruitages calés sur les repères |
| `src/scenes/*.tsx` | Les 9 scènes ; `src/ecrans.tsx` les maquettes de l'app ; `src/ui.tsx` l'identité (couleurs et polices de `public/app/atelier.css`) |
| `scripts/rendu.mjs` | Rendu Remotion puis normalisation EBU R128 (−16 LUFS, crête −1,5 dBTP) sans réencoder l'image |

Tout se cale sur la voix : une phrase plus longue allonge sa scène, décale les
repères qui la suivent, la musique et ses baisses de volume.

## Changer la voix

1. **Autre texte** : modifie `voix/script.md` (garde les identifiants `##`), puis `npm run voix && npm run rendu`.
2. **Autre voix Piper** : `REMY_VOIX_MODELE=/chemin/autre-voix.onnx npm run voix` (vérifie sa licence dans son `MODEL_CARD`), ou `--vitesse 1.1` pour ralentir.
3. **Autre moteur, ou une vraie voix** : dépose un fichier par scène dans `public/voix/`
   (`01-probleme.wav` … `09-chez-toi.wav` ; `.mp3`, `.m4a`, `.ogg` acceptés).
   Supprime les `.json` voisins (ou fournis les tiens : `{ "phrases": [{ "debut": 0, "fin": 2.1 }, …] }`,
   en secondes, une entrée par phrase) : sans eux, les sous-titres sont répartis au prorata du texte.
   Puis `npm run rendu` — durées, musique et sous-titres suivent.

## Ce que la vidéo dit, et ce qui existe

La voix off ne dit rien de faux sur le présent : ce qui n'est pas encore livré
est dit au futur ou introduit par « bientôt », et porte à l'écran une pastille
**Bientôt** ou **En préparation** (classement automatique des priorités, feuille
« Prochaines heures », arbre « où on en est », appel par T3 Code, agent qui a
fini mis en avant). Ces écrans-là sont des **maquettes animées**.

## Licences de ce qui est embarqué ou utilisé

- **Remotion** (4.0.539) — [Remotion License](https://www.remotion.dev/docs/license) :
  gratuit pour un particulier et pour les entreprises de 3 personnes au plus ;
  au-delà, une licence entreprise est nécessaire. En ligne de commande, le rendu
  n'envoie aucune télémétrie tant qu'aucune clé de licence n'est fournie
  ([Telemetry](https://www.remotion.dev/docs/telemetry)).
- **Polices** : Inter, JetBrains Mono, Source Serif 4 — SIL Open Font License 1.1
  (copie de `public/fonts`, voir `public/fonts/LICENSE.txt`).
- **Synthèse vocale** : [Piper](https://github.com/OHF-Voice/piper1-gpl) (`piper-tts` 1.8.0,
  GPL-3.0-or-later), utilisé comme outil, ni modifié ni distribué ici.
- **Voix** : `fr_FR-siwis-medium` du dépôt [rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices),
  entraînée sur la *SIWIS French Speech Synthesis Database* (Yamagishi, Honnet,
  Garner, Lazaridis ; University of Edinburgh / Idiap) — **CC BY 4.0**
  (<https://datashare.is.ed.ac.uk/handle/10283/2353>). Attribution : « Voix de
  synthèse : Piper, voix SIWIS (CC BY 4.0) », reprise en fin de vidéo et à
  remettre dans la description de toute publication.
- **Musique et bruitages** : originaux, synthétisés par `scripts/sons.mjs` ; même licence que le dépôt.
- **Icônes et maquettes** : dessinées dans `src/` ; logo de Rémy (`public/icons`).
  Les noms T3 Code, Claude, ChatGPT et Motion désignent les outils auxquels
  Rémy se branche ; aucun de leurs logos n'est reproduit.

Pendant la fabrication, la prononciation a été contrôlée en retranscrivant la
voix avec Whisper en local (`faster-whisper`, modèle `small`, MIT) : un outil de
vérification, pas une dépendance du projet.
