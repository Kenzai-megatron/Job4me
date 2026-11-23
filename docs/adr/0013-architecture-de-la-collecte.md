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
- **Source de démonstration** (`demo`) : des offres fictives sous `example.org`, sans aucune requête, disponible seulement si `collect.demoSource` est vrai (`JOB4ME_COLLECT_DEMO_SOURCE`, écrit par `pnpm setup:dev`, jamais par `setup:home`). Elle fait passer les tests de bout en bout par toute la chaîne.
- Un passage interrompu (worker arrêté) est marqué `interrupted` au passage suivant ; la file ne relance jamais un passage (`retryLimit` 0).
