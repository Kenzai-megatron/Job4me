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
