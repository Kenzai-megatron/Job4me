# 0010 Fichiers importés et extraction isolée

Statut : acceptée le 22/11/2026.

## Contexte

Mehdi importe son CV (PDF ou DOCX) et son archive LinkedIn (ZIP). Ces fichiers passent par des bibliothèques de lecture complexes, cibles classiques de fichiers piégés ; la spécification exige « types autorisés seulement, taille maximale, vérification du type réel, extraction isolée sans réseau » (section 11).

## Décision

- Téléversement d'un seul fichier, 5 Mo au plus (configuration). Le type se lit dans la signature du fichier, jamais dans son nom : PDF, DOCX sans macro, ou archive ZIP LinkedIn.
- Le fichier est chiffré (AES-256-GCM, données associées liées à l'import) sous une clé d'import dédiée, distincte de la clé maîtresse, et rangé sous un nom aléatoire dans le volume `files`. Il n'est jamais servi tel quel.
- L'extraction tourne dans un conteneur `extract` (même image) : réseau interne seulement, donc PostgreSQL et rien d'autre ; lecture seule, aucune capacité, mémoire et processus limités ; rôle PostgreSQL `job4me_extractor` limité aux tables d'import ; seule la clé d'import, pas la clé maîtresse.
- Bornes avant toute lecture : nombre d'entrées, taille décompressée et taux de compression des archives ; nombre de pages et longueur du texte extrait. Dans une archive LinkedIn, seuls les fichiers CSV utiles sont ouverts ; connexions et messages ne le sont jamais.
- Le texte extrait est chiffré en base et purgé après la validation (délai dans la configuration).

## Conséquences

- Une faille d'un lecteur de documents ne donne ni Internet, ni les secrets TOTP, ni le reste de la base.
- Un secret de plus à générer (`import_key`, mot de passe du rôle d'extraction) : `pnpm setup:dev` et `setup:home` les ajoutent sans toucher aux secrets existants.

## Mise en œuvre (lot 3, 22/11/2026)

- **Paquet `@job4me/imports`** : détection du type réel et bornes des archives (utilisées par l'API au téléversement), lecteurs PDF, DOCX et LinkedIn dans `@job4me/imports/extract` (utilisés par l'extracteur seul). L'API ne charge jamais pdf.js ni mammoth.
- **Fichier stocké** : `var/files/imports/<32 octets aléatoires en base64url>`, chiffré sous `secrets/import_key`, données associées `upload:file:<id>`. Le dossier est un montage du disque de la machine, propriété de l'utilisateur des conteneurs, plutôt qu'un volume Docker (dont le propriétaire ne suivrait pas `JOB4ME_UID`). Il est exclu de Git et du contexte de construction de l'image.
- **Extracteur** : conteneur `extract`, `node worker/extractor.js`. Il interroge `import_run` toutes les 2 s (configuration), réclame un import avec `FOR UPDATE SKIP LOCKED`, reprend une extraction restée en plan au-delà de `staleAfterMs` et abandonne après `maxAttempts` essais. Il n'a pas accès à la file pg-boss : un extracteur compromis ne peut donc pas commander d'autres tâches.
- **Fil de lecture** : chaque fichier est lu dans un `worker_thread` avec un budget de mémoire et de durée (configuration), sans variable d'environnement ; sa sortie standard est jetée ; sa réponse est validée par les schémas Zod et les bornes avant d'être chiffrée (`import_run:extracted:<id>`).
- **Rôle `job4me_extractor`** : créé par la migration (sans connexion possible tant que son mot de passe n'est pas fourni), droits remis à zéro puis accordés colonne par colonne à chaque migration ; politiques RLS : lecture des deux tables, mise à jour d'un import en attente ou en extraction vers « extraction », « extrait » ou « échec » seulement.
- **pdf.js 6** n'a plus de chemin `eval` ; son module natif de dessin (`@napi-rs/canvas`), inutile pour lire du texte, n'est pas installé (`ignoredOptionalDependencies`).
- **Archive LinkedIn** : liste blanche de fichiers et de colonnes dans `packages/imports/src/linkedin-files.ts`, établie d'après le format d'export connu de LinkedIn ; à confronter à la vraie archive de Mehdi (lot 5).
