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
