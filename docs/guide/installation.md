# Installer Job4me sur la machine de la maison

Job4me tourne sur un PC ou mini-PC Linux de la maison (décision D4), en conteneurs Docker. Tailscale le rend joignable depuis tes appareils, en HTTPS, sans rien ouvrir sur Internet (décision D3). Compte une heure la première fois.

## 1. Prérequis

- **Linux avec le disque chiffré (LUKS)**, choisi à l'installation du système. C'est ce chiffrement qui protège la base de données si la machine est volée.
- **Docker Engine et le plugin Compose** ([documentation Docker](https://docs.docker.com/engine/install/)). Ajoute ton utilisateur au groupe `docker`, puis ferme et rouvre ta session :

```bash
sudo usermod -aG docker "$USER"
```

- **Node 26 et pnpm 10**, seulement pour les scripts d'installation et de mise à jour (le plus simple : [fnm](https://github.com/Schniz/fnm), puis `npm install --global pnpm@10`).
- **Git**, avec un accès au dépôt privé.
- **Tailscale** sur la machine et sur l'iPhone, connectés au même compte ([installation](https://tailscale.com/download/linux)).
- **Ton gestionnaire de mots de passe** (décision D5) : il gardera la clé maîtresse, le mot de passe de secours et les codes de secours.

## 2. Tailscale

1. Connecte la machine et donne-lui le nom `job4me` :

```bash
sudo tailscale up
```

```bash
sudo tailscale set --hostname=job4me
```

2. Dans la console Tailscale, page **DNS** : vérifie que **MagicDNS** est actif, puis active **HTTPS Certificates**.
3. Note l'adresse complète de la machine, de la forme `job4me.<ton-tailnet>.ts.net` (commande `tailscale status`, ou la page **Machines** de la console).

## 3. Code et secrets

```bash
git clone <adresse du dépôt> job4me
```

```bash
cd job4me && pnpm install
```

Écris la configuration de la machine avec ton adresse Tailscale (et, si tu veux, une adresse de contact pour les services de notification) :

```bash
pnpm setup:home --origin https://job4me.<ton-tailnet>.ts.net --contact mailto:<ton-adresse>
```

La commande crée le dossier `secrets/` (lisible par toi seul) et le fichier `.env`, qui ne contient que des réglages et des chemins. Lance-la avec ton utilisateur habituel, pas avec `sudo` : les conteneurs tournent sous ton identité, pour lire les secrets sans les ouvrir à tous.

**Recopie tout de suite le contenu des fichiers de `secrets/` dans ton gestionnaire de mots de passe**, une note sécurisée par fichier. Les plus précieux sont `master_key` (sans elle, les secrets TOTP et l'identité chiffrés en base deviennent illisibles) et `import_key` (sans elle, les CV importés et leur texte extrait le deviennent).

Les fichiers importés, chiffrés, vivent dans `var/files/` à la racine du dépôt (jamais dans Git ni dans l'image) ; les sauvegardes du lot 6 les emporteront.

### Activer l'IA (facultatif)

Sans clé, tout fonctionne sauf la structuration du CV par l'IA et la proposition des mots-clés. Pour l'activer :

1. Dans la [console d'Anthropic](https://platform.claude.com), crée une clé d'API et règle un **plafond de dépense mensuel** (Job4me applique en plus ses propres plafonds : 2 $ par semaine et 10 $ au total, dans `config/default.yaml`).
2. Écris la clé dans le fichier secret, sans qu'elle passe par l'historique du terminal :

```bash
read -rs CLE && printf '%s' "$CLE" > secrets/anthropic_api_key && unset CLE
```

3. Redémarre le worker, seul conteneur à recevoir la clé :

```bash
pnpm stack:up
```

Paramètres > IA montre ensuite la dépense de la semaine, le total et les derniers appels, sans leur contenu.

## 4. Démarrer

```bash
pnpm stack:up
```

La première fois, la construction de l'image prend quelques minutes. La commande démarre PostgreSQL, applique les migrations, puis lance l'API et le worker ; elle rend la main quand tout est en bonne santé. Vérifie la configuration :

```bash
pnpm stack:cli config:check
```

Puis demande à Tailscale de servir l'application en HTTPS, aux seuls appareils de ton réseau Tailscale :

```bash
sudo tailscale serve --bg 3000
```

`tailscale serve status` affiche l'adresse servie. L'application n'écoute que sur `127.0.0.1:3000` : rien n'est exposé sur le réseau local ni sur Internet. N'utilise pas `tailscale funnel`, qui l'ouvrirait à tout Internet.

## 5. Créer ton compte

```bash
pnpm stack:cli user:create --email <ton-adresse> --name Mehdi
```

La commande demande deux fois le **mot de passe de secours** (au moins 12 caractères ; une phrase est idéale), puis affiche un **lien d'enrôlement à usage unique, valable 15 minutes**. Range ce mot de passe dans ton gestionnaire.

Ouvre le lien dans Safari sur l'iPhone, Tailscale connecté :

1. **Passkey** : « Créer la passkey », puis Face ID. Elle se range dans le trousseau iCloud.
2. **Code à 6 chiffres** : scanne le QR code avec ton application de codes (l'app Mots de passe d'iOS sait le faire), puis saisis le code affiché.
3. **Codes de secours** : recopie les 10 codes dans ton gestionnaire de mots de passe. Chacun ne sert qu'une fois.

Lien expiré ? Demandes-en un autre (les anciens cessent de marcher) :

```bash
pnpm stack:cli user:enroll-link --email <ton-adresse>
```

## 6. Installer l'application et tester les notifications sur l'iPhone

1. Dans Safari, sur l'adresse de Job4me : bouton Partager, puis **Sur l'écran d'accueil**.
2. Ouvre Job4me depuis l'icône, connecte-toi par Face ID.
3. **Paramètres > Sécurité > Notifications** : « Activer les notifications », accepte, puis « Envoyer une notification de test ». Elle arrive en quelques secondes.

Pour te connecter aussi depuis ton PC : sur la page de connexion, choisis la passkey de l'iPhone (QR code à scanner), puis ajoute une passkey propre au PC dans **Paramètres > Sécurité**.

## 7. Au quotidien

| Besoin | Commande |
| --- | --- |
| Mettre à jour | `git pull && pnpm install && pnpm setup:home && pnpm stack:up` (secrets et réglages nouveaux ajoutés sans toucher aux anciens, migrations comprises) |
| Lire les journaux | `pnpm stack:logs api` ou `pnpm stack:logs worker` |
| Arrêter | `pnpm stack:down` (les données restent dans le volume `job4me_pgdata`) |
| Derniers événements de sécurité | `pnpm stack:cli audit:tail --limit 50` |
| Fermer toutes les sessions | `pnpm stack:cli sessions:revoke-all --email <ton-adresse>` |

Les conteneurs redémarrent seuls avec la machine (Docker démarré au boot). Tailscale garde sa configuration `serve`.

## 8. En cas de perte

- **Passkey perdue** (iPhone changé, trousseau vidé) : connexion par mot de passe de secours + code à 6 chiffres, puis ajout d'une nouvelle passkey dans Paramètres > Sécurité.
- **Plus de code à 6 chiffres** : mot de passe de secours + un code de secours.
- **Tout perdu** : sur la machine elle-même, `pnpm stack:cli user:enroll-link --email <ton-adresse>` donne un nouveau lien d'enrôlement. La machine reste la racine de confiance (ADR 0003).
