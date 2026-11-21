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

| Commande                | Effet                                                                           |
| ----------------------- | ------------------------------------------------------------------------------- |
| `pnpm install`          | installe les dépendances et active le hook de commit                            |
| `pnpm setup:dev`        | écrit un `.env` local avec des secrets jetables (jamais commité)                |
| `pnpm dev`              | démarre PostgreSQL et Mailpit, applique les migrations, lance l'application     |
| `pnpm lint`             | ESLint sur tout le dépôt                                                        |
| `pnpm typecheck`        | vérification des types TypeScript                                               |
| `pnpm test`             | tests unitaires                                                                 |
| `pnpm test:integration` | tests d'intégration sur un vrai PostgreSQL (lancer `pnpm dev` ou Compose avant) |
| `pnpm format`           | formatage Prettier                                                              |

Mailpit, qui capture tous les mails de développement, s'ouvre sur http://127.0.0.1:8025.
