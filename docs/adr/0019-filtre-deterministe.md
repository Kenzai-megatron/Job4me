# 0019 Filtre déterministe

Statut : acceptée le 24/11/2026, au lot 3 de la phase 3 (plan, section 6).

## Contexte

Avant toute notation, la spécification (section 5, étapes 4 à 6) écarte sans coût ce qui est certain : employeurs exclus, annonces trop anciennes, lieux hors rayon, critères éliminatoires connus. `docs/SOURCES.md` (section 1.5) rappelle que l'erreur n'est pas symétrique : une offre écartée à tort n'est vue par personne. Le filtre doit donc être large à l'inclusion et net au rejet.

## Décision

- **Règles pures** (`packages/collect/src/screen.ts`), dans cet ordre, la première qui s'applique donne la raison :
  1. **employeur exclu** dans le profil, comparé par mots : « Deloitte » écarte « Deloitte Digital », jamais l'inverse ;
  2. **annonce trop ancienne**, plus de 60 jours depuis sa dernière parution datée (configuration `collect.offers.maxAgeDays`) ;
  3. **à l'étranger**, sauf télétravail complet accepté ;
  4. **au-delà du rayon** du profil, sauf télétravail annoncé, complet ou partiel, accepté (préférence autre que « sur site ») ; un lieu inconnu est gardé ;
  5. **langue exigée** par un champ de la source (la Forem) et exclue par une règle éliminatoire « langue » du profil ;
  6. **contrat** donné par un champ de la source (Forem, Actiris, Adzuna) qui n'est aucun de ceux du profil (aucun contrat choisi : aucun filtre).
- Ce qu'un texte libre dit (« néerlandais courant », années d'expérience) part à la notation, qui le pèse.
- **Une offre ajoutée à la main n'est jamais écartée** : elle est voulue.
- **Où il tourne** : dans le worker, après chaque passage, sur les annonces touchées ; au démarrage, sur les annonces jamais lues ; et sur toutes les annonces d'un compte quand l'API signale qu'un critère a changé (ville de base, rayon, contrats, télétravail, employeurs exclus, règles éliminatoires), par la file `offers_screen`.
- **Raison gardée** sur l'annonce (`excluded_reason`), avec l'heure du filtrage ; la liste montre les gardées par défaut, les écartées sur demande, avec leur raison.

## Conséquences

- Aucune offre n'est perdue en silence : chaque écart a sa raison, visible à l'écran, et un changement de critère les relit toutes.
- Les sources donnent désormais le contrat et les langues exigées dans des champs à part (`contracts`, `languages` des parutions).
- La notation (lots 4 et 5) ne lit que les offres gardées.
