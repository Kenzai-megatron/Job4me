# 0015 Conservation des offres collectées et des journaux

Statut : acceptée le 23/11/2026.

## Contexte

Les annonces collectées contiennent parfois des données de tiers (nom, e-mail ou téléphone d'un recruteur). La spécification (section 12) demande de ne garder que le nécessaire ; elle ne fixe pas de durée pour les offres.

## Décision

- Une offre qui n'a plus été vue depuis **90 jours** (Hypothèse, décision D5 du 23/11/2026) est supprimée par la purge horaire du worker ; la durée est dans la configuration.
- Les journaux de passage (`collection_pass`, `source_run`) sont gardés **un an** : ils servent à mesurer la pertinence de chaque source (phase 7) et ne contiennent ni URL avec clé ni contenu de page.
- Les jeux de test des connecteurs sont des réponses réelles **anonymisées** : aucune donnée de tiers dans le dépôt.
- Rien de ce qui est collecté ne quitte la machine en phase 2 ; l'envoi à Claude pour la notation sera décidé avec la phase 3.

## Conséquences

- Une offre encore publiée et revue garde sa date de première vue ; la purge ne touche que ce qui a disparu des sources.
- La phase 3 rattachera aux offres des notes et des liens de candidature : leur durée de vie suivra celle de l'offre, ou sera fixée par une nouvelle ADR.
