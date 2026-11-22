# 0012 Sauvegardes chiffrées

Statut : acceptée le 22/11/2026.

## Contexte

Avec la phase 1, la machine de la maison garde de vraies données personnelles. La spécification exige des « sauvegardes chiffrées avec test de restauration » (section 11).

## Décision

- `pnpm stack:backup` copie la base (`pg_dump`) et le volume `files`, chiffrés avec `age` pour une clé publique ; la machine ne garde que la clé publique, la clé privée vit dans le gestionnaire de mots de passe de Mehdi.
- Les copies vont dans un dossier local configurable ; Mehdi les recopie où il veut (disque USB, NAS, dossier synchronisé). Rétention dans la configuration.
- `pnpm stack:restore-test` restaure la dernière copie dans une base jetable et vérifie les migrations et le nombre de lignes ; la CI exécute la sauvegarde puis ce test sur des données fictives.

## Conséquences

- Une copie volée reste illisible sans la clé privée ; une clé privée perdue rend les copies inutilisables : elle se range comme la clé maîtresse.
- `age` s'installe sur la machine (paquet Debian et Ubuntu).
