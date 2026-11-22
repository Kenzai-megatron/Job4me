# 0001 Monorepo et outillage

Statut : acceptée le 20/11/2026.

## Contexte

Job4me réunit une interface, une API, un worker et des paquets partagés (schémas, base, sécurité). La spécification impose pnpm et Turborepo. Les versions de novembre 2026 : Node 26 LTS, TypeScript 7.0 (compilateur natif) et 6.0, typescript-eslint qui ne prend pas encore en charge la 7.0.

## Décision

- Un seul dépôt pnpm + Turborepo : `apps/web`, `apps/api`, `apps/worker`, et `packages/*` (contracts, db, config, security, logger, ui, i18n, tooling).
- Node 26 LTS (`.node-version`), TypeScript 6.0 en mode strict, ESM partout, imports sans extension (résolution `Bundler`).
- Les paquets internes exposent leurs sources TypeScript ; l'API et le worker sont regroupés en un seul fichier JavaScript pour la production, l'interface est construite par Vite.
- pnpm 10 épinglé dans `packageManager` ; scripts d'installation des dépendances bloqués sauf liste blanche ; délai de 7 jours avant d'adopter une version fraîchement publiée (3 jours à l'origine, porté à 7 le 22/11/2026) ; sous-dépendances venues de git ou d'archives refusées ; version publiée avec un niveau de confiance inférieur aux précédentes refusée.
- Outils : ESLint, Prettier, Vitest, Playwright.

## Conséquences

- Les types et schémas Zod circulent entre l'interface et l'API sans duplication.
- Passer à TypeScript 7 attendra la prise en charge par typescript-eslint ; Renovate le proposera.
- Une dépendance fraîchement publiée n'est installée qu'après 7 jours, ce qui écarte la plupart des paquets piégés retirés rapidement du registre.
