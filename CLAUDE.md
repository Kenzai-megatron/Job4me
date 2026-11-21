# Job4me

Application web responsive (PWA) de recherche d'emploi pour un seul utilisateur, Mehdi. Marché belge, français par défaut. Pas d'application native.
Spécification : `docs/SPEC.md`. Notes techniques sur les sources : `docs/SOURCES.md`. Les lire avant toute tâche.

## Règles non négociables

- Collecte respectueuse : cadence de particulier, pauses entre requêtes, arrêt net au premier 403 ou 429, jamais de contournement des protections anti-robots, un interrupteur par source.
- Chaque connecteur déclare son mode d'usage : LinkedIn « invité » et pages HTML sont réservés à l'usage personnel et se coupent en mode commercial.
- Avant d'écrire un connecteur : lire sa fiche dans `docs/SOURCES.md`, puis resonder la source par une vraie requête.
- L'IA n'invente rien : chaque ligne d'un CV ou d'une lettre provient d'un fait du profil.
- L'IA n'envoie rien : tout envoi passe par le moteur de règles, avec délai d'annulation et journal d'audit.
- Aucun secret dans le dépôt ni dans les journaux (masquer les clés dans les URL), aucune donnée réelle de tiers en développement.
- Chaque requête vérifie que la ressource appartient à l'utilisateur connecté : le code reste prêt pour plusieurs comptes.
- Quotas, seuils, plafonds et prix dans la configuration, jamais dans le code.
- En développement, les mails partent vers Mailpit, jamais vers une vraie boîte.

## Stack

pnpm + Turborepo, Next.js (web), Fastify + Zod (API), worker pg-boss, PostgreSQL + Drizzle,
fetch (undici) + cheerio pour la collecte, localités GeoNames, API Claude (Haiku 5.5, Sonnet 5.5),
API Gmail, Docker Compose + Mailpit en local.

## Méthode

- Une phase à la fois (`docs/SPEC.md`, section 14) : plan, validation de Mehdi, code, tests, revue de sécurité, démonstration.
- Décisions structurantes dans `docs/adr`.
- Plan de sécurité court (menaces, contrôles, tests) avant toute fonction mail, paiement, collecte ou agent IA.
- Une source qui rend 0 sans erreur est suspecte : journaliser offres lues, inédites et retenues par source dès le premier jour.
- Les valeurs marquées « Hypothèse » dans la spécification sont des choix par défaut : les appliquer, et les rappeler à Mehdi quand une décision en dépend.
- Signaler toute hypothèse qui pose problème au lieu de l'appliquer en silence.

## Conventions

- Échanges avec Mehdi en français.
- Code, identifiants et messages de commit en anglais.
- Textes de l'interface dans les fichiers de traduction, français par défaut.
