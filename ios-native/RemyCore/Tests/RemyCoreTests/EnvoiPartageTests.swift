import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import RemyCore

/// La feuille de partage (24/10) : démêler ce qui arrive d'une autre app,
/// préparer ce qui part, dire en clair ce qui échoue.
final class EnvoiPartageTests: XCTestCase {
    let jpeg = Data([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10])

    // MARK: Découpage texte / lien

    func testUnTexteSeul() {
        let c = ContenuPartage(textes: ["  Penser à rappeler Léa pour la boutique de bougies.  "])
        XCTAssertEqual(c.genre, .texte)
        XCTAssertEqual(c.texte, "Penser à rappeler Léa pour la boutique de bougies.")
        XCTAssertNil(c.lien)
    }

    func testUnTexteQuiNEstQuUneAdresseDevientLeLien() {
        let c = ContenuPartage(textes: ["https://exemple.org/bougies"])
        XCTAssertEqual(c.genre, .lien)
        XCTAssertEqual(c.lien?.absoluteString, "https://exemple.org/bougies")
        XCTAssertNil(c.texte)
    }

    func testLeLienEnvoyeDeuxFoisNEstGardeQuUneFois() {
        // Safari : l'URL en pièce jointe, et la même en texte.
        let c = ContenuPartage(textes: ["https://exemple.org/bougies/"], liens: [URL(string: "https://Exemple.org/bougies")!], titre: "Bougies artisanales")
        XCTAssertEqual(c.lien?.absoluteString, "https://Exemple.org/bougies")
        XCTAssertEqual(c.titre, "Bougies artisanales")
        XCTAssertNil(c.texte)
    }

    func testTitreEtAdresseDansLeMemeTexte() {
        // Beaucoup d'apps partagent « Titre https://… » en un seul texte.
        let c = ContenuPartage(textes: ["Le guide des cires végétales https://exemple.org/cires"], liens: [URL(string: "https://exemple.org/cires")!])
        XCTAssertEqual(c.titre, "Le guide des cires végétales")
        XCTAssertNil(c.texte)
        XCTAssertEqual(c.genre, .lien)
    }

    func testUnLongTexteAvecUnLienResteUnTexte() {
        let long = "Hugo m'a envoyé ça :\nil faut comparer les mèches en coton et en bois avant la commande de novembre."
        let c = ContenuPartage(textes: [long], liens: [URL(string: "https://exemple.org/meches")!])
        XCTAssertEqual(c.texte, long)
        XCTAssertNil(c.titre)
        XCTAssertEqual(c.genre, .lien)
    }

    func testSeulsLesLiensWebComptent() {
        let c = ContenuPartage(textes: ["file:///tmp/x.pdf"], liens: [URL(string: "file:///tmp/x.pdf")!, URL(string: "mailto:lea@exemple.org")!])
        XCTAssertNil(c.lien)
        XCTAssertEqual(c.texte, "file:///tmp/x.pdf", "gardé comme texte, pas comme lien")
        XCTAssertEqual(ContenuPartage(textes: ["  ", ""]).genre, .vide)
    }

    func testUneImagePrimeSurLeReste() {
        let i = ImagePartagee(donnees: jpeg, largeur: 10, hauteur: 20, texteLu: "  Facture 42\nTotal 18 €\n\n ")
        let c = ContenuPartage(textes: ["Capture"], image: i)
        XCTAssertEqual(c.genre, .image)
        XCTAssertEqual(c.image?.texteLu, "Facture 42\nTotal 18 €")
        XCTAssertEqual(c.image?.lignesLues, 2)
        XCTAssertNil(ImagePartagee(donnees: jpeg, largeur: 1, hauteur: 1, texteLu: " \n ").texteLu)
    }

    // MARK: Ce qui part

    func testLeTexteDeLaCapture() {
        let c = ContenuPartage(liens: [URL(string: "https://exemple.org/cires")!], titre: "Le guide des cires")
        XCTAssertEqual(EnvoiPartage.texteCapture(c, mot: "  à lire ce week-end "),
                       "Lien partagé : « Le guide des cires »\nhttps://exemple.org/cires\n\nMon mot pour Rémy : à lire ce week-end")
        XCTAssertEqual(EnvoiPartage.texteCapture(ContenuPartage(textes: ["Un texte"]), mot: "  "), "Un texte")
    }

    func testCeQuiManqueEstDitAvantDEnvoyer() {
        XCTAssertNotNil(EnvoiPartage.manque(ContenuPartage(), mot: nil))
        XCTAssertNotNil(EnvoiPartage.manque(ContenuPartage(), mot: "un mot"), "un mot seul ne suffit pas")
        // La tour refuse les textes trop courts : on le dit avant, avec quoi faire.
        let court = ContenuPartage(textes: ["Acheter du lait"])
        XCTAssertEqual(EnvoiPartage.manque(court, mot: nil), "Un peu court pour que Rémy en tire quelque chose : ajoute un mot pour lui.")
        XCTAssertNil(EnvoiPartage.manque(court, mot: "pour le gâteau de Léa samedi"))
        XCTAssertNil(EnvoiPartage.manque(ContenuPartage(textes: ["https://exemple.org/a"]), mot: nil), "un lien seul passe (son libellé l'allonge)")
        XCTAssertNil(EnvoiPartage.manque(ContenuPartage(image: ImagePartagee(donnees: jpeg, largeur: 1, hauteur: 1)), mot: nil), "une photo sans texte est rangée")
        XCTAssertNotNil(EnvoiPartage.manque(court, mot: String(repeating: "a", count: 501)))
    }

    func testLesDimensionsDUneImageReduite() {
        XCTAssertTrue(EnvoiPartage.dimensions(largeur: 4032, hauteur: 3024) == (1600, 1200))
        XCTAssertTrue(EnvoiPartage.dimensions(largeur: 1179, hauteur: 2556) == (738, 1600))
        XCTAssertTrue(EnvoiPartage.dimensions(largeur: 800, hauteur: 600) == (800, 600), "jamais agrandie")
        XCTAssertTrue(EnvoiPartage.dimensions(largeur: 0, hauteur: 600) == (0, 0))
        XCTAssertEqual(EnvoiPartage.qualitesImage, EnvoiPartage.qualitesImage.sorted(by: >), "de la meilleure à la plus légère")
        XCTAssertLessThan(EnvoiPartage.poidsImage, 3_000_000, "sous le plafond de la tour")
    }

    func testCeQuOnCopieSiLEnvoiEchoue() {
        let i = ImagePartagee(donnees: jpeg, largeur: 1, hauteur: 1, texteLu: "Facture 42")
        XCTAssertEqual(EnvoiPartage.texteACopier(ContenuPartage(image: i), mot: "à payer"), "Facture 42\n\nMon mot pour Rémy : à payer")
        XCTAssertEqual(EnvoiPartage.texteACopier(ContenuPartage(textes: ["Un texte"]), mot: nil), "Un texte")
        // Image + lien + texte (une app de vente) : rien ne se perd.
        let vente = ContenuPartage(textes: ["Lampe en laiton, 49 € — à offrir à Léa"], liens: [URL(string: "https://exemple.org/produit/42")!],
                                   titre: "Lampe Atelier", image: ImagePartagee(donnees: jpeg, largeur: 1, hauteur: 1))
        XCTAssertEqual(EnvoiPartage.texteACopier(vente, mot: nil),
                       "Lien partagé : « Lampe Atelier »\nhttps://exemple.org/produit/42\n\nLampe en laiton, 49 € — à offrir à Léa")
        let corps = EnvoiPartage.corpsImage(vente, vente.image!, mot: nil)
        XCTAssertEqual(corps["lien"] as? String, "https://exemple.org/produit/42")
        XCTAssertEqual(corps["joint"] as? String, "Lampe en laiton, 49 € — à offrir à Léa")
        XCTAssertEqual(corps["depuis"] as? String, "iphone", "la tour dit l'appareil réel")
    }

    // MARK: Ce qui revient

    func testLeRecu() {
        var r = RetourCapture(ajouts: ["Sam compare les mèches en coton et en bois"], memoire: true, message: nil)
        XCTAssertEqual(RecuPartage(r).titre, "J'ai compris. Classé.")
        XCTAssertEqual(RecuPartage(r).detail, "Retenu : Sam compare les mèches en coton et en bois")
        r = RetourCapture(ajouts: [], memoire: false, message: "Image rangée dans ton coffre (Captures/Images).")
        r.image = "Captures/Images/x.jpg"
        XCTAssertEqual(RecuPartage(r).titre, "Image rangée.")
        XCTAssertEqual(RecuPartage(r).detail, "Image rangée dans ton coffre (Captures/Images).")
        // Une tour qui ne garde pas les images : rien n'est « rangé ».
        XCTAssertEqual(RecuPartage(RetourCapture(ajouts: [], memoire: false, message: "Image reçue, mais cette tour ne garde pas les images.")).titre, "Image reçue.")
        r = RetourCapture(ajouts: [], memoire: true, message: nil)
        XCTAssertEqual(RecuPartage(r).titre, "J'ai compris. Classé.")
        XCTAssertEqual(RecuPartage(r).detail, "Rien de nouveau : Rémy le savait déjà.")
        // Le modèle local absent : l'image est quand même gardée, et c'est dit.
        r = RetourCapture(ajouts: [], memoire: false, message: "Pas absorbé tout de suite (le modèle local ne répond pas) : Rémy le relira cette nuit.")
        r.image = "Captures/Images/x.jpg"
        XCTAssertEqual(RecuPartage(r).titre, "Gardé, pas encore classé.")
        XCTAssertEqual(RecuPartage(r).detail, "Image gardée sur ta tour. Pas absorbé tout de suite (le modèle local ne répond pas) : Rémy le relira cette nuit.")
    }

    func testLesErreursSontDitesEnClair() {
        let pasConnecte = EchecPartage(ErreurPartage.nonConnecte)
        XCTAssertEqual(pasConnecte.titre, "Ouvre Rémy une fois")
        XCTAssertFalse(pasConnecte.reessayable)
        XCTAssertFalse(EchecPartage(ErreurAPI.nonConnecte).reessayable)
        let injoignable = EchecPartage(ErreurAPI.reseau("timeout"))
        XCTAssertEqual(injoignable.titre, "Ta tour ne répond pas : vérifie Tailscale")
        XCTAssertTrue(injoignable.reessayable)
        let refus = EchecPartage(ErreurAPI.serveur(413, "Image trop lourde pour la tour (3 Mo au plus)"))
        XCTAssertEqual(refus.detail, "Image trop lourde pour la tour (3 Mo au plus)")
        XCTAssertEqual(EchecPartage(refus), refus)
    }

    // MARK: Envoi (faux serveur)

    func client() -> ClientAPI {
        let conf = URLSessionConfiguration.ephemeral
        conf.protocolClasses = [FauxServeur.self]
        FauxServeur.recues = []
        FauxServeur.corps = [:]
        return ClientAPI(base: URL(string: "https://remy.test")!, session: URLSession(configuration: conf), coffre: CoffreMemoire("jeton-essai"))
    }

    func testUnLienPartParLaCaptureAvecSaSource() async throws {
        FauxServeur.reponses = ["POST /api/capture": [(200, #"{"ok":true,"ajouts":["Sam lit le guide des cires"],"memoire":true}"#)]]
        let api = client()
        let recu = try await api.partager(ContenuPartage(liens: [URL(string: "https://exemple.org/cires")!], titre: "Le guide des cires"), mot: nil)
        XCTAssertEqual(recu.detail, "Retenu : Sam lit le guide des cires")
        XCTAssertEqual(FauxServeur.corps["POST /api/capture"]?["source"] as? String, "partage")
        XCTAssertEqual(FauxServeur.corps["POST /api/capture"]?["texte"] as? String, "Lien partagé : « Le guide des cires »\nhttps://exemple.org/cires")
        XCTAssertEqual(FauxServeur.autorisations["POST /api/capture"], "Bearer jeton-essai")
    }

    func testUneImagePartParSaRoute() async throws {
        FauxServeur.reponses = ["POST /api/capture/image": [(200, #"{"ok":true,"ajouts":[],"memoire":false,"message":"Image rangée dans ton coffre (Captures/Images).","image":"Captures/Images/x.jpg"}"#)]]
        let api = client()
        let i = ImagePartagee(donnees: jpeg, largeur: 1, hauteur: 1, texteLu: "Facture 42")
        let recu = try await api.partager(ContenuPartage(image: i), mot: "à payer")
        XCTAssertEqual(recu.detail, "Image rangée dans ton coffre (Captures/Images).")
        let corps = FauxServeur.corps["POST /api/capture/image"]
        XCTAssertEqual(corps?["image"] as? String, jpeg.base64EncodedString())
        XCTAssertEqual(corps?["texte"] as? String, "Facture 42")
        XCTAssertEqual(corps?["mot"] as? String, "à payer")
        XCTAssertNil(FauxServeur.corps["POST /api/capture"], "rien d'autre n'est parti")
    }

    func testUneTourAncienneNeRecoitPasLeTexteLu() async throws {
        // La capture ordinaire d'une tour ancienne ne garde pas le texte lu au
        // modèle local : rien ne part, Sam met la tour à jour (ou copie).
        FauxServeur.reponses = [
            "POST /api/capture/image": [(404, "{}")],
            "POST /api/capture": [(200, #"{"ok":true,"ajouts":[],"memoire":false}"#)],
        ]
        let api = client()
        let i = ImagePartagee(donnees: jpeg, largeur: 1, hauteur: 1, texteLu: "Rendez-vous chez Hugo jeudi à 18 h")
        do {
            _ = try await api.partager(ContenuPartage(image: i), mot: nil)
            XCTFail("une tour sans route d'image doit le dire")
        } catch let e as EchecPartage {
            XCTAssertEqual(e.titre, "Ta tour ne sait pas encore recevoir d'images")
            XCTAssertFalse(e.reessayable)
        }
        XCTAssertNil(FauxServeur.corps["POST /api/capture"], "le texte lu ne repart pas par la capture ordinaire")
    }

    func testUnRefusDeLaTourEstRapporteTelQuel() async {
        FauxServeur.reponses = ["POST /api/capture/image": [(413, #"{"error":"capture","message":"Image trop lourde pour la tour (3 Mo au plus) : réduis-la avant de l'envoyer."}"#)]]
        let api = client()
        do {
            _ = try await api.partager(ContenuPartage(image: ImagePartagee(donnees: jpeg, largeur: 1, hauteur: 1)), mot: nil)
            XCTFail("le refus doit remonter")
        } catch {
            XCTAssertEqual(EchecPartage(error).detail, "Image trop lourde pour la tour (3 Mo au plus) : réduis-la avant de l'envoyer.")
        }
    }

    func testRienNePartSiLeContenuEstTropCourt() async {
        let api = client()
        do {
            _ = try await api.partager(ContenuPartage(textes: ["ok"]), mot: nil)
            XCTFail("trop court")
        } catch {
            XCTAssertFalse(EchecPartage(error).reessayable)
        }
        XCTAssertEqual(FauxServeur.recues, [], "aucune requête")
    }

    // MARK: Contre le vrai serveur (CI : REMY_TEST_URL)

    func testPartageContreLeVraiServeur() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let u = env["REMY_TEST_URL"], let url = URL(string: u), let mdp = env["REMY_TEST_MDP"] else {
            throw XCTSkip("REMY_TEST_URL absent")
        }
        let api = ClientAPI(base: url, session: URLSession(configuration: .ephemeral), coffre: CoffreMemoire())
        try await api.connexion(motDePasse: mdp, appareil: "Essai partage")
        guard try await api.versionServeur().sait("partage-v1") else { throw XCTSkip("serveur sans partage-v1") }
        // Un vrai JPEG de 1×1 : rangé, sans appel au modèle.
        let octets = try XCTUnwrap(Data(base64Encoded: "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="))
        let seule = try await api.partager(ContenuPartage(image: ImagePartagee(donnees: octets, largeur: 1, hauteur: 1)), mot: nil)
        XCTAssertEqual(seule.titre, "Image rangée.")
        XCTAssertTrue(seule.detail.hasPrefix("Image rangée"), seule.detail)
        // Avec du texte lu : gardée, jamais envoyée au cloud (modèle local seulement).
        let lue = try await api.partager(ContenuPartage(image: ImagePartagee(donnees: octets, largeur: 1, hauteur: 1, texteLu: "Atelier bougies jeudi 18 h chez Hugo")), mot: "à noter")
        XCTAssertTrue(lue.detail.hasPrefix("Image gardée sur ta tour."), lue.detail)
        // Un format refusé revient en clair.
        do {
            _ = try await api.partager(ContenuPartage(image: ImagePartagee(donnees: Data("GIF89a".utf8), largeur: 1, hauteur: 1)), mot: nil)
            XCTFail("un GIF doit être refusé")
        } catch {
            XCTAssertTrue(EchecPartage(error).detail.contains("JPEG ou PNG"), EchecPartage(error).detail)
        }
    }
}
