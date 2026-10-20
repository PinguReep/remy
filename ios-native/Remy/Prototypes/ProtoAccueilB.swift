import SwiftUI

// Direction B — Clarté : l'accueil d'une app iOS native. Grand titre, conseil
// en bulle, le temps restant en gros chiffres, puis la journée en blocs dont la
// hauteur suit (raisonnablement) la durée.

struct ProtoAccueilB: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ProtoTitreEcran(titre: "Aujourd'hui", surTitre: "Jeudi 15 octobre") {
                    ProtoBoutonBoite()
                }
                .padding(.horizontal, -16)
                ProtoConseilB()
                Group {
                    if let b = etat.enCours {
                        ProtoMaintenantB(bloc: b)
                            .transition(.asymmetric(insertion: .opacity.combined(with: .offset(y: 10)),
                                                    removal: .opacity.combined(with: .scale(scale: 0.97))))
                    } else {
                        ProtoLibreB()
                            .transition(.asymmetric(insertion: .opacity.combined(with: .offset(y: 10)),
                                                    removal: .opacity))
                    }
                }
                ProtoSuiteB()
                    .padding(.top, 4)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 130)
        }
        .scrollIndicators(.hidden)
    }
}

struct ProtoConseilB: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ProtoRemyMarque(taille: 30)
            VStack(alignment: .leading, spacing: 3) {
                Text("Remy").font(t.texte(13, .semibold)).foregroundStyle(t.signal)
                Text(etat.conseil)
                    .font(t.texte(16))
                    .foregroundStyle(t.encre)
                    .fixedSize(horizontal: false, vertical: true)
                    .contentTransition(.opacity)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(t.signal.opacity(0.09), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

struct ProtoMaintenantB: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t
    let bloc: ProtoBloc

    var body: some View {
        let fin = etat.fin(bloc)
        let total = fin.timeIntervalSince(bloc.debut)
        let ecoule = etat.maintenant.timeIntervalSince(bloc.debut)
        let cat = t.couleur(bloc.categorie)
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                ProtoPuce(texte: bloc.projet ?? bloc.categorie.nom, couleur: cat)
                Spacer()
                ProtoEnCours()
            }
            Text(bloc.titre)
                .font(t.titre(22, .semibold))
                .foregroundStyle(t.encre)
                .fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(etat.restant(bloc))")
                    .font(t.chiffres(54, .semibold))
                    .monospacedDigit()
                    .foregroundStyle(t.encre)
                    .contentTransition(.numericText())
                Text("min restantes")
                    .font(t.texte(17, .medium))
                    .foregroundStyle(t.encre2)
                Spacer()
            }
            VStack(spacing: 4) {
                ProtoBarreTemps(progression: ecoule / total, couleur: cat, epaisseur: 10)
                HStack {
                    Text(ProtoTemps.heure(bloc.debut))
                    Spacer()
                    Text("fin \(ProtoTemps.heure(fin))").contentTransition(.numericText())
                }
                .font(t.chiffres(13, .medium))
                .foregroundStyle(t.encre3)
            }
            HStack(spacing: 10) {
                ProtoBouton(titre: "Terminer", symbole: "checkmark", hauteur: 54) { etat.terminer(bloc.id) }
                ProtoBouton(titre: "Gérer", symbole: "slider.horizontal.3", principal: false, hauteur: 54) {
                    etat.ouvrirGerer(bloc.id)
                }
            }
            .padding(.top, 2)
        }
        .padding(20)
        .protoCarte(t)
    }
}

struct ProtoLibreB: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                ProtoPuce(texte: "Temps libre", couleur: t.encre2)
                Spacer()
                if let p = etat.prochain {
                    Text("jusqu'à \(ProtoTemps.heure(p.debut))").font(t.chiffres(13, .medium)).foregroundStyle(t.encre3)
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(etat.minutesLibres)")
                    .font(t.chiffres(54, .semibold))
                    .monospacedDigit()
                    .foregroundStyle(t.encre)
                Text("min devant toi")
                    .font(t.texte(17, .medium))
                    .foregroundStyle(t.encre2)
            }
            Text("Avant de partir déjeuner. Une tâche courte tient dedans :")
                .font(t.texte(15))
                .foregroundStyle(t.encre2)
                .fixedSize(horizontal: false, vertical: true)
            ProtoSuggestion()
        }
        .padding(20)
        .protoCarte(t)
    }
}

/// La journée en blocs : la hauteur suit la durée (avec un minimum pour le
/// doigt et un plafond pour la lisibilité). Un appui long l'agrandit.
struct ProtoSuiteB: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                ProtoTitreSection(texte: "Ensuite")
                Spacer()
                Button { etat.ouvrirPlanning() } label: {
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(t.encre2)
                        .frame(width: 36, height: 36)
                        .background(t.surface2, in: Circle())
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(ProtoAppui())
                .accessibilityLabel("Agrandir la journée")
            }
            VStack(spacing: 8) {
                ForEach(etat.suite) { b in ProtoLigneB(bloc: b) }
            }
            .contentShape(Rectangle())
            .onLongPressGesture(minimumDuration: 0.3) { etat.ouvrirPlanning() }
        }
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .padding(.bottom, 14)
        .protoCarte(t)
    }
}

struct ProtoLigneB: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t
    let bloc: ProtoBloc

    private var hauteur: CGFloat {
        let minutes = CGFloat(etat.fin(bloc).timeIntervalSince(bloc.debut) / 60)
        return min(max(minutes * 0.75, 52), 104)
    }

    var body: some View {
        let cat = t.couleur(bloc.categorie)
        Button { etat.ouvrirGerer(bloc.id) } label: {
            HStack(alignment: .top, spacing: 10) {
                Text(ProtoTemps.heure(bloc.debut))
                    .font(t.chiffres(14, .semibold))
                    .monospacedDigit()
                    .foregroundStyle(t.encre2)
                    .frame(width: 44, alignment: .leading)
                    .padding(.top, 11)
                contenu
                    .padding(.leading, bloc.genre == .trajet ? 12 : 16)
                    .padding(.trailing, 12)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, minHeight: hauteur, alignment: .topLeading)
                    .background(fond(cat), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(alignment: .leading) {
                        if bloc.genre != .trajet {
                            Capsule().fill(cat).frame(width: 4).padding(.vertical, 9).padding(.leading, 6)
                        }
                    }
                    .overlay {
                        if bloc.genre == .trajet {
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .strokeBorder(t.encre3.opacity(0.6), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                        }
                    }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(ProtoAppui())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Ouvre les actions")
    }

    private func fond(_ cat: Color) -> Color {
        switch bloc.genre {
        case .rdv: return cat.opacity(0.22)
        case .tache: return cat.opacity(0.10)
        case .trajet: return .clear
        }
    }

    @ViewBuilder
    private var contenu: some View {
        if bloc.genre == .trajet {
            HStack(spacing: 6) {
                Image(systemName: "car.fill").font(.system(size: 12))
                Text("Trajet · \(bloc.minutes) min vers \(bloc.lieu ?? "le rendez-vous")").font(t.texte(13, .medium))
            }
            .foregroundStyle(t.encre2)
        } else {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    if bloc.genre == .rdv {
                        Image(systemName: "lock.fill").font(.system(size: 11, weight: .semibold)).foregroundStyle(t.encre2)
                    }
                    Text(bloc.titre)
                        .font(t.texte(15, .semibold))
                        .foregroundStyle(t.encre)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                }
                Text(etat.sousTitre(bloc)).font(t.texte(13)).foregroundStyle(t.encre2)
                if bloc.echeance { ProtoRisque(texte: "Échéance aujourd'hui") }
            }
        }
    }
}
