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

## Mise en œuvre (lot 1, 23/11/2026)

- **Code** : les règles, pures et testées, dans `packages/collect/src/dedup.ts` (normalisation, clé, raisons de fusion, placement des parutions d'un passage) ; le stockage dans `packages/db/src/offers.ts` (candidats de l'historique, création et recalcul des annonces) ; le worker range les parutions de chaque passage (`apps/worker/src/collect/postings.ts`), l'API les ajouts manuels et la séparation.
- **Deux tables** : `offer` (l'annonce : sa parution retenue, première et dernière vue) et `job_offer` (la parution : `offer_id`, clé de contenu, intitulé nu, références, raison de la fusion, version de la normalisation). L'annonce affiche sa parution retenue, recalculée à chaque changement.
- **Journal** : `inédites` compte désormais les **annonces nouvelles** ; `fusionnées` (`merged_count`) les parutions nouvelles rattachées à une annonce existante ou à une autre parution du même passage. Une parution déjà vue chez la même source n'est ni l'une ni l'autre. Le test des sources compte les deux sans rien écrire. Écran Sources et `sources:run` affichent les deux colonnes.
- **Historique** : 21 jours (`collect.offers.historyDays`), appliqué aux quatre critères comme le dit le plan, et mesuré sur la dernière vue de l'annonce : une offre revue après trois semaines d'absence redevient une annonce nouvelle.
- **Stabilité** : une parution déjà enregistrée garde son annonce à chaque passage ; une séparation faite depuis la fiche (« Ce n'est pas la même offre ») n'est donc jamais défaite par la collecte. Chaque séparation est inscrite au journal d'audit (`offer.unmerged`).
- **Précisions apportées à `docs/SOURCES.md`**, toutes dans le sens de moins de fusions (au pire un doublon visible, jamais une offre perdue) :
  1. **Référence interne** : quatre chiffres seuls ne comptent qu'après un mot comme « réf », « ID » ou « vacature » ; sans lui, ce sont souvent des codes postaux, et deux « Comptable – 1000 Bruxelles » chez deux employeurs auraient fusionné. Cinq chiffres ou plus, ou un préfixe de lettres (« R0012345 »), comptent toujours ; les millésimes et les montants jamais.
  2. **Références différentes** : deux parutions dont les références diffèrent toutes ne fusionnent jamais, même à clé égale (un grand employeur qui ouvre deux postes du même intitulé).
  3. **Même lien** : seulement à intitulé nu identique et sans deux employeurs différents ; une page « carrières » commune à plusieurs offres ne les fusionne pas.
  4. **Ajouts manuels** : deux ajouts manuels ne fusionnent jamais entre eux, chacun est voulu ; un ajout manuel rejoint une annonce déjà collectée quand les règles le disent, et l'écran le signale.
  5. **Employeur dans l'intitulé** : retiré quand il l'ouvre ou le ferme (« Business Analyst – Deloitte »), seulement comme segment séparé (tiret, barre, parenthèses, « chez »), jamais quand il forme tout l'intitulé.
  6. **Site d'emploi à la place de l'employeur** (LinkedIn, Indeed, StepStone, Jobat, mais aussi Actiris, le Forem, le VDAB) : remplacé par `?` dès le format commun, donc aussi à l'affichage.
- **Offres de la phase 2** : la migration 0009 donne à chacune sa propre annonce ; au démarrage, le worker calcule leur identité et regroupe une fois celles qui sont la même annonce, selon les règles de l'historique. Un changement de normalisation incrémente `DEDUP_VERSION` : les identités sont recalculées au démarrage suivant.
- **Limite connue**, à reprendre au lot 2 avec les localités : la clé ignore le lieu ; une agence d'intérim qui publie le même intitulé pour plusieurs clients forme une seule annonce à plusieurs parutions, toutes visibles sur la fiche et séparables.
- **Tests** : les cas mesurés de `docs/SOURCES.md` (Deloitte et BNP, Adecco et Adeccorp, Sander et Sander Brussels, Wibit, Client of Manpower, AG Insurance), la fusion entre sources, la stabilité après séparation, la fenêtre de trois semaines, le mode test, le regroupement des offres de la phase 2 et la migration 0009 sur des parutions de la phase 2.
