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

## Mise en œuvre (lot 1, 24/11/2026) : modèle de document et CV maîtres

- **Schéma** (`packages/contracts/src/documents.ts`) : chaque ligne porte une clé stable (`fact:<id>`, `skill:<id>`…), son texte, ses sources, son origine et le résultat de son contrôle ; CV, lettre et mail ont chacun leur forme, toutes bornées.
- **Paquet `@job4me/documents`** : le CV maître construit à partir du profil, sans IA ; chaque ligne reprend un élément du profil tel quel, avec sa source. Ordre par défaut : poste en cours d'abord, puis du plus récent au plus ancien ; compétences par niveau ; langues par niveau CECR. Les réalisations suivent leur expérience ; celles sans expérience forment « Autres réalisations ». Les mots autour des faits (niveaux, noms des langues, « aujourd'hui ») sont écrits dans la langue du document.
- **Choix de Mehdi** (`master_cv.layout`) : l'ordre des éléments, ceux qu'il masque (masquer une expérience masque ses réalisations), et une accroche écrite de sa main, marquée « à la main », jamais contrôlée.
- **Versions** : une version est ajoutée seulement quand le CV change ; le rôle de l'application ne peut ni réécrire ni supprimer une version (droits retirés à la migration). Quand le profil a changé depuis la version courante, l'écran le dit et propose de mettre le CV à jour.
- **API** : `GET /api/master-cvs`, `POST /api/master-cvs`, `GET` et `PUT /api/master-cvs/:id`, `POST /api/master-cvs/:id/refresh`, `GET /api/documents/:id/versions` et `/versions/:number` ; journal d'audit à chaque version.
- **Écran Documents** : les CV maîtres par métier cible, l'éditeur (cocher, monter, descendre, accroche, gabarit), l'aperçu de la version courante et la liste des versions. L'export PDF et DOCX arrive au lot 2.

