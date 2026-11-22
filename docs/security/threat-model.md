# Modèle de menaces

Version de la phase 0 (22/11/2026). Il reprend la section 8 du plan de la phase 0, relie chaque menace à ses tests réels et sera complété avant chaque fonction de collecte, d'IA, de mail ou de paiement (`CLAUDE.md`).

## Actifs

- **Le compte** : sessions, passkeys, secret TOTP, codes de secours, haché du mot de passe de secours.
- **La clé maîtresse** (`secrets/master_key`) : elle chiffre les secrets TOTP et dérive les clés des codes de secours et des jetons CSRF.
- **Le journal d'audit**, en ajout seul.
- **Le code et sa chaîne de construction** : dépôt, CI, dépendances, image Docker.
- Plus tard, sur ces fondations : les données du profil et des CV, l'accès Gmail, les clés d'API.

## Frontières de confiance

| Zone | Confiance | Remarques |
| --- | --- | --- |
| Téléphone et PC de Mehdi | élevée | passkeys dans le trousseau, Tailscale connecté |
| Tailscale | élevée | seul chemin vers l'application, HTTPS de bout en bout jusqu'à la machine |
| Conteneurs `api` et `worker` | moyenne | entrées non fiables : tout ce qui arrive par HTTP, plus tard le contenu collecté |
| Conteneur `extract` | faible | lit les fichiers importés avec des bibliothèques complexes : ni Internet, ni clé maîtresse, rôle PostgreSQL limité à quelques colonnes des tables d'import, fichiers en lecture seule (ADR 0010) |
| PostgreSQL | élevée | réseau Docker interne, sans route vers l'extérieur ni port publié |
| Terminal de la machine | totale | racine de confiance : création du compte, liens d'enrôlement (ADR 0003) |
| GitHub (code, CI) | moyenne | aucun secret en CI pendant la phase 0 |
| Environnements de développement, dont Claude Code dans le cloud | faible | jamais de secret réel ni de donnée réelle de tiers |

## Menaces, contrôles et tests

Les tests cités tournent dans la CI : `unit`, `integration` (PostgreSQL 18), `e2e` (pile en conteneurs, mode production) et `security`.

| # | Menace | Contrôles | Tests automatisés |
| --- | --- | --- | --- |
| 1 | Mot de passe deviné ou réutilisé | passkey en priorité ; mot de passe jamais seul ; Argon2id (64 Mio, 3 passes) ; règles de robustesse ; verrouillage progressif par facteur ; limite de débit | `auth.int` : « never signs in with the password alone », « locks the password after repeated failures, but never the passkey », « answers the same way for an unknown e-mail and a wrong password » ; `security` : « applies the strength rules » |
| 2 | Hameçonnage relayé en temps réel | passkey liée à l'origine et au RP ID ; vérification de l'utilisateur exigée ; accès réservé aux appareils Tailscale | `auth.int` : « refuses an answer signed for another origin (phishing relay) » |
| 3 | Rejeu d'un code ou d'une signature | dernier pas TOTP mémorisé ; codes de secours à usage unique ; défis WebAuthn à usage unique ; compteur de signature | `auth.int` : « refuses the same code twice », « accepts a recovery code once », « refuses a replayed answer », « refuses a signature counter that goes backwards » ; `security` : « refuses a replayed code » ; `e2e` : code de secours refusé à la seconde utilisation |
| 4 | Vol ou fixation de session | cookies `__Host-`, `HttpOnly`, `Secure`, `SameSite=Strict` ; jeton de 256 bits haché en base ; nouvelle session à chaque connexion ; rotation à la ré-authentification ; expirations d'inactivité et absolue | `auth.int` : « opens a session with a strict cookie », « gives a new session token », « stores only the hash of the session token », « expires an idle session », « ends the session on logout » |
| 5 | CSRF | `SameSite=Strict` ; `Origin` obligatoire et dans la liste ; `Sec-Fetch-Site` ; jeton HMAC lié à la session | `app.int` : le groupe « CSRF (threat model row 5) » (sans `Origin`, autre origine, jeton absent ou étranger, requête intersite) |
| 6 | XSS | échappement React ; CSP stricte sans script en ligne ; `dangerouslySetInnerHTML` interdit par ESLint ; textes dans les fichiers de traduction | `app.int` : « sends a strict CSP without inline scripts » ; `e2e` : toute violation de CSP fait échouer le test |
| 7 | Accès aux données d'un autre compte | `user_id` dans chaque requête ; identifiants UUIDv7 ; RLS prévue dès la phase 1 | `auth.int` : « never lets one account act on the passkeys or sessions of another », « shows the signed-in user only their own audit events » |
| 8 | Fuite de secrets (dépôt, journaux) | `.env` et `secrets/` hors Git ; secrets en fichiers lus par `*_FILE` ; gitleaks en hook et en CI ; masquage pino ; jeton d'enrôlement dans le fragment de l'URL | `logger` : « redacts secrets and personal data », « masks the request URL and drops cookies » ; CI `secrets` : gitleaks sur tout l'historique |
| 9 | Copie de la base | jetons hachés ; TOTP chiffré (AES-256-GCM, données associées liées à la ligne) ; codes de secours en HMAC ; clé hors base ; disque chiffré (LUKS) | `auth.int` : « keeps the TOTP secret encrypted and recovery codes hashed » ; `security` : « refuses a ciphertext moved to another row » |
| 10 | Effacement de traces | `audit_log` en ajout seul : droits et déclencheur | `db` : « refuses updates and deletes from the runtime role », « refuses updates, deletes and truncation even from the owner » |
| 11 | Saturation | limites de débit sur les routes d'authentification et de compte qui vérifient un secret ; plafond de notifications de test ; taille de corps maximale | `app.int` : « answers 429 beyond the sign-in request budget », « refuses oversized bodies » ; `push.int` : « caps test notifications per minute » |
| 12 | Dépendance compromise | lockfile figé ; scripts d'installation bloqués sauf liste blanche ; versions publiées depuis au moins 7 jours ; sous-dépendances venues de git ou d'archives refusées ; niveau de confiance d'une version jamais en baisse ; Renovate ; image avec les seules dépendances de production | CI `security` : `pnpm audit`, SBOM CycloneDX ; analyse hebdomadaire osv-scanner (lockfile et image) |
| 13 | CI détournée | `permissions: contents: read` ; actions épinglées par SHA ; pas de `pull_request_target` ; aucun secret ; outils téléchargés vérifiés par empreinte | CI `security` : zizmor ; actionlint en local |
| 14 | Exposition réseau | API sur `127.0.0.1` seulement ; PostgreSQL sur un réseau interne sans port ; accès par Tailscale, jamais `funnel` | CI `security` : `pnpm check:compose` (ports, réseaux) |
| 15 | Fuite par les erreurs | gestionnaire d'erreurs générique ; codes traduits par l'interface ; identifiant de requête | `app.int` : « answers 500 with a code and a request id only », « answers 400 on invalid input without echoing it » |
| 16 | Requête vers un hôte arbitraire (SSRF) par un abonnement push | liste des services push des navigateurs, HTTPS sans port ni identifiants ; aucun autre appel sortant, imposé par une règle Semgrep | `push.int` : « refuses internal or foreign addresses », « refuses a forged endpoint » ; Semgrep `job4me-no-direct-http` |
| 17 | Mail réel parti du développement | hors production, seul Mailpit est accepté au démarrage ; `mail:test` refusé en production | `config` : « refuses a real mail server outside production » ; `mail` : « refuses to run in production » ; Semgrep `job4me-mail-host-from-config` |
| 18 | Conteneur compromis | utilisateur non root ; système de fichiers en lecture seule ; aucune capacité ; `no-new-privileges` ; image sans npm ni outils de construction | `pnpm check:compose` ; `e2e` sur ces conteneurs |
| 19 | Outil de sécurité compromis | versions épinglées ; binaires téléchargés vérifiés par empreinte ; Trivy écarté après sa compromission de mars 2026 (CVE-2026-33634) | revue manuelle à chaque mise à jour proposée par Renovate |
| 20 | Fichier importé piégé (faux type, macros, bombe ZIP, PDF malveillant) | type lu dans le contenu, jamais dans le nom ; 5 Mo au plus ; documents à macros refusés ; bornes sur l'annuaire de l'archive avant toute décompression, tailles réelles vérifiées ; pages et texte bornés ; lecture dans un fil à mémoire et durée limitées, dans le conteneur `extract` ; réponse du fil validée comme une entrée | `imports` : « refuses a ZIP bomb from its central directory », « refuses an entry that inflates beyond the size its headers declare », « refuses documents with macros » ; `imports.int` : « refuses trapped or unexpected files » ; `extractor.int` : « stops a thread that runs too long », « checks the answer of the thread like untrusted input » |
| 21 | Faille d'un lecteur de documents | conteneur `extract` sans Internet ni clé maîtresse ; rôle `job4me_extractor` : quelques colonnes de `upload` et `import_run`, statuts d'extraction seulement (RLS) ; aucun environnement transmis au fil de lecture ; module natif de dessin de pdf.js non installé | `extractor.int` : « reads and writes the few columns it needs, and nothing else » ; `db` : « has no rights of its own and only a few columns of the import tables » ; `pnpm check:compose` (réseau, secrets, montages, limites) |
| 22 | Lecture des fichiers importés ou du texte extrait | fichier chiffré sous la clé d'import (distincte de la clé maîtresse), lié à sa ligne, sous un nom aléatoire, jamais servi ; texte extrait chiffré et lié à son import ; journaux sans contenu ; `var/` hors Git et hors de l'image | `imports.int` : « detects the real type, encrypts the file under a random name », « never serves the stored file » ; `extractor.int` : « stores the text encrypted, with figures only in clear » |
| 23 | Données de tiers de l'archive LinkedIn | liste blanche de fichiers et de colonnes : connexions, messages et coordonnées de contact jamais lus | `imports` : « reads the allow-listed files and columns only » ; `extractor.int` : aucune personne tierce dans le texte extrait |

## Risques acceptés pour la phase 0

- **Existence du compte révélée par le verrouillage** : après 5 échecs, une adresse connue répond « verrouillé » (429), une inconnue « identifiants invalides ». Le service n'est joignable que depuis les appareils Tailscale de Mehdi.
- **Limites de débit par adresse IP** : derrière `tailscale serve`, toutes les requêtes arrivent de la même adresse et partagent le même compteur. Avec un seul utilisateur, c'est sans effet.
- **Pas de filtre sur l'en-tête `Host`** : une attaque par rebinding DNS vers `127.0.0.1:3000` depuis un navigateur de la machine n'obtient aucun cookie, et le contrôle d'`Origin` bloque toute écriture. À réexaminer si l'application écoute un jour ailleurs que sur `127.0.0.1`.
- **Abonnement push déplaçable** : un point de terminaison push passe au dernier compte qui l'enregistre. Il faut le connaître, et c'est un secret détenu par le navigateur.
- **Avis modéré sur esbuild ≤ 0.24.2**, arrivé par `drizzle-kit` en développement seulement : il concerne le serveur de développement d'esbuild, que le projet n'utilise pas.

## À compléter avant la phase 1 (collecte)

- **Contenu collecté non fiable** : texte des offres affiché comme texte, jamais comme HTML ; liens filtrés (`https:` seulement) ; aucune image distante sans proxy.
- **Client de collecte unique** : cadence de particulier, pauses, arrêt net au premier 403 ou 429, interrupteur par source, aucune redirection hors de la liste des hôtes de la source. La règle Semgrep `job4me-no-direct-http` impose ce passage obligé.
- **Données personnelles des offres** (noms et adresses de recruteurs) : durées de conservation dans la configuration.
- **RLS PostgreSQL** sur les tables métier, en plus du filtre `user_id`.
