import SwiftUI

// Les écrans communs aux deux directions : ils prennent la matière du thème
// (typographie, rayons, profondeur), la structure reste la même.

// MARK: - Remy (conversation)

struct ProtoRemyEcran: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t

    var body: some View {
        @Bindable var etat = etat
        VStack(spacing: 0) {
            ProtoTitreEcran(titre: "Remy", surTitre: "Nouvelle conversation") {
                HStack(spacing: 10) {
                    ProtoBoutonRond(symbole: "clock.arrow.circlepath", libelle: "Historique")
                    ProtoBoutonRond(symbole: "square.and.pencil", libelle: "Nouvelle conversation")
                }
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 12) {
                        ProtoRemyMarque(taille: 40)
                        Text("Qu'est-ce qu'on règle ?")
                            .font(t.titre(26, t.estAtelier ? .semibold : .bold))
                            .foregroundStyle(t.encre)
                        Text("Un conseil, un arbitrage, un changement de planning. Remy dit toujours ce qu'il modifie, et tu gardes le dernier mot.")
                            .font(t.texte(15))
                            .foregroundStyle(t.encre2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(ProtoDonnees.suggestions, id: \.self) { s in
                            Button {
                                Haptique.leger()
                                etat.composeur = s
                            } label: {
                                HStack(spacing: 10) {
                                    Text(s)
                                        .font(t.texte(15, .medium))
                                        .foregroundStyle(t.encre)
                                        .multilineTextAlignment(.leading)
                                    Spacer(minLength: 6)
                                    Image(systemName: "arrow.up.left")
                                        .font(.system(size: 12, weight: .semibold))
                                        .foregroundStyle(t.encre3)
                                }
                                .padding(.horizontal, 16)
                                .frame(minHeight: 50)
                                .background(t.estAtelier ? Color.clear : t.surface,
                                            in: RoundedRectangle(cornerRadius: t.estAtelier ? 14 : 18, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: t.estAtelier ? 14 : 18, style: .continuous)
                                    .strokeBorder(t.filet, lineWidth: t.estAtelier ? 1 : 0.5))
                            }
                            .buttonStyle(ProtoAppui())
                        }
                    }
                    HStack(spacing: 8) {
                        Image(systemName: "clock.arrow.circlepath").font(.system(size: 13))
                        Text("Hier · Organiser la semaine de prospection")
                            .font(t.texte(14))
                            .lineLimit(1)
                    }
                    .foregroundStyle(t.encre3)
                }
                .padding(.horizontal, t.estAtelier ? 22 : 20)
                .padding(.top, 30)
                .padding(.bottom, 24)
            }
            .scrollIndicators(.hidden)
            ProtoComposeur(texte: $etat.composeur)
                .padding(.bottom, 92)
        }
    }
}

struct ProtoComposeur: View {
    @Environment(\.protoTheme) private var t
    @Binding var texte: String

    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("Écris à Remy…", text: $texte, axis: .vertical)
                .font(t.texte(16))
                .lineLimit(1...5)
                .foregroundStyle(t.encre)
                .padding(.horizontal, 16)
                .padding(.vertical, 13)
                .background(t.surface, in: RoundedRectangle(cornerRadius: t.estAtelier ? 16 : 24, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: t.estAtelier ? 16 : 24, style: .continuous)
                    .strokeBorder(t.filet, lineWidth: t.estAtelier ? 1 : 0.5))
            Button {} label: {
                Image(systemName: texte.isEmpty ? "mic.fill" : "arrow.up")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(texte.isEmpty ? t.encre : Color.white)
                    .frame(width: 48, height: 48)
                    .background(texte.isEmpty ? t.surface2 : t.signal, in: Circle())
                    .contentTransition(.symbolEffect(.replace))
            }
            .buttonStyle(ProtoAppui())
            .accessibilityLabel(texte.isEmpty ? "Dicter" : "Envoyer")
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }
}

// MARK: - Carnet (navigation A : Aujourd'hui · Remy · Carnet)

struct ProtoCarnet: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t

    var body: some View {
        @Bindable var etat = etat
        NavigationStack(path: $etat.cheminTiers) {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    ProtoTitreEcran(titre: "Carnet", surTitre: "Ce que tu gardes")
                    ProtoRecherche(texte: "Chercher une liste, un projet, une note…")
                        .padding(.horizontal, 16)
                        .padding(.top, -12)
                    listes
                    ProtoSectionProjets(etats: [.active, .legere], titre: "Projets en cours")
                    ProtoSectionProjets(etats: [.idee], titre: "Idées en réserve",
                                        note: "Remy ne les planifie pas tant que tu n'as pas décidé.")
                    ProtoMemoireApercu()
                }
                .padding(.bottom, 130)
            }
            .scrollIndicators(.hidden)
            .background(t.fond)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { id in
                ProtoDetail(id: id)
            }
        }
        .tint(t.encre)
    }

    private var listes: some View {
        let restant = etat.courses.filter { !$0.coche }.count
        let nouveaux = etat.courses.filter { $0.nouveau }.count
        return VStack(alignment: .leading, spacing: 12) {
            ProtoTitreSection(texte: "Listes")
                .padding(.horizontal, t.estAtelier ? 22 : 20)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                ProtoTuileListe(nom: "Courses", symbole: "cart", couleur: t.couleur(.admin),
                                detail: nouveaux > 0 ? "\(restant) articles · \(nouveaux) nouveaux" : "\(restant) articles") {
                    etat.cheminTiers.append("liste-courses")
                }
                ProtoTuileListe(nom: "Pharmacie", symbole: "cross.case", couleur: t.couleur(.sport), detail: "1 article") {}
                ProtoTuileListe(nom: "Cadeau Nina", symbole: "gift", couleur: t.couleur(.proches), detail: "2 idées") {}
                ProtoTuileListe(nom: "Nouvelle liste", symbole: "plus", couleur: t.encre3, detail: "", vide: true) {}
            }
            .padding(.horizontal, 16)
        }
    }
}

struct ProtoRecherche: View {
    @Environment(\.protoTheme) private var t
    let texte: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 15, weight: .medium))
            Text(texte).font(t.texte(15)).lineLimit(1)
            Spacer(minLength: 0)
        }
        .foregroundStyle(t.encre3)
        .padding(.horizontal, 14)
        .frame(minHeight: 44)
        .background(t.surface2.opacity(t.estAtelier ? 0.8 : 1),
                    in: RoundedRectangle(cornerRadius: t.estAtelier ? 12 : 22, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isSearchField)
    }
}

struct ProtoTuileListe: View {
    @Environment(\.protoTheme) private var t
    let nom: String
    let symbole: String
    let couleur: Color
    let detail: String
    var vide = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 0) {
                Image(systemName: symbole)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(couleur)
                    .frame(width: 36, height: 36)
                    .background(vide ? Color.clear : couleur.opacity(0.14),
                                in: RoundedRectangle(cornerRadius: t.estAtelier ? 10 : 18, style: .continuous))
                Spacer(minLength: 12)
                Text(nom).font(t.texte(16, .semibold)).foregroundStyle(vide ? t.encre2 : t.encre)
                if !detail.isEmpty {
                    Text(detail).font(t.texte(13)).foregroundStyle(t.encre2).lineLimit(1)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, minHeight: 116, alignment: .topLeading)
            .modifier(ProtoFondTuile(vide: vide))
        }
        .buttonStyle(ProtoAppui())
    }
}

private struct ProtoFondTuile: ViewModifier {
    @Environment(\.protoTheme) private var t
    let vide: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if vide {
            content.overlay(RoundedRectangle(cornerRadius: t.estAtelier ? 18 : 22, style: .continuous)
                .strokeBorder(t.filet, style: StrokeStyle(lineWidth: 1.2, dash: [5, 4])))
        } else {
            content.protoCarte(t, rayon: t.estAtelier ? 18 : 22)
        }
    }
}

/// Une section de projets (Carnet ou onglet Projets).
struct ProtoSectionProjets: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t
    let etats: [ProtoEtatProjet]
    let titre: String
    var note: String? = nil

    var body: some View {
        let projets = ProtoDonnees.projets.filter { etats.contains($0.etat) }
        VStack(alignment: .leading, spacing: 12) {
            ProtoTitreSection(texte: titre, compte: projets.count)
                .padding(.horizontal, t.estAtelier ? 22 : 20)
            VStack(spacing: 0) {
                ForEach(projets) { p in
                    ProtoLigneProjet(projet: p)
                    if p.id != projets.last?.id {
                        Rectangle().fill(t.filet).frame(height: t.estAtelier ? 1 : 0.5).padding(.leading, 62)
                    }
                }
            }
            .padding(.vertical, 4)
            .protoCarte(t, rayon: t.estAtelier ? 18 : 22)
            .padding(.horizontal, 16)
            if let note {
                Text(note)
                    .font(t.texte(13))
                    .foregroundStyle(t.encre3)
                    .padding(.horizontal, t.estAtelier ? 22 : 20)
            }
        }
    }
}

struct ProtoLigneProjet: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t
    let projet: ProtoProjet

    var body: some View {
        let cat = t.couleur(projet.categorie)
        Button {
            etat.cheminTiers.append("projet-" + projet.id)
        } label: {
            HStack(spacing: 14) {
                Image(systemName: projet.etat == .idee ? "lightbulb" : symbole)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(projet.etat == .idee ? t.encre2 : cat)
                    .frame(width: 34, height: 34)
                    .background((projet.etat == .idee ? t.encre3 : cat).opacity(0.13),
                                in: RoundedRectangle(cornerRadius: t.estAtelier ? 9 : 17, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text(projet.nom).font(t.texte(16, .semibold)).foregroundStyle(t.encre).lineLimit(1)
                    Text(projet.prochaine).font(t.texte(13)).foregroundStyle(t.encre2).lineLimit(1)
                }
                Spacer(minLength: 6)
                if projet.etat == .active {
                    Text("Actif")
                        .font(t.texte(12, .semibold))
                        .foregroundStyle(t.signal)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(t.signal.opacity(0.12), in: Capsule())
                }
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(t.encre3)
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 62)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var symbole: String {
        switch projet.categorie {
        case .musique: return "music.note"
        case .pro: return "briefcase"
        case .maison: return "wrench.and.screwdriver"
        case .proches: return "airplane"
        case .sport: return "figure.run"
        case .admin: return "doc.text"
        }
    }
}

/// La mémoire, telle qu'elle sera au Lot 2 : des fiches avec leur statut.
struct ProtoMemoireApercu: View {
    @Environment(\.protoTheme) private var t

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                ProtoTitreSection(texte: "Ce que Remy sait de toi")
                Spacer()
                Text("Lot 2")
                    .font(t.texte(12, .semibold))
                    .foregroundStyle(t.encre2)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .overlay(Capsule().strokeBorder(t.filet, lineWidth: 1))
            }
            .padding(.horizontal, t.estAtelier ? 22 : 20)
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(ProtoDonnees.fiches.enumerated()), id: \.offset) { i, f in
                    HStack(alignment: .top, spacing: 12) {
                        Text(f.texte).font(t.texte(15)).foregroundStyle(t.encre).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 8)
                        Text(f.statut)
                            .font(t.texte(12, .semibold))
                            .foregroundStyle(f.statut.hasPrefix("Hypo") ? t.couleur(.admin) : t.encre2)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 13)
                    if i < ProtoDonnees.fiches.count - 1 {
                        Rectangle().fill(t.filet).frame(height: t.estAtelier ? 1 : 0.5).padding(.leading, 16)
                    }
                }
            }
            .protoCarte(t, rayon: t.estAtelier ? 18 : 22)
            .padding(.horizontal, 16)
            Text("Sourcées, datées, corrigeables. Une hypothèse n'est jamais traitée comme un fait.")
                .font(t.texte(13))
                .foregroundStyle(t.encre3)
                .padding(.horizontal, t.estAtelier ? 22 : 20)
        }
    }
}

// MARK: - Projets (navigation B : Aujourd'hui · Remy · Projets)

struct ProtoProjets: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t

    var body: some View {
        @Bindable var etat = etat
        NavigationStack(path: $etat.cheminTiers) {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    ProtoTitreEcran(titre: "Projets", surTitre: "Où tu mets ton énergie")
                    ProtoSectionProjets(etats: [.active], titre: "Priorité active")
                    ProtoSectionProjets(etats: [.legere], titre: "Progression légère")
                    ProtoSectionProjets(etats: [.attente], titre: "En attente")
                    ProtoSectionProjets(etats: [.idee], titre: "Idées",
                                        note: "Une idée n'entre pas au planning tant que tu n'as pas décidé de la lancer.")
                }
                .padding(.bottom, 130)
            }
            .scrollIndicators(.hidden)
            .background(t.fond)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { id in
                ProtoDetail(id: id)
            }
        }
        .tint(t.encre)
    }
}

// MARK: - Détails

struct ProtoDetail: View {
    let id: String

    var body: some View {
        if id == "liste-courses" {
            ProtoListeCourses()
        } else {
            ProtoDetailProjet(id: String(id.dropFirst("projet-".count)))
        }
    }
}

struct ProtoListeCourses: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(etat.courses) { a in
                    Button { etat.cocher(a.id) } label: {
                        HStack(spacing: 14) {
                            Image(systemName: a.coche ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 22, weight: .regular))
                                .foregroundStyle(a.coche ? t.encre3 : t.encre2)
                                .contentTransition(.symbolEffect(.replace))
                            Text(a.texte)
                                .font(t.texte(17, .medium))
                                .foregroundStyle(a.coche ? t.encre3 : t.encre)
                                .strikethrough(a.coche, color: t.encre3)
                            Spacer()
                            if a.nouveau && !a.coche {
                                Text("à l'instant").font(t.texte(12, .semibold)).foregroundStyle(t.signal)
                            }
                        }
                        .padding(.horizontal, 18)
                        .frame(minHeight: 54)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    Rectangle().fill(t.filet).frame(height: t.estAtelier ? 1 : 0.5).padding(.leading, 54)
                }
                HStack(spacing: 14) {
                    Image(systemName: "plus").font(.system(size: 18, weight: .medium))
                    Text("Ajouter un article").font(t.texte(17))
                }
                .foregroundStyle(t.encre3)
                .padding(.horizontal, 20)
                .frame(minHeight: 54)
            }
            .padding(.top, 8)
            .padding(.bottom, 130)
        }
        .background(t.fond)
        .navigationTitle("Courses")
        .navigationBarTitleDisplayMode(.large)
    }
}

struct ProtoDetailProjet: View {
    @Environment(\.protoTheme) private var t
    let id: String

    var body: some View {
        let p = ProtoDonnees.projets.first { $0.id == id } ?? ProtoDonnees.projets[0]
        let cat = t.couleur(p.categorie)
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 10) {
                    ProtoPuce(texte: p.categorie.nom, couleur: cat)
                    Text(p.nom).font(t.titre(30, t.estAtelier ? .semibold : .bold)).foregroundStyle(t.encre)
                    Text("Sortie visée en décembre. Quatre titres, deux sont mixés.")
                        .font(t.texte(15))
                        .foregroundStyle(t.encre2)
                }
                .padding(.horizontal, 20)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach([ProtoEtatProjet.active, .legere, .attente, .archive], id: \.self) { e in
                            Text(e.rawValue)
                                .font(t.texte(14, .semibold))
                                .foregroundStyle(e == p.etat ? (t.estAtelier ? t.fond : Color.white) : t.encre2)
                                .padding(.horizontal, 14)
                                .frame(minHeight: 38)
                                .background(e == p.etat ? (t.estAtelier ? t.encre : t.signal) : t.surface2, in: Capsule())
                        }
                    }
                    .padding(.horizontal, 20)
                }
                VStack(alignment: .leading, spacing: 12) {
                    ProtoTitreSection(texte: "Prochaines tâches").padding(.horizontal, 20)
                    VStack(spacing: 0) {
                        ligne("Retouche des photos", "Aujourd'hui 16 h · 1 h 30", cat)
                        Rectangle().fill(t.filet).frame(height: t.estAtelier ? 1 : 0.5).padding(.leading, 16)
                        ligne("Écrire le couplet du titre 4", "Samedi · sans créneau", cat)
                    }
                    .protoCarte(t, rayon: t.estAtelier ? 18 : 22)
                    .padding(.horizontal, 16)
                }
                VStack(alignment: .leading, spacing: 12) {
                    ProtoTitreSection(texte: "Décisions").padding(.horizontal, 20)
                    Text("12 octobre — Sortie repoussée à décembre, pour finir le mix sans rogner la prospection. (toi)")
                        .font(t.texte(15))
                        .foregroundStyle(t.encre)
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .protoCarte(t, rayon: t.estAtelier ? 18 : 22)
                        .padding(.horizontal, 16)
                }
            }
            .padding(.top, 8)
            .padding(.bottom, 130)
        }
        .background(t.fond)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func ligne(_ titre: String, _ sous: String, _ cat: Color) -> some View {
        HStack(spacing: 12) {
            Capsule().fill(cat).frame(width: 4, height: 34)
            VStack(alignment: .leading, spacing: 3) {
                Text(titre).font(t.texte(16, .semibold)).foregroundStyle(t.encre)
                Text(sous).font(t.texte(13)).foregroundStyle(t.encre2)
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 60)
    }
}

// MARK: - Boîte « À voir avec Remy »

struct ProtoBoite: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Les sujets qui méritent ton avis. Rien ne presse : tu peux les remettre à plus tard.")
                        .font(t.texte(15))
                        .foregroundStyle(t.encre2)
                        .padding(.horizontal, 4)
                    if etat.questionsOuvertes.isEmpty {
                        VStack(spacing: 10) {
                            Image(systemName: "checkmark.seal").font(.system(size: 34)).foregroundStyle(t.encre3)
                            Text("Rien à voir avec Remy pour l'instant.").font(t.texte(16, .medium)).foregroundStyle(t.encre2)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 60)
                    }
                    ForEach(etat.questionsOuvertes) { q in
                        ProtoCarteQuestion(question: q)
                            .transition(.asymmetric(insertion: .opacity, removal: .opacity.combined(with: .scale(scale: 0.96))))
                    }
                }
                .padding(16)
            }
            .background(t.fond)
            .navigationTitle("À voir avec Remy")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Fermer") { etat.boiteOuverte = false }.font(t.texte(16, .semibold))
                }
            }
        }
        .tint(t.encre)
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(t.estAtelier ? 24 : 34)
    }
}

struct ProtoCarteQuestion: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t
    let question: ProtoQuestion

    var body: some View {
        let choix = etat.reponses[question.id]
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                ProtoPuce(texte: question.titre, couleur: t.signal)
                Spacer()
                Text(question.quand).font(t.texte(13)).foregroundStyle(t.encre3)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(question.contexte).font(t.texte(15)).foregroundStyle(t.encre2).fixedSize(horizontal: false, vertical: true)
                Text(question.question).font(t.titre(20, .semibold)).foregroundStyle(t.encre)
            }
            VStack(spacing: 8) {
                ForEach(Array(question.options.enumerated()), id: \.offset) { i, option in
                    optionVue(i, option, choisie: choix == i)
                }
                HStack(spacing: 10) {
                    Image(systemName: "pencil").font(.system(size: 13, weight: .semibold))
                    Text("Répondre autrement…").font(t.texte(15))
                    Spacer()
                }
                .foregroundStyle(t.encre3)
                .padding(.horizontal, 14)
                .frame(minHeight: 48)
                .overlay(RoundedRectangle(cornerRadius: t.rayonControle, style: .continuous)
                    .strokeBorder(t.filet, style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
            }
            if let choix {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .top, spacing: 10) {
                        ProtoRemyMarque(taille: 24)
                        Text(question.reformulations[choix])
                            .font(t.texte(15))
                            .foregroundStyle(t.encre)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    HStack(spacing: 10) {
                        ProtoBouton(titre: "Oui, c'est ça", hauteur: 44) { etat.confirmer(question.id) }
                        ProtoBouton(titre: "Corriger", principal: false, hauteur: 44) {}
                    }
                }
                .padding(14)
                .background(t.signal.opacity(0.08), in: RoundedRectangle(cornerRadius: t.rayonControle + 4, style: .continuous))
                .transition(.opacity.combined(with: .offset(y: -6)))
            }
            HStack(spacing: 20) {
                Button("Plus tard") {}
                Button("Ignorer") {}
                Spacer()
            }
            .font(t.texte(14, .semibold))
            .foregroundStyle(t.encre2)
            .buttonStyle(.plain)
        }
        .padding(18)
        .protoCarte(t)
    }

    private func optionVue(_ i: Int, _ option: String, choisie: Bool) -> some View {
        Button { etat.repondre(question.id, i) } label: {
            HStack(alignment: .center, spacing: 12) {
                Text(["A", "B", "C", "D"][min(i, 3)])
                    .font(t.chiffres(13, .semibold))
                    .foregroundStyle(choisie ? (t.estAtelier ? t.fond : Color.white) : t.encre)
                    .frame(width: 28, height: 28)
                    .background(choisie ? (t.estAtelier ? t.encre : t.signal) : t.surface2, in: Circle())
                Text(option)
                    .font(t.texte(15, .medium))
                    .foregroundStyle(t.encre)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(minHeight: 48)
            .background(choisie ? t.encre.opacity(0.05) : Color.clear,
                        in: RoundedRectangle(cornerRadius: t.rayonControle, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: t.rayonControle, style: .continuous)
                .strokeBorder(choisie ? (t.estAtelier ? t.encre : t.signal) : t.filet, lineWidth: choisie ? 1.5 : 1))
        }
        .buttonStyle(ProtoAppui())
    }
}

// MARK: - Capture

struct ProtoCapture: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t
    @FocusState private var focus: Bool

    var body: some View {
        @Bindable var etat = etat
        let texte = etat.texteCapture.trimmingCharacters(in: .whitespacesAndNewlines)
        let analyse: ProtoAnalyse? = texte.isEmpty ? nil : ProtoAnalyse.de(texte, type: etat.typeCapture)
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Noter").font(t.titre(22, t.estAtelier ? .semibold : .bold)).foregroundStyle(t.encre)
                Spacer()
                Button { etat.captureOuverte = false } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(t.encre2)
                        .frame(width: 32, height: 32)
                        .background(t.surface2, in: Circle())
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Fermer")
            }
            TextField("Une course, une tâche, une idée, un rappel…", text: $etat.texteCapture, axis: .vertical)
                .font(t.texte(21, .medium))
                .foregroundStyle(t.encre)
                .lineLimit(1...4)
                .focused($focus)
            HStack(spacing: 8) {
                Image(systemName: analyse?.symbole ?? "wand.and.stars").font(.system(size: 13, weight: .semibold))
                Text(analyse?.apercu ?? "Un mot suffit. Remy classe à l'envoi, jamais avant.")
                    .font(t.texte(14, .medium))
                    .contentTransition(.opacity)
            }
            .foregroundStyle(analyse == nil ? t.encre3 : t.signal)
            .animation(.snappy, value: analyse?.apercu)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(ProtoTypeCapture.allCases) { type in
                        let actif = etat.typeCapture == type
                        Button {
                            Haptique.leger()
                            withAnimation(.snappy) { etat.typeCapture = type }
                        } label: {
                            HStack(spacing: 5) {
                                Image(systemName: type.symbole).font(.system(size: 12, weight: .semibold))
                                Text(type.titre).font(t.texte(14, .semibold))
                            }
                            .foregroundStyle(actif ? (t.estAtelier ? t.fond : Color.white) : t.encre)
                            .padding(.horizontal, 12)
                            .frame(minHeight: 36)
                            .background(actif ? (t.estAtelier ? t.encre : t.signal) : t.surface2, in: Capsule())
                        }
                        .buttonStyle(ProtoAppui())
                    }
                }
            }
            HStack(spacing: 10) {
                Button {} label: {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(t.encre)
                        .frame(width: 52, height: 52)
                        .background(t.surface2, in: Circle())
                }
                .buttonStyle(ProtoAppui())
                .accessibilityLabel("Dicter")
                ProtoBouton(titre: "Noter", symbole: "arrow.up", hauteur: 52) { etat.envoyerCapture() }
                    .disabled(texte.isEmpty)
                    .opacity(texte.isEmpty ? 0.45 : 1)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 14)
        .presentationDetents([.height(360)])
        .presentationCornerRadius(t.estAtelier ? 24 : 34)
        .presentationBackground(t.surface)
        .presentationDragIndicator(.visible)
        .task {
            try? await Task.sleep(nanoseconds: 350_000_000)
            focus = true
        }
    }
}
