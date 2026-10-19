import SwiftUI

// Direction A — Atelier : l'accueil se lit comme une page de carnet.
// Date en serif, conseil en exergue, une seule carte (« maintenant »), puis la
// suite de la journée en lignes, l'heure dans la marge.

struct ProtoAccueilA: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ProtoTitreEcran(titre: "15 octobre", surTitre: "Jeudi") {
                    ProtoBoutonBoite()
                }
                ProtoConseilA()
                    .padding(.horizontal, 22)
                    .padding(.top, 22)
                Group {
                    if let b = etat.enCours {
                        ProtoMaintenantA(bloc: b)
                            .transition(.asymmetric(insertion: .opacity.combined(with: .offset(y: 10)),
                                                    removal: .opacity.combined(with: .scale(scale: 0.97))))
                    } else {
                        ProtoLibreA()
                            .transition(.asymmetric(insertion: .opacity.combined(with: .offset(y: 10)),
                                                    removal: .opacity))
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 24)
                ProtoSuiteA()
                    .padding(.top, 34)
                ProtoFaitsA()
                    .padding(.top, 14)
            }
            .padding(.bottom, 130)
        }
        .scrollIndicators(.hidden)
    }
}

/// Le conseil du moment, en exergue : une phrase, lue en cinq secondes.
struct ProtoConseilA: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            RoundedRectangle(cornerRadius: 1.5).fill(t.signal).frame(width: 3)
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Text("Remy").font(t.texte(13, .semibold)).foregroundStyle(t.encre)
                    Text("· conseil du moment").font(t.texte(13)).foregroundStyle(t.encre3)
                }
                Text(etat.conseil)
                    .font(t.titre(20, .regular))
                    .italic()
                    .foregroundStyle(t.encre)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .contentTransition(.opacity)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }
}

/// « Maintenant » : la tâche en cours, son temps, Terminer et Gérer.
struct ProtoMaintenantA: View {
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
                .font(t.titre(25, .semibold))
                .foregroundStyle(t.encre)
                .fixedSize(horizontal: false, vertical: true)
            VStack(spacing: 4) {
                ProtoBarreTemps(progression: ecoule / total, couleur: cat, epaisseur: 8)
                HStack {
                    Text(ProtoTemps.heure(bloc.debut))
                    Spacer()
                    Text(ProtoTemps.heure(fin)).contentTransition(.numericText())
                }
                .font(t.chiffres(12))
                .foregroundStyle(t.encre3)
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("Il reste \(ProtoTemps.duree(etat.restant(bloc)))")
                    .font(t.texte(16, .semibold))
                    .foregroundStyle(t.encre)
                    .contentTransition(.numericText())
                Text("sur \(ProtoTemps.duree(Int(total / 60)))")
                    .font(t.texte(15))
                    .foregroundStyle(t.encre2)
            }
            HStack(spacing: 10) {
                ProtoBouton(titre: "Terminer", symbole: "checkmark") { etat.terminer(bloc.id) }
                ProtoBouton(titre: "Gérer", symbole: "slider.horizontal.3", principal: false) { etat.ouvrirGerer(bloc.id) }
            }
            .padding(.top, 2)
        }
        .padding(20)
        .protoCarte(t)
    }
}

/// Tâche terminée en avance : le temps libre, et ce qui tient dedans.
struct ProtoLibreA: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                HStack(spacing: 7) {
                    Circle().strokeBorder(t.encre3, lineWidth: 1.5).frame(width: 8, height: 8)
                    Text("Temps libre").font(t.texte(13, .medium)).foregroundStyle(t.encre2)
                }
                Spacer()
                if let p = etat.prochain {
                    Text("jusqu'à \(ProtoTemps.heure(p.debut))").font(t.chiffres(12)).foregroundStyle(t.encre3)
                }
            }
            Text("\(ProtoTemps.duree(etat.minutesLibres)) devant toi")
                .font(t.titre(25, .semibold))
                .foregroundStyle(t.encre)
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

/// La tâche qu'on peut avancer dans un créneau libre.
struct ProtoSuggestion: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t

    var body: some View {
        Button {
            etat.montrer("Avancée à maintenant : Motion replanifie la suite") {}
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "phone")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(t.couleur(.admin))
                    .frame(width: 36, height: 36)
                    .background(t.couleur(.admin).opacity(0.14), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text("Appeler l'assurance auto").font(t.texte(15, .semibold)).foregroundStyle(t.encre)
                    HStack(spacing: 6) {
                        ProtoRisque(texte: "Échéance aujourd'hui")
                        Text("· 15 min").font(t.texte(12)).foregroundStyle(t.encre2)
                    }
                }
                Spacer(minLength: 4)
                Text("Avancer").font(t.texte(15, .semibold)).foregroundStyle(t.signal)
            }
            .padding(12)
            .background(t.surface2.opacity(t.estAtelier ? 0.7 : 1), in: RoundedRectangle(cornerRadius: t.rayonControle, style: .continuous))
        }
        .buttonStyle(ProtoAppui())
    }
}

/// La suite de la journée, l'heure dans la marge. Un appui long l'agrandit.
struct ProtoSuiteA: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t

    var body: some View {
        let suite = etat.suite
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                ProtoTitreSection(texte: "La suite")
                Spacer()
                Button { etat.ouvrirPlanning() } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "arrow.up.left.and.arrow.down.right").font(.system(size: 12, weight: .semibold))
                        Text("Toute la journée")
                    }
                    .font(t.texte(13, .medium))
                    .foregroundStyle(t.encre2)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 22)
            VStack(spacing: 0) {
                ForEach(suite) { b in
                    ProtoLigneA(bloc: b)
                    if b.id != suite.last?.id {
                        Rectangle().fill(t.filet).frame(height: 1).padding(.leading, 82)
                    }
                }
            }
            .padding(.horizontal, 16)
            .contentShape(Rectangle())
            .onLongPressGesture(minimumDuration: 0.3) { etat.ouvrirPlanning() }
        }
    }
}

struct ProtoLigneA: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t
    let bloc: ProtoBloc

    var body: some View {
        let cat = t.couleur(bloc.categorie)
        Button { etat.ouvrirGerer(bloc.id) } label: {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .trailing, spacing: 2) {
                    Text(ProtoTemps.heure(bloc.debut)).font(t.chiffres(14, .medium)).foregroundStyle(t.encre)
                    Text(ProtoTemps.heure(etat.fin(bloc))).font(t.chiffres(12)).foregroundStyle(t.encre3)
                }
                .frame(width: 50, alignment: .trailing)
                marqueur(cat)
                    .frame(width: 6)
                    .frame(maxHeight: .infinity)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        if bloc.genre == .rdv {
                            Image(systemName: "lock.fill").font(.system(size: 11, weight: .semibold)).foregroundStyle(t.encre2)
                        }
                        if bloc.genre == .trajet {
                            Image(systemName: "car").font(.system(size: 12, weight: .medium)).foregroundStyle(t.encre2)
                        }
                        Text(bloc.titre)
                            .font(bloc.genre == .trajet ? t.texte(15) : t.texte(16, .medium))
                            .foregroundStyle(bloc.genre == .trajet ? t.encre2 : t.encre)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Text(etat.sousTitre(bloc)).font(t.texte(13)).foregroundStyle(t.encre2)
                    if bloc.echeance { ProtoRisque(texte: "Échéance aujourd'hui") }
                }
                Spacer(minLength: 0)
            }
            .fixedSize(horizontal: false, vertical: true)
            .padding(.vertical, 12)
            .padding(.horizontal, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Ouvre les actions")
    }

    /// RDV protégé : trait plein et large. Tâche : trait fin. Trajet : pointillé.
    @ViewBuilder
    private func marqueur(_ cat: Color) -> some View {
        switch bloc.genre {
        case .rdv:
            RoundedRectangle(cornerRadius: 3, style: .continuous).fill(cat)
        case .tache:
            RoundedRectangle(cornerRadius: 2, style: .continuous).fill(cat).frame(width: 4)
        case .trajet:
            Capsule().strokeBorder(t.encre3, style: StrokeStyle(lineWidth: 1.5, dash: [3, 3])).frame(width: 4)
        }
    }
}

/// Ce qui est déjà fait aujourd'hui, en une ligne discrète.
struct ProtoFaitsA: View {
    @Environment(ProtoEtat.self) private var etat
    @Environment(\.protoTheme) private var t

    var body: some View {
        let faits = etat.faits
        if !faits.isEmpty {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(t.encre3)
                Text("Fait aujourd'hui : " + faits.map { $0.titre }.joined(separator: ", "))
                    .font(t.texte(14))
                    .foregroundStyle(t.encre3)
                    .lineLimit(2)
            }
            .padding(.horizontal, 22)
        }
    }
}
