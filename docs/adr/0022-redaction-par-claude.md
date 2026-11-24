# 0022 Rédaction des documents par Claude

Statut : acceptée le 24/11/2026 (plan de la phase 4, décisions D1 et D3).

## Contexte

La lettre (250 à 350 mots) et le mail au recruteur (80 à 120 mots) gagnent à être rédigés : accroche liée à l'offre, preuves alignées sur ses exigences, ton naturel et direct. La spécification (section 6) prévoit Claude Sonnet 5.5 pour la rédaction et Claude Haiku 5.5 pour les contrôles. La notation reste gratuite pendant la phase de test (décision D5 de la phase 3) ; la rédaction, elle, se fait sur demande.

## Décision

- **À la demande** (D1) : un clic par dossier lance la rédaction de la lettre et du mail par Claude Sonnet 5.5 ; jamais d'office. Le CV reste construit sans IA ; sans clé, IA coupée ou plafond atteint, un **modèle sans IA** rempli par les faits prend le relais.
- **Langue de l'offre** (D3) : français, néerlandais ou anglais ; les faits sont traduits par Claude phrase par phrase, chaque phrase avec sa source et soumise au contrôle de l'ADR 0021 ; sans IA, le dossier reste en français.
- **Ce qui part chez Anthropic** :
  - les faits utiles du profil, sous des identifiants, sans identité, coordonnées, ville de base ni employeur actuel exclu ;
  - l'annonce (intitulé, employeur, lieu, 2 000 caractères de texte au plus, sans adresse e-mail, numéro de téléphone ni lien), entre balises de données, chevrons neutralisés ;
  - consignes en tête, partie fixe en cache, aucun outil, sortie au schéma.
- **Plafonds** : ceux de l'ADR 0009, vérifiés avant chaque appel ; une rédaction à la fois par dossier ; usages distincts dans le journal (« rédaction des documents », « contrôle des documents ») et à l'écran.
- **Coût estimé** : 2 à 3 centimes par dossier pour la rédaction, moins d'un centime pour le contrôle.

## Conséquences

- Le dossier reste utilisable sans IA ; Claude améliore la lettre et le mail sans jamais pouvoir y ajouter un fait.
- Une annonce piégée ne peut rien faire écrire qui ne vienne pas des faits : le contrôle de l'ADR 0021 s'applique quoi qu'elle dise.
