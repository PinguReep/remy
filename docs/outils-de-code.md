# Brancher un outil de code sur le modèle local, par Rémy

Rémy ouvre une porte « compatible OpenAI » vers le modèle local de la tour.
Un outil de code qui passe par elle parle au **même modèle que Rémy**, et
Rémy sait qui attend : une question posée à Rémy ne fait plus la queue derrière
un agent, et les agents qui tournent seuls se mettent en pause quand tu
demandes quelque chose.

## 1. Allumer la porte

Dans Rémy (le site) : **Réglages › Outils de code** → « Ouvrir la porte aux
outils de code ». Elle est coupée par défaut. Coupée, tout est refusé.

## 2. L'adresse (« base URL »)

- L'outil tourne **sur la tour** : `http://127.0.0.1:3010/v1` (le port de
  Rémy ; Réglages › Outils de code l'affiche, avec un bouton Copier).
- Il tourne **sur un autre appareil de ton réseau privé** : l'adresse du site
  de Rémy suivie de `/v1` (`https://<ta-tour>…/v1`), affichée au même endroit.

Le nom du modèle importe peu : Rémy prend toujours le sien (celui de
Réglages › Modèle). `GET /v1/models` le donne.

## 3. La clé (« API key »)

Crée-la dans Réglages › Outils de code. Elle s'affiche **une seule fois** :
copie-la tout de suite dans l'outil. Rémy n'en garde qu'une empreinte ; si tu
la perds, remplace-la. « Révoquer » la rend inutilisable sur-le-champ.

Il y a deux clés, et la différence est simple :

| Clé | Pour quoi | Ce qui se passe |
| --- | --- | --- |
| **Au clavier** | ce que tu fais toi-même dans ton outil, quand tu attends la réponse | passe devant tout, comme une question posée à Rémy ; met en pause le travail de fond de Rémy et les agents de fond |
| **Agents de fond** | les agents qui tournent seuls | quand tu demandes quelque chose (à Rémy ou au clavier), leurs **nouveaux** appels attendent leur tour, dans l'ordre, puis repartent quelques secondes après ; l'appel déjà en cours **finit** (il n'est pas coupé) |

Si un agent de fond attend plus que le délai réglé (2 min par défaut), ou si
trop d'appels attendent déjà (8 par défaut), il reçoit une erreur **503** avec
un en-tête `Retry-After` : les outils compatibles OpenAI réessaient seuls.
Réglages › Diagnostic › « Travail de fond » dit ce qui attend, par exemple
« 2 appels d'agents en attente : tu viens de poser une question ».

## Dans T3 Code

T3 Code ne parle pas lui-même à un modèle : il pilote des agents (Claude Code,
Codex, OpenCode, Pi…). D'après sa documentation (`docs/user/install.md`,
« Providers »), chaque instance de fournisseur a ses propres **variables
d'environnement**, « comme des clés d'API ou une base URL personnalisée » :
**Settings › Providers**, ajoute une instance, puis renseigne l'adresse et la
clé ci-dessus dans la configuration de l'agent :

- **OpenCode** : un fournisseur « compatible OpenAI » dans `opencode.json`
  (`@ai-sdk/openai-compatible`, `baseURL` = l'adresse, `apiKey` = la clé).
- **Pi** : son fournisseur compatible OpenAI (adresse et clé), ou la variable
  de clé dans l'instance Pi de T3 Code.
- **Claude Code** parle l'API d'Anthropic, pas celle d'OpenAI : il ne peut pas
  utiliser cette porte telle quelle.
- **Codex** : ses versions récentes passent par l'API « responses », que cette
  porte ne sert pas (`/v1/chat/completions` seulement). À essayer, sans garantie.

Une instance « au clavier » (ta clé au clavier) pour travailler, une autre
« agents » (la clé des agents de fond) pour ce qui tourne seul.

## Ce que la porte refuse

Toute requête sans clé valide ; les requêtes de plus de 8 Mo ; plus de 120
appels par minute et par clé (429) ; les images données par une adresse
(seulement jointes) ; tout paramètre qu'elle ne connaît pas (il n'est pas
relayé). Elle n'envoie rien ailleurs que vers le modèle local de la tour —
jamais vers le cloud — et ne garde rien de ce qui passe : seulement l'heure,
la clé utilisée, la durée et le nombre de jetons, dans Réglages › Coûts
(« outil de code »).
