# Rémy — repères pour Claude Code

Assistant personnel auto-hébergé (« directeur de cabinet », inspiré de Rémy
dans Ratatouille). Réponds en français, tutoie l'utilisateur.

## Ce dépôt est public : rien de personnel ici

Tout ce qui concerne la personne que Rémy accompagne reste sur sa machine (la
« tour »), jamais dans ce dépôt, ses PR, ses captures ou ses journaux de CI :

- mémoire, conversations, rappels : le coffre Obsidian (`REMY_VAULT`) et sa base `.remy/` ;
- secrets et réglages personnels : `%USERPROFILE%\.remy\remy.env` — dont `REMY_PRENOM`
  et `REMY_VOCABULAIRE`, lus par `lib/profil.js` ;
- vision, roadmap, notes privées : `%USERPROFILE%\.remy\prive\` (`REMY_PRIVE`, jamais
  lus par les sessions cloud) ;
- l'adresse de la tour : jamais dans le code. L'app iPhone la demande une fois
  (ou la reçoit à la compilation, secret `REMY_ADRESSE_TOUR`).

Dans les consignes envoyées aux modèles, le prénom s'écrit `${PRENOM}` (jamais en
dur) ; dans les commentaires et les tests, le prénom fictif « Sam ».

Dans le code, les tests et la démo : uniquement du fictif (Sam, Léa, Hugo, la
boutique de bougies…), aucune adresse réelle (tour, tailnet, réseau local). En
cas de doute, ça ne va pas dans le dépôt.

## Architecture en 30 secondes

- **Serveur Node** : `server.js` (127.0.0.1, publié aux seuls appareils du
  tailnet par Tailscale Serve) ; la table de routage vit dans `lib/routes.js`,
  partagée avec `api/index.js` (Vercel, plan Hobby = 12 fonctions max, la
  réécriture `vercel.json` route tout `/api/*` dessus).
- **App iPhone native** : `ios-native/` (SwiftUI). Son cœur `RemyCore` se teste
  sous Linux (`swift test`).
- **Page web** : `public/index.html` (vanilla JS, pas de framework, pas de build).
- `lib/` : chat.js (prompt, routeur de modèles, streaming SSE), providers.js
  (API Anthropic, CLI Claude Code, outil navigateur), glm.js (modèle local),
  motion.js, google.js, store.js et db.js (SQLite, migrations en avant
  seulement), ecriture.js (écritures idempotentes et annulables), coffre.js
  (Obsidian), sauvegarde.js, auth.js.
- **Cerveau** : un modèle local compatible OpenAI (`REMY_GLM_URL`). Claude
  seulement sur autorisation explicite (recherche web) ou en secours activé à la main.
- **Production** : pas d'auto-déploiement. Après chaque fusion, la tour se met à
  jour avec `scripts/installer-tour.ps1 -Ref <commit>` (voir `docs/tour.md`).

## `/mute` — répondre court

Quand l'utilisateur écrit `/mute` dans un message : réponse en 3 lignes maximum.
Le résultat, et rien d'autre. Pas de détail de features, pas de justification,
pas de liste de tests, pas de « pourquoi ». S'il veut le détail, il demandera.
Le travail reste le même — c'est le bavardage qui saute, pas la rigueur.

## Definition of Done (toute feature, sans qu'on ait à le demander)

1. **Feedback visible** sur chaque action : chargement (squelettes), succès,
   ou erreur claire avec quoi faire — jamais « rien ne se passe ».
2. **États vides et cas limites** gérés (mémoire vide, Motion absent, hors-ligne,
   réponse serveur non-JSON…). Un échec réseau ne laisse jamais un tap muet.
3. **Utilisable au pouce sur iPhone** : zones tactiles ≥ 44 px, safe-areas,
   testé au viewport 430×932 avant de livrer.
4. **Coût maîtrisé** : tout appel IA est journalisé dans le panneau coûts avec
   un `kind` ; pas d'appel automatique non désactivable.
5. **Vie privée** : données personnelles chiffrées au repos, audio jamais
   conservé, aucun nouveau tiers sans accord explicite du propriétaire, et rien
   de personnel dans ce dépôt public.
6. **Vérification avant livraison** : tester contre les faux services
   (Anthropic, Motion, Whisper, GLM) puis sonder la prod après déploiement — y
   compris les chemins imbriqués `/api/x/y`. Aucune affirmation de succès sans
   preuve exécutée.
7. **Retours des testeurs avant chaque build** : avant tout envoi TestFlight,
   relever les plantages et captures partagés depuis TestFlight
   (`docs/ios.md`, « Retours des testeurs »), les analyser et corriger ce qui
   peut l'être dans ce build.

## Pièges connus

- `pkill -f` : bracketer le motif (`serve[r].js`) sinon le shell se tue lui-même.
- Le catch-all Vercel `[...slug].js` ne matche qu'UN segment → ne jamais revenir
  en arrière sur la réécriture `__path`.
- `.gitignore` : `/data/` est ancré à la racine (les `data/` des skills doivent
  être versionnés).
- Tour (Windows) : PowerShell 5.1 + `2>$null` en mode `Stop` = arrêt à la
  première ligne d'erreur ; `ssh-keyscan` muet face aux sshd récents (relever
  l'empreinte avec `ssh`) ; un `.sh` envoyé sur Linux doit être en LF.
- Installeur de la tour : PowerShell **administrateur** (la tâche planifiée
  « Rémy » est créée ainsi ; sans ces droits, « Accès refusé » au remplacement).

## Mémoire entre les runs

- `docs/journal-technique.md` : décisions techniques non triviales (quoi +
  pourquoi), sans rien de personnel. À compléter à chaque décision.
