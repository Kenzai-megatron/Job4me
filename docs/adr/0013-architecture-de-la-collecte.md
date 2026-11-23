# 0013 Architecture de la collecte

Statut : acceptée le 23/11/2026.

## Contexte

La phase 2 collecte les offres de neuf sources du socle (spécification, sections 3 et 14 ; `docs/SOURCES.md`, section 1). Les sources changent sans prévenir, tombent, se taisent ou bloquent ; la plus fréquente des pannes est une source qui rend 0 offre sans erreur.

## Décision

- **Un format commun** (`CollectedOffer` : identifiant chez la source, intitulé, employeur et lieu à `?` si inconnus, date, lien, salaire, description de 1 200 caractères au plus, détails, source), validé par Zod à la sortie de chaque connecteur.
- **Un connecteur par source**, dans le paquet `packages/collect` : il déclare son nom, sa famille (par mots-clés ou à liste fixe), son niveau de mots-clés (liste complète ou prioritaires), ses hôtes, son mode d'usage, ses pauses et son budget de temps ; il rend `{ offers, readCount }`, `readCount` comptant les annonces lues avant tout filtre.
- **Un orchestrateur dans le worker** : une tâche pg-boss par passage, un `try/catch` et un budget de temps par source, un budget global ; une source qui tombe n'arrête jamais les autres. Une source volontairement non interrogée (interrupteur, clé absente, quota, attente après un 429) est « sautée », jamais « 0 offre ».
- **Un journal par source et par passage** (`source_run` : lues, inédites, retenues après le pré-filtre de titre, durée, statut, code d'erreur ou raison du saut) dès le premier jour, et une alerte « source muette » calculée sur les offres **lues** et la tendance des derniers passages.
- **Lecture sans JavaScript** : JSON validé par Zod, HTML lu avec cheerio ; jamais de navigateur sans tête, jamais d'exécution du code des pages.
- **Mode « tester les sources »** : un mot-clé, une page par source, depuis l'écran Sources et en ligne de commande ; il écrit son journal, pas d'offre.

## Conséquences

- Ajouter une source revient à écrire un connecteur et ses jeux de test (réponses réelles anonymisées), sans toucher à l'orchestrateur.
- Le dédoublonnage entre sources, la géographie et la notation (phase 3) se branchent après la collecte, sur le même format.

## Mise en œuvre (lot 1, 23/11/2026)

- Paquet `packages/collect` : format commun (`cleanOffer`, `collectedOfferSchema`), client poli, normaliseur de dates, pré-filtre de titre, registre des connecteurs. Il ne touche jamais la base : l'orchestrateur (`apps/worker/src/collect/pass.ts`) écrit les offres et le journal sous RLS.
- Un connecteur remet ses offres page par page (`context.add`) : une source arrêtée par son budget ou par un 429 garde ce qu'elle a lu, avec le statut « partielle ». `eachKeyword` passe au mot-clé suivant après une panne isolée et échoue quand tous les mots-clés ont échoué.
- Les pauses, budgets, essais, pages et attentes après un refus sont dans la configuration (`collect.sources.<nom>`) ; le connecteur déclare le reste (famille, niveau de mots-clés, hôtes, mode d'usage, clés, pré-filtre).
- **Comptes du journal** : `lues` avant tout filtre (ce que la source a rendu), `retenues` après le format commun, le doublon exact et le pré-filtre de titre, `inédites` parmi les retenues (jamais vues pour cette source). On a donc toujours lues ≥ retenues ≥ inédites ; les offres hors format sont comptées à part (`invalid_count`).
- **Pré-filtre de titre** : une expression du profil est un texte cherché en début de mot (« laborat » ne prend plus « collaborateur »), sans accents ni casse, et non une expression régulière, contrairement à `docs/SOURCES.md` (section 1.5). Raisons : une expression saisie ne peut pas bloquer le worker (retour arrière catastrophique), et elle se tape sans connaître la syntaxe. Une liste « garde » vide laisse tout passer. À revoir si la mesure de la phase 3 montre un besoin.
- **Mode test** : un mot-clé (le premier prioritaire), une page par source ; il écrit son journal et compte les inédites sans enregistrer d'offre. Un seul test à la fois par compte.
- **Source de démonstration** (`demo`) : des offres fictives sous `example.org`, sans aucune requête, disponible seulement si `collect.demoSource` est vrai (`JOB4ME_COLLECT_DEMO_SOURCE`, écrit par `pnpm setup:dev`, jamais par `setup:home`). Elle fait passer les tests de bout en bout par toute la chaîne et, depuis le lot 2, **remplace alors toutes les vraies sources** : ni une machine de développement ni la CI n'appellent un vrai site.
- Un passage interrompu (worker arrêté) est marqué `interrupted` au passage suivant ; la file ne relance jamais un passage (`retryLimit` 0).

## Mise en œuvre (lot 2, 23/11/2026)

- Quatre connecteurs, dans cet ordre d'appel : **Actiris**, **Forem**, **Google Jobs** (SerpApi), **Adzuna**. Actiris et Forem ont été sondés par une vraie requête le 23/11/2026 depuis l'environnement de Claude (décision D1, hôtes `www.actiris.brussels` et `www.odwb.be` autorisés avec l'accord de Mehdi) ; leurs jeux de test sont ces réponses, anonymisées (références, numéros d'entreprise et employeurs inventés). Adzuna et SerpApi n'ont pas encore de clé (décision D2) : leurs jeux de test suivent les champs documentés, à remplacer par de vraies réponses anonymisées dès que les clés existent.
- Chaque source déclare ses propres paramètres (`collect.sources.<nom>.params`, vérifiés au démarrage par le schéma du connecteur) et un âge maximal des annonces (`maxAgeDays` : 60 jours pour Actiris, le Forem et Adzuna).
- **Centre des recherches (Hypothèse)** : le Forem cherche autour d'un point ; tant que la géographie de la phase 3 ne situe pas la ville de base du profil, ce point est Bruxelles (`collect.area`), avec le rayon du profil.
- **Mode d'usage** : seul le Forem (open data sous CC BY-SA 4.0) reste actif en mode commercial. Actiris (API interne du site, non publiée), Adzuna (licence exigée pour un usage commercial) et Google Jobs par SerpApi (formule payante pour un usage commercial, à vérifier le jour venu) sont classés « usage personnel », comme les pages publiques.
- **Quota** : un connecteur peut se déclarer « sauté » avant sa première recherche (`SourceSkipped`, raison `quota`) et rapporter le solde de son compte (`reportQuota`), enregistré dans `source_setting`.
- **Vérification réelle** : le connecteur Actiris a lu une vraie réponse (100 offres sur 100 au format commun) ; il ne s'arrête plus sur l'âge de la dernière annonce, la liste n'étant pas strictement chronologique. Le Forem a répondu 429 à l'environnement de Claude (limite quotidienne de l'ODWB par adresse, partagée là-bas) : sa vérification réelle se fait depuis la maison, `pnpm stack:cli sources:test --source forem`.

## Mise en œuvre (lot 3, 23/11/2026)

- Quatre pages publiques, toutes « usage personnel » : **StepStone** (liste complète des mots-clés et pré-filtre de titre, la recherche étant un OU), **Jobijoba**, **Jobrapido** et **Talent.com** (mots-clés prioritaires). Ordre d'appel : Actiris, Forem, StepStone, Google Jobs, Adzuna, puis les agrégateurs.
- Lecture avec cheerio (`cheerio/slim`, sans parse5 ni undici) : `script`, `style`, `noscript`, `template` et `svg` retirés avant toute lecture ; aucun code de page exécuté. Jobrapido porte ses données en JSON dans un attribut `data-advert`, lu comme une donnée et validé par Zod.
- Sondés le 23/11/2026 par une vraie requête chacun (hôtes autorisés avec l'accord de Mehdi), puis lus par leur connecteur : StepStone 25 offres sur 25 au format commun, Jobijoba 27 sur 30, Jobrapido 8 sur 8, Talent.com 10 récentes sur 16 lues. Les jeux de test reprennent le balisage réel (balises, classes, attributs, blocs `<style>`) avec des contenus inventés.
- **Jobijoba** : les annonces sponsorisées n'ont qu'un lien chiffré (ROT13) ; il n'est jamais décodé : ces annonces sont lues et comptées, jamais gardées.
- **Gabarit changé** : une page StepStone sans total ni carte lève `invalid_response`, jamais « 0 offre » en silence ; pour les autres, la page vide se voit au journal (0 lue) et nourrira l'alerte « source muette » du lot 5.
- Budget d'un passage porté à 30 minutes (`collect.passBudgetMs`) : le mardi et le vendredi, pages publiques et LinkedIn s'ajoutent aux API.
