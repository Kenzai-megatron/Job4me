# Phase 2 : collecte, plan détaillé

Proposition du 23/11/2026, **validée par Mehdi le 23/11/2026** avec les options recommandées, sauf les clés d'API (décision D2 : plus tard) ; voir la section 14. Sources : spécification, sections 3, 5, 10 et 14 ; notes `docs/SOURCES.md`, sections 0 à 6.

## 1. Résumé

- **Un format commun** pour toutes les offres, un **contrat de connecteur** (`{ offers, readCount }`) et un **orchestrateur** qui isole chaque source : une source qui tombe n'arrête jamais les autres.
- **Un seul client HTTP poli** pour toute la collecte : hôtes autorisés par source, en-têtes ordinaires d'un navigateur, pauses entre requêtes, budget de temps, **arrêt net au premier 403 ou 429**, jamais de contournement d'une protection anti-robot.
- **Neuf connecteurs** pour Bruxelles : Forem (open data), Actiris (avec pré-filtre de titre), Adzuna et Google Jobs (API à clé), StepStone, Jobijoba, Jobrapido et Talent.com (pages publiques), puis LinkedIn « invité » avec ses précautions.
- **Mode « tester les sources »** (un mot-clé, une page par source), **journal par source** à chaque passage (offres lues, inédites, retenues) et **alerte « source muette »** dès le premier jour.
- **Ajout manuel** d'une offre (lien et texte collés), **interrupteur par source** et **mode d'usage** : LinkedIn « invité » et les pages publiques se coupent d'office en mode commercial.

## 2. Périmètre et critères de fin

**Inclus** (spécification, section 14) : format commun, contrat de connecteur, orchestrateur, mode test, journal par source, alerte « source muette », ajout manuel, les neuf sources du socle.
**Exclu** : dédoublonnage entre sources, géographie GeoNames et notation (phase 3) ; les sources « ensuite » (VDAB, emploi public, cabinets, pages carrière, alertes e-mail : phases 5 et 7). En phase 2, une même offre vue par deux sources apparaît deux fois ; seul le doublon exact d'une même source (même identifiant) est écarté.

**Critères de fin, tous vérifiables**

1. Chaque source du socle répond au mode test, depuis l'écran Sources et en ligne de commande.
2. Le journal montre, pour chaque source et chaque passage : offres lues, inédites et retenues après le pré-filtre de titre, durée, et l'erreur ou la raison d'un saut (quota, interrupteur, attente après un 429).
3. Une source qui rend 0 offre lue sans erreur, ou dont le volume s'effondre, déclenche l'alerte « source muette » (écran Sources et notification).
4. Un 403 ou un 429 arrête la source pour le passage, sans nouvel essai ; LinkedIn n'est plus appelé pendant 24 heures.
5. Aucune clé ne figure dans un journal, une erreur enregistrée ou une réponse de l'API.
6. En mode commercial, LinkedIn « invité » et les pages publiques ne peuvent pas s'activer.
7. CI verte, plan de sécurité de la section 9 appliqué et testé, revue de sécurité de la phase faite.

## 3. Modèle de données

Toutes les tables portent un `user_id` et une politique RLS, comme en phase 1 (les mots-clés, le rayon et la ville de base viennent du profil de chaque compte).

| Table | Contenu | Remarques |
| --- | --- | --- |
| `source_setting` | par source : activée ou non, attente jusqu'à (après un 429), quota restant connu | la liste des sources vient du code, leurs réglages de la configuration |
| `collection_pass` | un passage : planifié, manuel ou test ; début, fin, sources prévues | |
| `source_run` | une source dans un passage : statut (réussi, partiel, échec, sauté), lues, inédites, retenues, durée, code d'erreur ou raison du saut | jamais d'URL avec une clé, jamais de contenu de page |
| `job_offer` | une offre au format commun : identifiant chez la source, intitulé, employeur (`?` si inconnu), lieu (`?`), date, lien, salaire, description (1 200 caractères au plus), détails ; première et dernière vue | unique par source et identifiant ; la clé de contenu et la fusion viennent en phase 3 |

**Conservation** (Hypothèse) : une offre plus vue depuis 90 jours est supprimée (configuration) ; les journaux de passage sont gardés un an.

## 4. Contrat de connecteur et client HTTP

- **Un connecteur par source** (`packages/collect`) : il déclare son nom, sa famille (par mots-clés ou à liste fixe), son niveau de mots-clés (liste complète ou prioritaires), ses hôtes autorisés, son mode d'usage (personnel seulement ou non), ses pauses et son budget de temps ; il reçoit mots-clés, ville de base et rayon ; il rend `{ offers, readCount }`.
- **Un seul client HTTP** (`politeFetch`) pour toute la collecte, comme `job4me-no-direct-http` l'impose déjà par une règle Semgrep : hôte vérifié avant chaque requête et à chaque redirection, en-têtes ordinaires d'un navigateur (`Accept-Language: fr-BE,fr;q=0.9,nl;q=0.8,en;q=0.7`), pause par source, délai et taille de réponse bornés, **403 et 429 lèvent un arrêt de source**, clés masquées dans tout journal (`maskUrl`, déjà en place).
- **Lecture** : JSON validé par Zod ; HTML lu avec cheerio, **sans jamais exécuter le JavaScript des pages** ; un normaliseur unique pour les dates (RFC 2822, ISO, « 19 sep. 2026 », « Posted 26 days ago »…).
- **Peu d'essais** : un seul par requête pour LinkedIn et les pages publiques, deux ou trois avec attente croissante pour les API robustes.
- **Jeux de test** : pour chaque connecteur, quelques réponses réelles **anonymisées** (aucune donnée de tiers), pour repérer vite un changement de gabarit.

## 5. Orchestrateur et cadence

- Une tâche pg-boss par passage, un `try/catch` par source, un budget par source (60 à 180 s) et un budget global (15 min) : une source lente rend ce qu'elle a.
- **Cadence** (Hypothèse de la spécification) : pages publiques et LinkedIn **deux fois par semaine**, API et open data **une fois par jour**, depuis la connexion de la maison ; horaires dans la configuration.
- Une source volontairement non interrogée (interrupteur coupé, quota épuisé, attente après un 429, clé absente) est **« sautée »**, jamais « 0 offre ».
- Ordre d'appel : les sources les mieux renseignées d'abord (Actiris, Forem), pour la phase 3 où la première source gardera une offre vue deux fois.

## 6. Pré-filtre de titre

Les trois listes du profil (garde, rejet, toujours), saisies en phase 1, s'appliquent aux sources qui cherchent en OU (Actiris, StepStone) et aux sources à liste fixe ; jamais aux sources déjà précises (LinkedIn, Google Jobs). Intitulé comparé sans accents ni casse. La mesure contre les offres notées (« large à l'inclusion, net au rejet ») viendra en phase 3, avec la notation.

## 7. Les neuf sources du socle

Chaque connecteur s'écrit **après relecture de sa fiche dans `docs/SOURCES.md` et une vraie requête de sondage** (décision D1).

| Source | Voie | Mots-clés | Points de vigilance |
| --- | --- | --- | --- |
| Forem (ODWB) | open data, sans clé | liste complète | `within_distance` autour de la ville de base ; langues exigées reprises dans la description ; « .NET » pris pour « nettoyeur » ; source citée sur l'offre |
| Actiris | API JSON du site, sans clé | liste complète + pré-filtre | `Accept-Language` obligatoire ; `keywordSearchType: "Titre"` ; aucun champ en trop ; pas d'employeur depuis le 10/10/2026 ; offres de plus de 60 jours écartées |
| Adzuna | API, clé gratuite | liste complète, sans accents | `where=Bruxelles` ; mention « Jobs by Adzuna » ; clé dans l'URL, masquée |
| Google Jobs (SerpApi) | API, clé, 250 recherches par mois | prioritaires | `account.json` avant chaque passage (sans consommer), réserve dans la configuration |
| StepStone | page publique | liste complète + pré-filtre | 25 offres par page, pagination utile ; 410 = offre retirée |
| Jobijoba | page publique | prioritaires | sans ville ; deux pages |
| Jobrapido | page publique | prioritaires | sans `l=` ; intitulé parfois doublé |
| Talent.com | page publique | prioritaires | carte = l'`article` qui suit `data-job-id` ; classes à suffixe haché |
| LinkedIn « invité » | page publique, contraire à ses conditions (choix de Mehdi) | la dizaine de prioritaires | 20 s entre deux appels, un seul essai, page par page, **arrêt au premier 429 et 24 h sans appel** ; pagination à vérifier (`start=0, 10, 20`) ; coupé en mode commercial |

## 8. Écrans et API

- **Sources** : une carte par source avec son interrupteur, sa voie, son mode d'usage, ses derniers passages (lues, inédites, retenues, durée), son statut (réussie, partielle, sautée et pourquoi, en échec et pourquoi, muette) ; bouton **Tester les sources**.
- **Offres** (première version) : la liste des offres collectées, la plus récente d'abord, avec source et lien, filtrable par source ; la notation et le tri par pertinence arrivent en phase 3.
- **Ajouter une offre** : lien et texte collés par Mehdi ; le lien est **enregistré, jamais ouvert** par le serveur.
- API : `GET /api/sources`, `PATCH /api/sources/:name` (interrupteur), `POST /api/sources/test`, `GET /api/sources/:name/runs`, `GET /api/offers`, `POST /api/offers` (ajout manuel) ; en ligne de commande : `pnpm stack:cli sources:test [--source …]`.

## 9. Plan de sécurité court

Exigé par `CLAUDE.md` avant toute fonction de collecte ; il complétera le [modèle de menaces](../security/threat-model.md).

| # | Menace | Contrôles | Tests automatisés |
| --- | --- | --- | --- |
| 1 | Requête vers un hôte arbitraire (SSRF), par une redirection ou un lien collé | hôtes autorisés par connecteur, vérifiés à chaque redirection ; lien de l'ajout manuel jamais ouvert ; Semgrep `job4me-no-direct-http` | redirection hors liste refusée ; aucun appel sortant à l'ajout manuel |
| 2 | Page ou réponse hostile (énorme, malformée, piégée) | taille et délai bornés, cheerio sans JavaScript, format commun validé par Zod, longueurs plafonnées | jeux de test malformés et géants : source en échec propre, les autres continuent |
| 3 | Clé dans un journal (Adzuna, SerpApi) | `maskUrl`, erreurs enregistrées sans URL complète, clés en secrets de la machine | test de masquage sur une erreur réelle de connecteur |
| 4 | Blocage ou abus envers un site | cadence de particulier, pauses, arrêt au premier 403 ou 429, 24 h pour LinkedIn, interrupteur, mode d'usage | 429 simulé : arrêt immédiat, source « sautée » au passage suivant ; mode commercial : connecteurs personnels inactivables |
| 5 | Source muette ou tarissement silencieux | journal à chaque passage, alerte sur les offres **lues** et sur la tendance des derniers passages | 0 lue sans erreur et chute de volume : alerte levée |
| 6 | XSS par les champs d'une offre | échappement React, liens limités à `http` et `https`, `rel="noopener noreferrer"` | intitulé piégé affiché comme du texte ; lien `javascript:` refusé |
| 7 | Données de tiers dans les annonces (noms de recruteurs, contacts) | conservation limitée (90 jours sans être vue), jeux de test anonymisés, rien n'est envoyé ailleurs en phase 2 | purge testée ; gitleaks et revue des jeux de test |
| 8 | Dépassement de quota (SerpApi) | `account.json` avant le passage, réserve dans la configuration, source sautée sous la réserve | quota simulé sous la réserve : aucune recherche consommée |
| 9 | Worker saturé par une source lente | budget par source et budget global, une source à la fois par passage | source qui ne répond pas : budget respecté, passage terminé |

## 10. Ordre de réalisation

0. **Plan et ADR** : ce plan validé ; ADR 0013 (architecture de la collecte), 0014 (client HTTP poli et mode d'usage), 0015 (conservation des offres).
1. **Socle** : tables et RLS, client HTTP, contrat de connecteur, orchestrateur, journal, mode test (sans source réelle : un connecteur de test), ajout manuel.
2. **Open data et API** : Forem, Actiris avec pré-filtre, Adzuna, Google Jobs.
3. **Pages publiques** : StepStone, Jobijoba, Jobrapido, Talent.com.
4. **LinkedIn « invité »** avec ses précautions.
5. **Surveillance et écrans** : alerte « source muette », écran Sources complet, liste des offres.
6. **Clôture** : revue de sécurité, modèle de menaces complété, démonstration sur la machine de la maison.

**Démonstration** : sur la machine de la maison, mode test de chaque source, un passage réel, le journal par source, une source coupée puis rallumée, une offre ajoutée à la main ; CI verte.

## 11. Hypothèses de la spécification que je précise

1. **Où sonder les sources** : la règle « resonder par une vraie requête » s'applique avant chaque connecteur ; depuis l'environnement de Claude, l'adresse est celle d'un centre de données, que LinkedIn et certains sites traitent autrement qu'une connexion de particulier (décision D1).
2. **Doublons visibles en phase 2** : la fusion entre sources vient en phase 3 ; d'ici là, la liste des offres montre une offre par source qui la publie.
3. **LinkedIn « invité »** : la pagination de l'ami (`start=0, 25, 50`) saute probablement les rangs 11 à 25 ; je vérifierai `start=0, 10, 20` par deux appels avant d'écrire le connecteur.
4. **Conservation des offres** : la spécification ne la fixe pas ; je propose 90 jours sans être vue (Hypothèse, configuration).

## 12. Décisions à prendre

| # | Question | Options | Recommandée |
| --- | --- | --- | --- |
| D1 | Où sonder les sources avant d'écrire chaque connecteur ? | **a.** depuis l'environnement de Claude, en ajoutant les hôtes des sources à sa liste autorisée (une demande d'approbation par lot) ; LinkedIn depuis la maison par une commande que tu lances ; **b.** tout depuis la maison, par une commande `pnpm sources:probe` dont tu me renvoies le résultat | a |
| D2 | Clés Adzuna et SerpApi | **a.** tu les crées maintenant (gratuites, à ton nom) et les poses sur la machine de la maison ; **b.** plus tard : les deux connecteurs restent « sautés, clé absente » | a |
| D3 | Cadence (Hypothèse) | **a.** API chaque jour, pages et LinkedIn le mardi et le vendredi à 7 h 10 ; **b.** d'autres jours ou heures, que tu donnes | a |
| D4 | Alerte « source muette » | **a.** notification sur le téléphone et bandeau sur l'écran Sources ; **b.** bandeau seulement | a |
| D5 | Conservation des offres | **a.** 90 jours sans être vue (Hypothèse) ; **b.** une autre durée | a |
| D6 | Fusion des pull requests | **a.** Claude fusionne après une CI verte, comme en phases 0 et 1 ; **b.** tu relis chaque pull request | a |

## 13. ADR à rédiger au lot 0

- 0013 Architecture de la collecte : contrat de connecteur, orchestrateur, isolement par source, lecture sans JavaScript.
- 0014 Client HTTP poli et mode d'usage : hôtes autorisés, cadence, arrêt au 403 et 429, coupure en mode commercial.
- 0015 Conservation des offres collectées et des journaux de passage.

## 14. Décisions prises le 23/11/2026

| # | Décision |
| --- | --- |
| D1 | Sondage depuis l'environnement de Claude, avec l'accord de Mehdi pour chaque hôte ajouté à sa liste autorisée ; LinkedIn depuis la connexion de la maison |
| D2 | Clés Adzuna et SerpApi **plus tard** : les deux connecteurs s'écrivent et se testent sur leurs jeux de test, puis restent « sautés, clé absente » jusqu'à ce que Mehdi pose les clés sur la machine de la maison |
| D3 | API et open data chaque jour ; pages publiques et LinkedIn le mardi et le vendredi à 7 h 10 |
| D4 | Alerte « source muette » par notification sur le téléphone et bandeau sur l'écran Sources |
| D5 | Offres supprimées 90 jours après leur dernière vue |
| D6 | Claude fusionne chaque pull request après une CI verte |
