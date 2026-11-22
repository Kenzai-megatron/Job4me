# 0011 Row Level Security sur les données du profil

Statut : acceptée le 22/11/2026. Précise l'ADR 0006.

## Contexte

L'ADR 0006 annonçait la sécurité au niveau des lignes de PostgreSQL dès la phase 1, en deuxième barrière derrière le filtre `user_id` de chaque requête.

## Décision

- Chaque table du profil et des imports active RLS, avec une politique unique : la ligne est visible et modifiable seulement si son `user_id` vaut le paramètre de transaction `app.user_id`.
- L'API et le worker ouvrent une transaction par requête ou par tâche, y fixent `app.user_id` avec `set_config(..., true)` (portée de la transaction), puis lisent et écrivent ; sans ce paramètre, aucune ligne n'est visible.
- Le rôle d'extraction a sa propre politique, limitée aux tables d'import, car il traite les imports de tous les comptes.
- Les tables d'authentification restent hors RLS (ADR 0006).

## Conséquences

- Un filtre `user_id` oublié dans une requête ne laisse rien fuir : un test le vérifie avec deux comptes et une requête sans filtre.
- Le rôle propriétaire, qui passe les migrations, n'est pas soumis à RLS ; il ne sert jamais à l'exécution.
