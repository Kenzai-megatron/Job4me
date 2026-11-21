# 0002 Une seule origine : Fastify sert l'interface Vite + React

Statut : acceptée le 20/11/2026 (décision D2 du plan de la phase 0). Remplace le choix de Next.js de la spécification, section 10.

## Contexte

La spécification veut un navigateur qui n'appelle que l'API, et une API qui porte toute la logique. Next.js aurait ajouté un serveur d'affichage à sécuriser et à faire tourner, une CSP à nonce qui force le rendu dynamique de chaque page, et un mode hors ligne plus délicat.

## Décision

- L'interface est une application Vite + React (Tailwind CSS 4, composants dans l'esprit shadcn/ui, TanStack Router et Query, i18next).
- Fastify sert les fichiers construits et les routes `/api/*` sur la même origine. En développement, le serveur Vite relaie `/api` vers Fastify.
- CSP statique : `script-src 'self'` sans aucun script en ligne, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`.

## Conséquences

- Pas de CORS ; les cookies restent `SameSite=Strict`.
- L'interface ne contient aucun secret et n'accède jamais à la base.
- Un processus de moins à faire tourner sur la machine du domicile.
- Pas de rendu côté serveur : inutile pour un compte unique derrière une connexion.
