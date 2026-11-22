# 0009 IA : données envoyées, plafonds et journal

Statut : acceptée le 22/11/2026.

## Contexte

La phase 1 confie à l'API Claude la structuration du CV et la proposition des mots-clés (spécification, sections 4 et 10). Le CV contient l'identité et les coordonnées de Mehdi, que la spécification interdit d'envoyer à l'IA ; son contenu est une donnée, jamais une consigne ; les coûts doivent rester plafonnés (section 11).

## Décision

- Un seul client, le SDK officiel `@anthropic-ai/sdk`, dans le worker seulement. La clé d'API est un fichier secret de la machine de la maison ; sans elle, les fonctions d'IA répondent « non configuré » et tout le reste fonctionne.
- Modèles et prix dans la configuration : Claude Haiku 5.5 pour la structuration du CV, Claude Sonnet 5.5 pour les mots-clés.
- Avant l'envoi, l'identité et les coordonnées sont repérées et retirées localement (nom, e-mail, téléphone, liens, commune, rubrique « Références ») ; elles sont proposées à la rubrique Identité sans passer par l'IA.
- Consignes en français ; données entre balises, avec la consigne de les traiter comme des données ; aucun outil donné au modèle ; sortie au format JSON imposé par schéma, puis validée par Zod ; rien n'entre au profil sans la décision de Mehdi.
- Chaque appel est journalisé (`ai_call` : usage, modèle, jetons, coût calculé, statut), jamais son contenu. Avant chaque appel, le plafond hebdomadaire et le plafond total de la configuration sont vérifiés ; au-delà, l'appel n'est pas envoyé.

## Conséquences

- Les tests de la CI tournent sans clé, avec un transport simulé : caviardage, validation des sorties, refus, plafonds et journal sont vérifiés à chaque pull request.
- Un CV dont le texte se caviarde mal (nom d'un ancien responsable cité) peut encore laisser passer un nom de tiers : risque accepté, réduit par le retrait de la rubrique « Références ».

## Mise en œuvre (lot 4, 22/11/2026)

- **Client** : `@anthropic-ai/sdk` 1.8.0 dans le worker seulement (`apps/worker/src/ai/service.ts`), journaux du SDK coupés ; la clé est `secrets/anthropic_api_key`, vide par défaut (IA coupée), remise au seul conteneur `worker` (`pnpm check:compose` le vérifie).
- **Requête** : consignes en tête avec `cache_control`, données entre balises (une balise de même nom glissée dans les données est neutralisée), sortie au schéma JSON (`output_config.format`), effort réglé dans la configuration, aucun outil. Pour Claude Sonnet 5.5, repli côté serveur (`server-side-fallback-2026-07-01`, `fallbacks: "default"`) ; Claude Haiku 5.5 n'en a pas.
- **Validation** : la réponse est relue par Zod ; une réponse invalide a droit à un second essai ; un refus (`stop_reason: "refusal"`) est un échec explicite. Toute proposition de structuration doit citer mot pour mot un extrait du CV caviardé : sinon elle est écartée et comptée (`dropped`).
- **Coût** : calculé à partir des jetons (entrée, sortie, lecture et écriture du cache) et des prix de la configuration ; un modèle de repli inconnu est compté au prix prudent `unknownModelPrice`. Avant chaque appel, le pire cas (toute l'entrée écrite en cache, toute la sortie permise) est ajouté à la dépense des 7 derniers jours et au total : s'il franchit un plafond, rien n'est envoyé (`blocked`).
- **Journal** : une ligne `ai_call` par appel ou par refus d'envoyer (`blocked`, `disabled`) : usage, modèle qui a répondu, jetons, coût, statut, identifiant de requête, durée. Le rôle applicatif ne peut ni la modifier ni la supprimer.
- **Caviardage** (`apps/worker/src/ai/redact.ts`) : e-mails, téléphones, liens, adresses, numéro national, date et lieu de naissance, nationalité, état civil, identité connue (nom complet et ses parties, quels que soient les accents), première ligne qui ressemble à un nom, rubrique « Références » jusqu'à la rubrique suivante. Les e-mail, téléphone et nom trouvés deviennent des propositions pour la rubrique Identité, sans passer par l'IA.
- **Structuration** : le worker trouve les imports lus par l'extracteur grâce à la vue `import_run_ready` (identifiants seulement, propriété du rôle de migration), puis travaille sous RLS pour le compte concerné. Les propositions sont chiffrées sous la clé d'import (`import_proposal`) en attendant la décision de Mehdi (lot 5).
- **Mots-clés** : demande mise en file par l'API (`keyword_proposal_run`, une à la fois), exécutée par le worker ; les mots-clés arrivent au statut « proposé », origine « IA ».
