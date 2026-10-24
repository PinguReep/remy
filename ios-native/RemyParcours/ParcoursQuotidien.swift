import XCTest

/// Les parcours du quotidien de Sam, joués de bout en bout sur le simulateur,
/// contre la tour de démo (données fictives). Chaque étape : une capture
/// « Pnn-étape », les gestes et le temps écoulé (résumé en fin de run).
/// Les noms numérotés fixent l'ordre ; chaque parcours repart de données neuves.
final class ParcoursQuotidien: ParcoursBase {

    // MARK: - Entrer

    @MainActor
    func test01_premierLancement() {
        jouer("P01", "Premier lancement : adresse de la tour, mot de passe, journée", reinitialiser: true) {
            // Sans adresse connue (installation neuve) ; la même tour sous le nom
            // « localhost » : un trousseau vierge, donc le vrai écran de connexion.
            lancer(connecte: false, base: nil)
            let adresse = app.textFields["ma-tour.mon-tailnet.ts.net:8444"]
            let mdp = app.secureTextFields["Mot de passe"]
            _ = adresse.waitForExistence(timeout: 20) || mdp.exists
            if adresse.exists {
                try etape("adresse-de-la-tour", attendu: [adresse, bouton("Continuer")])
                try toucher(adresse, "champ adresse")
                try saisir(Banc.tourAutreNom, dans: adresse)
                try toucher(bouton("Continuer"), "Continuer")
            } else {
                noter("adresse déjà connue de l'app : écran d'adresse sauté")
            }
            try etape("mot-de-passe", attendu: [mdp], delai: 20)
            try toucher(mdp, "champ mot de passe")
            try saisir(Banc.mdp + "\n", dans: mdp)
            try etape("journee", attendu: [onglet("aujourdhui"), texte("Finaliser la démo de la boutique")], delai: 30)
            // Le tutoriel d'une mise à jour peut venir par-dessus : « Plus tard ».
            let plusTard = bouton("Plus tard")
            if plusTard.waitForExistence(timeout: 6) {
                try etape("nouveautes-par-dessus", attendu: [plusTard])
                constat("Premier lancement : à peine connecté, le tutoriel des « nouveautés » d'une mise à jour (plusieurs pages) passe devant la journée, pour quelqu'un qui n'a jamais connu la version d'avant.",
                        siFaux: false)
                try toucher(plusTard, "Plus tard")
                try etape("journee-libre", absent: [plusTard])
            }
        }
    }

    // MARK: - Maintenant

    @MainActor
    func test02_voirQuoiFaireMaintenant() {
        jouer("P02", "Voir quoi faire maintenant (carte, conseil, pourquoi)") {
            lancer()
            try attendreAccueil()
            try etape("maintenant", attendu: [texte("Finaliser la démo de la boutique"), texte("min restantes"), ident("maintenant.terminer")])
            auditerCibles("Aujourd'hui")
            let conseil = boutonContenant("conseil")
            try toucher(conseil, "conseil du moment")
            try etape("conseil-en-grand", attendu: [texte("Conseil du moment"), bouton("Un autre conseil")])
            try fermerSurimpression()
            try etape("retour", absent: [bouton("Un autre conseil")])
            // Appui long : le conseil avec son « pourquoi ».
            try appuiLong(conseil)
            try etape("conseil-pourquoi", attendu: [texte("Conseil du moment")])
            try fermerSurimpression()
            try etape("fin", absent: [bouton("Un autre conseil")])
        }
    }

    @MainActor
    func test03_terminerTacheEnCours() {
        jouer("P03", "Terminer la tâche en cours, puis enchaîner") {
            lancer()
            try attendreAccueil()
            try etape("maintenant", attendu: [texte("Finaliser la démo de la boutique"), ident("maintenant.terminer")])
            try toucher(ident("maintenant.terminer"), "Terminer")
            try etape("faite-avec-annuler", attendu: [texte("« Finaliser la démo de la boutique » : fait.")], delai: 6)
            try etape("et-maintenant", attendu: [texte("terminée. Et maintenant ?")], delai: 20)
            let commencer = boutonContenant("Commencer « ")
            if commencer.exists {
                let suivante = commencer.label
                try toucher(commencer, "Commencer la suivante")
                try etape("suivante-commencee", absent: [texte("terminée. Et maintenant ?")])
                noter("suivante proposée : \(suivante)")
                // La suivante, commencée, doit passer « EN COURS » tout de suite.
                let marque = nomme(app.staticTexts.matching(NSPredicate(format: "label == %@", "EN COURS")).firstMatch, "marque EN COURS")
                let tout = marque.waitForExistence(timeout: 8)
                capturer("carte-apres-commencer")
                constat("Après « Commencer », la carte dit encore « À VENIR · maintenant » : la tâche ne passe « EN COURS » (avec son temps restant) qu'à la minute suivante, quand l'écran se recalcule.",
                        siFaux: tout)
            } else {
                try toucher(bouton("Choisir…"), "Choisir")
                try etape("choisir-la-suite", attendu: [texteI("cette semaine")], delai: 8)
            }
        }
    }

    @MainActor
    func test04_prolongerTacheEnCours() {
        jouer("P04", "Prolonger la tâche en cours de 15 min") {
            lancer()
            try attendreAccueil()
            try toucher(ident("maintenant.gerer"), "Gérer")
            try etape("gerer", attendu: [bouton("+15 min"), boutonContenant("Replanifier ou modifier")])
            auditerCibles("Gérer")
            try toucher(bouton("+15 min"), "+15 min")
            let prolonger = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Prolonger ")).firstMatch
            try etape("impact-estime", attendu: [prolonger, texte("Estimation")])
            try toucher(prolonger, "Prolonger")
            try etape("prolongee", attendu: [texte("+15 min. Motion recalcule la suite.")], delai: 15)
        }
    }

    @MainActor
    func test05_decalerTacheADemain() {
        jouer("P05", "Décaler la tâche en cours à demain") {
            lancer()
            try attendreAccueil()
            try toucher(ident("maintenant.gerer"), "Gérer")
            try etape("gerer", attendu: [boutonContenant("Replanifier ou modifier")])
            try toucher(boutonContenant("Replanifier ou modifier"), "Replanifier")
            try etape("dates", attendu: [bouton("Demain"), bouton("Dans une semaine")])
            try toucher(bouton("Demain"), "Demain")
            try etape("decalee", attendu: [texte("à faire d'ici")], delai: 15)
            constat("Décaler laisse le panneau « Gérer » ouvert (« Prolonger » le referme) ; le message de confirmation se pose par-dessus ses actions.",
                    siFaux: !bouton("+15 min").exists)
        }
    }

    // MARK: - Capturer (le « + »)

    @MainActor
    func test06_capturerUneNote() {
        jouer("P06", "Noter une information à retenir") {
            lancer()
            try attendreAccueil()
            try toucher(ident("noter"), "+")
            let champ = ident("capture.champ")
            try etape("feuille-noter", attendu: [champ])
            try saisir("Hugo préfère qu'on lui écrive plutôt que de l'appeler, surtout le lundi.", dans: champ)
            try etape("texte-tape", attendu: [ident("capture.genre.retenir")])
            auditerCibles("Noter (+)")
            // Une préférence, pas un rendez-vous : « surtout le lundi » n'est pas une date.
            constat("Une information à retenir qui cite un jour (« surtout le lundi ») est devinée « Rappel » pour lundi 9 h : tout jour de la semaine est lu comme une date (AnalyseDate, GenreCapture.deviner).",
                    siFaux: !ident("capture.genre.rappel").isSelected)
            constat("« Plusieurs choses ? Rémy les range une à une » s'affiche pour une seule phrase (une virgule suffit à la déclencher).",
                    siFaux: !boutonContenant("Plusieurs choses").exists)
            try toucher(ident("capture.genre.retenir"), "puce Retenir")
            try etape("genre-retenir", attendu: [ident("capture.valider")])
            try toucher(ident("capture.valider"), "Retenir")
            try etape("retenue", absent: [champ], delai: 20)
        }
    }

    @MainActor
    func test07_capturerTacheDatee() {
        jouer("P07", "Noter une tâche avec une échéance (« vendredi »)") {
            lancer()
            try attendreAccueil()
            try toucher(ident("noter"), "+")
            let champ = ident("capture.champ")
            try etape("feuille-noter", attendu: [champ])
            try saisir("Envoyer le devis a Hugo vendredi", dans: champ)
            try etape("genre-devine", attendu: [ident("capture.genre.rappel")])
            let devine = ident("capture.genre.rappel").isSelected ? "rappel" : ident("capture.genre.tache").isSelected ? "tâche" : "autre"
            noter("genre deviné pour une tâche datée : \(devine)")
            try toucher(ident("capture.genre.tache"), "puce Tâche")
            try etape("force-en-tache", attendu: [texte("Motion lui trouvera un créneau")])
            // Une tâche « pour vendredi » doit garder vendredi comme échéance.
            constat("Tâche datée : forcée en « Tâche », l'échéance dite (vendredi) n'apparaît nulle part et n'est pas transmise à Motion (noterTache crée la tâche sans échéance, Modeles.swift:305).",
                    siFaux: texte("échéance").exists || texte("avant vendredi").exists)
            try toucher(ident("capture.valider"), "Ajouter à Motion")
            try confirmationApresFeuille("Ajoutée à Motion", champ: champ)
        }
    }

    @MainActor
    func test08_capturerElementDeListe() {
        jouer("P08", "Ajouter des courses, puis les retrouver dans la liste") {
            lancer()
            try attendreAccueil()
            try toucher(ident("noter"), "+")
            let champ = ident("capture.champ")
            try etape("feuille-noter", attendu: [champ])
            try saisir("Bananes, farine et levure", dans: champ)
            try etape("genre-liste", attendu: [texte("Courses")])
            try toucher(ident("capture.valider"), "Ajouter à la liste")
            try confirmationApresFeuille("3 articles dans « Courses »", champ: champ)
            try toucher(onglet("projets"), "onglet Projets")
            let courses = boutonContenant("Courses,")
            try etape("projets", attendu: [courses])
            try toucher(courses, "liste Courses")
            try etape("liste-courses", attendu: [texteI("bananes"), texteI("levure")])
        }
    }

    // MARK: - Rémy (conversation)

    @MainActor
    func test09_ajusterPuisAccepterProposition() {
        jouer("P09", "Ajuster une proposition de Rémy (durée), puis l'accepter") {
            lancer()
            try attendreAccueil()
            try ouvrirConversation("Abonnement de Tom")
            let ligne = boutonContenant("Acheter abonnement Claude Code pour Tom")
            try etape("proposition", attendu: [ligne, bouton("Oui, fais-le"), bouton("Non merci")])
            auditerCibles("Rémy, proposition")
            try toucher(ligne, "ligne de la proposition")
            try etape("ajuster", attendu: [texte("Ajuster l'ajout"), bouton("30 min")])
            auditerCibles("Ajuster")
            try toucher(bouton("30 min"), "30 min")
            try toucher(bouton("Enregistrer"), "Enregistrer")
            try etape("ajustee", attendu: [bouton("Oui, fais-le")], absent: [texte("Ajuster l'ajout")])
            try toucher(bouton("Oui, fais-le"), "Oui, fais-le")
            try etape("faite", attendu: [texte("C'est fait")], delai: 20)
        }
    }

    @MainActor
    func test10_refuserProposition() {
        jouer("P10", "Refuser une proposition de Rémy") {
            lancer()
            try attendreAccueil()
            try ouvrirConversation("Vidange de la Twingo")
            try etape("proposition", attendu: [bouton("Non merci"), bouton("Oui, fais-le")])
            try toucher(bouton("Non merci"), "Non merci")
            try etape("refusee", attendu: [texte("rien n'a été changé")], absent: [bouton("Oui, fais-le")], delai: 10)
            constat("« Non merci » efface la proposition du fil, sans trace ni « Annuler » : un refus touché par erreur ne se rattrape pas, et rien ne rappelle ce qui avait été proposé.",
                    siFaux: bouton("Annuler").exists || texte("Prendre rendez-vous pour la vidange").exists)
        }
    }

    @MainActor
    func test11_demanderARemyQuiPropose() {
        jouer("P11", "Demander à Rémy de caler une tâche, puis dire oui") {
            lancer()
            try attendreAccueil()
            try toucher(onglet("remy"), "onglet Rémy")
            try toucher(bouton("Nouvelle conversation"), "Nouvelle conversation")
            let composeur = app.textViews["Écris à Rémy…"]
            try etape("nouvelle-conversation", attendu: [composeur])
            try toucher(composeur, "composeur")
            try saisir("Il faut que je prepare la facture Ondine avant vendredi", dans: composeur)
            try toucher(bouton("Envoyer"), "Envoyer")
            try etape("message-parti", attendu: [texte("prepare la facture Ondine")], delai: 8)
            let oui = bouton("Oui, fais-le")
            try etape("proposition", attendu: [oui], delai: 45)
            RunLoop.current.run(until: Date().addingTimeInterval(1.5))
            constat("La proposition arrive sous le clavier : « Oui, fais-le » n'est pas visible sans défiler (le fil ne descend pas jusqu'au bas de la carte, clavier ouvert).",
                    siFaux: oui.isHittable)
            try toucher(oui, "Oui, fais-le")
            try etape("faite", attendu: [texte("C'est fait")], delai: 20)
        }
    }

    // MARK: - La journée, la semaine

    @MainActor
    func test12_parcourirJourneeEtSemaine() {
        jouer("P12", "Parcourir la journée (à l'échelle) et chercher la semaine") {
            lancer()
            try attendreAccueil()
            let dejeuner = boutonContenant("Déjeuner avec Léa")
            amener(dejeuner)
            try etape("la-suite", attendu: [dejeuner])
            try appuiLong(dejeuner)
            let echelle = texte("Les durées sont à l'échelle")
            if !echelle.waitForExistence(timeout: 5) {
                // Vu au 3e run : l'appui long a ouvert le panneau de la ligne, comme
                // un simple toucher. Sam fermerait et réessaierait, plus longuement.
                capturer("appui-pris-pour-un-toucher")
                noter("appui long (0,8 s) sur une ligne de la suite pris pour un toucher : panneau de la ligne au lieu de la journée à l'échelle ; second essai à 1,5 s")
                try fermerSurimpression()
                try appuiLong(dejeuner, duree: 1.5)
            }
            try etape("journee-a-l-echelle", attendu: [echelle])
            try fermerSurimpression()
            try etape("retour", absent: [texte("Les durées sont à l'échelle")])
            // La semaine : Sam la cherche sur l'accueil puis dans Projets.
            balayerVersLeHaut()
            balayerVersLeHaut()
            try etape("bas-de-l-accueil")
            try toucher(onglet("projets"), "onglet Projets")
            try etape("projets", attendu: [texteI("Où tu mets ton énergie")])
            let semaine = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] %@", "semaine")).firstMatch
            constat("Pas de vue « semaine » : ni l'accueil ni Projets ne montrent les jours à venir ; il faut demander à Rémy.",
                    siFaux: semaine.exists)
        }
    }

    // MARK: - Listes, rappels, carnet

    @MainActor
    func test13_ouvrirUneListeEtCocher() {
        jouer("P13", "Au magasin : ouvrir Courses et cocher") {
            lancer()
            try attendreAccueil()
            try toucher(onglet("projets"), "onglet Projets")
            let courses = boutonContenant("Courses,")
            try etape("projets", attendu: [courses])
            try toucher(courses, "liste Courses")
            try etape("liste", attendu: [bouton("Tomates"), bouton("Œufs")])
            auditerCibles("Liste")
            try toucher(bouton("Tomates"), "Tomates")
            try toucher(bouton("Œufs"), "Œufs")
            try etape("cochees", attendu: [texteI("pris")])
            let tomates = bouton("Tomates")
            XCTAssertTrue(tomates.isSelected, "Tomates doit être marquée prise")
        }
    }

    @MainActor
    func test14_creerUnRappel() {
        jouer("P14", "Créer un rappel daté depuis le « + »") {
            lancer()
            try attendreAccueil()
            try toucher(ident("noter"), "+")
            let champ = ident("capture.champ")
            try etape("feuille-noter", attendu: [champ])
            try saisir("Appeler le plombier demain 10h", dans: champ)
            try etape("genre-rappel", attendu: [texte("Créer le rappel")])
            try toucher(ident("capture.valider"), "Créer le rappel")
            // La première fois, iOS demande l'autorisation des notifications.
            capturer("demande-notifications")
            accepterAlerteSysteme(6)
            try confirmationApresFeuille("Rappel : demain", champ: champ)
            try toucher(onglet("projets"), "onglet Projets")
            try toucher(bouton("Tout voir"), "Tout voir (rappels)")
            try etape("dans-les-rappels", attendu: [texte("Appeler le plombier")])
        }
    }

    @MainActor
    func test15_chercherDansLeCarnet() {
        jouer("P15", "Retrouver l'anniversaire de Hugo dans le carnet") {
            lancer()
            try attendreAccueil()
            try toucher(onglet("projets"), "onglet Projets")
            try etape("projets", attendu: [texteI("Où tu mets ton énergie")])
            auditerCibles("Projets")
            constat("Pas de recherche dans le carnet (listes, rappels, projets) : seule la liste des conversations a un champ « Chercher ».",
                    siFaux: app.searchFields.firstMatch.exists)
            let anniversaires = boutonContenant("Anniversaires,")
            try etape("tuiles", attendu: [anniversaires])
            try toucher(anniversaires, "Anniversaires")
            try etape("trouve", attendu: [texte("Hugo — 2 juin")])
        }
    }

    // MARK: - Réglages

    @MainActor
    func test16_changerUnReglage() {
        jouer("P16", "Réglages : passer en sombre, puis revenir") {
            lancer()
            try attendreAccueil()
            try toucher(bouton("Réglages"), "Réglages")
            try etape("reglages", attendu: [texte("Apparence"), bouton("Sombre")])
            auditerCibles("Réglages")
            try toucher(bouton("Sombre"), "Sombre")
            try etape("sombre", attendu: [bouton("Fermer")])
            try toucher(bouton("Fermer"), "Fermer")
            try etape("accueil-sombre", attendu: [ident("maintenant.terminer")])
            try toucher(bouton("Réglages"), "Réglages")
            try toucher(bouton("Comme l'iPhone"), "Comme l'iPhone")
            try etape("comme-l-iphone", attendu: [bouton("Fermer")])
            try toucher(bouton("Fermer"), "Fermer")
            try etape("fin", attendu: [ident("maintenant.terminer")])
        }
    }

    // MARK: - Cas difficiles

    @MainActor
    func test17_tourInjoignableEnPleinUsage() {
        jouer("P17", "La tour s'éteint en plein usage, puis revient") {
            defer { Pilote.relancerTour() }
            lancer()
            try attendreAccueil()
            try etape("journee", attendu: [ident("maintenant.terminer")])
            Pilote.couperTour()
            try toucher(ident("maintenant.terminer"), "Terminer")
            try etape("coche-sans-tour", attendu: [texte("joignable")], delai: 20)
            // Tirer pour rafraîchir : l'écran doit dire pourquoi rien ne vient.
            tirerPourRafraichir()
            try etape("tirer-pour-rafraichir", attendu: [texte("injoignable")], delai: 20)
            Pilote.relancerTour()
            try toucher(bouton("Réessayer"), "Réessayer")
            try etape("tour-revenue", absent: [texte("injoignable")], delai: 30)
            // Ce qui attendait part : au besoin, « Réessayer » sur la ligne des changements.
            let attente = texte("partira dès que Rémy sera joignable")
            var essais = 0
            while attente.exists && essais < 3 {
                RunLoop.current.run(until: Date().addingTimeInterval(4))
                if attente.exists, let r = app.buttons.matching(NSPredicate(format: "label == %@", "Réessayer")).allElementsBoundByIndex.last, r.isHittable {
                    compter()
                    r.tap()
                }
                essais += 1
            }
            try etape("plus-rien-en-attente", absent: [attente], delai: 30)
        }
    }

    @MainActor
    func test18_texteTresLong() {
        jouer("P18", "Coller un très long texte dans le « + »") {
            lancer()
            try attendreAccueil()
            try toucher(ident("noter"), "+")
            let champ = ident("capture.champ")
            try etape("feuille-noter", attendu: [champ])
            let long = String(repeating: "Penser a demander le devis du plombier pour la cuisine, comparer avec celui de la semaine derniere et rappeler Hugo pour le planning du chantier. ", count: 2)
            try saisir(long, dans: champ)
            try etape("texte-long", attendu: [ident("capture.valider")])
            let valider = ident("capture.valider")
            constat("Texte très long : le bouton d'envoi du « + » n'est plus touchable (sous le clavier ou hors de la feuille).",
                    siFaux: valider.isHittable)
            constat("Texte très long : le champ dépasse la largeur de l'écran.",
                    siFaux: champ.frame.maxX <= app.frame.maxX + 1)
            try toucher(bouton("Fermer"), "Fermer")
            try etape("ferme", absent: [champ])
        }
    }

    @MainActor
    func test19_dynamicTypeTresGrand() {
        jouer("P19", "Texte système au plus grand (Dynamic Type AX5)") {
            // D'abord la taille normale, pour comparer.
            lancer()
            try attendreAccueil()
            // Le titre de la carte (serif) et un libellé courant (Inter) : l'onglet.
            let titreTache = nomme(app.staticTexts.matching(NSPredicate(format: "label == %@", "Finaliser la démo de la boutique")).firstMatch, "titre de la carte")
            try etape("taille-normale", attendu: [titreTache, onglet("aujourdhui")])
            let hTitre = titreTache.frame.height
            let hOnglet = onglet("aujourdhui").frame.height
            app.terminate()
            lancer(arguments: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
            try attendreAccueil()
            try etape("tres-grand", attendu: [titreTache])
            let hTitreG = titreTache.frame.height
            let hOngletG = onglet("aujourdhui").frame.height
            noter(String(format: "titre de la carte (serif) %.0f → %.0f pt ; onglet « Aujourd'hui » (Inter) %.0f → %.0f pt", hTitre, hTitreG, hOnglet, hOngletG))
            constat("Dynamic Type incohérent : les titres en serif (Police.titre, taille fixe) ne bougent pas, le texte courant (Inter) grandit sans plafond et se casse en plein mot (« restant/es », « Aujour/d'hui ») ou se tronque (« Boutiqu… »).",
                    siFaux: hTitreG > hTitre * 1.3 || hOngletG < hOnglet * 1.3)
            if !ident("maintenant.terminer").isHittable { noter("au plus grand, « Terminer » demande de défiler") }
            balayerVersLeHaut()
            try etape("defile")
            try toucher(ident("noter"), "+")
            try etape("noter-tres-grand", attendu: [ident("capture.champ")])
        }
    }

    // MARK: - Le matin

    @MainActor
    func test20_trierLesSujetsDeLaNuit() {
        jouer("P20", "Le matin : trier les sujets de la nuit (« À voir avec Rémy »)") {
            lancer()
            try attendreAccueil()
            try toucher(bouton("À voir avec Rémy"), "boîte « À voir avec Rémy »")
            try etape("boite", attendu: [app.navigationBars["À voir avec Rémy"], bouton("C'est fait"), bouton("Laisser tomber")])
            auditerCibles("À voir avec Rémy")
            try toucher(bouton("C'est fait"), "C'est fait")
            try etape("sujet-fait", attendu: [bouton("Rouvrir")], delai: 10)
            try toucher(bouton("Laisser tomber"), "Laisser tomber")
            try etape("sujet-laisse", attendu: [texte("Laissé de côté")], delai: 10)
            try toucher(bouton("En parler à Rémy"), "En parler à Rémy")
            let composeur = app.textViews["Écris à Rémy…"]
            try etape("question-preparee", attendu: [composeur], absent: [app.navigationBars["À voir avec Rémy"]], delai: 10)
            let prepare = (composeur.value as? String) ?? ""
            noter("question préparée dans le composeur : \(prepare.isEmpty ? "vide" : "\(prepare.count) caractères")")
            constat("« En parler à Rémy » depuis un sujet de la nuit n'amène pas la question dans le composeur.",
                    siFaux: !prepare.isEmpty && prepare != "Écris à Rémy…")
        }
    }

    // MARK: - Outils des parcours

    /// Onglet Rémy, liste des conversations, puis le fil voulu.
    @MainActor
    private func ouvrirConversation(_ titre: String) throws {
        try toucher(onglet("remy"), "onglet Rémy")
        try toucher(bouton("Conversations"), "Conversations")
        let fil = nomme(app.collectionViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", titre)).firstMatch, "ligne « \(titre) »")
        try etape("conversations", attendu: [app.navigationBars["Conversations"]])
        if !fil.waitForExistence(timeout: 3) || !fil.isHittable {
            // Plus bas dans la liste : Sam cherche par son titre.
            let recherche = app.searchFields.firstMatch
            try toucher(recherche, "Chercher une conversation")
            try saisir(String(titre.split(separator: " ").first ?? ""), dans: recherche)
            try etape("recherche", attendu: [fil])
        }
        try toucher(fil, titre)
        try etape("fil-ouvert", attendu: [texte(titre)], absent: [app.navigationBars["Conversations"]])
    }

    /// Referme un panneau superposé (conseil, journée à l'échelle) : sa croix
    /// « Fermer » (la dernière : le fond porte le même libellé), sinon un toucher
    /// à côté du panneau.
    @MainActor
    private func fermerSurimpression() throws {
        let croix = app.buttons.matching(NSPredicate(format: "label == %@", "Fermer")).allElementsBoundByIndex.filter { $0.isHittable }
        compter()
        if croix.count >= 2, let c = croix.last {
            c.tap()
        } else {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.07)).tap()
        }
    }
}
