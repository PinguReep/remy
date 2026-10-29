# Conversations externes : Claude Code, T3 Code, ChatGPT

Depuis le 29/10, la tour lit ce que tu as dit **ailleurs** — tes sessions
Claude Code, tes fils T3 Code (ordinateur ou téléphone), ton export ChatGPT —,
le range **chiffré** dans ton coffre, te le montre (app iPhone, site) et s'en
inspire (modèle local seulement). Capacité : `conversations-externes-v1`
(`GET /api/version`).

## Ce qui est garanti (et prouvé par `test/conversations-externes.test.mjs`)

- **À sens unique** : la tour lit les sources, n'y écrit jamais, et rien ne
  repart vers OpenAI ou Anthropic. Les modules `lib/connaissances/` ne font
  aucune requête réseau.
- **Matière privée** : jamais envoyée à Claude ni à aucun service. Les passages
  ne vont qu'au modèle local ; une conversation de Rémy qui les cite devient
  **privée** (plus de secours Claude, titre et mémoire en local, hors de la
  réflexion de nuit envoyable). La nuit, la relecture des conversations de la
  veille part avec `prive` : modèle local ou rien. Leurs mots entrent au filtre
  des requêtes sortantes (salle blanche) : un nom ou un numéro qu'ils citent ne
  part jamais dans une recherche web.
- **Chiffrée au repos** : textes, titres, aperçus, noms et dossiers de projets
  en AES-256-GCM ; l'index de recherche ne contient que des empreintes de mots
  (HMAC), sans positions. La clé n'est pas dans le coffre (voir « La clé »).
- **Secrets masqués** avant tout stockage (clés d'API, jetons, mots de passe,
  valeurs de `remy.env`).
- **Effaçable par source**, sans toucher aux originaux.
- **Pas dans les sauvegardes en double** : le dossier `Imports` (exports
  ChatGPT déposés, en clair, souvent des centaines de Mo) et les envois en
  cours ne partent jamais dans les sauvegardes de la tour ; la base, elle, y
  part (chiffrée), et sa clé n'y est pas.

Ce que la tour ne chiffre pas : l'export ChatGPT que **tu** déposes dans
`Imports` reste tel quel dans `Imports\Importés` (il contient aussi tes images,
que Rémy ne garde pas). Efface-le quand tu as vu tes conversations dans l'app
si le coffre est synchronisé ailleurs. Un export envoyé depuis l'iPhone, lui,
n'est gardé que le temps de l'import.

Ce qui reste visible sans la clé : le nombre de conversations et de messages,
leurs dates et tailles, des identifiants techniques (UUID), et quels messages
partagent une même empreinte de mot.

## Les sources

| Source (`id`) | Où la tour lit | Comment |
| --- | --- | --- |
| `claude-code` | `%USERPROFILE%\.claude\projects\**\*.jsonl` (trouvé seul), `CLAUDE_CONFIG_DIR`, `REMY_CLAUDE_DIRS` | relecture incrémentale toutes les 30 min, la nuit et à la demande ; ton texte et celui de Claude, jamais les outils ni la réflexion ; sous-agents et `claude -p` (Rémy, titres de T3) écartés |
| `t3` | `%USERPROFILE%\.t3\userdata\statev2.sqlite` (trouvé seul ; aussi `dev\`, et l'ancien `state.sqlite`), `T3CODE_HOME`, `REMY_T3_DIRS` | même rythme ; base ouverte en lecture seule (T3 lancé) ou « immutable » (T3 fermé : aucun fichier créé à côté) ; fils supprimés et sous-agents écartés ; une session Claude menée depuis T3 n'apparaît qu'une fois, sous T3 |
| `chatgpt` | l'export officiel : ChatGPT › Réglages › Contrôle des données › Exporter → un .zip par mail | envoyé depuis l'app (`POST …/chatgpt`) ou déposé dans `<coffre>\Imports` (relu toutes les 30 min, puis rangé dans `Imports\Importés`, jamais effacé) ; idempotent |

Allumées par défaut (Claude Code, T3) ; l'import ChatGPT s'allume au premier
envoi. Chaque source se coupe dans l'app, ou sur la tour.

### Réglages de la tour (`remy.env`)

| Réglage | Rôle |
| --- | --- |
| `REMY_SOURCE_CLAUDE_CODE` / `REMY_SOURCE_T3` / `REMY_SOURCE_CHATGPT` | `off` coupe la source quoi que dise l'app ; `on` la force |
| `REMY_CLAUDE_DIRS` | des dossiers `.claude` en plus, séparés par `;` (une distribution WSL : `\\wsl.localhost\Ubuntu\home\<toi>\.claude`) |
| `REMY_T3_DIRS` | des dossiers de T3 en plus (un fork rangé ailleurs), séparés par `;` ; un dossier peut être directement celui de la base |
| `REMY_IMPORTS_DIR` | le dossier surveillé des exports (défaut : `<coffre>\Imports`) |
| `REMY_IMPORT_MAX_MO` | taille maximale d'un envoi (défaut 2048) |
| `REMY_CONNAISSANCES_PROJETS` | ne garder que les projets dont le dossier contient l'un de ces mots (`essai,autre`) |
| `REMY_CONVERSATIONS_USAGE=off` | Rémy ne s'en sert plus (ni réponses, ni nuit) ; la consultation reste |
| `REMY_CONVERSATIONS_CLE` | la clé (64 caractères hexadécimaux), si tu préfères la tenir dans `remy.env` |
| `REMY_CLES_DIR` | le dossier du fichier de clé (défaut `%USERPROFILE%\.remy`) |

### La clé

`%USERPROFILE%\.remy\conversations.cle`, créée au premier usage, à côté de
`remy.env`, **hors du coffre** (qui peut être copié ou synchronisé). Perdue ou
changée : la base devient illisible — l'état le dit (`cle.erreur`),
« Tout effacer » puis « Lire maintenant » relit Claude Code et T3 ; un export
ChatGPT se réenvoie. Garde-en une copie avec celle des sauvegardes si tu veux
pouvoir restaurer la base telle quelle.

## Le contrat de l'API

Toutes les routes demandent la session (cookie du site ou jeton de l'iPhone).
Les dates sont en millisecondes depuis 1970 (`null` si inconnues). Une erreur
rend `{ "error": "<code>", "message": "<phrase>", "quoiFaire": "<phrase>" }`.

### `GET /api/conversations-externes` — l'état

```json
{
  "sources": [
    {
      "id": "claude-code",
      "nom": "Claude Code",
      "actif": true,
      "forceParLaTour": false,
      "disponible": true,
      "emplacements": [{ "origine": "dossier de l'utilisateur", "chemin": "~\\.claude\\projects", "trouve": true }],
      "derniereLecture": 1793235865350,
      "derniereReussie": 1793235865350,
      "conversations": 42,
      "messages": 1310,
      "derniereConversation": 1793228665297,
      "bilan": { "fichiers": 50, "lus": 3, "messages": 12, "masques": 1, "erreurs": 0 },
      "erreur": null,
      "aide": null
    }
  ],
  "usage": { "chat": true, "nuit": true, "forceParLaTour": false },
  "chiffre": true,
  "cle": { "origine": "fichier", "emplacement": "~\\.remy\\conversations.cle", "erreur": null },
  "imports": { "dossier": "~\\Documents\\Rémy\\Imports", "enAttente": 0, "importes": 1 },
  "total": { "conversations": 57, "messages": 1702 },
  "lectureToutesLesMin": 30
}
```

- `erreur` : la dernière lecture a échoué (`{ code, message, quoiFaire }` ;
  codes : `illisible`, `occupe`, `node-ancien`, `schema-inconnu`,
  `zip-invalide`, `json-invalide`, `sans-conversations`, `cle-differente`).
- `aide` : rien à montrer, et quoi faire (`introuvable` : la source n'est pas
  sur la tour ; `rien-importe` : aucun export ChatGPT).
- `bilan` : les compteurs de la dernière lecture (jamais de contenu).
- `cle.origine` : `fichier`, `remy.env` ou `a-creer` (rien lu encore).

### `GET /api/conversations-externes/liste`

Paramètres : `source` (`claude-code`, `t3`, `chatgpt`), `jour` (`AAAA-MM-JJ`,
heure de Paris : les conversations qui ont un message ce jour-là), `projet`
(`p-` + 10 hexadécimaux), `decalage` (défaut 0), `limite` (1–100, défaut 30).
Des plus récentes aux plus anciennes (dernier message).

```json
{
  "conversations": [
    {
      "source": "t3",
      "id": "fil-paiement",
      "titre": "Paiement en trois fois",
      "apercu": "Ajoute le paiement en trois fois au panier…",
      "assistant": "Codex",
      "projet": { "id": "p-1a2b3c4d5e", "nom": "Site de la boutique" },
      "debut": 1793225065297,
      "fin": 1793228665297,
      "messages": 2
    }
  ],
  "suite": 30,
  "total": 57
}
```

`suite` : le `decalage` de la page suivante, ou `null`.

### `GET /api/conversations-externes/jours`

Paramètres : `source`, `nombre` (jours en arrière, défaut 60). Pour parcourir
par date : `{ "jours": [{ "jour": "2026-10-28", "conversations": 4 }] }`, du
plus récent au plus ancien.

### `GET /api/conversations-externes/conversations/:source/:id`

Paramètres : `apres` (identifiant du dernier message reçu), `limite` (1–1000,
défaut 300). L'`id` est encodé (`encodeURIComponent`).

```json
{
  "conversation": { "source": "chatgpt", "id": "6f1c…", "titre": "Idées de coffrets de Noël", "apercu": "…", "assistant": "ChatGPT", "projet": null, "debut": 1793142325000, "fin": 1793142455000, "messages": 4 },
  "messages": [
    { "id": 9, "auteur": "utilisateur", "ts": 1793142325000, "texte": "Trois idées de coffrets de Noël ?" },
    { "id": 10, "auteur": "assistant", "ts": 1793142365000, "texte": "1. Coffret « Forêt »…" }
  ],
  "suite": null
}
```

`auteur` : `utilisateur`, `colle` (un long collage de ta part : code, mail),
`assistant` (son nom est `conversation.assistant`), `resume` (résumé de
compaction de Claude Code). `suite` : à passer en `apres` pour la page
suivante. 404 si la conversation n'existe pas (ou plus).

### `GET /api/conversations-externes/chercher?q=…`

Paramètres : `q` (obligatoire, 200 caractères au plus), `source`, `limite`
(1–50, défaut 20). Sans IA : les messages qui contiennent le plus de mots
cherchés (un début de mot de 4 lettres suffit, sans accents), puis les plus
récents.

```json
{
  "resultats": [
    { "source": "t3", "conversation": "fil-livraison", "titre": "Frais de livraison", "projet": { "id": "p-…", "nom": "Site de la boutique" }, "message": 7, "auteur": "utilisateur", "ts": 1793149645297, "score": 2, "extrait": "Livraison offerte dès 49 euros…" }
  ]
}
```

### `GET /api/conversations-externes/nuit?jour=AAAA-MM-JJ`

Ce que la nuit a tiré des conversations de ce jour (sans `jour` : le dernier
des 7 derniers jours) : des **propositions**, rien n'est fait seul.

```json
{
  "digest": {
    "jour": "2026-10-28",
    "creeA": 1793250000000,
    "sources": ["claude-code", "chatgpt"],
    "themes": ["Fiches produits", "Coffrets de Noël"],
    "decisions": ["Publier les nouvelles fiches vendredi"],
    "aFaire": [{ "texte": "Refaire les photos du coffret", "source": "Claude Code" }],
    "ligne": "Les nouvelles fiches sortent vendredi : il reste les photos du coffret."
  },
  "usage": { "chat": true, "nuit": true, "forceParLaTour": false }
}
```

`digest` vaut `null` s'il n'y a rien. La ligne du matin est aussi dans
`GET /api/rituel` (`conversations: { ligne, jour, sources }` ou `null`).

### Gestes

| Route | Corps | Réponse |
| --- | --- | --- |
| `POST /api/conversations-externes/synchroniser` | `{}` ou `{ "source": "t3" }` | `{ bilan: { ok, sources: { <id>: { ok, …compteurs } \| { ok: false, erreur } } }, etat }` ; 409 `source-coupee` |
| `PUT /api/conversations-externes/sources/:id` | `{ "actif": true }` | l'état |
| `DELETE /api/conversations-externes/sources/:id` | — | `{ ok, message, etat }` : tout ce qui vient de la source est effacé (et les résumés de nuit qui s'en servaient), la source coupée ; l'original n'est pas touché |
| `DELETE /api/conversations-externes/tout` | — | `{ ok, message, etat }` : tout effacé (clé changée) |
| `PUT /api/conversations-externes/usage` | `{ "chat": false }`, `{ "nuit": true }` | l'état |
| `POST /api/conversations-externes/chatgpt` | **le fichier** (.zip de l'export ou `conversations.json`), en corps brut (`Content-Type: application/zip` ou `application/octet-stream`) | `{ bilan: { deja, conversations, nouvelles, misesAJour, inchangees, ignorees, messages, masques, tronquees }, etat }` ; 413 `trop-gros` ; 422 `zip-invalide`, `json-invalide`, `sans-conversations` |

Un export déjà envoyé rend `bilan.deja: true` (reconnu à son empreinte) ; une
conversation déjà là n'est réécrite que si ChatGPT l'a modifiée depuis.

## Dans Rémy

- **Les réponses** : quand ta question s'y rapporte (« dans ma session Claude
  Code… », « avec ChatGPT hier… », le nom d'un de tes projets, « on avait
  décidé… » avec des passages vraiment proches), la tour cherche dans l'index
  et donne au modèle local quelques passages encadrés (6 au plus). La barre du
  chat le montre (« Rémy relit tes conversations Claude Code… ») et la
  conversation passe en privée (`done.prive: true`).
- **La nuit** (circuit « nuit », après la réflexion) : les conversations de la
  veille, relues par le modèle local seul → thèmes, décisions, choses à faire
  (`GET …/nuit`). Coût journalisé (`kind` : `conversations-nuit`).
- **Le matin** : une ligne dans le briefing de l'app, lue au moment de
  l'afficher, jamais écrite dans le briefing de la nuit.

Interrupteurs : `PUT …/usage` (app : Réglages › Sources des conversations) ;
`REMY_CONVERSATIONS_USAGE=off` sur la tour.
