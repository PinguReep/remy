# Modules Claude Code du projet

Tout ce qui vit dans ce dossier est **chargé automatiquement** par Claude Code à
l'ouverture d'une session sur ce dépôt (comme le `CLAUDE.md` à la racine) :

- `skills/` — savoir-faire invocables (chargés à la demande, seule leur
  description occupe le contexte en permanence)
- `agents/` — sous-agents spécialisés utilisables par Claude

## Provenance

Modules sélectionnés depuis [ECC](https://github.com/affaan-m/ECC) (licence MIT),
relus avant installation. Choix volontairement restreint : chaque skill installé
consomme du contexte à chaque session, donc on ne garde que ce qui sert ce projet.

**Skills** :
- `make-interfaces-feel-better` — détails de design (espacements, typo, états,
  zones tactiles) pour polir l'UI de Rémy
- `frontend-design-direction` — choisir une direction visuelle cohérente avant
  de coder une interface
- `security-review` — checklist sécurité (auth, entrées utilisateur, secrets,
  endpoints) — pertinent : Rémy manipule des données personnelles chiffrées
- `ui-ux-pro-max` — intelligence design ([nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill),
  MIT, généré via le CLI officiel) : bases interrogeables de 84 styles,
  192 palettes, 74 accords typo, 98 règles UX, presets d'animation — scripts
  Python en lib standard, zéro réseau. Seul le skill cœur est installé (les
  6 skills annexes du paquet — galeries, marque, slides — sont écartés, ~7 Mo
  sans rapport avec ce dépôt).

**Agents** :
- `code-reviewer` — revue de code à la demande (description adaptée : l'original
  ECC se déclenchait sur chaque modification, coûteux pour rien)
- `security-reviewer` — se déclenche après du code touchant auth/entrées/données
- `silent-failure-hunter` — traque les erreurs avalées et les replis silencieux
- `code-simplifier` — simplification à comportement constant
- `build-error-resolver` — répare les erreurs de build avec un diff minimal

Écartés délibérément : les hooks (exécutent des commandes — à auditer un par un
si besoin), `planner` (Opus + déclenchement proactif = coûts), les packs
React/Next et les ~240 autres skills sans rapport avec ce dépôt.
