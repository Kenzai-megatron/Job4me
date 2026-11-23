# Job4me

Application web (PWA) de recherche d'emploi pour un seul utilisateur, sur le marché belge. Elle collecte les offres, les note sur 100 selon le profil, adapte CV et lettre à chaque offre et envoie les candidatures selon des règles fixées par l'utilisateur.

- Spécification : [`docs/SPEC.md`](docs/SPEC.md)
- Notes sur les sources d'offres : [`docs/SOURCES.md`](docs/SOURCES.md)
- Plans : [phase 0](docs/plans/phase-0.md), [phase 1](docs/plans/phase-1.md), [phase 2](docs/plans/phase-2.md), [phase 3](docs/plans/phase-3.md) (proposition)
- Décisions d'architecture : [`docs/adr`](docs/adr/README.md)
- Installation sur la machine de la maison : [`docs/guide/installation.md`](docs/guide/installation.md)
- Démonstrations : [phase 0](docs/guide/demonstration-phase-0.md), [phase 1](docs/guide/demonstration-phase-1.md), [phase 2](docs/guide/demonstration-phase-2.md)
- Sécurité : [modèle de menaces](docs/security/threat-model.md), revues des [phase 0](docs/security/review-phase-0.md), [phase 1](docs/security/review-phase-1.md) et [phase 2](docs/security/review-phase-2.md)
- Règles de travail : [`CLAUDE.md`](CLAUDE.md)

## Prérequis

- Node 26 LTS et pnpm 10 (version épinglée dans `package.json`)
- Docker avec Compose

## Développement

```bash
pnpm install
```

```bash
pnpm dev
```

`pnpm dev` écrit au besoin un `.env` et des secrets jetables dans `secrets/` (jamais commités), démarre PostgreSQL et Mailpit, applique les migrations, puis lance l'API, le worker et l'interface sur http://localhost:5173. Mailpit, qui capture tous les mails de développement, s'ouvre sur http://127.0.0.1:8025. Pour créer le compte de développement :

```bash
pnpm job4me user:create --email mehdi@example.org --name Mehdi
```

## Commandes

| Commande                 | Effet                                                                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`           | installe les dépendances et active le hook de commit                                                                                                                                               |
| `pnpm setup:dev`         | écrit `.env` et des secrets jetables dans `secrets/` (`--force` réécrit `.env`, garde les secrets) ; remplace les vraies sources de la collecte par la source de démonstration (aucun site appelé) |
| `pnpm dev`               | PostgreSQL, Mailpit, migrations, puis API, worker et interface en mode surveillance                                                                                                                |
| `pnpm job4me <commande>` | administration : `user:create`, `user:enroll-link`, `sessions:revoke-all`, `audit:tail`, `config:check`, `mail:test`, `sources:test`, `sources:run`                                                |
| `pnpm lint`              | ESLint sur tout le dépôt                                                                                                                                                                           |
| `pnpm typecheck`         | vérification des types TypeScript                                                                                                                                                                  |
| `pnpm test`              | tests unitaires                                                                                                                                                                                    |
| `pnpm test:integration`  | tests d'intégration sur un vrai PostgreSQL (après `pnpm dev`)                                                                                                                                      |
| `pnpm test:e2e`          | tests de bout en bout Playwright sur l'interface construite et l'API                                                                                                                               |
| `pnpm format`            | formatage Prettier                                                                                                                                                                                 |
| `pnpm check:compose`     | contrôle de Compose : ports sur `127.0.0.1`, conteneurs durcis, images épinglées                                                                                                                   |

## Pile en conteneurs (machine de la maison, CI)

| Commande                                                   | Effet                                                                                                |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm setup:home --origin https://job4me.<tailnet>.ts.net` | réglages et secrets de la machine de la maison                                                       |
| `pnpm stack:up`                                            | construit l'image, applique les migrations, démarre API et worker sur `127.0.0.1:3000`               |
| `pnpm stack:cli <commande>`                                | commandes d'administration dans le conteneur de l'API                                                |
| `pnpm stack:logs [service]`                                | journaux des conteneurs                                                                              |
| `pnpm stack:down`                                          | arrête la pile (les données restent dans le volume)                                                  |
| `pnpm test:e2e:stack`                                      | tests de bout en bout contre les conteneurs, en mode production (jamais sur la machine de la maison) |

Une seule image sert l'API, le worker, les migrations et la CLI (`infra/docker/Dockerfile`). La base n'est joignable que sur un réseau Docker interne ; l'API n'écoute que sur `127.0.0.1`, et Tailscale la sert en HTTPS à tes appareils.
