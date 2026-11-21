# 0005 Configuration hors du code

Statut : acceptée le 20/11/2026.

## Contexte

`CLAUDE.md` : quotas, seuils, plafonds et prix dans la configuration, jamais dans le code. Les secrets ne vont ni dans le dépôt ni dans les journaux.

## Décision

- `config/default.yaml`, versionné, porte toutes les valeurs métier et de sécurité (durées de session, verrouillage, Argon2, limites de débit…).
- `config/local.yaml`, hors Git, surcharge ce qu'il faut sur une machine donnée (adresse publique, RP ID, sujet VAPID).
- Les secrets viennent de l'environnement ou de fichiers (`*_FILE`), jamais des fichiers YAML.
- Un schéma Zod valide l'ensemble au démarrage, avec des bornes : l'application refuse de démarrer si une valeur manque ou sort de ses bornes.
- En développement et en test, toute configuration SMTP autre que Mailpit est refusée.

## Conséquences

- `pnpm job4me config:check` vérifie la configuration sans démarrer l'application.
- Le schéma contient les bornes, jamais les valeurs.
