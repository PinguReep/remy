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
                // Des tutoriels entiers, 6 pages au plus : la suite au lancement suivant.
                let compteur = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Nouveau · 1/")).firstMatch
                let pages = compteur.exists ? Int(compteur.label.split(separator: "/").last ?? "") ?? 0 : 1
                noter("tutoriel des nouveautés : \(pages) page(s)")
                verifier("Le tutoriel des nouveautés tient en 6 pages au plus.", pages <= 6)
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
            // Vu sur le build 37 : l'échéance menacée, l'offre du briefing (et le
            // bilan, le soir) passent au-dessus ; la carte du moment est sous le pli.
            constat("À l'ouverture, la carte « Maintenant » (et « Terminer ») est sous le pli : l'échéance menacée et l'offre du briefing (le bilan, le soir) passent devant ; il faut défiler pour voir quoi faire.",
                    siFaux: ident("maintenant.terminer").isHittable)
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
            amenerDoucement(ident("maintenant.terminer"))
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
                // (Visible et touchable : la même étiquette existe, cachée, dans Projets.)
                let aVenir = nomme(app.staticTexts.matching(NSPredicate(format: "label == %@", "À VENIR")).firstMatch, "carte « À VENIR »")
                let debut = Date()
                RunLoop.current.run(until: Date().addingTimeInterval(3))
                capturer("carte-apres-commencer")
                let encoreAVenir = aVenir.exists && aVenir.isHittable
                if encoreAVenir {
                    while aVenir.exists && aVenir.isHittable && Date().timeIntervalSince(debut) < 70 {
                        RunLoop.current.run(until: Date().addingTimeInterval(1))
                    }
                    noter(String(format: "la tâche commencée reste « À VENIR · maintenant » %.0f s avant de passer en cours", Date().timeIntervalSince(debut)))
                    capturer("carte-enfin-en-cours")
                }
                constat("Après « Commencer », la carte dit encore « À VENIR · maintenant » : la tâche ne passe « EN COURS » (avec son temps restant) qu'à la minute suivante, quand l'écran se recalcule.",
                        siFaux: !encoreAVenir)
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
            amenerDoucement(ident("maintenant.gerer"))
            try toucher(ident("maintenant.gerer"), "Gérer")
            // Le panneau refait par l'ergonomie (24/10) : puces « +15 min »
            // (« Prolonger de 15 minutes » pour VoiceOver), « Décaler » en un toucher.
            let plus15 = bouton("Prolonger de 15 minutes")
            try etape("gerer", attendu: [plus15, bouton("Décaler : demain")])
            auditerCibles("Gérer")
            try toucher(plus15, "+15 min")
            let prolonger = nomme(app.buttons.matching(NSPredicate(format: "label == %@ OR label == %@", "Prolonger de 15 min", "Prolonger quand même")).firstMatch,
                                  "bouton « Prolonger de 15 min »")
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
            amenerDoucement(ident("maintenant.gerer"))
            try toucher(ident("maintenant.gerer"), "Gérer")
            // « Décaler » est dans le panneau (ergonomie, 24/10) : un toucher.
            let demain = bouton("Décaler : demain")
            try etape("gerer", attendu: [demain, bouton("Choisir une date")])
            try toucher(demain, "Demain")
            try etape("decalee", attendu: [texte("à faire d'ici")], delai: 15)
            // Levé par l'ergonomie : Décaler referme le panneau, comme Prolonger.
            verifier("Décaler referme le panneau « Gérer » : le message ne se pose plus sur ses actions.",
                     attendreDisparition(demain, delai: 5))
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
            // Les puces du « + » font 44 pt depuis l'ergonomie du 24/10 : vérifié.
            auditerCibles("Noter (+)", strict: true)
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
            // Un jour sans heure, pour une action : une tâche à échéance (date
            // limite, pas un créneau), plus un rappel à 9 h (corrigé : GenreCapture.deviner).
            let echeance = texte("avant l'échéance : vendredi")
            try etape("genre-devine", attendu: [ident("capture.genre.tache"), echeance])
            let devine = ident("capture.genre.rappel").isSelected ? "rappel" : ident("capture.genre.tache").isSelected ? "tâche" : "autre"
            noter("genre deviné pour une tâche datée : \(devine)")
            verifier("« Envoyer le devis a Hugo vendredi » doit être devinée « Tâche » (un jour sans heure n'est pas un rappel).",
                     devine == "tâche")
            // Changer le genre à la main ne perd pas la date comprise.
            try toucher(ident("capture.genre.rappel"), "puce Rappel")
            try etape("change-en-rappel", attendu: [texte("Rappel → ")], absent: [texte("Rappel sans date")])
            try toucher(ident("capture.genre.tache"), "puce Tâche")
            try etape("revient-en-tache", attendu: [texte("Motion lui trouvera un créneau"), echeance])
            try toucher(ident("capture.valider"), "Ajouter à Motion")
            try confirmationApresFeuille("Ajoutée à Motion", champ: champ)
            verifier("La confirmation dit l'échéance transmise à Motion (« à faire d'ici vendredi … »).",
                     texte("à faire d'ici vendredi").exists)
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
            // Corrigé : à l'arrivée d'une proposition, le clavier se range et le fil
            // descend jusqu'au bas de la carte (RemyView, Fil).
            verifier("La proposition doit être entièrement visible : « Oui, fais-le » touchable sans défiler, clavier rangé.",
                     oui.isHittable && !clavier.exists)
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
            // L'appui long sur « La suite » ouvre la journée à l'échelle. Le planning
            // suit l'heure du run (le déjeuner peut être passé : vu le 25/10 à 17 h) ;
            // la ligne « Toute la journée » est là à toute heure.
            let suite = texte("Toute la journée : Salon du design")
            amener(suite)
            try etape("la-suite", attendu: [suite])
            try appuiLong(suite)
            let echelle = texte("Les durées sont à l'échelle")
            if !echelle.waitForExistence(timeout: 5) {
                capturer("appui-sans-effet")
                noter("appui long (0,8 s) sur « La suite » sans effet ; second essai à 1,5 s")
                try appuiLong(suite, duree: 1.5)
            }
            try etape("journee-a-l-echelle", attendu: [echelle, bouton("7 jours")])
            // La semaine (24/10) : le constat « pas de vue semaine » est levé ; elle
            // est à un toucher de la journée, et c'est vérifié ici.
            try toucher(bouton("7 jours"), "7 jours")
            try etape("sept-jours", attendu: [texte("Les 7 jours")])
            try toucher(bouton("Demain"), "Demain")
            try etape("demain", attendu: [texteI("les durées sont à l'échelle")])
            try fermerSurimpression()
            try etape("retour", absent: [texte("Les durées sont à l'échelle"), texte("Les 7 jours")])
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
            // La première fois, iOS demande l'autorisation des notifications,
            // avant la confirmation ; déjà donnée, la feuille se ferme aussitôt.
            capturer("demande-notifications")
            accepterAlerteSysteme(8, tantQue: { champ.exists })
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
            amenerDoucement(ident("maintenant.terminer"))
            try toucher(ident("maintenant.terminer"), "Terminer")
            try etape("coche-sans-tour", attendu: [texte("joignable")], delai: 20)
            // Tirer pour rafraîchir : l'écran doit dire pourquoi rien ne vient.
            // La carte du moment est sous le pli (build 37) : l'écran a défilé
            // pour « Terminer » ; le premier geste le ramène en haut, le second tire.
            tirerPourRafraichir()
            if !texte("injoignable").waitForExistence(timeout: 8) { tirerPourRafraichir() }
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
            // Levé par l'ergonomie du 24/10 (titres en serif qui suivent la taille) : vérifié.
            verifier("Dynamic Type : les titres en serif grandissent avec le texte courant (titre \(Int(hTitre)) → \(Int(hTitreG)) pt).",
                     hTitreG > hTitre * 1.3 || hOngletG < hOnglet * 1.3)
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
            // Depuis le rendez-vous quotidien (24/10), les sujets de la nuit sont
            // dans « Ton briefing » (même bouton en haut, autre libellé).
            let briefing = app.navigationBars["Ton briefing"]
            try toucher(bouton("Ton briefing et les sujets de la nuit"), "briefing et sujets de la nuit")
            try etape("boite", attendu: [briefing, bouton("C'est fait"), bouton("Laisser tomber")])
            auditerCibles("Ton briefing")
            try toucher(bouton("C'est fait"), "C'est fait")
            try etape("sujet-fait", attendu: [bouton("Rouvrir")], delai: 10)
            try toucher(bouton("Laisser tomber"), "Laisser tomber")
            try etape("sujet-laisse", attendu: [texte("Laissé de côté")], delai: 10)
            try toucher(bouton("En parler à Rémy"), "En parler à Rémy")
            let composeur = app.textViews["Écris à Rémy…"]
            try etape("question-preparee", attendu: [composeur], absent: [briefing], delai: 10)
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
