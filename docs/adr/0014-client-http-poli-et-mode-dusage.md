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

## Mise en œuvre (lot 1, 23/11/2026)

- `PoliteClient` (`packages/collect/src/http.ts`), seul fichier autorisé à appeler `fetch` par la règle Semgrep. HTTPS seulement, hôtes exacts, port par défaut, aucun identifiant dans l'URL ; redirections suivies à la main (3 au plus, configuration) et revérifiées une à une ; une redirection d'un POST devient un GET.
- En-têtes : `User-Agent`, `Accept`, `Accept-Language` de la configuration ; un connecteur ne peut fixer ni `Authorization`, ni `Cookie`, ni `User-Agent`, ni `Accept-Language`.
- Nouvel essai seulement après une erreur réseau, un délai dépassé ou un 5xx, avec attente doublée à chaque fois ; jamais après un 4xx. 403 et 429 lèvent `blocked` : la source s'arrête pour le passage ; `cooldownHoursAfterBlock` (24 pour LinkedIn) la saute ensuite avec la raison « cooldown ».
- Corps lu en flux et coupé au-delà de `maxResponseBytes`, mesuré après décompression ; délai par requête ; budget de la source qui interrompt aussi les pauses.
- Mode commercial : l'API refuse d'activer une source à usage personnel (`source_commercial_mode`), l'orchestrateur la saute (« commercial_mode ») quel que soit son interrupteur.
- Clés : remises au seul connecteur qui les déclare, absentes = « sautée, clé absente » ; `maskUrl` masque aussi `app_id`.

## Mise en œuvre (lot 2, 23/11/2026)

- Pauses de la configuration : 2 s entre deux requêtes d'Actiris (API d'un site), 0,3 s pour le Forem (open data), 1 s pour Adzuna et SerpApi ; deux nouveaux essais pour ces API robustes, budget de 120 à 180 s par source.
- **Google Jobs le lundi, le mercredi et le vendredi, et non chaque jour** (écart signalé à la décision D3) : dix mots-clés prioritaires chaque jour feraient 300 recherches par mois, au-delà des 250 du plan gratuit ; trois jours par semaine en font environ 130 et laissent la place aux tests. Le compte est consulté avant chaque passage, sans dépenser de recherche ; sous la réserve (20), la source est sautée.
- Clés d'Adzuna et de SerpApi : fichiers `secrets/adzuna_app_id`, `secrets/adzuna_app_key` et `secrets/serpapi_key`, vides par défaut, remis au seul conteneur `worker` (contrôlé par `pnpm check:compose`) ; elles voyagent dans l'URL et sont masquées dans chaque ligne de journal.

## Mise en œuvre (lot 3, 23/11/2026)

- Pages publiques le mardi et le vendredi (décision D3), **3 s entre deux pages d'un même site, un seul essai**, aucun cookie gardé d'une requête à l'autre : un site qui pose un défi anti-robot (Akamai devant StepStone) finit par répondre 403, et la source s'arrête là.
- Les redirections de Jobijoba (mot-clé avec majuscule) restent sur son hôte ; une redirection vers un autre hôte arrête la source (`host_not_allowed`).
