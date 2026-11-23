# 0018 Notation des offres : sans IA par défaut, Claude en option

Statut : acceptée le 23/11/2026.

## Contexte

La spécification (section 5) note chaque offre sur 100 avec Claude Haiku 5.5, par lots de 25, puis analyse en détail les offres de 70 ou plus. Mehdi a décidé de **rester gratuit pendant la phase de test** (décision D5 du 23/11/2026) et de passer, si nécessaire, à un plafond de 2 $ par semaine. L'ADR 0015 renvoyait à la phase 3 l'envoi des offres à Claude.

## Décision

- **Notation sans IA par défaut** : un score sur 100, déterministe et expliqué, tiré du profil (métiers cibles, mots-clés, compétences, langues, distance, contrat et régime, fraîcheur ; pénalités des secteurs exclus et du rejet), poids dans la configuration ; confiance basse.
- **Notation par Claude, coupée par défaut** (`ai.scoring.enabled: false`) : notation rapide par Claude Haiku 5.5 par lots de 25 (sortie au schéma, identifiants vérifiés, second essai, tri sans IA en repli), analyse détaillée par Claude Sonnet 5.5 des offres de 70 ou plus (décision D3), appels directs plutôt que l'API Batch (décision D4). Elle s'active d'un réglage, avec un plafond de 2 $ par semaine.
- **Ce qui part chez Anthropic, une fois activée** (décision D2) : le profil sans identité ni coordonnées ; pour chaque offre, intitulé, employeur, lieu, distance et 500 caractères de description, sans adresse e-mail ni numéro de téléphone, entre balises de données ; consignes en tête, aucun outil. Le journal des appels garde jetons et coût, jamais le contenu.
- **Plafonds** dans la configuration, vérifiés avant chaque appel comme pour l'ADR 0009 ; plafond d'offres notées par passage, à tour de rôle entre les sources.
- Chaque score garde son modèle (ou « sans IA »), la version du prompt et celle du profil ; il n'est recalculé que si l'un d'eux ou l'annonce change. Un score sans description reste à confiance basse et ne déclenchera jamais d'envoi automatique.
- **Jeu de référence** (décision D1) : les notes de Mehdi restent dans sa base ; la mesure tourne sur la machine de la maison ; la CI ne voit que des offres fictives et un transport simulé.

## Conséquences

- Tant que l'IA reste coupée, la phase ne coûte rien ; le jeu de référence dira si la notation sans IA suffit.
- Activer Claude est un réglage et un plafond, sans changement de code.
