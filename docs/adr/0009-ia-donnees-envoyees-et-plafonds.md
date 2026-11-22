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
