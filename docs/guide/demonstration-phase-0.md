# Démonstration de la phase 0

Ce guide déroule les sept critères de fin de la phase 0 ([plan, section 2](../plans/phase-0.md)). Compte une heure : vingt minutes sur ton PC, le reste sur la machine de la maison et l'iPhone. Coche chaque ligne ; une ligne qui échoue, note ce que tu as vu et je corrige.

## A. Sur ton PC, en développement (critères 1 à 4)

Prérequis : Docker, Node 26 et pnpm 10, et un navigateur qui sait créer une passkey (Chrome, Edge, Safari ou Firefox récents ; sur Windows, Windows Hello).

1. **Clone neuf et démarrage**

```bash
git clone <adresse du dépôt> job4me-demo && cd job4me-demo
```

```bash
pnpm install
```

```bash
pnpm dev
```

   Attendu : PostgreSQL et Mailpit démarrent, les migrations passent, puis l'API, le worker et l'interface se lancent. http://localhost:5173 affiche la page de connexion de Job4me.

2. **Création du compte**, dans un second terminal :

```bash
pnpm job4me user:create --email mehdi@example.org --name Mehdi
```

   Attendu : deux demandes du mot de passe de secours, puis un lien `http://localhost:5173/enroll#…` valable 15 minutes.

3. **Enrôlement** : ouvre le lien. Crée la passkey, scanne le QR code avec ton application de codes et saisis le code, puis recopie les 10 codes de secours (ici, de simples codes de test).
   Attendu : l'accueil « Bonjour Mehdi » et la navigation (Accueil, Offres, Candidatures, Documents, Profil).

4. **Connexion par passkey** : « Se déconnecter », puis « Se connecter avec une passkey ».
   Attendu : retour à l'accueil sans saisir de mot de passe.

5. **Secours mot de passe + code** : déconnecte-toi, choisis « Utiliser le mot de passe de secours », saisis l'adresse et le mot de passe, puis un code à 6 chiffres de ton application.
   Attendu : connexion. Recommence avec un **code de secours** : il marche une fois ; à la tentative suivante, le même code est refusé.

6. **Journal d'audit** : **Paramètres > Sécurité**.
   Attendu : chaque événement y figure (compte créé, passkey enregistrée, connexions réussies et échouées, code de secours utilisé).

7. **Pile en conteneurs**, comme sur la machine de la maison : arrête `pnpm dev` (Ctrl+C), puis :

```bash
pnpm stack:up
```

   Attendu : la commande rend la main quand tout est en bonne santé ; http://localhost:3000 (pas `127.0.0.1` : les passkeys sont liées au nom `localhost`) sert la même application, cette fois depuis l'image Docker, avec la même base.

```bash
pnpm stack:down
```

8. **Mails de développement** :

```bash
pnpm job4me mail:test --to mehdi@example.org
```

   Attendu : le message apparaît dans Mailpit, http://127.0.0.1:8025, et nulle part ailleurs.

## B. Sur la machine de la maison et l'iPhone (critère 5)

Suis le [guide d'installation](installation.md) jusqu'au bout, puis vérifie :

1. Safari, Tailscale connecté, ouvre `https://job4me.<ton-tailnet>.ts.net` : cadenas valide, page de connexion.
2. Enrôlement avec Face ID, code à 6 chiffres, codes de secours rangés dans ton gestionnaire de mots de passe.
3. Partager, puis **Sur l'écran d'accueil** : l'icône Job4me s'ajoute ; ouverte, l'application s'affiche sans la barre de Safari.
4. Déconnexion, puis connexion par Face ID.
5. **Paramètres > Sécurité > Notifications** : « Activer les notifications », puis « Envoyer une notification de test ».
   Attendu : la notification arrive en quelques secondes, même application fermée.
6. Mode avion, puis ouvre l'application : une page hors ligne s'affiche au lieu d'une erreur de Safari.
7. Sur le PC, Tailscale connecté : ouvre la même adresse, connecte-toi avec la passkey de l'iPhone (QR code), puis ajoute une passkey du PC dans **Paramètres > Sécurité**.

## C. CI et documents (critères 6 et 7)

1. Sur GitHub, onglet **Actions** : la dernière exécution de `CI` sur `main` est verte (secrets, lint, tests unitaires, intégration, bout en bout sur conteneurs, sécurité).
2. Les documents existent : [modèle de menaces](../security/threat-model.md), [revue de sécurité](../security/review-phase-0.md), [ADR](../adr/README.md).

## Après la démonstration

Dis-moi ce qui a marché, ce qui a coincé et ce que tu veux changer (couleurs, textes, ergonomie). Je corrige, puis on valide ensemble le [plan de la phase 1](../plans/phase-1.md) avant d'écrire la moindre ligne de code de collecte.
