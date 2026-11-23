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

## Mise en œuvre (lot 6, 23/11/2026)

- **`pnpm stack:backup`** (`scripts/backup.ts`) : `pg_dump` au format personnalisé, lancé dans le conteneur `postgres` (son port n'est jamais publié), et l'archive de `var/files/`, chacun chiffré par `age -r` pour `JOB4ME_BACKUP_RECIPIENT` ; fichiers en `0600` dans un dossier `0700`. Le nombre de lignes de chaque table et le nombre de migrations sont relevés **dans l'instantané même du dump** (`pg_export_snapshot`, `--snapshot`), puis écrits dans un manifeste avec l'empreinte SHA-256 de chaque copie.
- **Rétention** : les `backups.keepDaily` copies les plus récentes, puis la plus récente de chaque semaine pour `backups.keepWeekly` semaines (configuration).
- **`pnpm stack:restore-test`** (`scripts/restore-test.ts`) : contrôle des empreintes avant tout déchiffrement, restauration dans une base jetable du même serveur (toujours supprimée ensuite), comparaison table par table avec le manifeste, nombre de migrations, puis lecture de l'archive des fichiers. La clé privée vient de `JOB4ME_BACKUP_IDENTITY_FILE`, un fichier temporaire que Mehdi efface ensuite.
- **CI** : après les tests de bout en bout sur les conteneurs, sauvegarde des données de test avec une clé jetable, puis test de restauration.
- **Chaque nuit** : minuterie systemd de l'utilisateur (`infra/systemd/`), décrite dans le guide d'installation, avec la procédure de restauration complète.
