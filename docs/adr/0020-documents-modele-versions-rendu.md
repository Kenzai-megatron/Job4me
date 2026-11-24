# 0020 Documents : modèle, versions et rendu

Statut : acceptée le 24/11/2026 (plan de la phase 4, décisions D4 à D7).

## Contexte

La phase 4 produit les documents de candidature : un CV maître par métier cible, puis, pour chaque offre, un dossier (CV adapté, lettre, mail au recruteur). La spécification (sections 6 et 10) demande une seule source par document, rendue en DOCX et en PDF, deux gabarits sobres lisibles par les logiciels de recrutement (ATS), des versions conservées et comparables, et des coordonnées insérées par le gabarit, jamais par l'IA.

## Décision

- **Un JSON par version de document**, validé par un schéma Zod partagé (`packages/contracts`) : sections, lignes, et pour chaque ligne ses **faits sources** (réalisation, expérience, compétence, langue, formation, certification, motivation, critère pratique) et son **origine** (profil, modèle sans IA, Claude, à la main). Longueurs bornées (lignes, sections, caractères).
- **Tables** propres à chaque compte (`user_id`, RLS) : `master_cv` (un par métier cible), `dossier` (un par offre), `document` (CV, lettre ou mail, avec sa version courante) et `document_version` (jamais modifiée).
- **Versions** : chaque construction, génération, réordonnancement ou modification à la main crée une version ; la comparaison lit deux versions ligne par ligne ; revenir à une version en crée une nouvelle.
- **CV maîtres sans IA** (D7) : construits à partir du profil pour chaque métier cible, puis choisis, ordonnés et masqués par Mehdi.
- **Rendu à la demande** (D4) par l'API, au téléchargement : PDF par `@react-pdf/renderer`, DOCX par `docx`, à partir de la même version ; aucun fichier généré stocké. L'identité, chiffrée, n'est déchiffrée que pour l'en-tête du document.
- **Deux gabarits** : « Classique » et « Moderne », une colonne, titres standards, texte sélectionnable, une à deux pages pour le CV ; langues et niveaux CECR bien visibles ; ni âge ni état civil ; **pas de photo** en phase 4 (D5). Aucun texte invisible, blanc sur blanc ou minuscule.
- **Polices** (D6) : Inter intégrée au PDF (licence OFL, fichiers versionnés avec leur empreinte et leur licence) ; Calibri, police courante de Word, pour le DOCX.

## Conséquences

- Le contenu d'un document n'existe qu'une fois ; ses deux formats ne peuvent pas diverger.
- Pas de fichier généré à sauvegarder, chiffrer ou purger ; un export coûte un rendu, borné en taille et en durée.
- Deux bibliothèques de rendu entrent dans l'image de l'API : versions épinglées, publiées depuis au moins 7 jours, et uniquement appliquées à notre propre JSON.
