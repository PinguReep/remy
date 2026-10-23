# Rémy sur iPhone (app native)

L'app iPhone est une **vraie app native en SwiftUI** (`ios-native/`), pas un site
affiché dans une coquille. Elle parle au même serveur que le site (`/api/*` sur
la tour, par Tailscale) : mêmes conversations, même mémoire, mêmes données. Son design reprend
celui du site (papier & encre, orange signal, Inter + JetBrains Mono embarquées).

## Ce qui se met à jour tout seul, et ce qui demande un build

- **Tout ce qui vient du serveur** (intelligence de Rémy, mémoire, réflexion
  nocturne, calculs du tableau de bord) : dès que la tour est mise à jour
  (`scripts/installer-tour.ps1`, qui fait d'abord une sauvegarde).
- **L'interface de l'app** : un nouveau build, **seulement sur décision de Sam**
  (Lot 0, D5) — un tag `ios-v…` ou « Run workflow » sur **« iOS → TestFlight »**.
  Le workflow fait d'abord passer tous les tests (serveur sur Ubuntu et Windows,
  cœur et intégration iOS, build et captures) ; un test rouge = aucun envoi.
  Plus d'envoi automatique à chaque fusion : avec les mises à jour automatiques
  de l'app TestFlight, l'iPhone l'installait sans que personne l'ait décidé.

  ```
  git tag ios-v2.1.0 && git push origin ios-v2.1.0
  ```

## Revenir à un build précédent

App **TestFlight** sur l'iPhone → **Rémy** → **Builds précédents** → choisir le
build → **Installer**. Le numéro de build et le commit de chaque envoi sont dans
le résumé de l'exécution du workflow ; l'archive et ses dSYM y sont gardés 90
jours (artefact `archive-ios-<build>`).

## Retours des testeurs (plantages, captures)

« Partager des commentaires » dans TestFlight envoie le retour chez Apple. Le
job `retours` de `ios-testflight.yml` les relève par l'API App Store Connect
(mêmes secrets que l'envoi), sans tests ni envoi : **Run workflow** avec
`retours_seulement` coché et `cle_publique` = `base64 -w0 cert.pem` (certificat
RSA-4096 du destinataire, public). Le dépôt étant public, rien ne sort en clair :
le journal ne montre que des compteurs, l'artefact `colis` est chiffré (CMS,
AES-256-GCM + RSA-OAEP) et gardé un jour. Déchiffrer avec la clé privée :
`bash scripts/retours-testflight/dechiffrer.sh colis.p7m prive.pem retours`.
Les e-mails des testeurs et les URL signées des images ne sont jamais écrits.

## Mise en place (une fois)

1. **Clé API App Store Connect** : App Store Connect → Utilisateurs et accès →
   Intégrations → Clés API → ＋ · Nom « CI » · Accès **Admin**. *(App Manager ne
   suffit pas : la signature de distribution dans le cloud, obligatoire pour
   TestFlight, est réservée au rôle Admin — erreur « Cloud signing permission
   error ». Le rôle d'une clé ne se modifie pas : il faut en recréer une.)* Note le
   **Key ID** et l'**Issuer ID**, télécharge le **.p8** (une seule fois possible).
2. **Identifiant d'équipe** : developer.apple.com → Account → **Membership** →
   « Team ID » (10 caractères).
3. **4 secrets GitHub** : https://github.com/PinguReep/remy/settings/secrets/actions
   - `ASC_KEY_ID`, `ASC_ISSUER_ID`, `APPLE_TEAM_ID`
   - `ASC_KEY_P8` : le .p8 encodé en base64 (`base64 -i AuthKey_XXXX.p8` sur Mac ;
     sous Windows : `[Convert]::ToBase64String([IO.File]::ReadAllBytes("AuthKey_XXXX.p8"))`)
   - facultatif, `REMY_ADRESSE_TOUR` : l'adresse de ta tour
     (`https://<tour>.<tailnet>.ts.net:8444`), inscrite dans l'app à la
     compilation. Sans lui, l'app la demande une fois au premier lancement et la
     garde sur l'iPhone. Elle n'est jamais écrite dans le dépôt, qui est public.
4. **Lancer le workflow une fois** (Actions → « iOS → TestFlight » → Run workflow) :
   il enregistre les Bundle ID `com.pingureep.remy`, `com.pingureep.remy.widgets`
   et `com.pingureep.remy.partage` (app, widgets, feuille de partage) chez Apple.
5. **Créer la fiche de l'app** : App Store Connect → Apps → ＋ → Nouvelle app →
   iOS · Nom « Rémy » · Bundle ID `com.pingureep.remy` · SKU `remy-001`. C'est la
   seule étape qu'Apple ne laisse pas automatiser.
6. **Relancer le workflow**. ~15 min plus tard le build est dans TestFlight :
   ajoute-toi en testeur interne.
7. **Sur l'iPhone** : app **TestFlight** → Rémy → **Installer**, puis active
   **Mises à jour automatiques**.

Les builds TestFlight expirent après 90 jours : relance le workflow (ou pose un
tag) avant l'échéance.

## Développement

- `ios-native/RemyCore` : le cœur (modèles, client API, flux de réponse, état des
  écrans), **sans SwiftUI** — il se compile et se teste aussi sous Linux :
  `cd ios-native/RemyCore && swift test`. Avec `REMY_TEST_URL` et `REMY_TEST_MDP`,
  un test tourne contre un vrai serveur.
- `ios-native/Remy` : les vues SwiftUI. Le projet Xcode est généré :
  `cd ios-native && xcodegen generate`.
- Une PR **prête à fusionner** (pas en brouillon) qui touche `ios-native/`
  **ou le serveur** (`lib/`, `server.js`) lance **« iOS natif — build &
  captures »** — aussi à la demande (Actions → Run workflow) et avant chaque
  envoi TestFlight ; plus à chaque push, pour ménager le quota de minutes
  macOS (qui comptent dix fois) : compilation, tests, puis l'app
  tourne sur un simulateur contre un serveur de démo aux données fictives
  (`ios-native/ci/`), et les écrans sont capturés (artefact `captures-iphone`).
  Après chaque capture, l'app doit tourner encore : un crash fait échouer la CI.
- Outils figés (`.github/actions/outils-ios`) : Xcode 26.6, XcodeGen 2.46.0
  (empreinte vérifiée). Les changer est un choix explicite, pas un effet de
  l'image macOS de GitHub.
- Variables de lancement (CI / dev) : `REMY_BASE_URL` (serveur visé),
  `REMY_DEMO_MDP` et `REMY_DEMO_ECRAN` (connexion et écran automatiques).
  Le HTTP n'est autorisé que vers le réseau local.

## Notes techniques

- Bundle ID `com.pingureep.remy` · iOS 17 minimum · iPhone uniquement.
- Extensions (24/10) : `RemyWidgets` (`com.pingureep.remy.widgets`) et
  `RemyPartage` (`com.pingureep.remy.partage`), même version que l'app. Elles
  lisent l'adresse de la tour et le jeton dans un trousseau partagé
  (`keychain-access-groups`, pas de groupe d'app) : `TrousseauPartage` dans le
  cœur. Liens `remy://capture`, `remy://aujourdhui|remy|projets` (`LienRemy`).
- Session : le cookie du serveur, gardé par le système (même mécanisme que le site).
- Signature : automatique via la clé API. Chaque build crée un certificat de
  développement sur une machine jetable ; le workflow TestFlight révoque ces
  certificats « Created via API » avant d'archiver (`scripts/asc-certificats.mjs`),
  sinon Apple refuse au-delà de son plafond. Lister sans rien toucher :
  `node scripts/asc-certificats.mjs` (avec les variables ASC_*).
- Numéro de build = numéro d'exécution du workflow (toujours croissant).
