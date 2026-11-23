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
