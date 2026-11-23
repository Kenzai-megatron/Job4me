# Revue de sécurité de la phase 1

Revue du 23/11/2026, par Claude, sur les lots 1 à 6 (profil, écrans, imports et extraction isolée, IA, relecture et LinkedIn, sauvegardes). Référence : [modèle de menaces](threat-model.md), lignes 20 à 30 ajoutées pendant la phase.

## Méthode

- **Lecture du code** : RLS et filtres `user_id` des 22 nouvelles tables, téléversement, détection du type réel, lecteurs de documents, conteneur `extract` et rôle `job4me_extractor`, client Claude (requête, plafonds, journal), caviardage, structuration, relecture et écriture au profil, archive LinkedIn, purge, sauvegardes et restauration.
- **Contrôles automatiques** passés en local et en CI : 106 tests d'intégration sur PostgreSQL 18, tests unitaires (lecteurs, caviardage, coûts, LinkedIn, rétention), 7 tests de bout en bout sur l'API puis sur la pile en conteneurs, règles Semgrep du projet, gitleaks, `pnpm audit`, actionlint, zizmor, `pnpm check:compose`.
- **Vérifications à l'exécution** : isolement du conteneur `extract` (réseau, système de fichiers, secrets, capacités) ; sauvegarde puis restauration dans une base jetable ; manifeste falsifié et copie altérée.
- Aucun appel réel à l'API Claude : un transport simulé remplace le réseau dans tous les tests.

## Constats

| # | Constat | Gravité | Statut |
| --- | --- | --- | --- |
| 1 | Le lockfile, résolu sous l'ancienne règle des 3 jours, gardait 67 paquets publiés depuis moins de 7 jours ; tout ajout de dépendance échouait. | moyenne (chaîne d'approvisionnement) | corrigé au lot 3 : résolution neuve sous la règle des 7 jours, aucun paquet verrouillé de moins de 7 jours, contournement refusé |
| 2 | pdf.js installe par défaut un module natif de dessin (`@napi-rs/canvas`) dont la lecture de texte n'a pas besoin. | faible (surface d'attaque) | corrigé au lot 3 : `ignoredOptionalDependencies` |
| 3 | Le contexte de construction Docker aurait embarqué `var/`, donc les fichiers importés (chiffrés), dans le cache de construction. | moyenne | corrigé au lot 3 : `var` dans `.dockerignore` |
| 4 | Le volume Docker `files` appartenait à l'utilisateur de l'image, pas à `JOB4ME_UID` : écriture impossible en CI. | faible (disponibilité) | corrigé au lot 3 : dossier de la machine monté, propriété de l'utilisateur |
| 5 | Le fil de lecture des PDF manquait de mémoire en CI à 128 Mo ; la cause n'était pas journalisée. | faible (disponibilité) | corrigé au lot 3 : tests au budget de la configuration (256 Mo), cause journalisée sans contenu |
| 6 | La limite de mot `\b` de JavaScript ignore les lettres accentuées : le caviardage prenait « né » dans « néerlandais ». | faible (qualité du caviardage) | corrigé au lot 4 : limites de mot Unicode, tests sur des textes accentués |
| 7 | `messages.parse()` du SDK lève une erreur sans l'usage quand la sortie ne colle pas au schéma : le coût de l'appel n'aurait pas été journalisé. | moyenne (plafonds) | corrigé au lot 4 : `create` avec le schéma JSON et validation Zod par Job4me |
| 8 | Après une relecture, les formulaires du profil montraient encore les anciennes valeurs (cache). | faible | corrigé au lot 5 : données relues à l'arrivée sur la page |
| 9 | La demande de mots-clés envoyait aussi les intitulés des expériences, au-delà de ce que le plan validé prévoit. | faible (minimisation) | corrigé au lot 7 : métiers cibles, compétences, secteurs et langues seulement, test ajouté |
| 10 | Le contrôle des plafonds n'est pas atomique : deux appels simultanés du même compte pourraient chacun passer le contrôle. | faible | accepté : une seule boucle de structuration et une seule demande de mots-clés à la fois ; dépassement borné au pire cas d'un appel |
| 11 | Les vues `import_run_ready` et `import_run_done` montrent au rôle applicatif les identifiants d'imports et de comptes, tous comptes confondus. | faible | accepté : aucun contenu, nécessaire pour trouver le travail avant de connaître le compte |
| 12 | Un extracteur compromis pourrait marquer en échec un import en attente, ou écrire un faux texte extrait (il détient la clé d'import). | faible | accepté (ADR 0010) : tout passe ensuite par la relecture de Mehdi |
| 13 | Un nom de tiers cité hors de la rubrique « Références » peut passer le caviardage. | faible | accepté (ADR 0009) |
| 14 | Les fichiers importés restent chiffrés sans limite de durée : aucun écran ne supprime un import. | faible (minimisation) | à faire en phase 2 : suppression d'un import et de son fichier |
| 15 | Par défaut, les sauvegardes restent sur le disque de la machine (`var/backups/`). | moyenne (disponibilité) | documenté : copie à faire ailleurs (guide, section 8) ; à vérifier sur la machine de la maison |
| 16 | La correspondance LinkedIn suit le format d'export connu, pas encore une vraie archive. | faible | à vérifier avec l'archive de Mehdi |
| 17 | Constat 13 de la phase 0 (paquets Debian de l'image de base) ; l'image passe à 515 Mo avec pdf.js et mammoth. | moyenne (surface de l'image) | suivi : rapport hebdomadaire, image distroless à évaluer en phase 2 |

## Points vérifiés sans constat

- **Appartenance** : chaque table de la phase 1 a sa politique RLS (`app.user_id`) et chaque requête son filtre `user_id` ; deux comptes ne se voient jamais (profil, imports, propositions, journal de l'IA, historique LinkedIn), même sans filtre dans la requête.
- **Téléversement** : type lu dans le contenu, 5 Mo au plus, une seule pièce, documents à macros, archives chiffrées et bombes ZIP refusés ; fichier chiffré sous la clé d'import, lié à sa ligne, sous un nom aléatoire, jamais servi ; CSRF et limite de débit.
- **Extraction** : conteneur sans Internet, en lecture seule, sans capacité, avec ses deux secrets seulement ; rôle limité à quelques colonnes et aux statuts d'extraction ; fil de lecture borné en mémoire et en durée, réponse validée.
- **IA** : clé remise au seul worker ; aucune valeur d'identité dans les requêtes simulées ; données entre balises, aucun outil, sortie au schéma puis Zod ; propositions sans extrait du CV écartées ; plafonds vérifiés avant l'envoi ; journal sans contenu, non modifiable par l'application ; clés masquées dans les journaux.
- **Relecture** : rien n'entre au profil sans décision ; une décision par proposition ; validation des rubriques ; journal d'audit ; propositions chiffrées en base ; purge après le délai de la configuration.
- **Sauvegardes** : chiffrées pour une clé publique, empreintes contrôlées, restauration testée table par table en CI.
- **Secrets** : aucun secret dans le dépôt (gitleaks), nouveaux secrets en fichiers `0600` créés par `pnpm setup:*`, clé d'API vide hors de la machine de la maison.

## Reste à vérifier sur la machine de la maison

1. Mettre à jour (`git pull`, `pnpm install`, `pnpm setup:home`, `pnpm stack:up`) puis suivre le [guide de démonstration](../guide/demonstration-phase-1.md).
2. Importer le vrai CV et la vraie archive LinkedIn ; signaler tout écart de format (constat 16).
3. Poser la clé d'API Claude avec un plafond mensuel dans la console d'Anthropic ; une structuration réelle d'un CV coûte moins d'un centime.
4. Mettre en place les sauvegardes, leur copie hors de la machine et le test de restauration mensuel (constat 15).
5. Points restés ouverts depuis la phase 0 : chiffrement du disque (LUKS), passkey Face ID et notifications sur l'iPhone.
