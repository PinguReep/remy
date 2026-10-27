# Parcours joués (XCUITest)

Les gestes du quotidien de Sam, joués de bout en bout sur le simulateur contre
une tour de démo (données fictives, faux Motion / Google / modèle local). Chaque
étape attend ce que l'écran doit montrer, le capture et note gestes et temps.

## Lancer

- **CI** : Actions → « iOS natif — parcours joués » → *Run workflow*
  (`ios-parcours.yml`, ~25 min). Champ « filtre » pour un seul parcours, ex.
  `ParcoursQuotidien/test11_demanderARemyQuiPropose`.
- **Sur un Mac** :
  ```sh
  node ios-native/RemyParcours/tour-pilote.mjs &      # tour :3000, pilote :3099
  cd ios-native && xcodegen generate
  xcodebuild test -project Remy.xcodeproj -scheme RemyParcours \
    -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max'
  ```

## Résultats (artefacts du run)

- `parcours-resultats/resume.md` : parcours, réussite, gestes, durée, étapes,
  constats (aussi dans la page du run) ; `resume.json` pour les chiffres.
- `parcours-resultats/captures/Pnn-mm-étape.png` : une capture par étape ;
  `-ECHEC` quand l'écran ne montrait pas ce qu'il devait.
- `parcours-xcresult` : le `.xcresult` complet (ouvrir dans Xcode).

## Écrire un parcours

```swift
@MainActor
func test21_monParcours() {
    jouer("P21", "Ce que Sam fait") {          // données de démo neuves
        lancer()
        try attendreAccueil()
        try toucher(ident("noter"), "+")      // un geste compté
        try etape("feuille", attendu: [ident("capture.champ")])
    }
}
```

- `toucher`, `appuiLong`, `saisir`, `balayer…` comptent les gestes ;
  `etape` attend, capture, puis arrête proprement le parcours si l'écran est faux.
- **Un défaut de l'app n'est pas corrigé ici** : `constat("ce qui ne va pas",
  siFaux: condition)` le garde en échec attendu (`XCTExpectFailure`), avec sa
  capture, et le résumé le reprend. `auditerCibles("écran")` mesure les zones
  tactiles sous 44 pt.
- **Un défaut corrigé** perd son `constat` : `verifier("ce qui doit être vrai",
  condition)` en fait une vraie vérification (échec rouge et capture s'il revient).
- `Pilote.couperTour()` / `relancerTour()` : la tour s'éteint en plein parcours.
- Identifiants d'accessibilité seulement là où le libellé ne suffit pas
  (`onglet.*`, `noter`, `maintenant.*`, `capture.*`).
