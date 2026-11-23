# Démonstration de la phase 2

Sur la machine de la maison, une demi-heure, plus l'attente du premier passage planifié. Le [guide d'installation](installation.md) reste la référence pour chaque commande ; ce guide suit les critères de fin de la phase ([plan de la phase 2](../plans/phase-2.md), section 2).

## 0. Mettre à jour

```bash
cd ~/job4me && git pull && pnpm install && pnpm setup:home && pnpm stack:up
```

`pnpm setup:home` ajoute les fichiers secrets vides d'Adzuna et de SerpApi (`secrets/adzuna_app_id`, `adzuna_app_key`, `serpapi_key`) sans toucher aux anciens. La migration ajoute les tables de la collecte.

Vérifie que le worker voit les sources :

```bash
pnpm stack:logs worker
```

Attendu : une ligne `collection ready` qui cite `actiris`, `forem`, `stepstone`, `google_jobs`, `adzuna`, `jobijoba`, `jobrapido`, `talent` (jamais `demo` sur la machine de la maison).

## 1. Des mots-clés validés

La collecte cherche avec les mots-clés **validés** du profil, les **prioritaires** pour les sources rationnées. Dans **Profil > Mots-clés de recherche**, garde au moins une dizaine de mots-clés, dont quelques prioritaires. Sans mot-clé, chaque source est « sautée, aucun mot-clé validé ».

## 2. Tester les sources

1. **Offres > Sources**, puis **Tester les sources** : un mot-clé, une page par source, aucune offre enregistrée.
2. Attendu en une à deux minutes, pour chaque source : **Réussie** avec « N lues · N retenues · N inédites », ou **Sautée** avec sa raison : Adzuna et Google Jobs « clé absente » tant que les clés ne sont pas posées.
3. La même chose en ligne de commande :

```bash
pnpm stack:cli sources:test
```

À signaler : une source **en échec** (avec le détail affiché), ou réussie avec **0 lue** : le site a peut-être changé de gabarit. Le Forem n'a pas pu être vérifié depuis l'environnement de Claude (limite de l'ODWB atteinte par son adresse partagée) : c'est ici qu'il se vérifie.

## 3. Un passage réel

Sans attendre 7 h 10 :

```bash
pnpm stack:cli sources:run
```

Attendu : le tableau des sources avec offres lues, retenues et inédites. Puis **Offres** : les offres collectées, la plus récente d'abord, avec leur source et leur lien ; le filtre par source. Le lendemain matin, un passage planifié s'ajoute de lui-même (journal sur chaque carte de l'écran Sources).

## 4. Une source coupée puis rallumée

1. Sur l'écran Sources, décoche **Activée** pour une source, puis **Tester les sources**.
2. Attendu : cette source « Sautée : interrupteur coupé », les autres testées normalement.
3. Recoche-la.

## 5. Une offre ajoutée à la main

1. **Offres > Ajouter une offre** : l'intitulé, le lien et le texte de l'annonce.
2. Attendu : l'offre en tête de liste, source « Ajout manuel ». Job4me enregistre le lien sans jamais l'ouvrir.

## 6. L'alerte « source muette »

Elle se déclenche d'elle-même quand une source réussie ne lit plus rien, ou bien moins que d'habitude : une notification sur le téléphone (une fois par incident) et un bandeau sur l'accueil et l'écran Sources. Rien à provoquer : vérifie seulement que les notifications de test arrivent (Paramètres > Sécurité, **Envoyer une notification de test**).

## 7. Supprimer un import

Dans **Profil > Importer un CV ou LinkedIn**, **Supprimer** puis **Supprimer définitivement** sur un ancien import : le fichier chiffré, son texte et ses propositions disparaissent, ce que tu as gardé reste au profil.

## 8. LinkedIn

Avant son connecteur, un sondage depuis ta connexion (décision D1) :

```bash
pnpm probe:linkedin
```

Renvoie à Claude le bloc affiché entre « À renvoyer à Claude » et « Fin ». Après un refus (429), plus aucun appel à LinkedIn pendant 24 heures.
