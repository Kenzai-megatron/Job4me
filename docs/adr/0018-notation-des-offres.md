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

## Mise en œuvre (lot 5, 24/11/2026) : la notation par Claude, écrite, testée et coupée

- **Coupée par défaut** (`ai.scoring.enabled: false`) ; elle s'active par `JOB4ME_AI_SCORING=true` dans `.env` sur la machine de la maison, sans changement de code. Elle partage les plafonds de l'ADR 0009 (2 $ par semaine), vérifiés avant chaque appel ; tous ses nombres sont dans la configuration (`ai.scoring`).
- **Quand** : après chaque passage planifié ou manuel, jamais après un passage de test (file `offers_ai_score`, un seul à la fois par compte). Au plus 200 offres par passage en notation rapide, choisies à tour de rôle entre les sources (les plus prometteuses de chaque source d'abord), et 10 analyses détaillées ; le reste attend le passage suivant.
- **Notation rapide** (Claude Haiku 5.5, prompt `quick-1`) : lots de 25, chaque offre identifiée par sa place dans le lot (o1, o2…) ; une seule grammaire pour tous les lots ; chaque offre envoyée doit revenir une fois et une seule, sans autre champ, score entier de 0 à 100 (Zod), sinon second essai, puis offre par offre. La raison est coupée à 200 caractères.
- **Analyse détaillée** (Claude Sonnet 5.5, prompt `detailed-1`) des offres de 70 ou plus qui ont un texte : six notes de la grille, points forts, écarts, éléments bloquants, mots-clés à reprendre. **Le score est calculé par Job4me** à partir des notes et des poids de la grille du profil (Claude ne le donne pas), donc les poids que Mehdi change comptent vraiment.
- **Repli** : ce qui échoue garde son score sans IA ; un plafond atteint ou l'API injoignable arrête la notation du passage. Un score de Claude n'est gardé que tant que le contexte (prompts, modèles, réglages, profil lu, consignes, étalon, poids) et l'offre telle qu'envoyée n'ont pas changé ; sinon il cède la place au score sans IA jusqu'à la notation suivante. Chaque score garde son modèle et la version de son prompt.
- **Ce qui part chez Anthropic** (décision D2) : le profil sans identité, coordonnées ni ville de base (métiers visés, compétences et niveaux, langues, intitulés et durées des expériences, critères pratiques, secteurs, critères éliminatoires, motivations), les consignes de notation ; pour chaque offre, intitulé, employeur, lieu, distance, conditions et 500 caractères de texte (1 200 pour l'analyse détaillée), sans adresse e-mail, numéro de téléphone ni lien. Consignes en tête, partie fixe en cache, données entre balises, chevrons des données neutralisés, aucun outil.
- **Lot suspect** (menace 1) : un lot de trois offres ou plus dont toutes les notes dépassent de 30 points ou plus la note sans IA est noté de nouveau offre par offre ; une consigne glissée dans une annonce ne touche alors plus que la sienne.
- **Confiance** : une offre sans texte est notée sur son intitulé, en confiance basse, et n'a pas d'analyse détaillée ; aucun score ne déclenche d'envoi en phase 3.
- **Écrans** : la fiche montre la grille (poids et notes), les éléments bloquants, les points forts, les écarts et les mots-clés ; Paramètres > IA montre la dépense par usage (notation rapide, analyse détaillée).
- **Précisions par rapport au plan, à valider par Mehdi** :
  - les **intitulés des diplômes et des certifications** (sans établissement ni année) partent aussi : sans eux, Claude prendrait un diplôme exigé pour un élément bloquant ;
  - **un élément bloquant plafonne le score à 59** (`blockerCap`) : une offre qu'un critère explicite rend impossible n'est jamais « postuler aujourd'hui » ;
  - **un changement du profil** ne relance pas Claude tout de suite : les scores de Claude devenus obsolètes cèdent la place au score sans IA, et Claude note de nouveau au passage suivant, pour qu'une série de retouches du profil ne coûte qu'une notation ;
  - le **plafond total de 10 $** de la phase 1 (`ai.caps.totalUsd`) s'applique aussi : à relever quand la notation par Claude sera activée durablement.
- **Tests**, tous sur un transport simulé, sans aucun appel réel : rien n'est envoyé tant que le réglage est coupé ou sans clé ; lots de 25 à tour de rôle entre les sources ; aucune valeur d'identité ni coordonnée de recruteur dans les requêtes ; annonce piégée (balise de fin neutralisée, lot suspect renoté offre par offre) ; offre manquante ou champ en trop refusés ; API injoignable et plafond atteint ; plafond d'offres par passage ; offre sans texte en confiance basse ; un compte ne note jamais les offres d'un autre.

## Mise en œuvre (lot 6, 24/11/2026) : jeu de référence, nouvelles offres à 80 ou plus

- **« Ma note »** sur la fiche d'une offre : une note de 0 à 100 et un mot d'explication (200 caractères au plus), propres au compte (`offer_rating`, RLS). L'écran Paramètres > IA montre où en est le jeu de référence (objectif : 30 offres variées) et les dernières mesures.
- **Mesure depuis la machine de la maison** (décision D1) : `pnpm stack:cli scoring:benchmark` demande la mesure au worker et l'affiche quand elle est finie ; elle est gardée (`scoring_benchmark`) :
  - **notation sans IA**, toujours, gratuite : écart moyen avec tes notes et les cinq plus grands écarts, contre le seuil de 10 points (Hypothèse de la spécification) ;
  - **Claude**, avec `--claude` seulement (quelques centimes, dans les plafonds, usage « mesure du jeu de référence » dans le journal des appels) : les mêmes étapes que la notation après un passage (lots, second essai, lot suspect, analyse détaillée à partir de 70), sur les offres notées qui ne servent pas d'étalon ; coût total et coût par offre ; la mesure ne modifie aucun score ;
  - **pré-filtre de titre** : la part des offres notées 60 ou plus qu'il aurait écartées, contre le plafond de 5 % (Hypothèse).
- **Étalon de sévérité** (spécification, section 5) : jusqu'à 5 offres notées dans le prompt de la notation rapide, une par tranche d'abord (80, 60, 40, 0), les notes les plus anciennes d'abord, pour qu'une nouvelle note ne change rien une fois l'étalon complet.
- `pnpm stack:cli scoring:run` lance la notation par Claude tout de suite plutôt qu'au passage suivant, si elle est activée.
- **Nouvelles offres à 80 ou plus** (décision D7) : après un passage (après la notation par Claude quand elle est activée), une notification « N nouvelles offres à 80 ou plus » si des offres gardées, vues pour la première fois dans les sept jours, atteignent 80 ; chaque offre n'est nommée qu'une fois (`offer.alerted_at`), jamais une offre ajoutée à la main. L'accueil les liste toute la semaine, les meilleures d'abord. Seuil et fenêtre dans la configuration (`scoring.alert`).
- **Précision par rapport à l'ADR 0015, à valider par Mehdi** : une offre que tu as notée n'est **jamais purgée** après 90 jours, sinon le jeu de référence s'effriterait ; retirer la note la rend à la règle commune.

## Clôture (lot 7, 24/11/2026)

- La liste des offres gagne le filtre de **distance** prévu par le plan (section 10) : 10, 25 ou 50 km au plus par la route, télétravail complet compris ; un lieu inconnu en est écarté.
- Revue de sécurité de la phase 3 : texte d'une offre borné avant caviardage et caviardé seulement quand Claude le lit ; mesures du jeu de référence purgées avec les journaux de passage.

