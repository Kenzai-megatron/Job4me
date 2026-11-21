# Job4me

Application web (PWA) de recherche d'emploi pour un seul utilisateur, sur le marché belge. Elle collecte les offres, les note sur 100 selon le profil, adapte CV et lettre à chaque offre et envoie les candidatures selon des règles fixées par l'utilisateur.

- Spécification : [`docs/SPEC.md`](docs/SPEC.md)
- Notes sur les sources d'offres : [`docs/SOURCES.md`](docs/SOURCES.md)
- Plan de la phase en cours : [`docs/plans/phase-0.md`](docs/plans/phase-0.md)
- Décisions d'architecture : [`docs/adr`](docs/adr/README.md)
- Règles de travail : [`CLAUDE.md`](CLAUDE.md)

## Prérequis

- Node 26 LTS et pnpm 10 (version épinglée dans `package.json`)
- Docker avec Compose

## Commandes

| Commande         | Effet                                                |
| ---------------- | ---------------------------------------------------- |
| `pnpm install`   | installe les dépendances et active le hook de commit |
| `pnpm lint`      | ESLint sur tout le dépôt                             |
| `pnpm typecheck` | vérification des types TypeScript                    |
| `pnpm test`      | tests unitaires                                      |
| `pnpm format`    | formatage Prettier                                   |

Les commandes de démarrage (`pnpm dev`, `pnpm stack:up`, `pnpm job4me …`) arrivent avec les lots suivants de la phase 0.
