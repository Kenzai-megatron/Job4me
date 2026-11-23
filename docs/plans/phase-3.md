# Phase 3 : dédoublonnage, géographie et notation, plan détaillé

Proposition du 23/11/2026, **validée par Mehdi le 23/11/2026** avec les options recommandées, sauf les plafonds (décision D5 : **gratuit pendant la phase de test**) ; voir la section 15. Sources : spécification, sections 4, 5, 10, 12 et 14 ; `docs/SOURCES.md`, sections 1.5 à 1.9. Préparée pendant que LinkedIn (phase 2, lot 4) attend le sondage depuis la maison, avec l'accord de Mehdi.

## 1. Résumé

- **Une annonce, une seule offre** : la même annonce vue par trois sources n'apparaît plus qu'une fois, avec ses trois liens. Clé de contenu (intitulé et employeur normalisés, jamais l'URL), fusion prudente des republications, comparaison avec les trois dernières semaines.
- **Géographie** : localités belges de GeoNames sous leurs deux noms, repli par code postal, distance à vol d'oiseau × 1,25 depuis la **ville de base du profil**, qui remplace le centre fixe (Bruxelles) de la phase 2. Un lieu inconnu est gardé, le télétravail aussi.
- **Filtre déterministe**, sans coût : employeurs exclus, annonces de plus de 60 jours, distance au-delà du rayon, critères éliminatoires certains (langue ou contrat donnés par la source).
- **Notation sans IA par défaut** (décision D5, gratuit pendant la phase de test) : un score sur 100 et sa raison, calculés à partir du profil (métiers cibles, mots-clés, compétences, langues, distance, contrat, fraîcheur), gratuits et explicables.
- **Notation par Claude, prête mais coupée** : notation rapide par Claude Haiku 5.5 par lots de 25, puis analyse détaillée des offres de 70 ou plus par Claude Sonnet 5.5 ; elle s'active d'un réglage, avec un plafond de 2 $ par semaine, quand Mehdi le décide.
- **Jeu de référence** : tu notes 30 vraies offres dans Job4me ; une commande de la machine de la maison mesure l'écart moyen avec Claude et le coût par offre.
- **Écrans** : offres classées par score, filtres, fiche détaillée ; pertinence par source sur l'écran Sources ; nouvelles offres à 80 ou plus sur l'accueil et en notification.

## 2. Périmètre et critères de fin

**Inclus** (spécification, section 14) : clé de contenu, fusion des republications, historique, localités GeoNames, distances, filtre déterministe, notation rapide par lots, analyse détaillée, jeu de référence de 30 offres notées par Mehdi.
**Exclu** : documents (phase 4), envoi et suivi (phase 5), quotas Basic et Premium, sélection plafonnée par semaine et « postes susceptibles d'intéresser » (phase 6).

**Critères de fin, tous vérifiables**

1. **Aucun doublon visible** sur une semaine d'offres : la liste d'une semaine relue par Mehdi, et le journal compte les parutions fusionnées par source et par passage.
2. **Écart moyen** entre les scores de Claude et les notes de Mehdi sur le jeu de référence **sous 10 points** (Hypothèse de la spécification).
3. **Coût par offre mesuré**, notation rapide et analyse détaillée à part, dans le journal des appels.
4. **Pré-filtre de titre mesuré** contre les offres notées : il n'écarte pas plus de 5 % des offres notées 60 ou plus (Hypothèse de la spécification).
5. CI verte, plan de sécurité de la section 11 appliqué et testé, revue de sécurité faite.

## 3. Modèle de données

Tout reste propre à chaque compte (`user_id` et RLS), comme en phase 2, sauf les localités, publiques et communes.

| Table | Contenu | Remarques |
| --- | --- | --- |
| `offer` (nouvelle) | l'**annonce unique** : clé de contenu, intitulé, employeur et lieu retenus, localité, distance, télétravail, première et dernière vue (toutes sources confondues), statut (gardée, écartée et pourquoi) | une annonce par clé et par compte ; la purge de 90 jours porte sur elle |
| `job_offer` (existe) | une **parution** chez une source, rattachée à son annonce (`offer_id`) ; intitulé nu, référence interne, code postal ajoutés | la fiche montre toutes les parutions et leurs liens |
| `locality` (nouvelle) | localités GeoNames : noms français, néerlandais, allemand et anglais, codes postaux, coordonnées | commune à tous les comptes, sans donnée personnelle |
| `offer_score` (nouvelle) | score rapide et raison, ou analyse détaillée (sous-scores, points forts, écarts, éléments bloquants, mots-clés), confiance, modèle, version du prompt, version du profil | recalculé seulement si le profil ou l'annonce change |
| `offer_rating` (nouvelle) | la note de Mehdi sur une annonce (jeu de référence) et un mot d'explication | jamais envoyée ailleurs qu'en étalon de sévérité, jamais dans le dépôt |
| `scoring_benchmark` (nouvelle) | chaque mesure du jeu de référence : écart moyen, pire écart, coût, modèle, version du prompt | |

Le profil gagne une **ville de base résolue** (localité GeoNames), des **consignes de notation** (ce qui est hors sujet pour Mehdi, ses cas limites) et les **poids de la grille** (section 8).

## 4. Dédoublonnage

Règles de `docs/SOURCES.md`, section 1.6, appliquées à chaque parution collectée, avant la notation :

- **Clé de contenu** = `sha1(intitulé normalisé | employeur normalisé)`, 16 caractères : sans accents, minuscules, employeur retiré de l'intitulé quand il le préfixe, mentions de genre (`(m/f/x)`, `H/F/X`…), références internes, villes, mentions de contrat et ponctuation retirées ; employeur sans formes juridiques ni « belgium ». Un agrégateur qui met le site d'origine à la place de l'employeur (« LinkedIn », « StepStone »…) donne `?`.
- **Fusion des republications** à intitulé nu identique, par trois règles étroites : référence interne commune ; l'un des deux sans employeur ; même employeur à une extension de nom près, comparé par mots. **Jamais** deux employeurs différents sans référence commune.
- **Contre l'historique** des trois dernières semaines : même clé, même URL, même intitulé nu et même référence, ou même intitulé nu et même employeur venant d'une autre source.
- De deux versions, l'annonce garde l'employeur nommé, puis la plus longue description ; l'ordre d'appel des sources (Actiris et le Forem d'abord) fait le reste.
- Le journal de chaque source compte ses **parutions fusionnées** ; une fusion se défait à la main depuis la fiche (« ce n'est pas la même offre »).

## 5. Géographie

- **Localités** : fichier `BE` de GeoNames et ses codes postaux (licence CC BY 4.0, attribution dans l'écran À propos et le dépôt), environ 2 700 localités et les communes sous leurs deux noms (Malines et Mechelen, Gand et Gent). Chargées en base par la migration (décision D6).
- **Lecture d'un lieu** : noms de localité, puis code postal (quatre chiffres, en écartant 2020 à 2035, des millésimes) ; les noms de pays ou de région ne situent rien (« Belgium », « Vlaanderen », « Flemish Region ») ; un nom porté par deux endroits distants de plus de 15 km n'est pas deviné ; un lieu à l'étranger (« Luxembourg », « Montrouge, France ») est hors rayon.
- **Distance** = vol d'oiseau × 1,25 depuis la ville de base du profil, rayon du profil (40 km par défaut).
- **Gardés quelle que soit la distance** : lieu inconnu (affiché sans distance) ; télétravail annoncé dans le lieu, l'intitulé ou la description, si le profil l'accepte.
- Le Forem cherche désormais autour de la ville de base, et non plus de Bruxelles.

## 6. Filtre déterministe

Gratuit et sans IA, **large à l'inclusion, net au rejet** (`docs/SOURCES.md`, section 1.5) :

- employeurs exclus par Mehdi (comparaison normalisée, par mots) ;
- annonces de plus de 60 jours quand la date est connue (configuration) ;
- distance au-delà du rayon, selon la section 5 ;
- critères éliminatoires **certains seulement** : une langue exigée que la source donne en champ (le Forem), un contrat que la source donne en champ. Le reste (« néerlandais courant » dans un texte libre, années d'expérience) part dans les consignes de la notation, qui le pèse.

Une offre écartée garde sa raison ; la liste peut montrer les écartées (« pourquoi je ne la vois pas »).

## 7. Notation sans IA (par défaut pendant la phase de test)

- **Gratuite et déterministe** (décision D5) : c'est le « tri par mots-clés » de la spécification, promu au rang de notation par défaut tant que l'IA reste coupée.
- **Ce qui compte**, poids dans la configuration : proximité de l'intitulé avec les métiers cibles et les mots-clés (les prioritaires pèsent plus), compétences du profil citées dans l'annonce, langues exigées par rapport aux niveaux du profil, distance, contrat et régime souhaités, fraîcheur ; secteurs exclus et mots du rejet font baisser le score.
- **Toujours expliquée** : « intitulé proche de « Comptable », 12 km, CDI, néerlandais demandé (B1 au profil) ». Confiance basse : un tel score ne déclenchera jamais d'envoi automatique (phase 5).
- Mesurée comme l'autre par le jeu de référence (section 9) : si l'écart avec tes notes dépasse le seuil, passer à la notation par Claude est la voie proposée.

## 7 bis. Notation rapide par Claude Haiku 5.5 (coupée par défaut)

- **Par lots de 25**, sortie au schéma : exactement autant d'éléments `{id, score, raison}` que d'offres envoyées, score de 0 à 100, raison de 200 caractères au plus ; puis validation Zod, identifiants vérifiés un à un. Un second essai par lot ; si l'API est indisponible, un **tri provisoire par mots-clés** marqué comme tel.
- **Barème** de la spécification : 80 à 100 postuler aujourd'hui, 60 à 79 pertinent, 40 à 59 faute de mieux, 0 à 39 hors sujet.
- **Le prompt**, écrit avec ses accents : consignes, profil **sans identité** (métiers cibles, compétences, langues et niveaux, intitulés et durées des expériences, critères pratiques, motivations), consignes de notation de Mehdi, quelques offres qu'il a notées comme étalon. Cette partie fixe est **mise en cache**.
- **Chaque offre** : `intitulé | employeur | lieu [distance]`, puis 500 caractères de description, **sans adresse e-mail ni numéro de téléphone** (retirés avant l'envoi), entre balises de données.
- Une offre **sans description** (LinkedIn, Actiris) est notée sur son intitulé, en **confiance basse** : elle ne déclenchera jamais d'envoi automatique (phase 5).
- **Plafond d'offres notées par passage**, réparti à tour de rôle entre les sources ; le surplus attend le passage suivant.
- **Coût estimé** (prix d'Anthropic du 3/11/2026, à mesurer) : environ 0,1 centime par lot de 25, soit quelques centimes par mois pour quelques centaines d'offres par semaine.

## 8. Analyse détaillée par Claude Sonnet 5.5 (offres de 70 ou plus, coupée par défaut)

- **Seuil de 70** (Hypothèse de la spécification), une offre à la fois, avec sa description complète (1 200 caractères au plus), par Claude Sonnet 5.5 (décision D3), quand la notation par Claude est activée.
- **Sortie** : sous-scores de la grille, points forts, écarts, éléments bloquants, mots-clés à reprendre dans le dossier ; elle remplace le score rapide.
- **Grille**, poids modifiables par Mehdi dans le profil : compétences techniques 30, expérience et fonction 20, langues 15, critères pratiques 15, secteur 10, motivations 10.
- **Coût estimé** : environ 2 centimes par offre avec Claude Sonnet 5.5, 0,1 centime avec Claude Haiku 5.5 ; une vingtaine d'offres par semaine.

## 9. Jeu de référence et mesures

- **Noter dans Job4me** : sur la fiche d'une offre, « Ma note » (0 à 100) et un mot d'explication ; il en faut 30, variées (bonnes, moyennes, hors sujet).
- **Mesurer sur la machine de la maison** : `pnpm stack:cli scoring:benchmark` renote les 30 offres avec le prompt et le modèle du moment, puis affiche l'écart moyen, les cinq pires écarts, le coût et le modèle ; la mesure est gardée (`scoring_benchmark`).
- **Pré-filtre de titre** : la même commande dit quelle part des offres que tu as notées 60 ou plus le filtre aurait écartées.
- **En CI**, jamais de vraies offres (aucune donnée réelle de tiers dans le dépôt) : la même chaîne tourne sur des offres fictives, avec un transport simulé, comme en phase 1.

## 10. Écrans et API

- **Offres** : classées par score puis par fraîcheur, avec pastille de tranche et raison ; filtres (tranche, source, distance, nouvelles, écartées) ; **fiche** : score et sous-scores, points forts, écarts, éléments bloquants, lieu et distance, toutes les parutions avec leurs liens, « Ma note ».
- **Sources** : la **pertinence** de chaque source sur quatre semaines (part de ses annonces notées 80 ou plus), et ses parutions fusionnées.
- **Accueil** : les nouvelles offres à 80 ou plus de la semaine.
- **Profil** : consignes de notation et poids de la grille ; ville de base vérifiée (« Bruxelles, 1000 : trouvée »).
- **Notification**, selon la décision D7 : « 3 nouvelles offres à 80 ou plus » après un passage.
- **Paramètres > IA** : dépense par usage (notation rapide, analyse détaillée, mesure du jeu de référence).
- API : `GET /api/offers` (tri, tranches, filtres), `GET /api/offers/:id` (fiche), `PUT /api/offers/:id/rating`, `POST /api/offers/:id/unmerge`, `GET /api/scoring/benchmarks` ; en ligne de commande, `scoring:benchmark` et `scoring:run`.

## 11. Plan de sécurité court

Exigé par `CLAUDE.md` avant tout agent d'IA ; il complétera le [modèle de menaces](../security/threat-model.md).

| # | Menace | Contrôles | Tests automatisés |
| --- | --- | --- | --- |
| 1 | Consignes glissées dans le texte d'une annonce (contenu de tiers) | consignes en tête, annonces entre balises de données, balise de fin neutralisée, aucun outil, sortie au schéma puis Zod, scores bornés, un identifiant par offre vérifié ; un lot dont tous les scores sautent est noté suspect et renoté offre par offre | annonce piégée dans un lot simulé : schéma tenu, identifiants intacts, aucun autre champ accepté |
| 2 | Données personnelles envoyées à Anthropic | profil sans identité ni coordonnées ; annonces sans e-mail ni téléphone, 500 caractères ; rien d'autre ne part ; journal des appels sans contenu | requête simulée : aucune valeur d'identité ni coordonnée de recruteur dedans |
| 3 | Dérive des coûts | plafonds par semaine et pour la phase dans la configuration, pire cas vérifié avant chaque appel (comme en phase 1), plafond d'offres par passage, cache de la partie fixe | plafond atteint : aucun envoi ; lot coupé au plafond d'offres |
| 4 | Fusion à tort de deux offres différentes (une offre perdue) | règles étroites de la section 4, jamais deux employeurs différents sans référence commune, fusion réversible depuis la fiche | les cas de `docs/SOURCES.md` (Deloitte et BNP, Adecco et Adeccorp, Sander et Sander Brussels) |
| 5 | Lieu mal lu (une bonne offre écartée) | lieu inconnu gardé, noms de pays ignorés, ambiguïté non devinée, repli par code postal hors millésimes | « Gent, Flemish Region, Belgium », « Belgium », « 2026 », « Luxembourg », « Montrouge, France » |
| 6 | Score sans explication, ou qui déciderait seul | chaque score expliqué ; confiance basse sans description ; aucun envoi en phase 3 | offre sans description : confiance basse |
| 7 | Notes de Mehdi et jeu de référence | RLS et filtre `user_id` ; jamais dans le dépôt ni en CI | un autre compte ne voit ni note ni mesure |
| 8 | Fichier GeoNames altéré | fichier dérivé versionné avec son empreinte, régénérable par un script, attribution | empreinte vérifiée par la migration |

## 12. Ordre de réalisation

0. **Plan et ADR** : ce plan validé ; ADR 0016 (annonce unique et dédoublonnage), 0017 (géographie GeoNames), 0018 (notation par Claude : données envoyées, modèles, plafonds).
1. **Annonce unique** : table `offer`, clé de contenu, fusion, historique, journal des fusions ; liste des offres par annonce, avec ses parutions.
2. **Géographie** : localités, ville de base du profil, distances, télétravail ; Forem autour de la ville de base.
3. **Filtre déterministe** et consignes de notation du profil.
4. **Notation sans IA** (par défaut), tri par score, fiche détaillée ; pertinence par source.
5. **Notation par Claude**, coupée par défaut : notation rapide par lots (Claude Haiku 5.5), analyse détaillée des offres de 70 ou plus (Claude Sonnet 5.5), grille modifiable, plafond par passage ; tout testé sur un transport simulé, sans aucun appel réel.
6. **Jeu de référence**, mesure depuis la maison, notification des offres à 80 ou plus.
7. **Clôture** : revue de sécurité, modèle de menaces complété, démonstration sur la machine de la maison.

**Démonstration** : sur la machine de la maison, une semaine d'offres relue sans doublon visible, 30 offres notées par Mehdi et l'écart mesuré, le coût par offre, les distances vérifiées sur quelques lieux connus.

## 13. Décisions à prendre

| # | Question | Options | Recommandée |
| --- | --- | --- | --- |
| D1 | Jeu de référence et mesures | **a.** tu notes 30 offres dans Job4me, la mesure tourne par une commande sur la machine de la maison, la CI sur des offres fictives ; **b.** des copies anonymisées de tes offres notées vont dans le dépôt pour la CI | a |
| D2 | Ce qui part chez Anthropic pour noter | **a.** profil sans identité, et pour chaque offre intitulé, employeur, lieu, distance et 500 caractères de description sans e-mail ni téléphone ; **b.** intitulé, employeur et lieu seulement (notation moins juste) | a |
| D3 | Modèle de l'analyse détaillée | **a.** Claude Sonnet 5.5 (environ 2 centimes par offre) ; **b.** Claude Haiku 5.5 (environ 0,1 centime, moins nuancé) | a |
| D4 | API Batch (moitié prix, réponse jusqu'à 24 heures plus tard) | **a.** appels directs en phase 3 (scores quelques minutes après le passage ; coût déjà infime), Batch quand le volume le justifiera ; **b.** Batch dès maintenant pour les passages planifiés, comme le prévoit la spécification | a |
| D5 | Plafonds de dépense de l'IA | **a.** 3 $ par semaine glissante et 25 $ pour la phase (Hypothèse) ; **b.** d'autres montants, que tu donnes | a |
| D6 | Localités GeoNames | **a.** fichier dérivé versionné dans le dépôt (quelques centaines de Ko, CC BY 4.0), régénérable par un script ; **b.** téléchargé à chaque installation | a |
| D7 | Notification des bonnes offres | **a.** une notification après un passage s'il y a de nouvelles offres à 80 ou plus ; **b.** pas de notification en phase 3, l'accueil seulement | a |
| D8 | Fusion des pull requests | **a.** Claude fusionne après une CI verte, comme aux phases 0 à 2 ; **b.** tu relis chaque pull request | a |

## 14. Hypothèses de la spécification que je précise

1. **La CI ne voit jamais tes vraies offres** : la spécification veut que la CI mesure l'écart avec tes notes, mais `CLAUDE.md` interdit toute donnée réelle de tiers en développement. La mesure réelle se fait donc sur la machine de la maison (décision D1) ; la CI vérifie la chaîne sur des offres fictives.
2. **API Batch** : la spécification la prévoit pour la notation de nuit ; les passages ayant lieu à 7 h 10, une réponse jusqu'à 24 heures plus tard retarderait les scores de la journée. Je propose des appels directs tant que le coût reste de quelques centimes (décision D4).
3. **Annonce unique propre à chaque compte** : la spécification voit les offres communes à tous les comptes ; la phase 2 les a rendues propres à chaque compte (plan validé), et l'annonce unique suit la même règle.
4. **Critères éliminatoires** : seuls ceux que la source donne en champ sont appliqués sans IA ; ceux d'un texte libre vont à la notation, qui peut les nuancer (« néerlandais : un atout » n'est pas « néerlandais exigé »).

## 15. Décisions prises le 23/11/2026

| # | Décision |
| --- | --- |
| D1 | Tes 30 notes saisies dans Job4me ; la mesure tourne par une commande sur la machine de la maison ; la CI vérifie la chaîne sur des offres fictives |
| D2 | Vers Anthropic, quand l'IA sera activée : profil sans identité, et pour chaque offre intitulé, employeur, lieu, distance et 500 caractères de description sans e-mail ni téléphone |
| D3 | Analyse détaillée par Claude Sonnet 5.5 |
| D4 | Appels directs plutôt que l'API Batch |
| D5 | **Gratuit pendant la phase de test** : la notation se fait sans IA ; la notation par Claude est écrite et testée mais coupée, et s'active, si nécessaire, avec un plafond de 2 $ par semaine |
| D6 | Localités GeoNames versionnées dans le dépôt, régénérables par un script |
| D7 | Une notification après un passage s'il y a de nouvelles offres à 80 ou plus |
| D8 | Claude fusionne chaque pull request après une CI verte |

**Conséquence de D5 à signaler** : le critère de fin « écart moyen sous 10 points » se mesurera d'abord sur la notation sans IA. Si elle reste au-dessus du seuil, la mesure le montrera chiffres à l'appui, et l'activation de Claude (2 $ par semaine au plus) sera la décision à prendre.
