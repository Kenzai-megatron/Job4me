# 0006 Isolation par utilisateur

Statut : acceptée le 20/11/2026.

## Contexte

Job4me sert Mehdi seul, mais le code doit rester prêt pour plusieurs comptes : chaque requête vérifie à qui appartient la ressource (spécification, section 2 ; `CLAUDE.md`).

## Décision

- Toute table propre à un utilisateur porte `user_id` (clé étrangère, suppression en cascade, index).
- Toute fonction d'accès aux données exige l'identifiant de l'utilisateur connecté ; aucune route ne lit, ne modifie ou ne supprime une ressource par son seul identifiant.
- Identifiants UUIDv7 générés par PostgreSQL 18 : ordonnés dans le temps, impossibles à deviner.
- Deux rôles PostgreSQL : `job4me_owner` possède le schéma et passe les migrations ; `job4me_app`, utilisé à l'exécution, n'a pas le droit de modifier le schéma métier et n'a que `INSERT` et `SELECT` sur `audit_log`.
- La file pg-boss vit dans son propre schéma `pgboss`, qui appartient à `job4me_app`, car pg-boss y crée ses tables de file.
- À partir de la phase 1, Row Level Security sur les tables métier, avec `app.user_id` fixé à chaque transaction, en deuxième barrière.

## Conséquences

- Des tests d'intégration vérifient avec deux comptes qu'aucun ne peut lire ou supprimer les ressources de l'autre.
- Les tables d'authentification restent hors RLS : elles servent avant de connaître l'utilisateur, et seul le module d'authentification y accède.
