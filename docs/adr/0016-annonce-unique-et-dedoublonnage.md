# 0016 Annonce unique et dédoublonnage

Statut : acceptée le 23/11/2026.

## Contexte

La même annonce circule sur plusieurs sites, sous des URL différentes, parfois republiée un autre jour avec l'employeur écrit autrement (`docs/SOURCES.md`, section 1.6). En phase 2, chaque parution est une ligne de `job_offer` : une annonce vue par trois sources apparaît trois fois. La phase 3 doit ne la montrer qu'une fois, et la noter une seule fois.

## Décision

- **Deux niveaux** : l'**annonce** (`offer`, une par clé et par compte) et ses **parutions** (`job_offer`, une par source et par identifiant, rattachées par `offer_id`). Les scores, les notes de Mehdi et la purge de 90 jours portent sur l'annonce ; sa dernière vue est la plus récente de ses parutions.
- **Clé de contenu** = `sha1(intitulé normalisé | employeur normalisé)` sur 16 caractères, jamais l'URL ; normalisation de `docs/SOURCES.md` (accents, mentions de genre, références, villes, contrats, formes juridiques) ; un site d'origine à la place de l'employeur devient `?`.
- **Fusion prudente des republications**, à intitulé nu identique : référence interne commune ; l'un des deux sans employeur ; même employeur à une extension de nom près, comparé par mots. Jamais deux employeurs différents sans référence commune. Historique de trois semaines (configuration).
- **Annonce retenue** : celle qui nomme l'employeur, puis la plus longue description ; l'ordre d'appel des sources départage le reste.
- **Réversible** : une fusion se défait depuis la fiche ; chaque source compte ses parutions fusionnées à chaque passage.

## Conséquences

- La liste des offres et la notation travaillent sur les annonces ; la fiche montre toutes les parutions et leurs liens.
- Une fusion à tort fait perdre une offre de vue : les règles restent étroites, testées sur les cas mesurés de `docs/SOURCES.md`.
