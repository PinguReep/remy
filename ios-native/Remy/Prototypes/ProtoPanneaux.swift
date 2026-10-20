import SwiftUI

// Panneaux superposés (spec §4.4) : fond flouté, bords visibles, fermeture par
// un toucher à l'extérieur. Pas des « sheets » iOS, qui ne se ferment pas au
// toucher extérieur (plan §4.3).

struct ProtoSurimpression<Contenu: View>: View {
    @Environment(\.accessibilityReduceMotion) private var reduire
    let fermer: () -> Void
    var depuisLeBas = true
    @ViewBuilder var contenu: () -> Contenu
    @State private var visible = false

    var body: some View {
        ZStack(alignment: depuisLeBas ? .bottom : .center) {
            Rectangle()
                .fill(.ultraThinMaterial)
                .overlay(Color.black.opacity(0.14))
                .ignoresSafeArea()
                .onTapGesture(perform: fermer)
                .accessibilityLabel("Fermer")
                .accessibilityAddTraits(.isButton)
            contenu()
                .offset(y: visible || reduire ? 0 : (depuisLeBas ? 260 : 24))
                .scaleEffect(visible || reduire || depuisLeBas ? 1 : 0.95)
                .opacity(visible ? 1 : 0)
        }
        .onAppear {
            withAnimation(.spring(response: 0.42, dampingFraction: 0.86)) { visible = true }
        }
    }
}

// MARK: - Gérer

struct ProtoGerer: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t
    let bloc: ProtoBloc

    var body: some View {
        let cat = t.couleur(bloc.categorie)
        let enCours = etat.enCours?.id == bloc.id
        VStack(alignment: .leading, spacing: 16) {
            Capsule().fill(t.filet).frame(width: 38, height: 5).frame(maxWidth: .infinity)
            VStack(alignment: .leading, spacing: 6) {
                ProtoPuce(texte: bloc.projet ?? bloc.categorie.nom, couleur: cat)
                Text(bloc.titre)
                    .font(t.titre(22, t.estAtelier ? .semibold : .bold))
                    .foregroundStyle(t.encre)
                    .fixedSize(horizontal: false, vertical: true)
                Text(ligneHoraire(enCours: enCours))
                    .font(t.chiffres(14))
                    .foregroundStyle(t.encre2)
            }
            if bloc.genre == .rdv || bloc.genre == .trajet {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "lock.fill").font(.system(size: 13, weight: .semibold))
                    Text(bloc.genre == .rdv
                         ? "Rendez-vous protégé : Remy ne le déplace jamais sans toi. Il vit dans ton agenda Google."
                         : "Marge de trajet protégée : rien ne sera planifié dedans.")
                        .font(t.texte(14))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .foregroundStyle(t.encre2)
                .padding(12)
                .background(t.surface2.opacity(0.7), in: RoundedRectangle(cornerRadius: t.rayonControle, style: .continuous))
            }
            if enCours {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Prolonger").font(t.texte(14, .semibold)).foregroundStyle(t.encre2)
                    HStack(spacing: 8) {
                        ForEach([5, 15, 30], id: \.self) { m in puce("+\(m) min", choisie: etat.choixProlongation == m) { etat.choisir(m) } }
                        puce("Autre…", choisie: false) {}
                    }
                    if let m = etat.choixProlongation {
                        ProtoImpact(minutes: m)
                            .transition(.opacity.combined(with: .offset(y: -6)))
                    }
                }
            }
            VStack(spacing: 0) {
                if bloc.genre == .tache {
                    action("calendar.badge.clock", "Replanifier", "Plus tard, demain, une autre date")
                    action("hand.raised", "Bloquée", "Dis ce qui bloque, Remy la met de côté")
                    action("square.and.pencil", "Détails", "Durée, priorité, échéance, projet, notes")
                    action("questionmark.bubble", "Est-ce raisonnable ?", "Demander l'avis de Remy")
                } else {
                    action("calendar", "Ouvrir dans l'agenda", "Google Agenda")
                    action("car", "Marges de trajet", "20 min avant, 10 min après")
                }
                action("clock.arrow.circlepath", "Journal", "Ce qui a changé, et comment l'annuler", dernier: true)
            }
            .background(t.surface2.opacity(t.estAtelier ? 0.45 : 0.6),
                        in: RoundedRectangle(cornerRadius: t.rayonControle + 2, style: .continuous))
        }
        .padding(.horizontal, 20)
        .padding(.top, 10)
        .padding(.bottom, 20)
        .frame(maxWidth: .infinity)
        .protoCarte(t, rayon: t.estAtelier ? 26 : 36)
        .padding(.horizontal, 10)
        .padding(.bottom, 6)
    }

    private func ligneHoraire(enCours: Bool) -> String {
        let plage = "\(ProtoTemps.heure(bloc.debut)) – \(ProtoTemps.heure(etat.fin(bloc)))"
        return enCours ? "\(plage) · il reste \(ProtoTemps.duree(etat.restant(bloc)))" : plage
    }

    private func puce(_ texte: String, choisie: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(texte)
                .font(t.texte(15, .semibold))
                .monospacedDigit()
                .foregroundStyle(choisie ? (t.estAtelier ? t.fond : Color.white) : t.encre)
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(choisie ? (t.estAtelier ? t.encre : t.signal) : t.surface2,
                            in: RoundedRectangle(cornerRadius: t.estAtelier ? 12 : 22, style: .continuous))
        }
        .buttonStyle(ProtoAppui())
    }

    private func action(_ symbole: String, _ titre: String, _ sous: String, dernier: Bool = false) -> some View {
        Button {} label: {
            HStack(spacing: 14) {
                Image(systemName: symbole)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(t.encre)
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text(titre).font(t.texte(16, .medium)).foregroundStyle(t.encre)
                    Text(sous).font(t.texte(13)).foregroundStyle(t.encre2)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(t.encre3)
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 56)
            .overlay(alignment: .bottom) {
                if !dernier { Rectangle().fill(t.filet).frame(height: t.estAtelier ? 1 : 0.5).padding(.leading, 52) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// L'impact d'une prolongation, ESTIMÉ (Motion recalcule seul, plan §4.3) :
/// un RDV protégé n'est jamais cassé sans accord (AC-05).
struct ProtoImpact: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t
    let minutes: Int

    var body: some View {
        let finMaquette = ProtoTemps.a(11, 30).addingTimeInterval(TimeInterval((etat.prolongation + minutes) * 60))
        let retard = Int(finMaquette.timeIntervalSince(ProtoTemps.a(11, 35)) / 60)
        VStack(alignment: .leading, spacing: 12) {
            if retard <= 0 {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(t.couleur(.sport))
                    Text(ProtoTemps.insecable("Fin à \(ProtoTemps.heureFR(finMaquette)). Tu pars juste à temps pour le déjeuner."))
                        .font(t.texte(15))
                        .foregroundStyle(t.encre)
                        .fixedSize(horizontal: false, vertical: true)
                }
                ProtoBouton(titre: "Prolonger de \(minutes) min", hauteur: 46) { etat.prolonger(minutes) }
            } else {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(t.alerte)
                    Text(ProtoTemps.insecable("Fin à \(ProtoTemps.heureFR(finMaquette)) : tu arriverais au déjeuner avec Léa \(retard) min en retard. Il est protégé."))
                        .font(t.texte(15))
                        .foregroundStyle(t.encre)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack(alignment: .top, spacing: 10) {
                    ProtoRemyMarque(taille: 22)
                    Text(ProtoTemps.insecable("Plutôt : finir à 11 h 30 et reprendre \(minutes) min à 15 h 45, après l'assurance."))
                        .font(t.texte(15, .medium))
                        .foregroundStyle(t.encre)
                        .fixedSize(horizontal: false, vertical: true)
                }
                VStack(spacing: 8) {
                    ProtoBouton(titre: "Reprendre à 15 h 45", hauteur: 46) { etat.reprendrePlusTard() }
                    ProtoBouton(titre: "Prolonger quand même", principal: false, hauteur: 46) { etat.prolonger(minutes) }
                }
                Text("Estimation : Motion recalcule la suite, Remy vérifie après coup.")
                    .font(t.texte(12))
                    .foregroundStyle(t.encre3)
            }
        }
        .padding(14)
        .background((retard <= 0 ? t.couleur(.sport) : t.alerte).opacity(0.08),
                    in: RoundedRectangle(cornerRadius: t.rayonControle + 2, style: .continuous))
    }
}

// MARK: - La journée agrandie (appui long)

struct ProtoPlanningEtendu: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t
    private let echelle: CGFloat = 1.15
    private let heures = Array(8...23)

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Jeudi 15 octobre").font(t.titre(22, t.estAtelier ? .semibold : .bold)).foregroundStyle(t.encre)
                    Text("Les durées sont à l'échelle").font(t.texte(13)).foregroundStyle(t.encre2)
                }
                Spacer()
                HStack(spacing: 2) {
                    Text("Jour")
                        .font(t.texte(13, .semibold))
                        .foregroundStyle(t.encre)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 30)
                        .background(t.surface, in: Capsule())
                    Text("Semaine")
                        .font(t.texte(13, .medium))
                        .foregroundStyle(t.encre2)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 30)
                }
                .padding(3)
                .background(t.surface2, in: Capsule())
                Button { etat.fermerPanneaux() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(t.encre2)
                        .frame(width: 30, height: 30)
                        .background(t.surface2, in: Circle())
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Fermer")
            }
            .padding(.leading, 18)
            .padding(.trailing, 8)
            .padding(.vertical, 10)
            Rectangle().fill(t.filet).frame(height: t.estAtelier ? 1 : 0.5)
            ScrollViewReader { defilement in
                ScrollView {
                    ZStack(alignment: .topLeading) {
                        grille
                        GeometryReader { g in
                            ForEach(etat.blocs) { b in
                                blocVue(b)
                                    .frame(width: g.size.width - 64, height: hauteur(b))
                                    .offset(x: 60, y: y(b.debut))
                            }
                            maintenant(largeur: g.size.width)
                        }
                    }
                    .frame(height: CGFloat(heures.count - 1) * 60 * echelle + 24)
                    .padding(.horizontal, 12)
                    .padding(.top, 12)
                }
                .scrollIndicators(.hidden)
                .task {
                    try? await Task.sleep(nanoseconds: 60_000_000)
                    defilement.scrollTo("h9", anchor: .top)
                }
            }
        }
        .containerRelativeFrame(.vertical) { hauteur, _ in hauteur * 0.92 }
        .protoCarte(t, rayon: t.estAtelier ? 26 : 36)
        .padding(.horizontal, 10)
    }

    private var grille: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(heures, id: \.self) { h in
                HStack(alignment: .top, spacing: 8) {
                    Text(String(format: "%02d:00", h))
                        .font(t.chiffres(11, .medium))
                        .foregroundStyle(t.encre3)
                        .frame(width: 44, alignment: .trailing)
                        .offset(y: -7)
                    Rectangle().fill(t.filet).frame(height: t.estAtelier ? 1 : 0.5)
                }
                .frame(height: h == heures.last ? 12 : 60 * echelle, alignment: .top)
                .id("h\(h)")
            }
        }
    }

    private func y(_ d: Date) -> CGFloat { ProtoTemps.minutesDepuisMatin(d) * echelle }

    private func hauteur(_ b: ProtoBloc) -> CGFloat {
        max(CGFloat(etat.fin(b).timeIntervalSince(b.debut) / 60) * echelle - 2, 18)
    }

    @ViewBuilder
    private func blocVue(_ b: ProtoBloc) -> some View {
        let cat = t.couleur(b.categorie)
        let h = hauteur(b)
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                if b.genre == .rdv { Image(systemName: "lock.fill").font(.system(size: 9, weight: .bold)) }
                if b.genre == .trajet { Image(systemName: "car.fill").font(.system(size: 9)) }
                Text(b.genre == .trajet ? "Trajet · \(b.minutes) min" : b.titre)
                    .font(t.texte(12, .semibold))
                    .lineLimit(1)
                    .strikethrough(b.fait, color: t.encre3)
                if b.echeance {
                    Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 9)).foregroundStyle(t.alerte)
                }
            }
            .foregroundStyle(b.fait ? t.encre3 : t.encre)
            if h >= 38 {
                Text("\(ProtoTemps.heure(b.debut)) – \(ProtoTemps.heure(etat.fin(b)))")
                    .font(t.chiffres(11))
                    .foregroundStyle(t.encre2)
            }
        }
        .padding(.leading, 10)
        .padding(.trailing, 6)
        .padding(.vertical, h >= 38 ? 6 : 2)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(fond(b, cat), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(alignment: .leading) {
            if b.genre != .trajet {
                RoundedRectangle(cornerRadius: 1.5).fill(cat).frame(width: 3).padding(.vertical, 4).padding(.leading, 3)
            }
        }
        .overlay {
            if b.genre == .trajet {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(t.encre3.opacity(0.6), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
            } else if b.genre == .rdv {
                RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(cat.opacity(0.7), lineWidth: 1)
            }
        }
        .opacity(b.fait ? 0.55 : 1)
    }

    private func fond(_ b: ProtoBloc, _ cat: Color) -> Color {
        switch b.genre {
        case .rdv: return cat.opacity(0.24)
        case .tache: return cat.opacity(b.fait ? 0.06 : 0.14)
        case .trajet: return t.surface2.opacity(0.5)
        }
    }

    private func maintenant(largeur: CGFloat) -> some View {
        HStack(spacing: 0) {
            Text(ProtoTemps.heure(etat.maintenant))
                .font(t.chiffres(10, .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 5)
                .padding(.vertical, 2)
                .background(t.signal, in: Capsule())
            Rectangle().fill(t.signal).frame(height: 1.5)
        }
        .frame(width: largeur - 4)
        .offset(x: 12, y: y(etat.maintenant) - 8)
        .allowsHitTesting(false)
    }
}

// MARK: - Message d'annulation et légende

struct ProtoToastVue: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t

    var body: some View {
        if let m = etat.toast {
            HStack(spacing: 12) {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(t.signal)
                Text(m.texte)
                    .font(t.texte(15, .medium))
                    .foregroundStyle(t.fond)
                    .lineLimit(2)
                Spacer(minLength: 4)
                if let annuler = m.annuler {
                    Button {
                        Haptique.leger()
                        withAnimation(.easeOut(duration: 0.18)) { etat.toast = nil }
                        annuler()
                    } label: {
                        Text("Annuler")
                            .font(t.texte(15, .semibold))
                            .foregroundStyle(t.signal)
                            .frame(minWidth: 44, minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.leading, 16)
            .padding(.trailing, 8)
            .frame(minHeight: 54)
            .background(t.encre, in: RoundedRectangle(cornerRadius: t.estAtelier ? 16 : 27, style: .continuous))
            .shadow(color: Color.black.opacity(0.18), radius: 16, x: 0, y: 6)
            .padding(.horizontal, 14)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .task(id: m.id) {
                guard !etat.figerToast else { return }
                try? await Task.sleep(nanoseconds: 4_500_000_000)
                if etat.toast?.id == m.id {
                    withAnimation(.easeOut(duration: 0.2)) { etat.toast = nil }
                }
            }
        }
    }
}

struct ProtoLegende: View {
    @Environment(ProtoEtat.self) private var etat

    var body: some View {
        if let l = etat.legende {
            Text(l)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(Color.black.opacity(0.78), in: Capsule())
                .padding(.top, 4)
                .transition(.opacity.combined(with: .offset(y: -8)))
                .id(l)
        }
    }
}
