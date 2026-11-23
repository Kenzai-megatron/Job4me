# Sources : notes techniques pour la collecte

Version du 19/11/2026, à déposer dans le dépôt sous `docs/SOURCES.md`.

Ces notes reprennent celles d'un ami de Mehdi, dont la veille d'offres d'emploi tourne deux fois par semaine depuis septembre 2026 (Python, SQLite et un LLM pour la notation). Elles sont adaptées à Job4me : TypeScript, PostgreSQL et un score sur 100. Tout a été mesuré sur les vrais sites ; adresses, champs et sélecteurs valent au 19/11/2026.

Les sites changent sans prévenir : rien qu'en octobre 2026, Actiris a changé d'API, EU Careers a refait son site, Talent.com a changé le gabarit de ses cartes et talent.brussels s'est mis à servir ses pages en mode débogage. Chaque source se resonde donc par une vraie requête avant d'écrire son connecteur : les sélecteurs et adresses ci-dessous sont un point de départ, pas une garantie.

## 0. Règles de collecte

- **Cadence de particulier** : deux passages par semaine pour les pages publiques et LinkedIn, depuis la connexion du domicile ; un passage par jour au plus pour les API et l'open data (Hypothèse).
- **Pauses** : 0,3 s entre deux requêtes d'une API open data, jusqu'à 3 s entre deux requêtes d'un même site, 20 s pour LinkedIn.
- **Arrêt net au premier 403 ou 429**, pour toute la source et pour ce passage, sans jamais insister. Pour LinkedIn, aucun nouvel appel dans les 24 heures.
- **Jamais de contournement des protections anti-robots** (Cloudflare, DataDome, captcha) : un site qui refuse est laissé, ou atteint par une voie ouverte (open data, alertes e-mail, agrégateur, Google Jobs).
- **En-têtes ordinaires d'un navigateur** : `User-Agent`, `Accept`, `Accept-Language: fr-BE,fr;q=0.9,nl;q=0.8,en;q=0.7`.
- **Conditions d'utilisation** : les API publiques (open data du Forem, Adzuna, SerpApi, logiciels de recrutement) sont les voies propres ; la lecture de pages publiques est tolérée à petite dose ; LinkedIn interdit la collecte automatisée dans ses conditions, et Mehdi a choisi de l'inclure pour son usage personnel, à très faible volume.
- **Mode d'usage** : chaque connecteur déclare s'il est réservé à l'usage personnel. LinkedIn « invité » et toutes les pages publiques le sont : ils se coupent d'office si Job4me s'ouvre un jour à d'autres utilisateurs.
- **Secrets** : aucune clé dans le code, les journaux ou ces notes. Adzuna et SerpApi portent leur clé dans l'URL : la masquer dans tout journal (`api_key=…`, `app_key=…`). Les deux clés sont gratuites, à créer au nom de Mehdi.

## 1. Architecture de la collecte

### 1.1 Un format commun

Chaque connecteur rend une liste d'offres au même format :

```ts
type CollectedOffer = {
  externalId: string;       // identifiant chez la source
  title: string;
  company: string;          // "?" si inconnu, jamais inventé
  location: string;         // "?" si inconnu
  postedAt: string | null;  // AAAA-MM-JJ
  url: string;
  salary: string | null;
  description: string;      // 1 200 caractères au plus, parfois vide
  source: string;
  details: string | null;   // faits donnés par la source, affichés tels quels : "CDI · temps partiel"
};
```

- Les dates arrivent dans tous les formats (RFC 2822, ISO avec ou sans `Z`, « 19 sep. 2026 », « 24 septembre », « 06-09-2026 », « Posted 26 days ago ») : un seul normaliseur. Sans année : l'année courante, ou la précédente si la date tomberait dans le futur (une annonce du 28/12 lue le 03/01).
- Employeur ou lieu inconnu : `"?"`, jamais une valeur inventée.
- La clé de dédoublonnage se calcule après normalisation (§ 1.6).

### 1.2 Le contrat d'un connecteur

- Une fonction par source. Elle reçoit ce qu'il lui faut du profil (mots-clés, rayon, ville de base) et rend `{ offers, readCount }` : les offres déjà passées au pré-filtre de titre (§ 1.5), et le nombre d'annonces **lues** avant tout filtre.
- **Un budget de temps par source** (60 à 180 s) et un budget global (15 min pour l'ensemble des sources secondaires) : une source lente rend ce qu'elle a, elle ne retarde pas le reste.
- **Peu d'essais** : un seul par requête pour LinkedIn et pour les sources secondaires tenues par leur budget ; deux ou trois, avec une attente croissante, pour les API robustes.
- **Une panne totale lève une exception** (aucune requête réussie) ; une panne partielle (un mot-clé sur dix) rend ce qui a été lu.
- L'orchestrateur isole chaque source (une tâche pg-boss et un `try/catch` par source) : une source qui tombe n'arrête jamais les autres.
- Une source volontairement non interrogée (quota épuisé, interrupteur coupé, attente après un 429) se signale **« sautée »**, pas « 0 offre » : sinon la surveillance la croit morte.

### 1.3 Les mots-clés

- **Deux niveaux** : la liste complète (25 à 35 mots-clés) pour les sources généreuses (Actiris, StepStone, Forem, sites spécialisés) ; une dizaine de **prioritaires** pour les sources rationnées ou lentes (LinkedIn, Google Jobs, agrégateurs, cabinets).
- **Trois langues : français, néerlandais, anglais.** Autour de Bruxelles, Zaventem, Vilvorde, Machelen ou Malines publient en néerlandais : sans mots-clés néerlandais, ces offres n'arrivent jamais.
- Certaines API ne comprennent pas les accents (Adzuna) : les retirer pour elles.
- **La pertinence vient de la précision du mot-clé, pas du volume** (§ 4).
- Dans Job4me, l'IA propose les mots-clés à partir des métiers cibles du profil ; Mehdi les valide et les modifie.

### 1.4 Deux familles de sources

- **Par mots-clés** : la recherche du site fait le tri (Actiris, StepStone, LinkedIn, agrégateurs). Elles servent n'importe quel métier.
- **À liste fixe** : on lit tout ce que le site publie (emploi public, cabinets, sites de niche), et le pré-filtre de titre trie.

### 1.5 Le pré-filtre de titre

Trois listes d'expressions régulières, cherchées dans l'intitulé sans accents et sans tenir compte de la casse :

- **garde** : un titre qui en contient une peut passer ;
- **rejet** : un titre qui en contient une est écarté ;
- **toujours** : des marqueurs sûrs, plus forts que le rejet (« Employé administratif logistique » est un poste administratif, même si « logisti » est dans le rejet).

Indispensable pour les recherches en OU sur les mots (Actiris, StepStone : « technicien électroménager » ramène tous les techniciens) et pour les sources à liste fixe. Inutile, voire nuisible, sur une source déjà précise.

**La règle la plus importante : un filtre placé avant la notation se mesure contre ce que la notation a déjà approuvé.** Une offre qu'il écarte n'est vue par personne : l'erreur n'est pas symétrique. Chez l'ami, une première version écrite d'intuition (exiger des expressions de deux mots) rejetait 34 % des offres déjà notées 6 sur 10 ou plus, dont une à 9 sur 10. La version mesurée garde 98 % des offres notées 6 ou plus (96 % des 8 ou plus) en ne laissant passer que 45 % des titres. Large à l'inclusion, net au rejet. Dans Job4me, la CI rejoue le filtre sur les offres déjà notées (`docs/SPEC.md`, section 5).

Pièges de sous-chaîne rencontrés : « laborat » dans « collaborateur », « pneu » dans « elektropneumatica », « camion » dans « camionnette », « huishoud » dans « huishoudelijke dienst » (aide ménagère). « Technicien de surface » désigne le nettoyage ; « Field Engineer » ou « Service Engineer » désigne un technicien en Belgique (pour un technicien, rejeter « ingénieur », jamais « engineer »).

### 1.6 Le dédoublonnage

La même annonce circule sur plusieurs sites, sous des URL différentes : on ne hache pas l'URL.

**Clé de contenu** = `sha1(titre normalisé + "|" + employeur normalisé)`, tronquée à 16 caractères :

- titre : sans accents, en minuscules ; nom de l'employeur retiré quand il préfixe le titre (« AG Insurance - Business Process Analyst - Brussels ») ; mentions de genre retirées (`(m/f/x)`, `H/F/X`, `m/v/x`, `M/W/D`, y compris leurs restes mal tapés) ; références internes (`Job ID`, `ref`, `vacature` suivi d'un code) ; villes (bruxelles, brussels, brussel, belgium…) ; mentions de contrat (cdi, cdd, freelance, full-time, part-time, temps plein) ; ponctuation ;
- employeur : sans accents, sans formes juridiques (srl, sprl, bv, bvba, nv, sa, group, groupe, belgium, belgique), sans ponctuation.

**Fusion des republications que la clé rate.** À intitulé « nu » identique (normalisé, sans employeur ni chiffres), trois règles volontairement étroites :

1. une **référence interne commune** dans l'intitulé (4 chiffres ou plus, préfixe de lettres facultatif, en excluant les millésimes 19xx et 20xx et les montants comme « 4700 EUR ») ;
2. **l'un des deux sans employeur** : garder celui qui le nomme ;
3. **le même employeur à une extension de nom près**, comparé par mots et jamais par caractères (« Wibit Consulting & Services » et « … (WibitCS) » ; « Client of Manpower » et « Manpower » ; mais « Adecco » n'absorbe pas « Adeccorp »).

Jamais fusionnées : deux offres qui nomment deux employeurs différents sans référence commune (« Business Analyst » chez Deloitte et chez BNP sont deux offres). De deux versions, garder celle qui nomme l'employeur, puis celle qui a la plus longue description.

**Contre l'historique**, une offre est déjà connue si : même clé ; même URL ; même intitulé nu et même référence interne (sur 3 semaines) ; ou même intitulé nu et même employeur à extension près, venant d'une autre source (sur 3 semaines). Les agrégateurs republient la même offre un autre jour avec l'employeur écrit autrement (« Sander » et « Sander Brussels » : 9 offres sur 19 de Jobrapido au premier essai).

Les agrégateurs mettent parfois **le site d'origine à la place de l'employeur** (« LinkedIn », « JOBAT », « Indeed », « StepStone ») : le remplacer par `"?"`, que la fusion sait traiter.

Ordre d'appel : une annonce trouvée par deux sources est gardée sous la première interrogée. Mettre en tête les sources les mieux renseignées (Actiris donne commune et code postal).

Dans Job4me : règles appliquées par `packages/collect/src/dedup.ts`, avec les précisions de l'ADR 0016 (notes du lot 1 de la phase 3).

### 1.7 La géographie

- Table des quelque 2 700 localités belges de **GeoNames** (fichier BE, licence CC BY 4.0), plus les grandes villes, chargée en base. Les communes ont **deux noms** (Malines et Mechelen, Gand et Gent, Louvain et Leuven) : une table qui n'en porte qu'un rate la moitié des annonces.
- **Repli par code postal** (les quatre chiffres belges sont attribués par zone), en écartant les nombres de 2020 à 2035, qui sont des millésimes.
- **Les noms de pays ou de région ne situent rien** : « Belgium », « Belgique », « Vlaanderen », « Wallonie ». Chez l'ami, le format de LinkedIn (« Gent, Flemish Region, Belgium ») était placé sur « belgium », donc à Bruxelles, à 0 km : 113 offres mal situées, dont 28 à plus de 40 km. Ignorer ces mots.
- Un même nom à deux endroits distants de plus de 15 km : ne pas deviner.
- Distance = vol d'oiseau × **1,25** (rapport moyen entre route et vol d'oiseau en Belgique), depuis la ville de base. Rayon par défaut : 40 km.
- **Un lieu inconnu est gardé** (affiché sans distance) : une offre réelle perdue coûte plus cher qu'une offre de trop. Un lieu qui nomme un autre pays (« Montrouge, France ») est hors rayon.
- Télétravail annoncé (dans le lieu, le titre ou la description) : gardé quelle que soit la distance, si Mehdi l'accepte.
- Les sources qui étiquettent les offres avec la ville **cherchée** (Jobijoba, Jobrapido) s'interrogent **sans ville** ; c'est le filtre de distance qui trie.

### 1.8 La suite de la chaîne et la notation

1. Collecte de toutes les sources, fusion des republications, employeurs exclus par Mehdi.
2. Filtre de distance.
3. Seulement les offres jamais vues.
4. **Notation par un LLM, par lots de 25 offres** (chez l'ami un modèle local ; dans Job4me Claude Haiku 5.5). Ce qui a marché :
   - une **sortie JSON contrainte par schéma** : exactement n éléments `{"id": int, "score": int, "raison": string}`, aucune omission sur 1 951 offres ;
   - un **barème explicite**, transposé sur 100 pour Job4me : 80 à 100 = postuler aujourd'hui, 60 à 79 = pertinent, 40 à 59 = faute de mieux, 0 à 39 = hors sujet ;
   - le profil, des consignes propres à la personne (ce qui est hors sujet pour elle ; ses cas limites : langue exigée, années d'expérience, distance) et quelques **offres déjà notées comme étalon** de sévérité ;
   - chaque offre présentée ainsi : `titre | employeur | lieu [distance]`, puis 500 caractères de description ;
   - **un prompt écrit avec ses accents** : rédigé en ASCII, le modèle répondait en ASCII, et une consigne « mets les accents » n'y changeait rien ; c'est l'exemple qui amorce le style ;
   - chaque lot isolé, un second essai par lot, et un **repli par mots-clés** si le LLM est indisponible : mieux vaut un tri grossier que rien ;
   - un **plafond d'offres notées par passage, à tour de rôle entre les sources** quand il mord : sinon la première source collectée prend toutes les places.
5. Les offres au-dessus du seuil sont proposées, triées par note ; le surplus attend le passage suivant.

Dans Job4me, cette notation rapide est suivie d'une analyse détaillée des offres de 70 ou plus (`docs/SPEC.md`, section 5). La table SQLite de l'ami correspond aux tables `job_offer`, `offer_score` et `source_run` du cahier des charges (`docs/SPEC.md`, section 10).

### 1.9 La surveillance

- **Une source qui rend 0 sans erreur est la panne la plus fréquente et la plus silencieuse.** Journaliser chaque source à chaque passage : `N lues, M inédites (K après le filtre de titre)`, et l'erreur en cas d'exception.
- Juger une source « muette » sur le nombre **lu** (`readCount`), pas sur ce qui passe le filtre : une petite source vivante dont rien ne passe le filtre du jour n'est pas morte.
- Surveiller **le volume des derniers passages**, pas seulement celui du jour : un tarissement progressif ne ressemble à aucune panne. Chez l'ami, un envoi est passé de 40 offres à 2 en quatre jours sans qu'aucun contrôle ne réagisse.
- Un mode **« tester les sources »** (un mot-clé, une page par source) vérifie qu'elles répondent avant d'accuser le reste. Dans Job4me, c'est un bouton de l'écran Sources et une commande en ligne.

## 2. Les sources, une par une

Toutes ont répondu au passage du 19/11/2026 chez l'ami, LinkedIn seulement en partie.

### 2.1 Services publics

#### Actiris : la meilleure source pour Bruxelles (API JSON du site, sans clé)

Environ 33 000 offres. Actiris **agrège aussi le VDAB et le Forem**, et publie des cabinets injoignables en direct (Robert Half, Randstad, Adecco, Michael Page, Austin Bright…). Il donne **commune et code postal**.

```http
POST https://www.actiris.brussels/api/Offer/GetAllOffers
Content-Type: application/json
Accept: application/json
Accept-Language: fr            (obligatoire : sans lui, 500 sur toutes les requêtes)
Referer: https://www.actiris.brussels/fr/citoyens/offres-demploi/

{"pageOption": {"page": 1, "from": 0, "pageSize": 100},
 "offreFilter": {"texte": "<mot-clé>", "keywordSearchType": "Titre", "localisation": "Tout"}}
```

- Réponse : `{"total": N, "offers": [...]}` (la liste s'appelait `items` avant le 10/10/2026).
- Champs utiles : `reference`, `titreFr` ou `titreNl` (l'un peut être nul : prendre l'un ou l'autre), `dateCreation`, `communeFr` ou `communeNl`, `codePostal`, `typeContrat` (CDI, CDD, INTERIM), `typeContratLibelle`, `regimeTravail` (`PT` = temps partiel ; `NO` ne garantit pas un temps plein), `numeroEntreprise`. **Depuis le 10/10/2026, pas de nom d'employeur dans la liste.**
- Lien vers l'offre : `https://www.actiris.brussels/fr/citoyens/offres-demploi/?keywords=<reference>`.
- Pas de description, pas de route de détail (404), page d'annonce rendue en JavaScript : la notation se fait sur l'intitulé.
- **N'envoyer que ces champs** : un champ en trop (`employerFilter: {}`, `references: []`, `regimesTravail: []`) rend 400.
- `keywordSearchType: "Titre"` est le levier de précision : 45 résultats contre 2 218 en `"Partout"` pour « contrôleur de gestion ».
- La recherche est un **OU sur les mots du titre** : 92 % de bruit mesuré sur un profil finance, d'où un **pré-filtre de titre indispensable** (sans lui, 1 385 offres d'un coup à noter).
- `pageSize: 1` donne le total à moindre coût, utile pour suivre le marché.
- Pagination réelle (pages 1 et 2 disjointes) ; s'arrêter à `total`. Trois pages de 100 suffisent.
- Écarter les annonces de plus de 60 jours (`dateCreation`) : le plus souvent pourvues.
- **Offres relayées du VDAB ou du Forem** : employeur de façade « OFFRE D'UNE AUTRE REGION » (`numeroEntreprise` = `1111111111`) et adresse d'Actiris (Saint-Josse, 1210) comme lieu. Employeur inconnu ; lieu repris de la fin de l'intitulé s'il y figure (« … - Tielt Winge »), sinon inconnu.
- Domaine : `actiris.brussels` (`actiris.be` répond 302). L'ancienne API (`/Umbraco/api/OffersApi/GetAllOffers`) répond 404 depuis le 10/10/2026 ; la nouvelle a été trouvée dans le JavaScript du site (`OfferService.getAllOffers`).
- Peu de stages d'étudiant : ses « stages » sont surtout des Stage FIRST (`STAGE SPEP`), un dispositif pour demandeurs d'emploi.
- **Sondé par Job4me le 23/11/2026** (puis lu par le connecteur : 100 offres sur 100 au format commun, toutes datées et situées) : tout ce qui précède se vérifie, sauf l'ordre, qui n'est pas strictement chronologique ; l'`Accept-Language` ordinaire d'un navigateur (`fr-BE,fr;q=0.9,…`) suffit, sans `Referer`. `dateCreation` arrive avec un décalage horaire et jusqu'à sept décimales (`2026-11-23T06:10:05.9362938+01:00`), `communeFr` peut être vide alors que `codePostal` est rempli, la liste porte un champ `employer` toujours nul. 321 résultats pour « comptable » en recherche par titre.

#### Forem : open data ODWB (API JSON, sans clé)

Environ 26 000 offres, mises à jour chaque jour, géolocalisées. Le Forem **ouvre deux sources fermées** : 39 % de ses offres viennent de Jobat, 10 % de References.

```http
GET https://www.odwb.be/api/explore/v2.1/catalog/datasets/offres-d-emploi-forem/records
    ?where=search("<mot-clé>") and within_distance(lieuxtravailgeo, geom'POINT(4.3517 50.8467)', 40km)
           and datedebutdiffusion >= date'AAAA-MM-JJ'
    &limit=100
    &select=numerooffreforem,titreoffre,nomemployeur,lieuxtravaillocalite,lieuxtravailcodepostal,
            datedebutdiffusion,url,typecontrat,regimetravail,langues,metier,niveauxetudes,
            experiencerequise,source
```

Paramètres à encoder dans l'URL ; `POINT(longitude latitude)`, longitude d'abord (ici le centre de Bruxelles : Job4me y met la ville de base du profil).

- Réponse : `results[]`, une offre par `numerooffreforem` ; `lieuxtravaillocalite` et `lieuxtravailcodepostal` sont des listes.
- Pas de description : en composer une à partir des champs, **les langues exigées** surtout, que la notation doit voir.
- L'employeur est souvent doublé (« L.I.P. Belgique - L.I.P. Belgique ») : garder une moitié.
- Piège : la recherche plein texte prend « .NET » pour « nettoyeur ».
- Données propriété du Forem : citer la source sur l'offre.
- **Sondé par Job4me le 23/11/2026** : 24 237 offres, mises à jour chaque nuit, licence **CC BY-SA 4.0** (attribution, partage dans les mêmes conditions). Les champs ci-dessus existent tous ; `lieuxtravaillocalite` peut aussi arriver en simple texte, `langues` et `niveauxetudes` à `null`. La recherche plein texte porte sur tous les champs, pas seulement l'intitulé (« comptable » ramène un « Polyvalent administratief bediende » dont le métier est comptable) : 158 offres à 40 km de Bruxelles sur 30 jours.
- **Limite de l'ODWB** : 10 000 appels par jour et par adresse pour un utilisateur anonyme. Depuis une adresse partagée (l'environnement de Claude, un centre de données), elle peut être déjà atteinte : 429, `"errorcode": 10005`, `reset_time` à minuit UTC. Depuis la connexion de la maison, une soixantaine d'appels par jour n'en approche pas.

#### VDAB : pages publiques (HTML)

L'API REST répond 403 partout. Les pages « jobs voor … », faites pour les moteurs de recherche, sont lisibles : 28 offres chacune, avec employeur, commune, date et début de description.

```http
GET https://www.vdab.be/vindeenjob/jobs/<page>          (ex. business-controller)
```

- Cartes `<div class="product-tile">` ; titre `<h2 class="product-title">` ; `<div class="location-job"><strong>employeur</strong> in <strong>commune</strong>` ; date dans `online-sinds` ; `<div class="product-description">` ; lien `https://www.vdab.be/vindeenjob/vacatures/<id>/…`.
- **Piège majeur : le VDAB rabat une adresse inconnue sur sa page la plus proche.** Vérifier chaque page à la main : `controleur-de-gestion` mène à « controleur » (ponts roulants), `financieel-analist` à « financieel » (8 782 offres), `management-accountant` à « account manager », `witgoedtechnicus` à « commercieel medewerker », `servicetechnieker` à « monteur », `hvac-technieker` à « calculator HVAC », `stage` à « hotel stage ». Une page inexistante rend 404.
- La page d'annonce est rendue en JavaScript.

#### BOSA, travaillerpour.be (emploi public fédéral, HTML)

`GET https://travaillerpour.be/fr/jobs?page=N` (N à partir de 0, environ 6 pages). Cartes `<article class="node node--type-job…">`, lien `/fr/jobs/…` avec l'intitulé dans un `<span>`, organisme dans `<div class="organization-wrapper">`. Pas de lieu dans la liste (inconnu). Tous métiers : pré-filtre de titre.

#### talent.brussels (emploi public régional, HTML)

`GET https://www.talent.brussels/fr/offres-d-emploi?page=N` (environ 4 pages). **Retirer les commentaires HTML avant de lire** : depuis le 30/10/2026, le site sert ses pages en mode débogage de Drupal (`<!-- THEME DEBUG -->` entre chaque balise). Cartes `<div class="info-job">`, lien `/fr/offres-d-emploi/…`, titre `field--name-title`, organisme `<p class="division">`.

#### EU Careers (EPSO) et eujobsalert : postes de l'Union européenne

- `GET https://eu-careers.europa.eu/jobs_en?page=N` (site refait mi-octobre 2026 ; les anciennes listes renvoient vers une page « Access denied »). Blocs `<div class="eujmp-vacancy-result">` : titre `eujmp-vacancy-result__title`, `__top-meta` (institution, date limite dans `<time datetime>`), `__bottom-meta` (type : Temporary staff, Contract staff, Seconded national experts ; grade ; lieu marqué `location-icon`). 90 à 130 postes sur environ 7 pages ; la dernière page se lit dans les liens de pagination. Garder agents temporaires et contractuels (un expert national détaché doit déjà être fonctionnaire).
- `GET https://eujobsalert.com/jobs/?location=brussels&page=N` : `<article>`, lien `/jobs/<slug>/`, titre en `h2` ou `h3`, institution, salaire.
- **Nationalité d'un État membre exigée** : le dire à la notation.

### 2.2 Généralistes

#### StepStone.be : le plus gros volume (HTML)

```http
GET https://www.stepstone.be/emplois/<mot-en-slug>/a-<ville-en-slug>?radius=40&page=N
```

- 25 offres par page ; total dans `data-resultlist-offers-total`.
- Cartes découpées sur `data-at="job-item"` ; lien `<a … data-at="job-item-title">` ; champs `data-at="job-item-company-name"`, `job-item-location`, `job-item-timeago`, `job-item-teaser`.
- Les champs sont des empilements de `<span>` avec des blocs `<style>` : s'arrêter au premier `</span>` rend une chaîne vide. Prendre la tranche jusqu'au `data-at` suivant, retirer les `<style>`, puis les balises.
- Repli : l'URL de l'annonce contient titre, ville, employeur et identifiant (`/offres-d-emploi--Business-Controller-Leuven-Dixon-Finance--2243315-inline.html`).
- La pagination rapporte (pages 2 et 3 : 47 offres absentes de la page 1 pour un seul mot-clé) ; la ville interrogée aussi (Wavre rendait 7 offres que « Bruxelles, 40 km » ne rendait pas).
- Recherche en OU sur les mots : beaucoup de bruit (3 à 5 % au-dessus du seuil sur un profil finance). Une offre retirée rend **410 Gone** : définitif.
- **Sondé par Job4me le 23/11/2026** : 200 derrière Akamai, sans cookie ; 25 cartes `article[data-at="job-item"]` dont l'`id` vaut `job-item-<numéro>` ; le texte des champs est dans des `<div>` imbriqués entre des blocs `<style>` ; ancienneté dans `data-at="job-item-timeago"` (« il y a 4 jours »), télétravail dans `job-item-work-from-home`, extrait dans `jobcard-content`. Le sélecteur `data-at="job-item"` apparaît aussi dans le CSS de la page : compter les `article`, pas les occurrences.

#### LinkedIn : l'API « invité » (HTML), la plus précise mais bridée

**Choix de Mehdi** : collecte incluse malgré les conditions d'utilisation de LinkedIn, qui interdisent la collecte automatisée. Usage personnel, très faible volume ; connecteur coupé d'office si Job4me s'ouvre à d'autres.

Sans compte ni cookie : c'est ce que charge la recherche publique d'offres quand on fait défiler la page.

```http
GET https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search
    ?keywords=<mot-clé>&location=Brussels%2C%20Belgium&start=<n>&f_TPR=r604800
```

- Réponse : des fragments HTML, une carte par `<li>` : titre `base-search-card__title` (`h3`), employeur `base-search-card__subtitle` (parfois dans un `<a>`), lieu `job-search-card__location`, date `datetime="AAAA-MM-JJ"`, lien `https://xx.linkedin.com/jobs/view/<slug-id>` (couper la chaîne de requête).
- `f_TPR=r604800` = publiées dans les 7 derniers jours (en secondes).
- **10 cartes par appel.** L'ami pagine par `start=0, 25, 50` (reste d'une époque à 25 cartes par page) : les rangs 11 à 25 et 36 à 50 ne sont jamais lus. Probablement mieux : `start=0, 10, 20`, à vérifier par deux appels (`start=0` puis `start=10`, même mot-clé).
- **Pas de description** : la notation se fait sur l'intitulé. C'est pourtant la source la plus précise mesurée (48,8 % au-dessus du seuil, contre 4,6 % pour StepStone, le 18/09/2026).
- `f_JT=I` et `f_E=1` (stage, débutant) sont **ignorés** par l'API invité (mêmes dix offres avec ou sans) : c'est le mot-clé qui trie.
- **Bridage (HTTP 429).** Au 3e appel rapproché le 17/09 ; 30 appels espacés de 20 s passaient sans 429 le 18/09 ; **depuis la mi-octobre 2026, 429 tôt dans deux passages sur trois**, parfois dès le premier appel, depuis la même connexion résidentielle, à deux passages par semaine. Règles :
  - 20 s entre deux appels, un seul essai par appel ;
  - **arrêt net au premier 429**, et aucun nouvel appel dans les 24 heures ;
  - peu de mots-clés : la dizaine de prioritaires ;
  - l'ordre **page par page** (la page 1 de chaque mot-clé, puis les pages 2) : un 429 ne coûte alors que des pages profondes, et pas les derniers mots-clés de la liste ;
  - une page d'annonce (`/jobs/view/…`) redemandée dans la même seconde rend aussi 429.
- Voies propres vers ses offres, en complément : ses **alertes e-mail** (§ 2.8) et Google Jobs, qui les reprend.

#### StudentJob.be : stages et jobs étudiants (HTML)

```http
GET https://www.studentjob.be/vacatures?search[keywords_scope]=<mot-clé>
```

Chaque carte est un `<a data-job-opening-id="…">` qui porte ses champs en attributs : `data-job-opening-title`, `data-job-opening-item-brand` (employeur), `data-job-opening-employment` (« Stage », « Afstudeerstage »…), `data-job-opening-topjob`. **Écarter les « Top Job »** (`="true"` : annonces payées, présentes sur toutes les recherches). Lieu dans le `<span>` qui suit `nyc-icon-location` ; « Landelijk », « partout » ou « national » = inconnu. Ni date ni description. Recherche large (« stage .net » ramène l'hôtellerie) : pré-filtre. La page `/stages` est inutilisable (1 396 annonces, surtout des livreurs).

#### Welcome to the Jungle : start-up et PME (Algolia, clé publique)

Application JavaScript adossée à Algolia ; le site sert lui-même sa clé de recherche **publique**, celle que reçoit tout navigateur :

```http
GET https://www.welcometothejungle.com/api/env
    → "PUBLIC_ALGOLIA_APPLICATION_ID": "…", "PUBLIC_ALGOLIA_API_KEY_CLIENT": "…"

POST https://<application_id en minuscules>-dsn.algolia.net/1/indexes/*/queries
X-Algolia-Application-Id: <…>
X-Algolia-API-Key: <…>
Content-Type: application/json
Origin: https://www.welcometothejungle.com
Referer: https://www.welcometothejungle.com/

{"requests": [{"indexName": "wttj_jobs_production_fr",
               "params": "query=<mot-clé>&hitsPerPage=50&filters=offices.country_code%3ABE"}]}
```

- Relire la clé à chaque passage : elle peut changer.
- Pour les stages : une seule requête, `query` vide, `filters=offices.country_code:BE AND contract_type:internship`, `hitsPerPage=200` : tous les stages publiés en Belgique (une trentaine).
- `results[0].hits[]` : `name`, `organization.name` et `.slug`, `offices[]` (`city`, `country`, `country_code`), `contract_type` (internship, apprenticeship, full_time, temporary, freelance, part_time, vie, graduate_program), `contract_duration_minimum` et `_maximum` (mois), `remote` (fulltime, partial, punctual), `summary`, `key_missions`, `published_at`, `slug`.
- Lien : `https://www.welcometothejungle.com/fr/companies/<organization.slug>/jobs/<slug>`.

### 2.3 Agrégateurs (ils reprennent LinkedIn, Indeed, les sites d'intérim…)

#### Jobijoba (HTML)

`GET https://www.jobijoba.be/emploi/offres-emploi-<mot-clé encodé>.html?page=N` (encodage de formulaire, espaces en `+`, 2 pages). **Sans ville.** Blocs découpés sur `class="offer-header"` : titre `offer-header-title` (`h3`), lien `a.permalink-link`, lieu après `icon-map-marker`, employeur après `icon-apartment`, `publication_date`, `span.description`. Excellent rendement récent (§ 4).

**Sondé par Job4me le 23/11/2026** : le mot-clé est servi avec une majuscule (301 de `comptable` vers `Comptable`) ; 30 blocs `div.offer[data-id="ad_<empreinte>"]` par page (1 079 offres pour « Comptable ») ; les annonces sponsorisées n'ont pas de `permalink-link`, seulement un lien chiffré en ROT13 dans `data-atc`, que Job4me ne décode pas.

#### Talent.com (HTML)

`GET https://be.talent.com/jobs?k=<mot-clé>&l=Bruxelles&p=N`. La carte est **l'`<article>` qui suit un élément `data-job-id="…"`** (12 caractères), quel que soit son attribut (gabarit changé le 21/10/2026). Classes à suffixe haché : chercher les préfixes `JobCard_title`, `JobCard_company`, `JobCard_location`. Lien : `https://be.talent.com/view?id=<id>` (redirige vers l'annonce). Donne le vrai lieu. Reprend surtout LinkedIn (12 de ses 20 premières offres déjà connues).

**Sondé par Job4me le 23/11/2026** : l'`<article>` est maintenant **dans** l'élément `data-job-id`, qui porte aussi `data-new-id` (18 chiffres) : c'est lui que prend le lien `view?id=`. 16 cartes par page, page servie en néerlandais malgré l'`Accept-Language` ; la date fiable est l'attribut `dateTime` de `<time>`. Beaucoup d'annonces anciennes (jusqu'à mai 2025) : l'âge maximal en garde 10 sur 16.

#### Jobrapido (HTML)

`GET https://be.jobrapido.com/?w=<mot-clé>&p=N`, **sans `l=`** (sinon chaque offre porte la ville cherchée). Blocs `class="result-item js-result-item` ; titre `<h3 class="result-item__title…">` (le mot cherché y est en `<strong>` : ne pas s'arrêter à la première balise fermante) ; `result-item__company-label`, `result-item__location-label` ; lien `https://open.app.jobrapido.com/…` (couper la chaîne de requête). Il écrit parfois l'intitulé deux fois (« Office Assistant Office Assistant ») : garder une moitié.

**Sondé par Job4me le 23/11/2026** : chaque résultat porte ses données en JSON dans `data-advert` (`advertId`, `title` avec ses `<strong>`, `company`, `location`, `date` en « 16 nov » ou « 15 okt », `openAdvertUrl`, `salary`) : plus sûr que les classes. Le lien est devenu `https://be.jobrapido.com/jobpreview/<advertId>?redirectTo=…`. 8 résultats par page seulement.

#### Adzuna : l'API (clé gratuite sur developer.adzuna.com)

```http
GET https://api.adzuna.com/v1/api/jobs/be/search/<page>?app_id=…&app_key=…&what=<mot SANS accents>
    &where=Bruxelles&distance=45&results_per_page=50&max_days_old=60&content-type=application/json
```

- `where=Brussels` rend 0 : seuls « Bruxelles » et « Brussel » sont reconnus. Les accents ne sont pas compris (« stage développeur » rend 0, « stage developpeur » rend 1). `max_days_old=30` divisait le résultat par deux.
- `results[]` : `title`, `company.display_name`, `location.display_name`, `redirect_url`, `created`, `salary_min` et `salary_max`, `description` ; `count` = total (ne demander la page 2 que si `count` dépasse 50).
- Rend parfois beaucoup moins sans le dire.
- Le **site** (`https://www.adzuna.be/search?q=…&w=Bruxelles`) marche aussi, mais derrière CloudFront : fragile. Préférer l'API.
- Conditions : mention « Jobs by Adzuna » sur chaque offre affichée ; usage personnel permis ; licence obligatoire pour un usage commercial.

#### Google Jobs, par SerpApi (clé, quota)

```http
GET https://serpapi.com/search.json?engine=google_jobs&q=<mot-clé>&location=Brussels, Belgium&hl=fr&gl=be&api_key=…
```

- `jobs_results[]` : `title`, `company_name`, `location`, `apply_options[0].link` (sinon `share_link`), `detected_extensions.posted_at`, `description`, `via`.
- Plan gratuit : **250 recherches par mois**. `GET https://serpapi.com/account.json?api_key=…` donne `plan_searches_left` et `plan_renewal_date` **sans consommer de recherche** : vérifier avant chaque passage, garder une réserve.
- Google agrège Indeed, Jobat, LinkedIn et les sites des employeurs : **la porte propre vers les sites fermés**, et l'une des sources les plus précises (§ 4).

### 2.4 Sites spécialisés d'un métier (exemple : la finance)

- **eFinancialCareers** (API JSON, sans clé, **description complète**) : `GET https://job-search-ui.efinancialcareers.com/v3/efc/jobs/search?q=<mot-clé>&location=Brussels, Belgium&page=1&pageSize=50&currencyCode=EUR&culture=fr&radius=40&radiusUnit=km&includeRemote=true&includeUnspecifiedSalary=true`, avec `Accept: application/json`, `Origin: https://www.efinancialcareers.be` et `Referer: https://www.efinancialcareers.be/`. Réponse : `body.data[]` (ou `data[]`) : `title`, `companyName` ou `clientBrandName`, `jobLocation.displayName`, `detailsPageUrl` (relatif : préfixer `https://www.efinancialcareers.be`), `postedDate`, `salary`, `description`. Trouvée dans le `<script id="ng-state">` de la page, où Angular précharge la réponse de sa propre API, URL comprise. Faible pertinence mesurée malgré la description (1,5 à 4 %).
- **financejobs.be** : `GET https://financejobs.be/vacatures?what=<mot-clé>&amount=50&per_page=100` ; `<article class="job-item-row…">`, `job-item-title`, employeur après « door », lieu `<li class="bold">`, « Geplaatst op JJ-MM-AAAA ». Son filtre de lieu ne marche pas : chercher sur toute la Belgique et filtrer la distance. Pannes Cloudflare (522, 503) par moments.
- **finance-vacatures.be** et **financejobsbelgium.be** : même thème WordPress (« pxp »), `/finance-jobs/page/N/` et `/finance-vacatures/page/N/` ; liens `a.pxp-jobs-card-N-title` (`/job/…`), `pxp-jobs-card-N-location`, `pxp-jobs-card-N-company`.

Pour un autre métier, chercher les sites spécialisés équivalents, et les mesurer avant de les garder.

### 2.5 Cabinets de recrutement

- **Robert Half** : `GET https://www.roberthalf.com/be/fr/emplois/belgium/<page-métier>` (ex. `controleur-de-gestion`). 25 offres complètes, salaire compris, dans `initialResults = JSON.parse('…');`. C'est un littéral de chaîne JavaScript (`\x22`, `\/`…) : le décoder **sans jamais l'évaluer**, par exemple en remplaçant les `\xNN` par `\u00NN` puis en appliquant deux `JSON.parse`, à vérifier sur un vrai exemple. On obtient `data.jobs[]` : `jobtitle`, `city`, `postalcode`, `date_posted`, `payrate_max`, `payrate_period`, `job_detail_url`, `description`.
- **Michael Page** : `GET https://www.michaelpage.be/jobs/finance?page=N` ; `<div about="/job-detail/…" class="job-tile…">`, titre `<h3><a>`, `job-location`, `job_advert__job-summary-text`.
- **Hays** : le site principal est en JavaScript, le **site mobile** est servi : `GET https://m.hays.be/search/?q=<mot-clé>&location=&sortType=2&jobType=-1`. Il répond **301 avec la page entière dans le corps** : accepter ce corps (plus de 20 Ko). Blocs `class="job-container"`, lien `id="gtm_job_redirecttodetail"` avec l'intitulé dans l'attribut `textcontent`, `class="location"`, `class="salary…"`.
- **Morgan Philips** : `GET https://jobs2.morganphilips.com/fr-be/?page=N` ; `<div class="row jobTitle…">`, `<h2> <a href="/fr-be/…">`, lieu parmi les `<span>` de `row jobInfo`.
- **Profile Group** : `GET https://www.profilegroupjobs.com/en/index.aspx`, puis `<script id="__NEXT_DATA__">` et `props.pageProps.request.pageData.result[]` : `jobTitle`, `customerName`, `location`, `url`, `publishedDate`, `shortDescription`.
- Randstad, Adecco, Accent, Start People, Unique, Robert Walters… : pas de lecture directe trouvée, mais **ils passent par Actiris** (et StepStone).

### 2.6 Pages carrière des employeurs (API publiques des logiciels de recrutement)

Un connecteur par logiciel, mais **un identifiant par employeur**, qui figure dans l'adresse de sa page carrière. Ces logiciels sont mondiaux : ne garder que ce qui est **en Belgique**, par un test positif sur le lieu (sinon « Bangalore, India » passerait comme lieu inconnu).

- **Workday** : `POST https://<tenant>.wd<N>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs`, `Content-Type: application/json` (sans lui : 500), corps `{"appliedFacets": {}, "limit": 20, "offset": 0, "searchText": "<mot>"}`, réponse `jobPostings[]` : `title`, `locationsText`, `externalPath` (lien : `https://<tenant>.wd<N>.myworkdayjobs.com/<site><externalPath>`), `postedOn`. **422 = tenant inconnu, 404 = mauvais nom de site.** Vérifiés avec des offres belges le 25/09/2026 : `swift` wd3 `Join-Swift`, `pwc` wd3 `Global_Experienced_Careers`, `gsk` wd5 `GSKCareers`, `mastercard` wd1 `CorporateCareers`, `jj` wd5 `JJ`.
- **Greenhouse** : `GET https://boards-api.greenhouse.io/v1/boards/<slug>/jobs`, réponse `jobs[]` : `title`, `location.name`, `absolute_url`, `updated_at` (ex. collibra, lighthouse, showpad).
- **Lever** : `GET https://api.lever.co/v0/postings/<slug>?mode=json`, réponse : `text`, `categories.location`, `hostedUrl`, `createdAt` (millisecondes), `descriptionPlain` (ex. deliverect).

### 2.7 Sites de niche du métier

Pour un métier précis, chercher son réseau professionnel : c'est souvent le seul endroit où ces postes se publient ensemble. Exemple : **VVBAD** (bibliothèques, archives, documentation en Flandre) : `GET https://www.vvbad.be/vacatures?page=N`, cartes `<a class="card-teaser…" href="/vacatures/…" data-created="<horodatage unix>">`, titre `card-teaser__title`, description « employeur • régime • durée », date limite « Solliciteren voor: AAAA-MM-JJ ». Écarter les offres closes : la liste les garde.

### 2.8 Alertes e-mail : la voie propre vers les sites fermés

Indeed, Jobat, Glassdoor, Monster et LinkedIn envoient des alertes par e-mail. Dans Job4me :

- Mehdi s'abonne avec un **alias dédié** de sa boîte Gmail (son adresse suivie de `+offres`) ;
- Job4me lit uniquement ces mails par l'API Gmail (scope `gmail.readonly`, requête limitée à l'alias et aux expéditeurs connus) : **rien n'est marqué lu ni déplacé** ;
- dans chaque alerte, il prend les liens qui pointent vers une offre du site expéditeur (`linkedin.com/(comm/)?jobs/view`, `indeed.com`, `jobat.be`, `stepstone.be`, `glassdoor.`, `monster.`), le texte du lien servant d'intitulé ; il écarte « voir », « postuler », « se désinscrire », « gérer »… et les textes de moins de 6 ou de plus de 140 caractères ;
- le lieu est celui de l'alerte, déjà limitée par le site.

Chez l'ami, ce connecteur, en IMAP et en lecture seule, n'a jamais été éprouvé sur de vraies alertes : affiner la lecture au premier exemplaire reçu de chaque site.

## 3. Ce qui ne marche pas (ne pas y perdre de temps)

Sondage de 52 sites les 17 et 18/09/2026, complété les 25 et 26/09 :

- **403 Cloudflare ou DataDome** : Jobat (et Vacature.com, qui y redirige), Indeed (flux RSS en 404), Monster (redirige vers monster.com), Glassdoor, le site de Jooble. **Ne pas forcer** : passer par l'open data du Forem (Jobat, References), les alertes e-mail ou Google Jobs.
- **API fermées** : l'ancienne API Careerjet répond 401 « legacy », la v4 exige un compte partenaire (refusé) ; la clé Jooble obtenue servait le Jooble américain ; les sites de Careerjet et d'Optioncarrière servent une page anti-robot.
- **Rendu en JavaScript** (rien dans le HTML, pas d'API trouvée) : Werken voor Vlaanderen, Mercuri Urval, Hudson, USG, Talentus, brusselsjobs, ictjob.be (résultats en AJAX), Synergie, Adecco.
- **Autres** : References.be (certificat invalide, mais il passe par le Forem), Arbeitnow (aucune offre belge), TheMuse (ignore le lieu), l'API REST du VDAB (403 : passer par ses pages publiques ou par Actiris). EuroBrussels fonctionne mais ne publie que des postes d'affaires européennes (policy, public affairs) : 0 offre pertinente sur 40 pour un profil finance.

## 4. Ce que les mesures ont appris

**Le volume ne dit rien de la pertinence.** Part des offres au-dessus du seuil de notation, sur 1 085 offres notées (profil finance, 18/09/2026) : LinkedIn 48,8 %, StepStone 4,6 % (sur 654 offres), eFinancialCareers 4,2 %, EuroBrussels 0 %. 62 % de tout le collecté notait 0 ou 1 sur 10.

Sur le dernier mois (19/10 au 19/11/2026, même profil ; une offre vue par plusieurs sources compte pour la première interrogée) :

| Source | Offres nouvelles notées | Au-dessus du seuil |
| --- | --- | --- |
| Google Jobs | 61 | 77 % |
| Jobijoba | 201 | 70 % |
| VDAB | 65 | 51 % |
| Jobrapido | 149 | 38 % |
| LinkedIn | 238 | 37 % |
| Adzuna (API) | 33 | 21 % |
| Forem | 18 | 17 % |
| Talent.com | 222 | 7 % |
| Actiris | 205 | 6 % |
| StepStone | 397 | 3 % |
| eFinancialCareers | 199 | 1,5 % |

Pour une recherche de stage en développement, LinkedIn faisait à lui seul la moitié des offres envoyées. **Les chiffres dépendent du profil** : Job4me mesure la pertinence source par source après quelques passages (écran Sources), et Mehdi retire ce qui ne rapporte rien.

- **La pertinence vient de la précision du mot-clé interrogé**, pas du volume ni de la longueur de la description (LinkedIn n'en donne aucune).
- **Épuiser les sources qu'on a avant d'en chercher d'autres** : 34 sites sondés en vain ; paginer LinkedIn et StepStone et passer de 12 à 28 mots-clés a rapporté 289 offres inédites d'un coup.
- Pour des **stages** : Actiris et le Forem n'en ont presque pas pour des étudiants ; StudentJob, Welcome to the Jungle, LinkedIn, StepStone, Adzuna et Jobrapido en ont. Un pré-filtre « l'intitulé annonce un stage » (stage, stagiair(e), intern(ship)…), mesuré sur 1 573 intitulés, n'en perdait aucun.
- Pour un **métier technique** : Actiris et StepStone cherchent en OU (pré-filtre indispensable), les pages VDAB se vérifient une à une, les agrégateurs (Jobijoba, Jobrapido) et les sociétés d'intérim publient beaucoup.

## 5. Les techniques qui resservent

- **Avant de lire du HTML, chercher le JSON que le site s'est préchargé** : `<script id="ng-state">` (Angular), `__NEXT_DATA__` (Next.js), `application/ld+json` (schema.org), `initialResults = JSON.parse('…')`.
- **Quand le HTML résiste, lire le JavaScript du site** : chemins d'API et format des filtres y sont en clair. **Et lire les en-têtes qu'il pose**, pas seulement le corps : c'est l'`Accept-Language` manquant qui a fait croire, un jour entier, qu'Actiris exigeait un navigateur.
- **Quand toutes les variantes d'un paramètre échouent, on cherche dans le mauvais paramètre** (seize corps de requête essayés, tous en 500 : le corps était bon, l'en-tête manquait). Et vérifier qu'un domaine n'a pas bougé avant de conclure à une erreur.
- **Un code d'erreur se lit précisément** : 422 chez Workday = tenant inconnu (pas « fermé ») ; 410 chez StepStone = offre retirée, définitif ; un 301 peut porter la page entière (Hays).
- **Le titre d'un poste ne dit pas la langue de l'annonce** (« Junior Business Controller » dans une annonce entièrement française) : pour deviner la langue, écarter le jargon d'intitulé et ne voter que sur les mots propres à une langue.
- **Ajout Job4me** : lire le HTML avec un vrai analyseur (cheerio) plutôt qu'avec des expressions régulières, sans jamais exécuter le JavaScript des pages ; garder pour chaque connecteur quelques réponses réelles anonymisées comme jeux de test, pour repérer vite un changement de gabarit.

## 6. Ordre de démarrage dans Job4me

1. Le format commun, le contrat de connecteur `{ offers, readCount }`, l'orchestrateur qui isole chaque source et le mode « tester les sources » (phase 2).
2. Un premier socle pour Bruxelles : **Actiris** avec pré-filtre de titre, **Forem** (open data), **StepStone**, **Jobijoba**, **Jobrapido**, **Talent.com**, **Adzuna** (API) et **Google Jobs** (quota), puis **LinkedIn** avec ses précautions (phase 2).
3. Le dédoublonnage, la géographie et la notation (phase 3).
4. Le journal par source et l'alerte « source muette » dès le premier jour.
5. Après quelques passages : mesurer la pertinence par source, affiner les mots-clés en français, néerlandais et anglais, ajouter les sites de niche du métier visé, les pages carrière d'employeurs choisis et les alertes e-mail (phases 5 et 7).
