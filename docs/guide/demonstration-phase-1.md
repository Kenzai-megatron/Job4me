# Démonstration de la phase 1

Sur la machine de la maison, une quarantaine de minutes. Le [guide d'installation](installation.md) reste la référence pour chaque commande ; ce guide suit les critères de fin de la phase (spécification, section 14) : « un vrai CV est importé et validé champ par champ, et les mots-clés sont validés par Mehdi ».

## 0. Mettre à jour

```bash
cd ~/job4me && git pull && pnpm install && pnpm setup:home && pnpm stack:up
```

`pnpm setup:home` ajoute les nouveaux secrets (`import_key`, `db_extractor_password`, `anthropic_api_key` vide) et réglages sans toucher aux anciens. **Recopie `secrets/import_key` dans ton gestionnaire de mots de passe**, comme `master_key`.

Vérifie que les cinq services tournent, dont le nouveau conteneur d'extraction :

```bash
docker compose --env-file .env -f infra/compose.yaml --profile app ps
```

Attendu : `postgres`, `api`, `worker`, `extract` en marche, `migrate` terminé.

## 1. Le profil à la main

1. Ouvre `https://job4me.<ton-tailnet>.ts.net`, connecte-toi, puis **Profil**.
2. Remplis **Identité et contact**, les **Critères pratiques** (ville de base, contrats, régime) et tes **Motivations**.
3. Ajoute un à trois **Métiers cibles**.

Attendu : la complétude monte à chaque rubrique ; les liens « À compléter » mènent à la bonne carte.

## 2. Activer l'IA (facultatif, quelques centimes)

Suis « Activer l'IA » dans le guide d'installation : clé d'API dans `secrets/anthropic_api_key`, **plafond mensuel réglé dans la console d'Anthropic**, puis `pnpm stack:up`. Sans clé, la suite marche aussi : seules les coordonnées du CV sont proposées et les mots-clés se saisissent à la main.

## 3. Importer le vrai CV

1. Dans **Importer un CV ou LinkedIn**, choisis ton CV (PDF ou DOCX), puis **Importer**.
2. Attendu en quelques secondes : « En attente de lecture », « Lecture en cours », « Analyse en cours », puis **À relire** avec le nombre de propositions.
3. Ouvre **Relire les propositions**. Pour chaque proposition, lis l'extrait du CV affiché, puis **Garder**, **Corriger** ou **Écarter**. Une langue sans niveau demande de choisir le niveau.
4. À la fin : « Tout est relu », et l'import passe à **Ajouté au profil**.

À vérifier : aucune proposition ne contient ce que ton CV ne dit pas (l'IA ne doit rien inventer) ; tes coordonnées sont proposées à la rubrique Identité sans être passées par l'IA (Paramètres > IA ne montre qu'un appel, la structuration).

## 4. Importer l'archive LinkedIn

1. Sur LinkedIn : **Préférences > Confidentialité des données > Obtenir une copie de vos données**, archive complète ; elle arrive par e-mail après quelques minutes à quelques heures (parfois un jour).
2. Importe le fichier ZIP tel quel, puis relis les propositions (postes, formations, compétences, langues, certifications, offres sauvegardées, candidatures).

À signaler : un fichier ou une colonne que Job4me ne lit pas, ou mal (la correspondance suit le format connu de l'export ; c'est la première vraie archive). Tes connexions et tes messages ne sont jamais ouverts.

## 5. Les mots-clés

1. Dans **Mots-clés de recherche**, **Proposer avec l'IA**.
2. Attendu : « Claude propose des mots-clés… », puis 25 à 35 mots-clés en français, néerlandais et anglais, au statut « Proposé », dont une dizaine prioritaires.
3. Garde, modifie ou écarte chacun ; ajoute ceux qui manquent à la main.

Critère de fin : les mots-clés gardés sont ceux que tu valides.

## 6. Paramètres > IA

Attendu : la dépense des 7 derniers jours et le total, sous les plafonds (2 $ et 10 $), et la liste des appels (structuration du CV, mots-clés) avec jetons et coût, **sans aucun contenu**.

## 7. Complétude à 100 %

Complète ce qui manque (expériences, réalisations, compétences, langues, formation) jusqu'à « Toutes les rubriques utiles sont remplies ».

## 8. Sauvegarde et restauration

Suis la section 8 du guide d'installation : paire de clés `age`, clé publique dans `.env`, première sauvegarde, minuterie de chaque nuit, puis le test de restauration :

```bash
JOB4ME_BACKUP_IDENTITY_FILE=/dev/shm/job4me-backup-key.txt pnpm stack:restore-test && shred -u /dev/shm/job4me-backup-key.txt
```

Attendu : « Restore test … passed » avec le nombre de tables, de lignes et de fichiers. Recopie ensuite `var/backups/` hors de la machine.

## 9. Ce qui reste de la phase 0

Si ce n'est pas déjà fait : chiffrement du disque (LUKS), passkey Face ID sur l'iPhone, installation sur l'écran d'accueil et notification de test (Paramètres > Sécurité).

## Ce que j'attends de toi ensuite

- Les écarts constatés (étapes 3 et 4 surtout), avec une capture si possible, **sans y montrer de données personnelles de tiers**.
- Ta validation du [plan de la phase 2](../plans/phase-2.md) et tes réponses à ses décisions.
