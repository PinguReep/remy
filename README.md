# Rémy

Un assistant personnel auto-hébergé, pensé comme un « directeur de cabinet » :
il observe, apprend, propose — et tu gardes toujours le dernier geste. Inspiré
de Rémy dans *Ratatouille*.

- **App iPhone native** (SwiftUI) : la journée, les tâches, les rappels, la
  conversation avec Rémy, la dictée.
- **Un serveur chez toi** (une « tour ») : Node, SQLite, joignable seulement par
  tes appareils (Tailscale). Tes données ne quittent pas ta machine.
- **Un modèle local** pour réfléchir (compatible OpenAI, ex. GLM) ; Claude
  seulement quand tu l'autorises.
- **Motion** et **Google Agenda** pour les tâches et les rendez-vous : Rémy
  propose, rien n'est écrit sans ton accord, tout s'annule.

## Vie privée

Ce dépôt ne contient **aucune donnée personnelle** : ni mémoire, ni
conversations, ni réglages, ni adresses. Tout cela vit sur la tour (coffre
Obsidian, base chiffrable, `remy.env`). Les exemples, tests et données de
démonstration sont fictifs.

## Développement

```bash
npm ci
npm start        # serveur local, http://localhost:3000
npm test         # tests du serveur
```

L'app iPhone : `ios-native/` (voir `docs/ios.md`). Son cœur (`RemyCore`) se
teste aussi sous Linux : `cd ios-native/RemyCore && swift test`.

Installer ou mettre à jour la tour : `docs/tour.md`.

## Licence

Tous droits réservés — voir [`LICENSE`](LICENSE).
