# Revue de sécurité de la phase 0

Revue du 22/11/2026, par Claude, sur les lots 1 à 7 (branche `phase-0/lot-7-closure`). Référence : [modèle de menaces](threat-model.md).

## Méthode

- **Lecture du code** : authentification (enrôlement, passkeys, mot de passe + TOTP, codes de secours, ré-authentification, verrouillage), sessions et cookies, CSRF, notifications push, service worker, en-têtes, service des fichiers statiques, erreurs, CLI, migrations et droits PostgreSQL, Dockerfile, Compose, workflows.
- **Contrôles automatiques** passés en local : 59 tests d'intégration sur PostgreSQL 18, tests unitaires, 6 tests de bout en bout sur l'API puis sur la pile en conteneurs en mode production, règles Semgrep du projet, `pnpm audit`, actionlint, zizmor, `pnpm check:compose`.
- **Vérification de la pile en conteneurs** : utilisateur, système de fichiers en lecture seule, capacités, réseaux, ports publiés, montage des secrets, en-têtes servis.

Les jeux de règles Semgrep du registre (TypeScript, Node.js, OWASP) n'ont pas pu tourner dans l'environnement de Claude, où `semgrep.dev` est bloqué ; ils ont tourné à la première exécution de la CI sur GitHub (constat 12).

## Constats

| # | Constat | Gravité | Statut |
| --- | --- | --- | --- |
| 1 | pg-boss crée son schéma avec `CREATE SCHEMA IF NOT EXISTS`, que PostgreSQL contrôle même quand le schéma existe : l'API et le worker refusaient de démarrer en conteneur, et les tests n'utilisaient pas la vraie file. | élevée (disponibilité) | corrigé au lot 6 : réglages partagés `createSchema: false`, schéma créé par la migration pour le rôle applicatif, test d'intégration de la vraie file avec ce rôle |
| 2 | En production, les origines de développement (`http://localhost:3000`) restaient acceptées pour CSRF et WebAuthn. | faible | corrigé au lot 6 : une seule origine en production, test ajouté |
| 3 | L'image embarquait les dépendances de tout l'espace de travail (TypeScript, React, outils de test) ainsi que npm. | moyenne (surface d'attaque) | corrigé au lot 6 : dépendances de production de l'API et du worker seulement, aux versions du lockfile ; npm et corepack retirés |
| 4 | Les routes de compte qui vérifient un secret ou hachent un mot de passe (ré-authentification, confirmation TOTP, changement de mot de passe) n'avaient pas de limite de débit, alors qu'Argon2id coûte 64 Mio par calcul. | moyenne (saturation) | corrigé au lot 7 : même budget que la connexion |
| 5 | La notification de test n'était pas plafonnée. | faible | corrigé au lot 7 : plafond dans la configuration (`push.testRequestsPerMinute`), test ajouté |
| 6 | Le test « au-delà de la limite : 429 » et le contrôle des ports publiés, prévus au plan, manquaient. | faible (couverture) | corrigé au lot 7 : test d'intégration et `pnpm check:compose` en CI |
| 7 | Trivy, prévu au plan pour l'analyse des images, a été compromis en mars 2026 (CVE-2026-33634 : binaire v0.69.4 malveillant, tags de l'action réécrits). | moyenne (chaîne d'approvisionnement) | remplacé par osv-scanner, épinglé par empreinte |
| 8 | Une adresse connue et verrouillée répond 429, une adresse inconnue 401 : l'existence du compte se devine après 5 échecs. | faible | accepté (un seul utilisateur, accès Tailscale) |
| 9 | Limites de débit par adresse IP : derrière `tailscale serve`, un seul compteur pour tous les appareils. | faible | accepté |
| 10 | Aucun filtre sur l'en-tête `Host` (rebinding DNS vers `127.0.0.1:3000`). | faible | accepté : sans cookie, rien de lisible ; écritures bloquées par le contrôle d'`Origin` |
| 11 | Avis modéré esbuild ≤ 0.24.2, par `drizzle-kit`, en développement seulement. | faible | accepté : le serveur de développement d'esbuild n'est pas utilisé |
| 12 | Premier passage de la CI : les règles Semgrep du registre relèvent 6 réglages de gestionnaires de paquets trop permissifs (3 jours au lieu de 7 pour pnpm et Renovate, aucun délai pour npm, sous-dépendances venues de git ou d'archives acceptées, pas de politique de confiance pnpm). | moyenne (chaîne d'approvisionnement) | corrigé au lot 7 : 7 jours partout, `blockExoticSubdeps`, `trustPolicy: no-downgrade` ; installations en ligne et hors ligne vérifiées |

## Points vérifiés sans constat

- Passkeys : vérification de l'utilisateur exigée, clés résidentes, RP ID et origines attendues, défis à usage unique liés au navigateur, compteur de signature contrôlé.
- Secours : le mot de passe seul n'ouvre jamais de session ; second facteur dans les 5 minutes, verrouillage par facteur ; le jeton d'enrôlement est consommé dans la même transaction que l'ajout de la passkey.
- Sessions : nouvelle session à chaque connexion, rotation du jeton à la ré-authentification, haché SHA-256 en base, expirations d'inactivité et absolue, compte désactivé refusé.
- Chaque requête de compte filtre par `user_id` (passkeys, sessions, abonnements push, journal d'audit).
- Service worker : aucune réponse de l'API en cache ; seuls les fichiers à empreinte sont gardés ; un clic sur une notification n'ouvre qu'une page de même origine.
- En-têtes : CSP stricte (`default-src 'self'`, ni script en ligne ni origine tierce, `frame-ancestors 'none'`), HSTS en production, `Referrer-Policy: no-referrer`, `Permissions-Policy` restrictive, `Cache-Control: no-store` sur l'API.
- Fichiers statiques : routes construites au démarrage, fichiers cachés refusés, aucun chemin résolu à la requête.
- Conteneurs : utilisateur non root (propriétaire de `secrets/`), lecture seule, aucune capacité, `no-new-privileges`, PostgreSQL sans port et sur un réseau interne, API sur `127.0.0.1`, secrets montés en fichiers `0600`.
- CI : permissions en lecture seule, actions épinglées par SHA, aucun secret, outils vérifiés par empreinte ; zizmor sans constat.
- Données : uniquement des adresses `example.org` et des secrets jetables en développement ; les secrets de la machine de la maison sont générés sur la machine et ne passent jamais par l'environnement de Claude.

## Reste à vérifier

1. **Première exécution de la CI sur GitHub** : faite le 22/11/2026 ; les alertes des règles Semgrep du registre sont corrigées (constat 12).
2. **Sur la machine de la maison et l'iPhone** (critère 5 du plan) : HTTPS par `tailscale serve`, passkey Face ID, installation sur l'écran d'accueil, notification reçue par le service push d'Apple.
3. **Chiffrement du disque (LUKS)** de la machine, prérequis de la décision D4.
