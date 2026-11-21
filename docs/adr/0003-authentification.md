# 0003 Authentification : passkeys, secours, sessions, ré-authentification

Statut : acceptée le 20/11/2026.

## Contexte

Un seul compte, aucune inscription publique (spécification, sections 2, 10 et 11). Les actifs à protéger : CV, accès Gmail, clés d'API. Cible : OWASP ASVS 5.0 niveau 2.

## Décision

- **Création** : en ligne de commande sur la machine (`pnpm job4me user:create`), qui affiche un lien d'enrôlement à usage unique de 15 minutes. Le jeton voyage dans le fragment de l'URL (`#t=…`), jamais envoyé au serveur dans une requête de page ni dans un en-tête Referer.
- **Passkeys** (SimpleWebAuthn) : découvrables, vérification de l'utilisateur exigée, attestation `none`, origine et RP ID tirés de la configuration.
- **Secours** : mot de passe Argon2id (64 Mio, 3 passes, 4 voies) toujours suivi d'un code TOTP (RFC 6238, anti-rejeu) ou d'un code de secours à usage unique. Désactivable dès deux passkeys.
- **Sessions** côté serveur : jeton de 256 bits dans le cookie `__Host-j4m_session` (`HttpOnly`, `Secure`, `SameSite=Strict`), seul son haché SHA-256 en base ; 12 heures d'inactivité, 7 jours au plus ; nouveau jeton à chaque connexion et ré-authentification.
- **Avant connexion**, un cookie `__Host-j4m_pre` lie les défis WebAuthn et l'étape « mot de passe accepté » au navigateur qui les a demandés.
- **CSRF** : `SameSite=Strict`, contrôle de l'en-tête `Origin` et jeton dérivé (HMAC) de la session ou du cookie d'avant connexion, exigé dans l'en-tête `x-csrf-token`.
- **Ré-authentification** de moins de 5 minutes pour les actions sensibles.
- **Verrouillage progressif par facteur** : 5 échecs, puis une minute d'attente doublée jusqu'à une heure ; la passkey n'est jamais bloquée par les échecs du mot de passe.
- Briques éprouvées plutôt qu'un cadriciel complet (Better Auth, Auth.js) : nos parcours sont atypiques et doivent rester lisibles.

## Conséquences

- Le terminal de la machine est la racine de confiance : `pnpm job4me user:enroll-link` dépanne si tous les moyens de connexion sont perdus.
- Les passkeys créées sur `localhost` ne servent pas sur l'adresse Tailscale : il faut les enregistrer à nouveau sur l'adresse définitive.
- Avec `SameSite=Strict`, la première page ouverte depuis un lien externe arrive sans cookie ; l'interface recharge alors son état par l'API.
