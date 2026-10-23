import CoreLocation
import SwiftUI
import UIKit
import RemyCore

/// Réglages › Localisation (20/10) : l'allumer (coupée par défaut), la mettre
/// en pause, voir où Rémy croit que tu es, nommer un lieu, tout effacer.
/// Les positions vont à la tour, qui traduit les adresses chez elle.
struct LieuxVue: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var fermer
    @State private var nomIci = ""
    @State private var nommerOuvert = false
    @State private var aRenommer: LieuTour?
    @State private var nouveauNom = ""
    @State private var effacerOuvert = false
    @State private var position = false
    @State private var autorisation = CapteurLocalisation.partage.autorisation

    var body: some View {
        let m = app.lieux
        NavigationStack {
            List {
                Section {
                    Toggle(isOn: Binding(get: { m.active }, set: { allumer($0) })) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Localisation").font(Police.texte(16, .medium)).foregroundStyle(Palette.encre)
                            Text("Tes arrivées et départs (iOS les détecte, presque sans batterie) et tes trajets en voiture vont à ta tour. Rémy sait où tu en es dans ta journée.")
                                .font(Police.texte(13))
                                .foregroundStyle(Palette.encre2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .tint(Palette.signal)
                    .frame(minHeight: 60)
                    if m.active { autorisationLigne }
                    if m.active {
                        if m.enPause, let p = m.pauseJusqua {
                            Button { m.reprendre() } label: {
                                Label("En pause jusqu'à \(Format.heure(p)) — reprendre", systemImage: "play.circle")
                                    .frame(minHeight: 44)
                            }
                        } else {
                            Button { Haptique.leger(); m.pause() } label: {
                                Label("Pause 2 h", systemImage: "pause.circle").frame(minHeight: 44)
                            }
                        }
                    }
                }

                if let v = m.vue {
                    Section("En ce moment") {
                        Text(v.etat.phrase).font(Police.texte(15)).foregroundStyle(Palette.encre)
                        Button {
                            nomIci = ""
                            nommerOuvert = true
                        } label: {
                            Label(position ? "Je cherche où tu es…" : "Nommer ce lieu", systemImage: "mappin.and.ellipse").frame(minHeight: 44)
                        }
                        .disabled(position || !m.active)
                    }
                    if !v.aujourdhui.isEmpty {
                        Section("Aujourd'hui") {
                            ForEach(v.aujourdhui) { visite in
                                HStack {
                                    Text(visite.lieu?.lisible ?? "Lieu sans adresse connue")
                                        .font(Police.texte(15))
                                        .foregroundStyle(Palette.encre)
                                    Spacer(minLength: 8)
                                    Text(Format.heure(visite.arrivee) + (visite.depart.map { "–" + Format.heure($0) } ?? ""))
                                        .font(Police.mono(13))
                                        .foregroundStyle(Palette.encre2)
                                        .monospacedDigit()
                                }
                                .frame(minHeight: 36)
                            }
                        }
                    }
                    Section("Tes lieux") {
                        if v.lieux.isEmpty {
                            Text("Aucun lieu pour l'instant : ils apparaissent avec tes premières visites.")
                                .font(Police.texte(14))
                                .foregroundStyle(Palette.encre2)
                        }
                        ForEach(v.lieux) { l in
                            Button {
                                // Un commerce reconnu : son nom est proposé, Sam confirme.
                                nouveauNom = l.nom ?? l.commerce?.nom ?? ""
                                aRenommer = l
                            } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(l.affiche).font(Police.texte(15, l.nom == nil ? .regular : .medium)).foregroundStyle(Palette.encre)
                                    if l.nom != nil, let a = l.adresse {
                                        Text(a).font(Police.texte(13)).foregroundStyle(Palette.encre2)
                                    }
                                    if l.nom == nil, let c = l.commerce {
                                        Text("Sans doute : \(c.libelle)")
                                            .font(Police.texte(13, .medium))
                                            .foregroundStyle(Palette.signal)
                                    }
                                    Text(sousTitre(l)).font(Police.texte(12)).foregroundStyle(Palette.encre3)
                                }
                                .frame(minHeight: 44, alignment: .leading)
                            }
                            .buttonStyle(.plain)
                            .swipeActions {
                                Button(role: .destructive) { Task { await m.supprimer(l) } } label: { Label("Oublier", systemImage: "trash") }
                            }
                        }
                    }
                    Section {
                        if v.geocodage?.pret != true {
                            Text("Ta tour n'a pas encore sa base d'adresses : les lieux restent sans adresse. Sur la tour : scripts/geo-importer.mjs.")
                                .font(Police.texte(13))
                                .foregroundStyle(Palette.encre2)
                                .fixedSize(horizontal: false, vertical: true)
                        } else if v.commerces?.aRefaire == true {
                            Text("La base des commerces de ta tour date d'avant les dernières règles : relance scripts/commerces-importer.mjs sur la tour.")
                                .font(Police.texte(13))
                                .foregroundStyle(Palette.encre2)
                                .fixedSize(horizontal: false, vertical: true)
                        } else if v.commerces != nil, v.commerces?.pret != true {
                            Text("Ta tour ne connaît pas encore les commerces autour de toi (coiffeur, drive, salle…). Sur la tour : scripts/commerces-importer.mjs.")
                                .font(Police.texte(13))
                                .foregroundStyle(Palette.encre2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        if !m.enAttente.isEmpty {
                            Text("\(m.enAttente.count) position\(m.enAttente.count > 1 ? "s" : "") attend\(m.enAttente.count > 1 ? "ent" : "") la tour : elles partiront dès qu'elle répond.")
                                .font(Police.texte(13))
                                .foregroundStyle(Palette.encre2)
                        }
                        Text("Gardé \(v.jours ?? 90) jours sur ta tour, puis effacé. Les adresses sont traduites chez toi : aucune position ne part chez Apple ni chez Claude.")
                            .font(Police.texte(12))
                            .foregroundStyle(Palette.encre3)
                            .fixedSize(horizontal: false, vertical: true)
                        Button(role: .destructive) { effacerOuvert = true } label: {
                            Label("Effacer l'historique", systemImage: "trash").frame(minHeight: 44)
                        }
                    }
                } else if let e = m.erreur {
                    Section {
                        Text(e).font(Police.texte(15)).foregroundStyle(Palette.danger)
                        BoutonTexte("Réessayer") { Task { await m.charger() } }
                    }
                } else {
                    Section { Squelette(largeurs: [0.6, 0.9, 0.5]) }
                }
            }
            .navigationTitle("Localisation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("OK") { fermer() } } }
            .task { if ProcessInfo.processInfo.environment["REMY_DEMO_ECRAN"] != "lieux" { await m.charger() } }
            .refreshable { await m.charger() }
            .alert("Nommer ce lieu", isPresented: $nommerOuvert) {
                TextField("Salle de sport, chez maman…", text: $nomIci)
                Button("Nommer") { Task { await nommerIci() } }
                    .disabled(nomIci.trimmingCharacters(in: .whitespaces).isEmpty)
                Button("Annuler", role: .cancel) {}
            } message: {
                Text("Rémy le reconnaîtra à chaque passage.")
            }
            .alert("Renommer", isPresented: Binding(get: { aRenommer != nil }, set: { if !$0 { aRenommer = nil } })) {
                TextField("Nom du lieu", text: $nouveauNom)
                Button("Renommer") {
                    if let l = aRenommer { Task { await m.renommer(l, nouveauNom.trimmingCharacters(in: .whitespaces)) } }
                }
                .disabled(nouveauNom.trimmingCharacters(in: .whitespaces).isEmpty)
                Button("Annuler", role: .cancel) {}
            }
            .confirmationDialog("Effacer tes visites et trajets ?", isPresented: $effacerOuvert, titleVisibility: .visible) {
                Button("Tout effacer", role: .destructive) { Task { await m.toutEffacer() } }
            } message: {
                Text("Sur la tour et sur cet iPhone. Les lieux que tu as nommés restent.")
            }
        }
    }

    @ViewBuilder
    private var autorisationLigne: some View {
        switch autorisation {
        case .authorizedAlways:
            EmptyView()
        case .authorizedWhenInUse:
            ligneReglages("Autorise « Toujours » dans les réglages d'iOS : sans ça, Rémy ne voit tes visites qu'app ouverte.")
        case .denied, .restricted:
            ligneReglages("La localisation est refusée pour Rémy dans les réglages d'iOS.")
        default:
            EmptyView()
        }
    }

    private func ligneReglages(_ texte: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(texte).font(Police.texte(13)).foregroundStyle(Palette.danger).fixedSize(horizontal: false, vertical: true)
            BoutonTexte("Ouvrir les réglages d'iOS") {
                if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) }
            }
        }
    }

    private func sousTitre(_ l: LieuTour) -> String {
        let n = l.visites ?? 0
        let source = l.source == "agenda" ? "reconnu d'après ton agenda" : l.source == "sam" ? "nommé par toi" : "à nommer ?"
        return "\(n) visite\(n > 1 ? "s" : "") · \(source)"
    }

    private func allumer(_ oui: Bool) {
        Haptique.leger()
        app.lieux.activer(oui)
        if oui { CapteurLocalisation.partage.demarrer() } else { CapteurLocalisation.partage.arreter() }
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            autorisation = CapteurLocalisation.partage.autorisation
        }
    }

    private func nommerIci() async {
        let nom = nomIci.trimmingCharacters(in: .whitespaces)
        position = true
        defer { position = false }
        guard let l = await CapteurLocalisation.partage.positionIci() else {
            app.dire("Position introuvable : vérifie que la localisation est autorisée pour Rémy.")
            return
        }
        await app.lieux.nommerIci(nom, lat: l.coordinate.latitude, lon: l.coordinate.longitude)
    }
}

/// Des lieux fictifs pour la capture de la CI (aucune vraie adresse).
enum LieuxDemo {
    static func vue() -> VueLieux {
        let h: Double = 3_600_000
        let maintenant = Date().millis
        let salle = LieuTour(id: "l1", nom: "Salle de sport", adresse: "3 Avenue du Port, 99001 Villefictive", lat: 0, lon: 0, rayon: 80, source: "sam", visites: 12, derniere: maintenant - 0.5 * h)
        let maison = LieuTour(id: "l2", nom: "Maison", adresse: "12 Rue des Lilas, 99001 Villefictive", lat: 0, lon: 0, rayon: 80, source: "sam", visites: 40, derniere: maintenant - 3 * h)
        let coiffeur = LieuTour(id: "l3", nom: "Coiffeur", adresse: "8 Place du Marché, 99002 Bourg-Fictif", lat: 0, lon: 0, rayon: 80, source: "agenda", visites: 1, derniere: maintenant - 26 * h)
        let inconnu = LieuTour(id: "l4", nom: nil, adresse: "21 Chemin des Vignes, 99002 Bourg-Fictif", lat: 0, lon: 0, rayon: 80, source: "auto", visites: 3, derniere: maintenant - 50 * h,
                               commerce: CommerceProche(nom: "Boulangerie des Vignes", type: "boulangerie", distance: 12))
        let ici = { (l: LieuTour) in EtatLieux.Ici(id: l.id, nom: l.nom, adresse: l.adresse) }
        return VueLieux(actif: true, jours: 90,
                        etat: EtatLieux(ou: "lieu", depuis: maintenant - 0.5 * h, lieu: ici(salle)),
                        aujourdhui: [
                            VisiteTour(id: "v1", arrivee: maintenant - 10 * h, depart: maintenant - 4 * h, lieu: ici(maison)),
                            VisiteTour(id: "v2", arrivee: maintenant - 0.5 * h, depart: nil, lieu: ici(salle)),
                        ],
                        lieux: [salle, maison, coiffeur, inconnu],
                        geocodage: GeocodageTour(pret: true, adresses: 1_200_000, departements: ["99"]),
                        commerces: CommercesTour(pret: true, commerces: 48_000))
    }
}
