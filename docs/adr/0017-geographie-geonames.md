# 0017 Géographie : localités GeoNames et distances

Statut : acceptée le 23/11/2026.

## Contexte

Chaque source écrit les lieux à sa façon (« Gent, Flemish Region, Belgium », « 1000 », « Bruxelles (1000) », « België »). La spécification (section 5) veut une distance depuis la ville de base, un lieu inconnu gardé, le télétravail gardé. En phase 2, le Forem cherchait autour d'un centre fixe (Bruxelles, Hypothèse).

## Décision

- **Localités GeoNames** (fichier `BE` et ses codes postaux, licence CC BY 4.0) : environ 2 700 localités, sous leurs noms français, néerlandais, allemand et anglais, avec codes postaux et coordonnées. Un **fichier dérivé versionné dans le dépôt** (décision D6), régénérable par un script, chargé en base par la migration et contrôlé par son empreinte ; attribution dans le dépôt et dans l'application. Table commune à tous les comptes, sans donnée personnelle.
- **Lecture d'un lieu** : noms, puis code postal (en écartant 2020 à 2035) ; les noms de pays et de région ne situent rien ; une ambiguïté au-delà de 15 km n'est pas devinée ; un lieu à l'étranger est hors rayon.
- **Distance** = vol d'oiseau × 1,25 depuis la ville de base du profil, résolue en localité ; rayon du profil (40 km par défaut). Lieu inconnu et télétravail accepté : gardés quelle que soit la distance.
- La ville de base remplace le centre fixe de la phase 2 pour les recherches autour d'un point (le Forem).

## Conséquences

- Les distances s'affichent sur chaque offre ; le filtre de distance ne perd jamais une offre au lieu inconnu.
- Une mise à jour de GeoNames passe par le script et une revue du fichier dérivé.

## Mise en œuvre (lot 2, 24/11/2026)

- **Données** : `pnpm geonames` lit les trois fichiers BE de GeoNames (codes postaux, lieux, noms alternatifs) et écrit `packages/db/drizzle/data/localities.tsv` : 2 762 localités (nom et province), 1 008 avec d'autres noms (Malines, Elsene, Gand, Antwerp, Luik, Hal…), codes postaux et coordonnées, 180 Ko, attribution en tête. Seuls les noms courants en alphabet latin sont gardés : ni noms historiques, ni formes administratives (« Arrondissement de Namur »), ni formes doubles (« Ixelles/Elsene »).
- **Chargement** : la migration 0010 crée `locality` et `dataset` ; après les migrations, le fichier est chargé si son empreinte SHA-256 diffère de celle déjà en base, et **refusé s'il ne correspond pas à l'empreinte écrite dans le code** (`LOCALITIES_SHA256`, mise à jour par le script) : un fichier altéré arrête la migration (menace 8, testé). Tables en lecture seule pour l'application, sans données personnelles.
- **Lecture d'un lieu** (`packages/collect/src/places.ts`) : le lieu est découpé (virgules, parenthèses, barres, tirets espacés) ; les pays, régions et provinces sont ignorés ; un nom de localité, puis un code postal (hors 2020 à 2035, dans la configuration `geo`), situent l'offre. Sur les jeux de test des huit connecteurs, chaque lieu réel est lu (« Bruxelles (1000) », « Laeken, Bruxelles (1020) », « Brussel, België », « Gand », « Huizingen, BE »).
- **Précisions**, à signaler :
  1. Le **nom officiel** d'une localité passe avant les autres noms des autres : « Mechelen » est la ville, pas les villages du Limbourg que leurs habitants appellent aussi ainsi.
  2. La **Région de Bruxelles-Capitale** situe l'offre à Bruxelles : la région, c'est la ville et ses communes.
  3. **Luxembourg** seul est à l'étranger (le plan) ; avec une localité belge (« Arlon, Luxembourg »), c'est la province.
  4. **Ambiguïté** : comme prévu, un nom porté par deux localités à plus de 15 km n'est pas deviné, ce qui laisse sans distance « Halle », « Aalst » ou « Machelen » écrits sans code postal. La mesure sur une semaine d'offres dira s'il faut préférer la commune à la section.
  5. **Télétravail** : « (Remote) » ou « Bruxelles (hybride) » comme segment du lieu ou de l'intitulé, et dans la description des termes sans ambiguïté (« télétravail », « thuiswerk », « home office »…), négations écartées ; un « 100 % télétravail » explicite vaut télétravail complet. Au lot 3, la proposition de ne garder au-delà du rayon que le télétravail complet n'a pas été retenue : la spécification garde le télétravail annoncé, complet ou partiel (ADR 0019).
  6. **Recherches autour d'un point** : le Forem cherche autour de la ville de base trouvée (sinon la zone de la configuration). StepStone et Talent.com gardent la ville de la configuration dans leur adresse de recherche, tant que leurs noms de ville n'ont pas été vérifiés.
  7. **Attribution** : l'application n'a pas encore d'écran « À propos » ; l'attribution GeoNames figure sous la ville de base du profil, là où les localités servent, et dans le README.
- **Distances** : chaque parution est située à l'écriture ; l'annonce prend le lieu le plus précis de ses parutions (trouvé avec code postal, trouvé, à l'étranger, inconnu) et sa distance par la route depuis la ville de base, recalculée pour toutes les annonces quand la ville de base change. Les offres déjà en base sont situées au démarrage du worker.

