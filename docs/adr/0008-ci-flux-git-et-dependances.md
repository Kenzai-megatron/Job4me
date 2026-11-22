# 0008 Chaîne CI, flux Git et sécurité des dépendances

Statut : acceptée le 20/11/2026 (décisions D1 et D6), modifiée le 21/11/2026 : Claude fusionne lui-même les pull requests pendant la phase 0.

## Contexte

Dépôt GitHub privé sur un compte gratuit : ni protection de branche, ni CodeQL, ni blocage des secrets à l'envoi. La spécification demande détection de secrets, audit des dépendances, analyse statique et inventaire des composants.

## Décision

- **Flux Git** : un lot = une branche et une pull request. Pendant la phase 0, Claude fusionne lui-même chaque pull request quand la CI est verte (choix de Mehdi du 21/11/2026, à revoir plus tard).
- **CI GitHub Actions** : `secrets` (gitleaks), `lint` (Prettier, ESLint, types), `unit`, `integration` (PostgreSQL 18), `e2e` (Playwright avec authentificateur WebAuthn virtuel), `security` (Semgrep, audit des dépendances, zizmor, SBOM CycloneDX).
- **Durcissement des workflows** : `permissions: contents: read`, actions épinglées par SHA, pas de `pull_request_target`, aucun secret nécessaire en phase 0.
- **Dépendances** : lockfile figé, scripts d'installation bloqués sauf liste blanche, délai de 7 jours avant d'adopter une version, Renovate chaque semaine, analyse hebdomadaire de l'image et des dépendances avec osv-scanner (modifié le 22/11/2026 : 7 jours au lieu de 3 ; Trivy écarté après sa compromission de mars 2026).
- **Localement** : un hook pre-commit lance gitleaks (s'il est installé) et Prettier sur les fichiers indexés.

## Conséquences

- Semgrep et gitleaks remplacent CodeQL et la protection des pushes de GitHub.
- Sans protection de branche, la discipline repose sur la CI et sur la règle « une pull request par lot ».
