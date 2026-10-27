// Les mots qui peuvent sortir sans rien dire de personne (25/10), pour le
// filtre des requêtes sortantes (lib/filtre-sortie.js) : un mot de la mémoire,
// du profil ou du planning ne bloque une recherche que s'il n'est PAS ici.
//
//   - MOTS_COURANTS : le français de tous les jours, plus le vocabulaire des
//     recherches (prix, horaires, seuil, cotisation…) et des gabarits de Rémy
//     (« ## Préférences », « [déclaré] », « En retard ») ;
//   - LIEUX_PUBLICS : villes, pays, régions — un nom de ville passe ;
//   - ORGANISMES : organismes publics, aides, sigles administratifs ;
//   - PRODUITS : marques et produits grand public.
//
// Écrits avec accents ; le filtre les compare sans accents ni majuscules. Un
// nom composé (« saint-etienne », « new york ») s'écrit avec des tirets.
// Rien de personnel ici : ce sont des listes générales, et la tour peut en
// ajouter (REMY_FILTRE_PERMIS, ses communes de la Base Adresse Nationale).

const liste = (t) => t.split(/\s+/).filter(Boolean);

export const MOTS_COURANTS = liste(`
le la les l un une des du de d au aux ce cet cette ces mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs
je j tu il elle on nous vous ils elles me m te t se s lui y en moi toi soi eux qui que qu quoi dont où ou et mais donc or ni car
si ne n pas plus moins très trop peu beaucoup assez bien mal tout tous toute toutes rien personne chaque quelque quelques
plusieurs autre autres même mêmes tel telle tels telles quel quelle quels quelles lequel laquelle lesquels lesquelles
celui celle ceux celles ceci cela ça voici voilà avec sans pour par sur sous dans entre vers chez avant après depuis pendant
jusque jusqu contre selon malgré parmi hors dès environ près loin ici là alors ainsi aussi encore déjà toujours jamais
souvent parfois enfin puis ensuite comme comment pourquoi combien quand lorsque puisque parce afin cependant pourtant
toutefois néanmoins sinon surtout seulement vraiment plutôt presque oui non peut-être sauf via etc vers dessus dessous
devant derrière dedans dehors partout ailleurs autour aucun aucune nul nulle certain certaine certains certaines divers
chacun chacune quiconque lorsqu quelqu quoique tant autant tellement vite lentement bientôt tard tôt longtemps maintenant
actuellement récemment désormais dorénavant auparavant ensemble notamment également environ exactement simplement
directement rapidement facilement uniquement totalement entièrement complètement vraiment

être est sont suis es sommes êtes était étaient été sera seront serait seraient soit soient étant
avoir ai as a avons avez ont avait avaient eu aura auront aurait auraient ayant
faire fait fais faites font faisait fera ferait faisant aller va vais vas allons allez vont allait ira irait allé
pouvoir peut peux pouvons pouvez peuvent pourrait pourrais pourra pu vouloir veut veux voulons voulez veulent voudrais voudrait voulu
devoir doit dois devons devez doivent devrait devrais devra dû falloir faut fallait faudra faudrait
savoir sait sais savons savez savent su venir vient viens venons venez viennent venu voir voit vois voyons voyez voient vu
dire dit dis disons dites disent prendre prend prends prenons prenez prennent pris mettre met mets mis donner trouver chercher
passer parler demander penser croire crois croit rester porter montrer comprendre comprend connaître connais connaît connu
appeler appelle appellent appelé payer paie paye acheter achète vendre vend vendu louer travailler manger boire bois dormir dort
partir part parti sortir sort sorti arriver entrer ouvrir ouvre ouvert fermer commencer finir finit fini lire lit lu écrire écrit
envoyer envoie recevoir reçoit reçu changer créer utiliser aider aimer préférer préfère choisir choisit gérer gère organiser
préparer réserver annuler modifier remplir déclarer calculer comparer installer réparer nettoyer cuisiner apprendre apprend
jouer courir marcher conduire conduit rouler voyager visiter attendre attend répondre répond poser rendre rend tenir tient
obtenir obtient devenir devient revenir revient sembler laisser suivre suit vivre vit mourir naître perdre perd gagner coûter
valoir vaut compter ajouter supprimer retirer déposer signer inscrire inscrit résilier rembourser augmenter baisser réduire
dépasser bénéficier cotiser imposer exonérer facturer embaucher licencier démissionner déménager emménager noter retenir
rappeler planifier programmer décaler déplacer terminer valider refuser accepter proposer confirmer vérifier relire lister
trier ranger classer garder jeter oublier souvenir rêver habiter loger dépenser économiser investir emprunter prêter devoir
réfléchir décider hésiter essayer tester regarder écouter entendre sentir toucher couper cuire laver soigner guérir consulter
appliquer remettre reprendre repartir rentrer monter descendre tomber lever coucher réveiller habiller doucher

an ans année années jour jours journée semaine semaines mois heure heures minute minutes seconde secondes temps date dates
moment moments fois matin matinée midi soir soirée nuit week-end weekend aujourd hui demain hier veille lendemain
lundi mardi mercredi jeudi vendredi samedi dimanche janvier février mars avril mai juin juillet août septembre octobre
novembre décembre printemps été automne hiver saison saisons vacances congé congés férié fériés fête fêtes noël pâques
anniversaire rentrée trimestre semestre décennie siècle passé présent futur avenir

homme hommes femme femmes enfant enfants bébé bébés fils fille filles père mère parent parents frère frères sœur sœurs
famille ami amie amis amies copain copine copains voisin voisine voisins collègue collègues patron patronne chef cheffe
client clients cliente clientes personne personnes gens monsieur madame mademoiselle docteur médecin médecins dentiste
avocat avocate notaire comptable banquier assureur artisan artisans plombier électricien garagiste coiffeur coiffeuse
pharmacien pharmacienne infirmier infirmière kiné kinésithérapeute psychologue psy vétérinaire professeur professeure prof
élève élèves étudiant étudiante étudiants employé employée employés salarié salariée salariés employeur employeurs
indépendant indépendante indépendants entrepreneur entrepreneuse entrepreneurs auto-entrepreneur micro-entrepreneur
micro-entrepreneurs commerçant commerçants agriculteur retraité retraitée retraités chômeur demandeur propriétaire
propriétaires locataire locataires bailleur vendeur acheteur utilisateur utilisatrice utilisateurs développeur développeuse
ingénieur designer graphiste consultant freelance gérant gérante directeur directrice responsable associé associée associés
mari femme compagnon compagne conjoint conjointe époux épouse grand-mère grand-père grands-parents oncle tante cousin cousine
neveu nièce beau-père belle-mère partenaire

maison maisons appartement appart logement logements chambre chambres cuisine salon salle salles bain toilettes jardin
garage cave grenier balcon terrasse immeuble quartier rue rues route routes ville villes village villages campagne région
régions pays monde mer montagne plage lac rivière forêt parc centre lieu lieux adresse adresses domicile studio bureau bureaux

travail boulot emploi emplois poste postes métier métiers job jobs entreprise entreprises société sociétés micro-entreprise
microentreprise auto-entreprise association associations réunion réunions rendez-vous rdv projet projets tâche tâches
dossier dossiers document documents papier papiers formulaire formulaires contrat contrats facture factures devis paiement
paiements virement virements prélèvement prélèvements compte comptes banque banques crédit crédits prêt prêts dette dettes
argent euro euros prix tarif tarifs coût coûts frais budget budgets salaire salaires revenu revenus chiffre chiffres affaires
bénéfice bénéfices impôt impôts taxe taxes cotisation cotisations charge charges déclaration déclarations seuil seuils
plafond plafonds taux montant montants barème barèmes aide aides allocation allocations prime primes subvention subventions
indemnité indemnités pension pensions retraite retraites chômage assurance assurances mutuelle mutuelles santé sécurité
sociale social sociaux remboursement remboursements loi lois décret décrets règle règles règlement réglementation droit
droits obligation obligations délai délais démarche démarches procédure procédures inscription inscriptions résiliation
réclamation réclamations recours amende amendes sanction sanctions justice tribunal juge plainte litige succession héritage
divorce mariage pacs naissance décès carte cartes identité passeport permis visa titre titres séjour statut statuts régime
régimes création fermeture prestation prestations service services vente ventes achat achats activité activités commerce
commerces artisanat profession professions libérale libéral micro réel forfait exonération exonérations franchise
déduction abattement acompte échéance échéances avance avances quotient foyer fiscal fiscale fiscalité trésorerie
comptabilité gestion facturation chiffre-d-affaires capital action actions bourse placement épargne livret intérêts
loyer loyers caution bail quittance hypothèque immobilier location achat propriété copropriété syndic travaux chantier

santé maladie maladies malade médicament médicaments traitement traitements ordonnance ordonnances vaccin vaccins
vaccination hôpital hôpitaux clinique urgence urgences pharmacie consultation consultations douleur douleurs fièvre grippe
rhume covid symptôme symptômes allergie allergies sport sports sommeil stress fatigue examen examens analyse analyses
radio prise sang tension poids régime alimentation nutrition hygiène soin soins

voiture voitures train trains avion avions bus métro tram tramway vélo vélos trottinette taxi gare gares aéroport billet
billets vol vols trajet trajets voyage voyages horaires horaire retard retards grève grèves trafic bouchon bouchons parking
essence carburant électrique autoroute péage transport transports itinéraire distance kilomètres

courses magasin magasins supermarché marché boutique boutiques restaurant restaurants resto café cafés bar boulangerie pain
lait œuf œufs fromage viande poisson légume légumes fruit fruits eau vin bière repas déjeuner dîner petit-déjeuner recette
recettes menu menus commande commandes livraison livraisons colis produit produits article articles marque marques promo
promotion promotions soldes stock rupture cadeau cadeaux

téléphone téléphones portable portables ordinateur ordinateurs pc écran écrans clavier souris internet wifi réseau réseaux
site sites web page pages lien liens appli applis application applications logiciel logiciels mise jour version versions
mot passe email e-mail mail mails message messages courriel compte sociaux photo photos vidéo vidéos fichier fichiers
imprimante batterie chargeur câble données sauvegarde sauvegardes mot-de-passe numérique informatique
https http www com fr org net eu html htm php asp aspx index accueil fr-fr

météo pluie soleil neige vent orage orages température températures chaleur froid canicule film films série séries livre
livres musique concert concerts spectacle spectacles exposition expositions musée musées cinéma théâtre jeu jeux match
matchs équipe équipes football foot rugby tennis basket course randonnée piscine gym yoga danse sortie sorties loisir loisirs

bon bonne bons bonnes meilleur meilleure meilleurs meilleures mauvais mauvaise grand grande grands grandes petit petite
petits petites gros grosse nouveau nouvelle nouveaux nouvelles vieux vieille jeune jeunes long longue longs court courte
haut haute bas basse premier première premiers dernier dernière derniers prochain prochaine prochains suivant suivante
précédent précédente seul seule seuls simple simples facile faciles difficile difficiles possible possibles impossible
important importante importants principal principale principaux général générale généraux actuel actuelle actuels récent
récente récents ancien ancienne anciens gratuit gratuite gratuits cher chère chers public publique publics privé privée
privés officiel officielle officiels national nationale nationaux local locale locaux français française européen
européenne international internationale mensuel mensuelle annuel annuelle hebdomadaire quotidien quotidienne journalier
total totale totaux net nette brut brute moyen moyenne moyens minimum maximum maximal minimal obligatoire obligatoires
facultatif ouvert ouverte ouverts fermé fermée fermés disponible disponibles complet complète libre libres plein pleine
vide chaud chaude froide prévu prévue urgent urgente rapide rapides lent lente vrai vraie faux fausse exact exacte
réel réelle légal légale fixe variable personnel personnelle professionnel professionnelle

zéro deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize vingt trente quarante
cinquante soixante cent cents mille million millions milliard milliards demi moitié quart deuxième troisième quatrième

quoi définition exemple exemples liste listes avis comparatif comparaison guide tutoriel conseil conseils astuce astuces
différence différences top classement statistique statistiques nombre nombres question questions réponse réponses
information informations info infos actualité actualités news calendrier programme programmes résultat résultats
explication explications condition conditions critère critères calcul calculs simulateur simulation estimation durée
durées période périodes début fin partie parties part total pourcentage pourcentages évolution hausse baisse augmentation
revalorisation montant mise-à-jour officiel source sources

chose choses truc trucs idée idées problème problèmes solution solutions cas façon manière sorte type types genre niveau
niveaux point points côté fond forme ensemble groupe groupes numéro numéros nom noms prénom prénoms âge sexe couleur
couleurs taille poids mesure mesures raison raisons besoin besoins envie objectif objectifs but buts suite milieu histoire
vie société politique économie environnement énergie électricité gaz chauffage eau

identité contexte préférence préférences habitude habitudes fonctionnement hypothèse hypothèses déclaré observé inféré
confiance mémoire planning agenda tâche horaires configurés ouverts retard cette semaine plus tard échéance priorité
asap haute basse min sans titre invitation rendez-vous rappel rappels liste courses carnet note notes moment depuis
repères certitudes lieu supposé tâches liées secret secrets ligne lignes calendar google-calendar sans-titre

maître maîtres dr mme mmes mlle mr me pr titulaire stagiaire apprenti apprentie apprentissage alternance alternant
toussaint pentecôte ascension épiphanie chandeleur armistice assomption halloween saint-valentin ramadan aïd réveillon
nouvel-an mardi-gras fête-des-mères fête-des-pères jour-de-l-an vacances-scolaires pont ponts férié

auto autos moto motos beau belle beaux belles week weekends scooter camion camionnette utilitaire remorque caravane
camping-car vélo-cargo cargo vtt vae trottinettes covoiturage autopartage location-de-voiture permis-de-conduire
contrôle-technique carte-grise vignette crit-air pneu pneus vidange révision entretien panne pannes dépannage fourrière
radar amende stationnement borne bornes recharge

pompe pompes chaudière chaudières fioul granulés poêle poêles bois isolation isoler isolé isolée combles comble perdus
perdu perdue grenier toiture toit tuiles façade murs mur fenêtre fenêtres vitrage double-vitrage porte portes volet volets
plancher sol carrelage parquet peinture papier-peint plomberie électricité tableau compteur linky radiateur radiateurs
climatisation clim ventilation vmc ballon chauffe-eau thermostat rénovation rénover énergétique énergie dpe diagnostic-énergétique
audit devis artisan artisans maçon menuisier couvreur chauffagiste plaquiste peintre entreprise-rge travaux chantier
remplacer remplacement installation installateur réparation dépannage fuite humidité moisissure cuisine salle-de-bain
jardinage tondeuse haie arrosage piscine piscines spa abri cabane clôture portail

appareil appareils dentaire dentaires orthodontie orthodontiste orthodontistes ostéopathe ostéopathes ostéopathie
ostéo kinésithérapie kinés séance séances rééducation ophtalmologue ophtalmo ophtalmologie opticien lunettes lentilles
dermatologue dermato gynécologue gynéco pédiatre généraliste spécialiste spécialistes cardiologue radiologue radiologie
orl sage-femme infirmière infirmiers pharmacienne mutuelle mutuelles complémentaire tiers-payant carte-vitale feuille
remboursé remboursée remboursés remboursable dépassement honoraires consultation téléconsultation hospitalisation
opération chirurgie anesthésie vaccin vaccins rappel prise-de-sang bilan bilans check-up dépistage prévention ordonnance
arrêt-maladie arrêt indemnités-journalières congé-maternité congé-paternité grossesse accouchement crèche nounou
assistante-maternelle garde gardes babysitting baby-sitter cantine école écoles collège lycée université fac études
scolarité inscription-scolaire bourse bourses périscolaire centre-de-loisirs colonie

impôt-sur-le-revenu revenu-fiscal versement versements libératoire foncière foncier taxe-foncière taxe-d-habitation
redevance prélèvement-à-la-source crédit-d-impôt réduction-d-impôt niche défiscalisation déficit plus-value plus-values
dividende dividendes salaire-net brut-net cotisations-sociales charges-sociales bulletin fiche-de-paie relevé relevés
attestation attestations justificatif justificatifs avis-d-imposition déclaration-de-revenus trimestriel trimestrielle
mensualité mensualités échéancier relance relances impayé impayés recouvrement huissier commissaire-de-justice
assurance-vie assurance-habitation assurance-auto responsabilité-civile sinistre sinistres franchise expertise
affiche affiches logo logos maquette maquettes illustration illustrations graphisme graphique identité-visuelle
portfolio boutique-en-ligne vendeur vendeuse vendeurs commission commissions abonnement abonnements tarif-réglementé
coworking télétravail visio réunion-client prospect prospects mission missions prestation-de-services
marathon semi-marathon trail randonnées rando randos ski pistes piste station stations remontées forfait-de-ski
massif massifs sommet col lac lacs refuge bivouac escalade vtt kayak voile plongée surf natation course-à-pied
aspirateur aspirateurs robot robots électroménager lave-linge lave-vaisselle frigo réfrigérateur congélateur four
micro-ondes cafetière bouilloire télé télévision tv enceinte casque écouteurs tablette tablettes smartphone smartphones
bagage bagages cabine soute valise valises dimensions dimension poids-maximum enregistrement embarquement correspondance
escale hôtel hôtels auberge gîte gîtes location-saisonnière visa visas passeports douane change devise devises
dimensions surface superficie mètre mètres carré carrés hauteur largeur longueur profondeur capacité puissance
consommation autonomie garantie garanties sav retour retours échange échanges remboursement-partiel avoir
dur dure durs dures tendre tendres doux douce
code codes civil civile pénal pénale article articles alinéa cour cours cassation appel conseil état constitution constitutionnel
préfet président présidente ministère ministre gouvernement assemblée sénat république département départements commune communes
prud-hommes prudhommes juridiction juridictions jurisprudence avocat-conseil médiateur médiation conciliateur conciliation
alterner associer adulte adultes dose doses paracétamol ibuprofène aspirine doliprane dafalgan efferalgan advil nurofen spasfon smecta gaviscon
`);

// Villes, pays, régions : un nom de lieu public n'est pas une confidence. La
// tour y ajoute les communes de sa Base Adresse Nationale (lib/geocodage.js)
// et ce que REMY_FILTRE_PERMIS liste.
export const LIEUX_PUBLICS = liste(`
paris lyon toulouse nice nantes montpellier strasbourg bordeaux lille rennes reims toulon saint-étienne le-havre grenoble
dijon angers nîmes villeurbanne clermont-ferrand le-mans aix-en-provence brest tours amiens limoges annecy perpignan
boulogne-billancourt metz besançon orléans saint-denis argenteuil rouen mulhouse montreuil caen nancy roubaix tourcoing
nanterre vitry-sur-seine avignon créteil dunkerque poitiers asnières-sur-seine versailles courbevoie colombes
aulnay-sous-bois rueil-malmaison pau aubervilliers champigny-sur-marne antibes la-rochelle saint-maur-des-fossés cannes
calais béziers colmar bourges drancy mérignac ajaccio saint-nazaire issy-les-moulineaux noisy-le-grand levallois-perret
valence quimper cergy pessac troyes neuilly-sur-seine vénissieux ivry-sur-seine chambéry lorient niort sarcelles villejuif
clichy épinay-sur-seine hyères pantin fréjus évry narbonne beauvais montauban cholet maisons-alfort saint-quentin meaux
chelles vannes bayonne arles clamart fontenay-sous-bois évreux laval sartrouville belfort albi bastia brive blois
saint-malo chartres charleville-mézières châteauroux tarbes angoulême alès saint-brieuc carcassonne châlons-en-champagne
gap mâcon auxerre nevers périgueux agen cahors rodez mende foix auch mont-de-marsan lons-le-saunier vesoul épinal
bar-le-duc chaumont laon arras lens douai valenciennes cambrai boulogne-sur-mer compiègne senlis fontainebleau melun
étampes rambouillet pontoise cherbourg saint-lô alençon lisieux deauville dieppe fécamp granville dinan lannion morlaix
concarneau la-roche-sur-yon les-sables-d-olonne saumur chinon vierzon montluçon vichy moulins le-puy-en-velay aurillac
roanne villefranche-sur-saône bourg-en-bresse annemasse thonon-les-bains évian chamonix albertville aix-les-bains vienne
romans-sur-isère montélimar orange carpentras cavaillon apt manosque digne-les-bains draguignan grasse menton monaco
sète agde lunel millau castres lourdes biarritz anglet dax arcachon libourne bergerac sarlat royan rochefort cognac
saintes châtellerault vitré fougères redon guérande la-baule pornic marne-la-vallée la-défense saint-tropez cassis
la-ciotat aubagne martigues istres salon-de-provence aix nîmes uzès sète montélimar valence bastia porto-vecchio
france allemagne espagne italie portugal belgique suisse luxembourg pays-bas hollande royaume-uni angleterre écosse
irlande autriche pologne grèce suède norvège danemark finlande islande russie ukraine turquie maroc algérie tunisie égypte
sénégal côte-d-ivoire canada québec états-unis usa amérique mexique brésil argentine chili pérou colombie chine japon
corée inde thaïlande vietnam indonésie australie nouvelle-zélande israël liban iran irak émirats dubaï qatar afrique
europe asie océanie
chartreuse vercors belledonne oisans écrins mont-blanc pyrénées massif-central cévennes morvan ardennes jura vosges
chamrousse les-deux-alpes alpe-d-huez val-thorens courchevel méribel tignes val-d-isère la-plagne les-arcs avoriaz
megève les-gets la-clusaz le-grand-bornand serre-chevalier font-romeu saint-lary la-mongie superdévoluy autrans
villard-de-lans lans-en-vercors camargue luberon verdon calanques bretagne-sud côte-basque côte-d-opale baie-de-somme
mont-saint-michel futuroscope disneyland
île-de-france bretagne normandie occitanie provence alpes côte-d-azur paca auvergne rhône-alpes auvergne-rhône-alpes
bourgogne franche-comté grand-est alsace lorraine champagne hauts-de-france nord picardie nouvelle-aquitaine aquitaine
limousin poitou charentes pays-de-la-loire centre-val-de-loire corse guadeloupe martinique guyane réunion mayotte savoie
haute-savoie dordogne gironde landes var vaucluse hérault gard ardèche drôme isère ain jura doubs vosges finistère
morbihan vendée loire rhône seine marne oise somme aisne essonne yvelines val-d-oise val-de-marne hauts-de-seine
seine-saint-denis seine-et-marne bouches-du-rhône alpes-maritimes haute-garonne loire-atlantique ille-et-vilaine
londres london bruxelles berlin madrid barcelone rome milan lisbonne porto amsterdam vienne prague varsovie budapest
athènes stockholm oslo copenhague dublin zurich lausanne bâle bruges anvers new-york los-angeles san-francisco chicago
miami montréal tokyo pékin shanghai hong-kong singapour sydney istanbul moscou kiev casablanca marrakech tunis alger dakar
abidjan
`);

export const ORGANISMES = liste(`
urssaf caf cpam ameli msa impots impôts dgfip francetravail france-travail pôle-emploi pole-emploi insee inpi sncf ratp edf
engie gdf la-poste ants préfecture mairie cnil anah ademe bpi bpifrance apec cnav carsat agirc arrco agirc-arrco mdph
crous cnous onisep legifrance service-public gouv gouv.fr unédic acre arce are rsa apl aah ars smic tva cfe cvae siret siren
kbis ape naf cerfa banque-de-france hadopi arcom dgccrf infogreffe cci cma cpf opco pajemploi cesu sécu urssaf.fr caf.fr
ameli.fr impots.gouv.fr service-public.fr service-public.gouv.fr legifrance.gouv.fr economie.gouv.fr entreprendre
oms onu ue nasa fmi ocde bce eurostat unesco unicef croix-rouge restos-du-cœur emmaüs samu pompiers police gendarmerie
maprimerénov maprimerenov ma-prime-rénov france-rénov france-renov mon-accompagnateur-rénov cee rge ptz éco-ptz eco-ptz
bnc bic ir is micro-bnc micro-bic tva-intracommunautaire cnaf ccas dreets direccte sie sip trésor-public dgddi douanes
assurance-maladie assurance-retraite l-assurance-maladie l-assurance-retraite lassuranceretraite info-retraite cnracl
ircantec cipav cnavpl ssi sécurité-sociale mon-espace-santé ameli.fr lamaisondelautonomie anil adil effy hellio
cnil.fr education-nationale éducation-nationale pronote ent parcoursup ants.gouv.fr permis-de-conduire anssi
`);

export const PRODUITS = liste(`
iphone ipad mac macbook imac airpods apple watch android samsung galaxy pixel google gmail chrome firefox safari edge
windows microsoft excel word powerpoint outlook teams office linux ubuntu motion notion obsidian shopify wordpress wix
amazon fnac darty boulanger leclerc auchan lidl aldi intermarché monoprix franprix casino ikea decathlon leroy-merlin
castorama ouigo tgv ter blablacar uber airbnb booking doctolib leboncoin vinted paypal lydia revolut n26 boursorama
netflix spotify deezer youtube whatsapp telegram instagram facebook tiktok twitter linkedin snapchat chatgpt openai claude
anthropic tesla renault peugeot citroën toyota volkswagen dacia playstation xbox nintendo steam free orange sfr bouygues
sosh freebox livebox garmin fitbit kindle tailscale docker github python javascript nvidia intel amd raspberry synology
philips dyson nespresso thermomix vélib navigo gpt gemini mistral deepseek qwen glm
etsy figma canva adobe photoshop illustrator indesign lightroom procreate discord slack zoom dropbox trello airtable
ebay aliexpress temu shein cdiscount rakuten back-market backmarket easyjet ryanair air-france transavia vueling
flixbus daikin atlantic mitsubishi viessmann saunier-duval de-dietrich bosch siemens miele whirlpool electrolux
xiaomi roborock irobot roomba ecovacs huawei oneplus oppo sony lg nikon canon fujifilm gopro dji lego
carrefour système-u super-u hyper-u lidl.fr ikea.fr marmiton allociné tripadvisor michelin waze maps google-maps
outlook.com hotmail yahoo proton protonmail icloud apple-pencil airtag homepod apple-tv
`);
