# Revue de sécurité de la phase 2

Revue du 23/11/2026, par Claude, sur les lots 1 à 5 (socle de la collecte, open data et API, pages publiques, surveillance et écrans) et sur la suppression d'un import. **LinkedIn « invité » (lot 4) attend le sondage depuis la maison** (décision D1) : sa part de la revue s'ajoutera avec son connecteur. Référence : [modèle de menaces](threat-model.md), lignes 31 à 40.

## Méthode

- **Lecture du code** : client HTTP poli (hôtes, redirections, en-têtes, tailles, délais, budget, 403 et 429), orchestrateur (isolement des sources, budgets, raisons de saut, journal), lecture des pages (cheerio sans code exécuté, `script` et `style` retirés), format commun, RLS et filtres `user_id` des quatre nouvelles tables, API des sources et des offres, ajout manuel, ligne de commande, alerte « source muette », notifications, purge, suppression d'un import.
- **Contrôles automatiques** passés en local et en CI : 69 tests unitaires du paquet de collecte (dont les huit connecteurs sur des réponses réelles anonymisées), 144 tests d'intégration sur PostgreSQL 18, 8 tests de bout en bout sur l'API puis sur la pile en conteneurs, règles Semgrep du projet (seul `packages/collect/src/http.ts` peut appeler `fetch`), gitleaks, `pnpm audit`, actionlint, zizmor, `pnpm check:compose` (clés des sources remises au seul worker).
- **Vérifications réelles**, depuis l'environnement de Claude avec l'accord de Mehdi pour chaque hôte (décision D1) : une requête de sondage par source avant son connecteur, puis un passage du connecteur sur la vraie réponse. Rien de ce qui a été lu n'est dans le dépôt : les jeux de test gardent le balisage réel avec des contenus inventés.

## Constats

| # | Constat | Gravité | Statut |
| --- | --- | --- | --- |
| 1 | Le connecteur qui ignore son budget laissait une promesse rejetée sans gestionnaire : une erreur tardive aurait arrêté le worker. | moyenne (disponibilité) | corrigé au lot 1 : course contre le budget, rejets absorbés, apports tardifs ignorés |
| 2 | Une erreur de la base pendant l'écriture d'une source arrêtait tout le passage. | faible (disponibilité) | corrigé au lot 1 : chaque source isolée jusqu'à l'écriture de son journal |
| 3 | Les expressions du pré-filtre de titre, lues comme des expressions régulières (`docs/SOURCES.md`), pouvaient bloquer le worker par retour arrière catastrophique. | moyenne (disponibilité) | corrigé au lot 1 : texte cherché en début de mot, jamais une expression régulière (écart signalé, ADR 0013) |
| 4 | Sur la pile de développement et en CI, le bouton « Tester les sources » aurait appelé les vrais sites. | moyenne (respect des sites, données de tiers) | corrigé au lot 2 : en développement, la source de démonstration remplace toutes les vraies |
| 5 | Actiris n'est pas strictement chronologique : l'arrêt sur l'âge de la dernière annonce aurait sauté des pages récentes. | faible (complétude) | corrigé au lot 2, vu sur la vraie réponse |
| 6 | L'ODWB limite les anonymes à 10 000 appels par jour et par adresse ; l'adresse partagée de l'environnement de Claude l'avait déjà atteinte (429). | faible | accepté : aucune insistance ; vérification réelle du Forem depuis la maison ; une soixantaine d'appels par jour n'en approche pas |
| 7 | Google Jobs chaque jour (décision D3) dépasserait les 250 recherches mensuelles du plan gratuit. | faible (quota) | corrigé au lot 2 : lundi, mercredi et vendredi, compte consulté avant chaque passage, réserve de 20 |
| 8 | Jobijoba cache les liens des annonces sponsorisées (ROT13). | faible (respect des sites) | accepté : jamais décodés, ces annonces sont lues et comptées, pas gardées |
| 9 | Le sélecteur `data-at="job-item"` de StepStone apparaît aussi dans le CSS de la page : compter ses occurrences aurait faussé le nombre d'offres lues. | faible (journal) | corrigé au lot 3 : seuls les éléments `article` comptent |
| 10 | Le budget de 15 minutes d'un passage ne suffit pas le mardi et le vendredi. | faible (complétude) | corrigé au lot 3 : 30 minutes, dans la configuration |
| 11 | Les fichiers importés restaient chiffrés sans limite de durée (revue de la phase 1, constat 14). | faible (minimisation) | corrigé : suppression d'un import, de son fichier, de son texte et de ses propositions |
| 12 | Avis `minimatch` de l'outil de lint (revue de la phase 1, constat 18). | faible | corrigé : `typescript-eslint` 8.73.0, exception retirée |
| 13 | Les annonces des agrégateurs portent parfois des données de tiers (nom d'un recruteur). | faible | accepté (ADR 0015) : 90 jours au plus après la dernière vue, rien ne quitte la machine en phase 2 |
| 14 | Le client se présente avec l'en-tête d'un navigateur ordinaire (`docs/SOURCES.md`, section 0). | faible (conformité) | accepté : choix documenté ; ni cookie, ni rotation d'adresse, ni navigateur sans tête, ni captcha ; arrêt au premier 403 ou 429 |
| 15 | StepStone est derrière Akamai : la première requête passe, une suite trop rapprochée pourrait être refusée. | faible (disponibilité) | accepté : 3 s entre deux pages, un seul essai, arrêt net au premier refus, visible au journal |
| 16 | Adzuna et Google Jobs n'ont pas encore de clé (décision D2) : leurs jeux de test suivent les champs documentés, pas une vraie réponse. | faible | à faire quand les clés existeront : sondage puis jeux de test anonymisés |

## Points vérifiés sans constat

- **SSRF** : HTTPS seulement, hôtes exacts déclarés par le connecteur, port par défaut, aucun identifiant dans l'URL, chaque redirection revérifiée ; le lien d'une offre ajoutée à la main n'est jamais ouvert ; l'API n'appelle jamais une source, seul le worker le fait.
- **Réponses hostiles** : taille bornée avant et pendant la lecture, après décompression ; délai par requête, budget par source et par passage ; JSON et données de pages validés par Zod ; format commun validé, longueurs plafonnées, liens `http` et `https` seulement.
- **Respect des sites** : pause par source, un seul essai pour les pages, arrêt au premier 403 ou 429, attente configurable après un refus (24 heures pour LinkedIn), un passage à la fois, interrupteur par source, mode commercial qui coupe les sources à usage personnel (tests à l'appui).
- **Clés** : fichiers secrets remis au seul worker, au seul connecteur qui les déclare ; masquées dans chaque ligne de journal (`app_id`, `app_key`, `api_key`) ; jamais dans un journal de passage ni une réponse de l'API.
- **Appartenance** : `user_id` et RLS sur `source_setting`, `collection_pass`, `source_run` et `job_offer` ; un passage ne tourne que pour son compte ; un autre compte ne voit ni offre, ni passage, ni journal.
- **Affichage** : texte des offres rendu par React, jamais comme HTML ; liens filtrés à l'affichage et ouverts avec `rel="noopener noreferrer"` ; aucune image distante.
- **Surveillance** : journal à chaque passage (lues, retenues, inédites, durée, raison) ; alerte sur les offres lues et la médiane des passages précédents ; une notification par incident.
- **Conservation** : offres 90 jours après leur dernière vue, journaux un an, purge testée compte par compte.

## Reste à faire

1. **LinkedIn « invité » (lot 4)** : lancer `pnpm probe:linkedin` sur la machine de la maison et renvoyer le bloc affiché ; le connecteur s'écrit ensuite, avec sa part de cette revue.
2. **Sur la machine de la maison** : suivre le [guide de démonstration](../guide/demonstration-phase-2.md), dont le test réel du Forem (constat 6).
3. **Clés d'Adzuna et de SerpApi**, quand tu le souhaites (constat 16).
