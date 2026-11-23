# 0014 Client HTTP poli et mode d'usage

Statut : acceptée le 23/11/2026.

## Contexte

`CLAUDE.md` impose une collecte respectueuse : cadence de particulier, pauses, arrêt net au premier 403 ou 429, jamais de contournement des protections anti-robots, un interrupteur par source, et la coupure des sources à usage personnel en mode commercial. La règle Semgrep `job4me-no-direct-http` interdit déjà tout appel HTTP direct.

## Décision

- **Un seul client** (`politeFetch`) pour toute la collecte : chaque requête et chaque redirection vers un hôte hors de la liste déclarée par le connecteur est refusée ; en-têtes ordinaires d'un navigateur ; une pause par source (de 0,3 s pour l'open data à 3 s, 20 s pour LinkedIn) ; délai et taille de réponse bornés ; un seul essai pour LinkedIn et les pages publiques, deux ou trois avec attente croissante pour les API robustes.
- **403 et 429 arrêtent la source** pour tout le passage, sans nouvel essai ; LinkedIn n'est plus appelé pendant 24 heures (`source_setting.cooldown_until`).
- **Jamais de contournement** : ni rotation d'adresse, ni navigateur sans tête, ni résolution de captcha, ni imitation d'un en-tête d'authentification. Un site qui refuse est laissé, ou atteint par une autre voie (open data, Google Jobs, alertes e-mail).
- **Mode d'usage** : la configuration porte `collect.usageMode` (`personal` par défaut). Chaque connecteur déclare s'il est réservé à l'usage personnel (LinkedIn « invité » et toutes les pages publiques) ; en mode `commercial`, ils ne peuvent ni s'activer ni tourner, quel que soit leur interrupteur.
- **Clés dans l'URL** (Adzuna, SerpApi) : fichiers secrets de la machine de la maison ; sans clé, le connecteur est « sauté, clé absente » ; toute URL journalisée passe par `maskUrl`, et les erreurs enregistrées ne gardent jamais l'URL complète.
- **Cadence** (Hypothèse, décision D3 du 23/11/2026) : API et open data une fois par jour ; pages publiques et LinkedIn le mardi et le vendredi à 7 h 10, heure de Bruxelles ; horaires dans la configuration.
- **Sondage avant chaque connecteur** (décision D1) : depuis l'environnement de Claude, avec l'accord de Mehdi pour chaque hôte ajouté à la liste autorisée ; LinkedIn depuis la connexion de la maison.

## Conséquences

- Une source bloquée se voit au journal (« arrêtée sur 429 »), jamais comme une source vide.
- Ouvrir un jour Job4me à d'autres coupe d'office LinkedIn « invité » et les pages publiques : il faudra des sources sous licence.
