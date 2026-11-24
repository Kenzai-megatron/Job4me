# 0021 Contrôle anti-invention

Statut : acceptée le 24/11/2026 (plan de la phase 4, décision D2).

## Contexte

`CLAUDE.md` le pose comme règle non négociable : l'IA n'invente rien, chaque ligne d'un CV ou d'une lettre provient d'un fait du profil. La spécification (section 6) précise : pour chaque ligne générée, le modèle indique le fait du profil sur lequel elle s'appuie ; une ligne sans fait source est signalée et bloquée avant validation ; aucun mot-clé caché.

## Décision

- **Chaque ligne écrite par Claude cite ses faits** par leurs identifiants dans la demande (`f12`, `e3`…), jamais par leur texte ; la sortie au schéma l'impose, Zod le vérifie.
- **Contrôle déterministe**, gratuit, sur chaque ligne de Claude :
  - au moins un fait cité, et chaque fait cité existe dans le profil du compte ;
  - chaque nombre, date, pourcentage et montant de la ligne figure dans ses faits ;
  - chaque compétence, outil, diplôme, employeur ou nom propre de la ligne figure dans ses faits, ou dans l'annonce quand il nomme l'entreprise ou le poste visés.
- **Contrôle par Claude Haiku 5.5** des lignes qui passent le premier contrôle : « cette phrase dit-elle quelque chose que ses faits ne disent pas ? », réponse au schéma, ligne par ligne, avec une raison courte.
- **Une ligne qui échoue** est marquée avec sa raison et bloque le passage du dossier à « prêt » jusqu'à ce qu'elle soit corrigée, retirée ou réécrite à la main. Une ligne écrite à la main appartient à Mehdi : marquée « modifiée à la main », jamais bloquée.
- **Sans IA** : les CV et les modèles de lettre et de mail ne contiennent que des faits repris tels quels ; ils passent le contrôle déterministe par construction.
- **Pas de mot-clé caché** : le gabarit n'en permet aucun et un test d'export le vérifie (texte extrait égal au contenu, aucune police minuscule, aucune couleur proche du fond).

## Conséquences

- Une reformulation trop libre est bloquée plutôt que laissée passer : l'erreur coûte une correction à Mehdi, jamais un CV faux envoyé.
- Le contrôle par Claude Haiku coûte moins d'un centime par dossier ; IA coupée ou plafond atteint, les lignes de Claude non contrôlées restent bloquées.
