# Revue de sécurité de la phase 3

Revue du 24/11/2026, par Claude, sur les lots 1 à 6 : annonce unique, géographie, filtre déterministe, notation sans IA, notation par Claude (coupée par défaut), jeu de référence et nouvelles offres à 80 ou plus. Référence : [plan de sécurité de la phase 3](../plans/phase-3.md), section 11, et [modèle de menaces](threat-model.md), lignes 41 à 50.

## Méthode

- **Lecture du code** : clé de contenu et règles de fusion, séparation d'une parution, localités et distances, filtre, règles de la notation sans IA, prompts et contrôles de la notation par Claude, ce qui part chez Anthropic, orchestration (lots, second essai, lot suspect, analyse détaillée, repli), versions des scores, jeu de référence (API, commande, mesure), alerte des offres à 80 ou plus, purge, RLS et filtres `user_id` des nouvelles tables, écrans.
- **Contrôles automatiques** passés en local et en CI : 122 tests unitaires du paquet de collecte, 34 du worker (prompts, caviardage, contrôles des réponses), 104 tests d'intégration de l'API, 78 du worker et 15 de la base sur PostgreSQL 18, 8 tests de bout en bout sur le serveur de test puis sur la pile en conteneurs, règles Semgrep du projet, gitleaks, `pnpm audit`, zizmor, `pnpm check:compose`.
- **Notation par Claude** : uniquement sur un transport simulé, avec des offres et un profil fictifs ; aucun appel réel, aucune clé. Les requêtes simulées sont relues : profil sans identité, annonces sans coordonnées, données entre balises, partie fixe en cache, aucun outil.
- **Vérification visuelle** sur la pile en conteneurs : fiche avec analyse détaillée, « Ma note », accueil, Paramètres > IA, sur ordinateur et téléphone, sans violation d'accessibilité (axe).

## Constats

| # | Constat | Gravité | Statut |
| --- | --- | --- | --- |
| 1 | Les motifs du caviardage (e-mail, téléphone, lien) coûtent le carré de la longueur d'un texte sans espace : un texte collé de 20 000 caractères pathologiques prendrait environ une seconde, et ce caviardage tournait à chaque notation sans IA. | faible (disponibilité) | corrigé au lot 7 : texte borné à 10 000 caractères avant caviardage (le plus long prompt en lit 5 000 au plus) ; caviardage calculé seulement quand Claude lit l'offre |
| 2 | Les mesures du jeu de référence gardaient sans limite les intitulés des offres aux plus grands écarts. | faible (minimisation) | corrigé au lot 7 : purgées avec les journaux de passage, après un an |
| 3 | Une annonce piégée peut gonfler sa propre note : le lot suspect ne repère qu'une manipulation de tout un lot. | moyenne en phase 5 | accepté en phase 3 (aucun envoi, raison affichée) ; **la phase 5 ne devra jamais envoyer sur la seule foi d'un score de Claude** (par exemple : confiance normale et score sans IA cohérent exigés) |
| 4 | Une durée d'expérience en cours, recalculée chaque mois, aurait rendu tous les scores de Claude obsolètes chaque mois. | faible (coût) | corrigé au lot 5 : la version porte sur les dates enregistrées, pas sur les durées |
| 5 | Une erreur pendant la notation par Claude aurait fait rejouer la file par pg-boss, et payer deux fois les mêmes appels. | faible (coût) | corrigé au lot 5 : files de la notation et de la mesure sans nouvel essai, délai dans la configuration |
| 6 | Un passage de test aurait déclenché une notation payante. | faible (coût) | corrigé au lot 5 : la notation suit les passages planifiés ou manuels seulement |
| 7 | Les plafonds de l'IA ne sont pas atomiques : notation, mots-clés et structuration d'un CV peuvent passer le contrôle en même temps. | faible (coût) | accepté (risque de la phase 1, étendu) : écart borné au pire cas de quelques appels |
| 8 | Quand Claude note, jusqu'à cinq offres notées partent avec la note et le mot d'explication de Mehdi (étalon de sévérité). | faible (confidentialité) | accepté, documenté (ADR 0018, guide d'installation) ; rien ne part tant que la notation est coupée |
| 9 | Une offre notée n'est jamais purgée, contrairement à la règle des 90 jours (ADR 0015). | faible (minimisation) | accepté, à valider par Mehdi : sans cela, le jeu de référence s'effriterait ; retirer la note rend l'offre à la règle commune |

## Points vérifiés sans constat

- **Appartenance** : `user_id` et RLS sur `offer`, `offer_score`, `offer_rating` et `scoring_benchmark` ; seule une offre du compte se note ou se sépare ; une mesure ne se lit que par son compte ; localités et jeu de données communs, en lecture seule pour l'application.
- **Ce qui part chez Anthropic** : profil lu dans des tables à part, jamais dans `profile_identity` ; ni ville de base, ni employeurs ou lieux des expériences ; annonces caviardées puis coupées ; tout ce qui vient d'un tiers ou de Mehdi est entre balises, chevrons neutralisés.
- **Sorties de Claude** : schéma strict, identifiants vérifiés, scores bornés, listes et textes coupés aux longueurs de la configuration ; le score détaillé est calculé par Job4me à partir des sous-scores et des poids de la grille, jamais repris de Claude.
- **Affichage** : raisons, points forts, écarts, éléments bloquants et mots-clés rendus comme du texte par React, jamais comme HTML.
- **Journaux** : nombres seulement pour la notation, la mesure et l'alerte ; journal des appels sans contenu ; notification sans contenu d'offre (un nombre).
- **Coûts** : coupée par défaut, plafonds avant chaque appel, plafonds d'offres par passage, mesure de Claude seulement sur demande, dépense par usage à l'écran.
- **Fusion** : règles étroites, séparation réversible depuis la fiche, une parution rangée ne bouge plus.
- **Géographie** : fichier GeoNames vérifié par son empreinte à chaque migration, régénérable, attribution affichée.
- **Configuration** : poids, pénalités, seuils, plafonds, tailles de lots et fenêtres dans `config/default.yaml`, jamais dans le code.

## Reste à faire

1. **Sur la machine de la maison** : suivre le [guide de démonstration](../guide/demonstration-phase-3.md) : une semaine d'offres relue, 30 offres notées, `pnpm stack:cli scoring:benchmark`, distances vérifiées.
2. **Décisions de Mehdi** : les précisions marquées « à valider » des ADR 0016 à 0019 (dont les constats 8 et 9), et l'activation éventuelle de la notation par Claude au vu de la mesure.
3. **Phase 5** : le moteur de règles ne devra jamais envoyer sur la seule foi d'un score de Claude (constat 3).
4. **LinkedIn « invité »** (phase 2, lot 4) attend toujours le sondage depuis la maison (`pnpm probe:linkedin`).
