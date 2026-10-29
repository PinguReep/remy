import SwiftUI
import RemyCore

/// L'onglet « Projets » (structure du Carnet, J1.1) : les listes en tête (à
/// deux touchers au magasin), les rappels, puis tes projets Motion du plus
/// pressé au plus calme, et ce que Rémy sait de toi. Les projets sont en
/// lecture seule : ils se modifient dans Motion ou avec Rémy.
struct ProjetsView: View {
    @Environment(AppModel.self) private var app
    @Environment(EtatInterface.self) private var ui
    @State private var memoire = false

    var body: some View {
        @Bindable var ui = ui
        NavigationStack(path: $ui.cheminProjets) {
            racine
                .toolbar(.hidden, for: .navigationBar)
                .navigationDestination(for: RouteProjets.self) { r in
                    switch r {
                    case .liste(let id): ListeView(id: id)
                    case .rappels: RappelsView()
                    case .noeud(let id): NoeudView(id: id)
                    case .conversations: ConversationsExternesVue()
                    case .conversationExterne(let source, let id, let autour): ConversationExterneVue(source: source, id: id, autour: autour)
                    case .sourcesConversations: SourcesConversationsVue()
                    }
                }
        }
        .tint(Palette.encre)
    }

    private var racine: some View {
        let p = app.projets
        return ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                TitreEcran(titre: "Projets", surTitre: "Où tu mets ton énergie")
                if app.carnet.disponible || !app.carnet.listes.isEmpty {
                    SectionListes()
                    SectionRappels()
                } else if app.serveur != nil {
                    Vide(texte: "Listes et rappels arriveront ici avec la mise à jour de ta tour.")
                        .padding(20)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .carte()
                        .padding(.horizontal, 16)
                }
                etat
                if let l = p.liste, !l.projets.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        TitreSection(texte: "En cours", compte: l.projets.count).padding(.horizontal, 6)
                        VStack(spacing: 0) {
                            ForEach(Array(l.projets.enumerated()), id: \.element.id) { i, projet in
                                LigneProjet(projet: projet)
                                if i < l.projets.count - 1 {
                                    Rectangle().fill(Palette.filet).frame(height: 1).padding(.leading, 58)
                                }
                            }
                        }
                        .padding(.horizontal, 14)
                        .carte(rayon: 18)
                        if let n = l.sansProjet, n > 0 {
                            Text("\(n) tâche\(n > 1 ? "s" : "") sans projet dans Motion.")
                                .font(Police.texte(13))
                                .foregroundStyle(Palette.encre3)
                                .padding(.horizontal, 6)
                        }
                    }
                    .padding(.horizontal, 16)
                }
                if app.organisation.dossiersDisponibles { SectionDossiers() }
                // Tes conversations d'ailleurs : Claude Code, T3, ChatGPT (29/10).
                if app.conversationsExternes.disponible {
                    CarteConversationsExternes().padding(.horizontal, 16)
                }
                CarteMemoire { memoire = true }
                if let le = p.misAJour {
                    Text("Liste datant \(Format.depuis(le)).")
                        .font(Police.texte(12))
                        .foregroundStyle(Palette.encre3)
                        .padding(.horizontal, 22)
                }
            }
            .padding(.bottom, 48)
        }
        .background(Palette.fond)
        .refreshable {
            async let p: Void = app.projets.charger()
            async let c: Void = app.carnet.charger()
            async let o: Void = app.organisation.charger()
            async let x: Void = app.conversationsExternes.charger()
            _ = await (p, c, o, x)
        }
        .sheet(isPresented: $memoire) { MemoireView() }
    }

    /// Ce qui manque, dit simplement, avec ce qui débloque.
    @ViewBuilder
    private var etat: some View {
        let p = app.projets
        if !p.disponible && p.liste == nil && app.serveur != nil {
            Vide(texte: "Ta tour n'a pas encore la mise à jour qui lit tes projets Motion.")
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
                .carte()
                .padding(.horizontal, 16)
        } else if let e = p.erreur {
            Vide(texte: p.liste == nil ? e : "\(e) Voici les derniers lus.", titreAction: p.chargement ? "…" : "Réessayer") {
                Task { await app.projets.charger() }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .carte()
            .padding(.horizontal, 16)
        } else if p.liste?.motion == false {
            Vide(texte: "Motion n'est pas branché sur ta tour : tes projets s'afficheront ici dès qu'il le sera.")
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
                .carte()
                .padding(.horizontal, 16)
        } else if p.liste == nil {
            Squelette(largeurs: [0.6, 0.9, 0.7])
                .padding(20)
                .carte()
                .padding(.horizontal, 16)
        } else if p.liste?.projets.isEmpty == true {
            Vide(texte: "Aucun projet ouvert dans Motion.")
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
                .carte()
                .padding(.horizontal, 16)
        }
    }
}

/// Un projet : sa couleur, son nom, combien de tâches, la prochaine. Toucher :
/// son arborescence (sous-projets dans Remy) ; tour d'avant : en parler à Rémy.
private struct LigneProjet: View {
    @Environment(AppModel.self) private var app
    @Environment(EtatInterface.self) private var ui
    let projet: Projet

    var body: some View {
        let couleur = Palette.projet(projet.nom)
        Button {
            Haptique.leger()
            if app.organisation.dossiersDisponibles {
                ui.cheminProjets.append(.noeud("motion:" + projet.id))
                return
            }
            Task {
                _ = await app.preparer("Où en est le projet « \(projet.nom) » ? Propose-moi les prochaines étapes.",
                                       dansFil: projet.nom)
            }
        } label: {
            HStack(spacing: 14) {
                Image(systemName: "square.stack.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(couleur)
                    .frame(width: 32, height: 32)
                    .background(couleur.opacity(0.14), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text(projet.nom)
                        .font(Police.texte(16, .medium))
                        .foregroundStyle(Palette.encre)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(detail)
                        .font(Police.texte(13))
                        .foregroundStyle(Palette.encre2)
                        .lineLimit(2)
                    if let r = projet.enRetard, r > 0 { Risque(texte: r > 1 ? "\(r) en retard" : "1 en retard") }
                }
                Spacer(minLength: 0)
                if let s = projet.statut, !s.isEmpty {
                    Text(s)
                        .font(Police.texte(12, .semibold))
                        .foregroundStyle(Palette.encre2)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Palette.fond2, in: Capsule())
                }
            }
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(app.organisation.dossiersDisponibles ? "Ouvre ses sous-projets et ses tâches" : "Prépare une question pour Rémy")
    }

    private var detail: String {
        var bits = [projet.taches == 0 ? "aucune tâche ouverte" : "\(projet.taches) tâche\(projet.taches > 1 ? "s" : "")"]
        if let t = projet.prochaine {
            bits.append("prochaine : " + t.titre + (t.echeance.map { " (\(Format.jourCourt($0.date)))" } ?? ""))
        }
        return bits.joined(separator: " · ")
    }
}

/// Ce que Rémy sait de toi : le résumé (mots, sections), et l'accès au texte.
private struct CarteMemoire: View {
    static func resume(_ m: ResumeMemoire?) -> String {
        guard let m else { return "Lire et corriger sa mémoire" }
        let s = m.sections > 1 ? "s" : ""
        return "\(Format.entier(m.mots)) mots · \(m.sections) section\(s) remplie\(s) sur \(m.totalSections)"
    }

    @Environment(AppModel.self) private var app
    let ouvrir: () -> Void

    var body: some View {
        let m = app.tableau.donnees?.memoire
        VStack(alignment: .leading, spacing: 6) {
            TitreSection(texte: "Mémoire").padding(.horizontal, 6)
            bouton(m)
        }
        .padding(.horizontal, 16)
    }

    private func bouton(_ m: ResumeMemoire?) -> some View {
        Button {
            Haptique.leger()
            ouvrir()
        } label: {
            HStack(spacing: 14) {
                Image(systemName: "person.text.rectangle")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Palette.encre2)
                    .frame(width: 32, height: 32)
                    .background(Palette.fond2, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text("Ce que Rémy sait de toi").font(Police.texte(16, .medium)).foregroundStyle(Palette.encre)
                    Text(Self.resume(m))
                        .font(Police.texte(13))
                        .foregroundStyle(Palette.encre2)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.encre3)
            }
            .padding(14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .carte(rayon: 18)
    }
}
