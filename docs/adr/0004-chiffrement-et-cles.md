# 0004 Chiffrement applicatif et gestion des clés

Statut : acceptée le 20/11/2026.

## Contexte

Le secret TOTP, puis les jetons Gmail (phase 5) et les fichiers (phase 1), ne doivent pas être lisibles dans une copie de la base. La spécification demande AES-256-GCM et une clé hors de la base.

## Décision

- Une clé maîtresse de 32 octets aléatoires, fournie par un fichier ou une variable hors du dépôt (`JOB4ME_MASTER_KEY` ou `JOB4ME_MASTER_KEY_FILE`).
- Une clé dérivée par usage avec HKDF-SHA-256 (`totp`, `recovery`, `csrf`, puis `mail-token`, `files`) : une fuite d'un usage n'expose pas les autres.
- Chiffrement AES-256-GCM, nonce aléatoire de 96 bits, données associées `table:colonne:id` : un chiffré recopié sur une autre ligne ne se déchiffre pas.
- Format stocké : version (1 octet), nonce (12 octets), chiffré, étiquette (16 octets) ; colonne `key_version` pour la rotation.
- Codes de secours stockés en HMAC-SHA-256 avec la clé dérivée `recovery` ; jetons de session et d'enrôlement en SHA-256.

## Conséquences

- Perdre la clé maîtresse rend illisibles le TOTP et les jetons chiffrés : sa copie de secours va dans le gestionnaire de mots de passe de Mehdi (décision D5).
- La rotation consistera à ajouter une version de clé, rechiffrer, puis retirer l'ancienne.
