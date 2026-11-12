---
name: fonctionnalite
description: À utiliser quand l'utilisateur demande une nouvelle fonctionnalité de Rémy ou un changement visible (écran, comportement, outil du chat). Transforme une demande dictée en une fiche courte (situation, critères vérifiables), montre l'écran avant de construire partout, puis mène le travail jusqu'au bout sans redemander.
---

# /fonctionnalite — d'une demande à une fonctionnalité livrée

But : réussir du premier coup. Les allers-retours viennent presque toujours de
trois choses : une situation mal comprise, un « fini » qui ne se vérifie pas,
un écran découvert trop tard. Ce skill traite les trois, dans l'ordre.

## 1. Comprendre (5 minutes, pas plus)

Avant tout code, écris la **fiche** (elle tient sur un écran) :

- **La situation** : où est l'utilisateur, que veut-il faire, qu'est-ce qui
  l'en empêche aujourd'hui. Avec ses mots. S'il a donné une solution (« ajoute
  un bouton… »), remonte à la situation.
- **Ce qui existe déjà** dans Rémy sur le sujet (cherche dans le code ; ne
  demande pas ce que tu peux lire).
- **La référence** s'il en a cité une (« comme Motion », « comme Rappels
  d'Apple ») : va lire ce qu'elle fait vraiment.
- **Ce que Rémy fait seul** et ce que l'utilisateur confirme. Par défaut :
  Rémy propose, l'utilisateur confirme ou corrige. Jamais un formulaire vide
  comme passage obligé.
- **3 à 6 critères de réussite** qui se vérifient par une commande ou une
  capture (« une tâche bloquée n'apparaît jamais dans le conseil du moment »).
- **Hors périmètre** : ce qu'on ne fait pas cette fois.

Ne pose une question que si deux lectures raisonnables mènent à des
constructions différentes. Deux questions au plus, fermées, groupées. Sinon
choisis, dis ton choix en une ligne, et avance.

## 2. Montrer l'écran d'abord

Construis sur la tour et le site (rapide, vérifiable ici), avec des données
fictives. Prends les captures (bureau et format iPhone), **regarde-les**, puis
montre-les à l'utilisateur avec une phrase par capture. L'iPhone se construit
après son accord — sauf correction évidente qu'il a déjà demandée.

## 3. Construire jusqu'au bout

- Respecte `CLAUDE.md` : Definition of Done, vie privée, coût maîtrisé,
  dépôt public (données fictives).
- Les trois appareils : tour, site (app Windows), iPhone. Un ancien appareil
  ne casse pas (capacité annoncée par la tour, clé absente = inchangé).
- Le Swift ne se compile que dans les contrôles automatiques (environ une
  heure) : écris-le simple, relis-le ligne à ligne, corrige au premier échec.
- Un tutoriel court dans les Nouveautés si quelque chose change à l'écran ;
  retire ou remplace celui qui devient faux.

Pour ne pas t'arrêter en chemin, pose la condition de fin avec `/goal`, par
exemple : « tous les tests passent, les contrôles automatiques sont verts,
les captures bureau et iPhone ont été regardées, ou arrêt après 30 tours ».

## 4. Vérifier, puis livrer

Chaque critère de la fiche est prouvé (sortie de commande ou capture), pas
affirmé. Ensuite, sans demander (voir « Autonomie » dans `CLAUDE.md`) : fusion
dès que tout est vert, build TestFlight, mise à jour de la tour.

## 5. Le compte rendu (court)

Dans cet ordre, en mots de tous les jours :

1. Ce qui change pour lui (2 à 4 lignes).
2. Ce qu'il doit faire (installer le build, lancer une commande), s'il y a lieu.
3. Ce qui n'a pas pu être vérifié sur du vrai matériel.
4. Les décisions qui lui reviennent, en questions fermées.

Rien d'autre : ni liste de fichiers, ni détail des tests, ni vocabulaire de
développeur.
