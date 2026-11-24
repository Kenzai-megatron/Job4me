# Démonstration de la phase 3

Sur la machine de la maison, une heure environ, plus une semaine d'offres pour le premier critère. Le [guide d'installation](installation.md) reste la référence pour chaque commande ; ce guide suit les critères de fin de la phase ([plan de la phase 3](../plans/phase-3.md), section 2).

Par défaut, tout se fait **sans IA** (décision D5, gratuit pendant la phase de test). La notation par Claude est prête mais coupée : la section 6 dit comment l'essayer, si tu le décides.

## 0. Mettre à jour

```bash
cd ~/job4me && git pull && pnpm install && pnpm stack:up
```

Les migrations ajoutent les annonces uniques, les localités belges (GeoNames, vérifiées par leur empreinte), les scores et le jeu de référence. Au démarrage, le worker range les offres déjà collectées : regroupement, lieux, filtre, scores. Vérifie-le :

```bash
pnpm stack:logs worker
```

Attendu : une ligne `stored postings prepared` avec des nombres (`identified`, `located`, `screened`, `scored`), puis `collection ready`.

## 1. Ta ville de base et tes critères

1. **Profil > Critères pratiques** : ta ville de base et son code postal, puis **Enregistrer**. Attendu : « Ville de base trouvée » ; sinon, corrige le nom ou ajoute le code postal.
2. Vérifie ton rayon, tes contrats, ton régime et le télétravail : le filtre s'en sert pour écarter ce qui est certain.
3. **Profil > Consignes de notation** : ce qui est hors sujet pour toi et tes cas limites (« le néerlandais B2 exigé reste possible », par exemple).

## 2. Une semaine d'offres sans doublon visible (critère 1)

Après quelques passages (ou `pnpm stack:cli sources:run` pour ne pas attendre) :

1. **Offres** : chaque annonce n'apparaît qu'une fois, avec « N parutions » quand plusieurs sites la portent. Les offres sont classées par score, puis par fraîcheur.
2. Ouvre une annonce à plusieurs parutions : chaque site, son lien et la raison de la fusion (« même intitulé et même employeur », « même référence »…).
3. Si deux offres différentes ont été fusionnées à tort : **Ce n'est pas la même offre** sur la parution en trop. Elle forme sa propre annonce, et les passages suivants la laissent à part.
4. **Offres > Sources** : chaque source montre ses parutions fusionnées et sa pertinence (part de ses offres notées 80 ou plus).

À signaler : un doublon encore visible (les deux intitulés et employeurs), ou une fusion à tort.

## 3. Lieux et distances

1. Dans la liste, chaque offre montre son lieu et sa distance par la route depuis ta ville de base (« Mechelen, 27 km »).
2. Vérifie trois ou quatre lieux que tu connais : la distance est le vol d'oiseau × 1,25, arrondi au kilomètre.
3. **Écartées** : les offres mises de côté avec leur raison (trop loin, à l'étranger, employeur exclu, trop ancienne, langue ou contrat exclus). Un lieu inconnu n'est jamais écarté.

## 4. Noter 30 offres et mesurer l'écart (critères 2 et 4)

1. Sur la fiche d'une offre, **Ma note** : ta note sur 100 et, si tu veux, un mot d'explication. Note une trentaine d'offres **variées** : de très bonnes, des moyennes, des hors sujet.
2. **Paramètres > IA > Jeu de référence** suit le compte (« 12 offres notées sur 30 »).
3. Mesure la notation sans IA :

```bash
pnpm stack:cli scoring:benchmark
```

Attendu : l'écart moyen entre tes notes et les scores (le but : moins de 10 points), les cinq plus grands écarts, et la part des offres notées 60 ou plus que le pré-filtre de titre aurait écartées (le but : 5 % au plus). La mesure reste visible dans Paramètres > IA.

Si l'écart reste au-dessus de 10 points, les cinq plus grands écarts disent pourquoi : poids à ajuster (`scoring.rules` dans la configuration), consignes à préciser, ou passage à la notation par Claude (section 6), qui est la décision à prendre.

## 5. Les nouvelles offres à 80 ou plus (décision D7)

1. **Accueil** : « Nouvelles offres à 80 ou plus », vues ces sept derniers jours, les meilleures d'abord.
2. Après un passage, si de nouvelles offres atteignent 80 : **une** notification sur le téléphone (« 3 nouvelles offres notées 80 ou plus »). Chaque offre n'est annoncée qu'une fois ; une offre que tu ajoutes toi-même ne l'est jamais.

Vérifie d'abord que les notifications arrivent : Paramètres > Sécurité, **Envoyer une notification de test**.

## 6. Facultatif : essayer la notation par Claude (critère 3)

À faire seulement si tu décides de dépenser quelques centimes ; la clé de l'IA doit être installée (guide d'installation, « Activer l'IA »).

1. Mesure d'abord Claude sur tes 30 notes, sans rien activer :

```bash
pnpm stack:cli scoring:benchmark --claude
```

Attendu : l'écart moyen de Claude sur les offres notées hors étalon, et le **coût par offre**. Paramètres > IA montre la dépense, à part : « Mesure du jeu de référence ».

2. Si l'écart est meilleur et que tu veux l'activer pour de bon : `JOB4ME_AI_SCORING=true` dans `.env`, puis `pnpm stack:up`. Après le passage suivant (ou `pnpm stack:cli scoring:run`), les fiches montrent « Score rapide de Claude Haiku » ou l'analyse détaillée (grille, points forts, écarts, éléments bloquants, mots-clés). Paramètres > IA montre la dépense par usage (notation rapide, analyse détaillée).

3. Pour revenir en arrière : `false` dans `.env`, puis `pnpm stack:up`.

## 7. À me renvoyer

- Le résultat de `scoring:benchmark` (et de `--claude` si tu l'as essayé) : écarts et coûts, sans le détail des offres si tu préfères.
- Les doublons, fusions à tort ou distances fausses que tu as vus.
- Tes réponses aux précisions des ADR 0016 à 0019 marquées « à valider » (dont : l'élément bloquant qui plafonne le score à 59, les offres notées jamais purgées, le plafond total de 10 $ de l'IA).
