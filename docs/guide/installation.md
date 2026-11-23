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

### Activer Adzuna et Google Jobs (facultatif)

Sans clé, ces deux sources sont « sautées, clé absente » ; les autres collectent normalement. Les deux clés sont gratuites, à ton nom (décision D2 : quand tu veux).

1. **Adzuna** : crée un compte sur [developer.adzuna.com](https://developer.adzuna.com) ; il donne un identifiant d'application (`app_id`) et une clé (`app_key`).
2. **Google Jobs** : crée un compte gratuit sur [serpapi.com](https://serpapi.com) (250 recherches par mois) et copie la clé d'API. Job4me consulte le compte avant chaque passage, sans dépenser de recherche, et garde une réserve de 20 recherches (configuration, `collect.sources.google_jobs.params.quotaReserve`).
3. Écris chaque valeur dans son fichier secret, sans qu'elle passe par l'historique du terminal :

```bash
read -rs ID && printf '%s' "$ID" > secrets/adzuna_app_id && unset ID
```

```bash
read -rs CLE && printf '%s' "$CLE" > secrets/adzuna_app_key && unset CLE
```

```bash
read -rs CLE && printf '%s' "$CLE" > secrets/serpapi_key && unset CLE
```

4. Redémarre (le worker est le seul conteneur à recevoir ces clés), puis teste les deux sources :

```bash
pnpm stack:up
```

```bash
pnpm stack:cli sources:test --source adzuna --source google_jobs
```

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
| Sauvegarder tout de suite | `pnpm stack:backup` (chaque nuit sinon, section 8) |
| Derniers événements de sécurité | `pnpm stack:cli audit:tail --limit 50` |
| Fermer toutes les sessions | `pnpm stack:cli sessions:revoke-all --email <ton-adresse>` |
| Tester les sources (un mot-clé, une page chacune, aucune offre enregistrée) | `pnpm stack:cli sources:test`, ou une seule : `pnpm stack:cli sources:test --source <nom>` ; aussi depuis l'écran **Sources** |
| Lancer un passage de collecte sans attendre 7 h 10 | `pnpm stack:cli sources:run` |
| Journal de la collecte (offres lues, retenues, inédites par source) | écran **Sources**, ou `pnpm stack:logs worker` (lignes `source run`) |

Les conteneurs redémarrent seuls avec la machine (Docker démarré au boot). Tailscale garde sa configuration `serve`.

La collecte tourne d'elle-même chaque matin à 7 h 10 : les API et l'open data chaque jour, les pages publiques et LinkedIn le mardi et le vendredi (configuration, `collect`). Une source coupée par son interrupteur, en pause après un refus du site ou sans clé apparaît « sautée » avec sa raison, jamais « 0 offre ». Les commandes `sources:*` choisissent seules le compte quand il n'y en a qu'un ; sinon, ajoute `--email <ton-adresse>`.

## 8. Sauvegardes

Chaque nuit, la base et le dossier `var/files/` sont copiés et chiffrés avec [`age`](https://github.com/FiloSottile/age) pour une clé publique. La machine ne garde que cette clé publique : une copie volée reste illisible. La clé privée vit dans ton gestionnaire de mots de passe (ADR 0012).

1. Installe `age` et crée la paire de clés, **sur un disque temporaire** :

```bash
sudo apt install age
```

```bash
age-keygen -o /dev/shm/job4me-backup-key.txt
```

2. Recopie tout le contenu de `/dev/shm/job4me-backup-key.txt` (la ligne `AGE-SECRET-KEY-…` comprise) dans une note sécurisée de ton gestionnaire de mots de passe, puis ajoute la clé publique dans `.env` et efface le fichier :

```bash
echo "JOB4ME_BACKUP_RECIPIENT=$(age-keygen -y /dev/shm/job4me-backup-key.txt)" >> .env && shred -u /dev/shm/job4me-backup-key.txt
```

3. Fais une première sauvegarde ; elle va dans `var/backups/` (ou le dossier `JOB4ME_BACKUP_DIR` de `.env`) :

```bash
pnpm stack:backup
```

4. Programme la sauvegarde de chaque nuit (service utilisateur systemd, actif même sans session ouverte) :

```bash
mkdir -p ~/.config/systemd/user && cp infra/systemd/job4me-backup.* ~/.config/systemd/user/ && systemctl --user daemon-reload && systemctl --user enable --now job4me-backup.timer && sudo loginctl enable-linger "$USER"
```

Si le dépôt n'est pas dans `~/job4me`, corrige `WorkingDirectory` dans `~/.config/systemd/user/job4me-backup.service`. La rétention (14 copies récentes, puis une par semaine pendant 8 semaines) se règle dans `config/default.yaml` (`backups`).

5. **Recopie régulièrement `var/backups/` ailleurs** (disque USB, NAS, dossier synchronisé) : sur la même machine, une copie ne protège pas d'une panne du disque.

6. **Une fois par mois, vérifie qu'une copie se restaure** : remets la clé privée dans un fichier temporaire, lance le test, puis efface le fichier. Le test restaure dans une base jetable, compare chaque table et les fichiers, et ne touche jamais la vraie base.

```bash
JOB4ME_BACKUP_IDENTITY_FILE=/dev/shm/job4me-backup-key.txt pnpm stack:restore-test && shred -u /dev/shm/job4me-backup-key.txt
```

### Restaurer pour de bon

Après la perte de la base ou du disque, sur une machine réinstallée avec le même dépôt et les mêmes `secrets/` (gardés dans le gestionnaire de mots de passe) :

```bash
pnpm stack:down
```

```bash
docker compose --env-file .env -f infra/compose.yaml up -d --wait postgres
```

```bash
age -d -i /dev/shm/job4me-backup-key.txt var/backups/job4me-<date>.db.age | docker compose --env-file .env -f infra/compose.yaml exec -T postgres pg_restore -U job4me_owner -d job4me --clean --if-exists
```

```bash
age -d -i /dev/shm/job4me-backup-key.txt var/backups/job4me-<date>.files.age | tar -C var -xf -
```

```bash
pnpm stack:up && shred -u /dev/shm/job4me-backup-key.txt
```

## 9. En cas de perte

- **Passkey perdue** (iPhone changé, trousseau vidé) : connexion par mot de passe de secours + code à 6 chiffres, puis ajout d'une nouvelle passkey dans Paramètres > Sécurité.
- **Plus de code à 6 chiffres** : mot de passe de secours + un code de secours.
- **Tout perdu** : sur la machine elle-même, `pnpm stack:cli user:enroll-link --email <ton-adresse>` donne un nouveau lien d'enrôlement. La machine reste la racine de confiance (ADR 0003).
