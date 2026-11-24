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

## Mise en œuvre (lot 4, 24/11/2026) : la notation sans IA

- **Règles** (`packages/collect/src/score.ts`, version `rules-1`), poids dans la configuration (`scoring.rules`, 100 au total) :
  - intitulé, 35 : métier cible 100 %, mot-clé prioritaire 90 %, autre mot-clé 75 %, intitulé en partie proche 60 % × la part des mots trouvés ;
  - compétences du profil citées, 20 : trois suffisent ; une offre sans description reste neutre ;
  - langues demandées (champ de la source ou texte) par rapport aux niveaux du profil, 10 : la plus faible compte ;
  - distance, 15 : tout jusqu'au quart du rayon, puis de moins en moins jusqu'à la moitié au rayon ; lieu inconnu 60 % ; télétravail complet accepté, tout ;
  - contrat et régime donnés par la source, 10 ;
  - fraîcheur, 10 ;
  - pénalités : secteur exclu cité −20, mot rejeté du pré-filtre dans l'intitulé −15.
- **Les critères pratiques ne comptent qu'à proportion de la pertinence** (intitulé ou compétences) : une offre proche, récente et en CDI dont l'intitulé et les compétences ne correspondent à rien reste hors sujet. Étalement sur des cas types : 91 (métier cible, compétences citées), 81 (métier cible sans description), 62 (mot-clé), 48 (autre intitulé, trois compétences), 27 (intitulé en partie proche), 9 (hors sujet).
- **Toujours expliqué** : les facteurs sont gardés comme données (`offer_score.factors`) et l'interface les formule (« intitulé de votre métier « Comptable » · 3 compétences citées · 12 km · CDI »). **Confiance basse** : un score sans IA ne déclenchera jamais d'envoi automatique (phase 5).
- **Recalculé seulement si quelque chose change** : la version du profil (règles, poids, données lues) ou celle de l'offre. Seules les offres gardées par le filtre (ADR 0019) sont notées : après chaque passage, au démarrage, et après chaque changement du profil (file `offers_screen`).
- **Écrans** : offres classées par score puis par fraîcheur, avec pastille de tranche et explication ; filtres par tranche et « nouvelles » ; fiche avec tous les facteurs ; pertinence par source sur quatre semaines (part des offres notées 80 ou plus).
- L'écart avec les notes de Mehdi se mesurera au lot 6 (jeu de référence) : il dira si la notation sans IA suffit.
