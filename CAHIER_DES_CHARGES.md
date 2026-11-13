# Cahier des charges — Calendrier personnel

Version : 0.4 — 13 novembre 2026. Document de référence du projet ; les instructions de démarrage et de validation figurent dans [README.md](./README.md).

## 1. Problème et objectif

La saisie de périodes de travail variables dans Calendrier Apple oblige à répéter les mêmes informations jour après jour. L’application doit permettre de préparer une semaine en une seule action, tout en conservant des événements indépendants : par exemple, cinq postes de 05 h à 13 h du lundi au vendredi, puis cinq postes de 13 h à 21 h la semaine suivante.

Elle réunit également les autres événements personnels, leurs catégories, leurs rappels et leurs documents. Les données restent sur l’appareil ; l’abonnement Apple facultatif publie une copie des événements sans documents. L’interface, en français, reprend les conventions familières d’un calendrier Apple, avec un thème clair, sombre ou lié au système.

## 2. Décisions confirmées par l’utilisateur

- **PWA d’abord**, installable depuis le navigateur, avec **import et export de fichiers de calendrier `.ics`** pour la première version.
- Ajouter un abonnement Apple en lecture seule : les changements dans Tempo sont publiés dans un flux privé, puis récupérés automatiquement par iOS à sa fréquence. La synchronisation bidirectionnelle reste une évolution distincte.
- Zone des jours fériés : **Bretagne, France**, donc calendrier national de France métropolitaine.
- Stockage local des données et, lorsque le navigateur le permet, des pièces jointes.
- Création d’un fichier de cahier des charges et d’un second fichier de suivi des tâches.

## 3. Fonctionnalités de la première version

### Calendrier et navigation

- Décision du 13 novembre 2026 : afficher uniquement le calendrier au lancement, avec une présentation simple inspirée de Calendrier iOS. Pas de logo, slogan, surtitre, bandeau de bienvenue ni panneau latéral permanent.
- Organiser la navigation selon la hiérarchie année → mois → jour. En haut à gauche, le bouton retour ouvre l’année depuis les mois, et les mois depuis une journée. Il remplace les anciennes flèches de changement de mois.
- La vue année défile verticalement dans les deux sens, comme les mois, avec chargement progressif et nombre d’années montées limité. Chaque année porte son titre et présente douze mini-calendriers sans événements, pour choisir rapidement un mois. Supprimer les flèches de changement d’année et les lettres des jours de la semaine au-dessus des mini-calendriers.
- Placer le choix « Calendrier / Liste » dans un menu déroulant ouvert par une icône à côté de la recherche. La vue semaine reste proposée uniquement sur grand écran. Le choix « Calendrier » retrouve le niveau de navigation précédent.
- Conserver la recherche, le bouton d’ajout et le retour à aujourd’hui. Les filtres et réglages s’ouvrent depuis « Calendriers » ; la création groupée depuis « Travail ».
- Ouvrir une véritable vue jour au toucher d’une date, avec grille horaire, événements à la journée et passage au jour précédent/suivant par balayage horizontal. Les boutons de navigation restent disponibles.
- En haut de la vue jour, afficher les sept dates de la semaine correspondante, du lundi au dimanche. Toucher une date change la journée ; la semaine se met à jour lors du passage à une autre semaine.
- Sur mobile, remplacer la vue semaine par la vue jour. Conserver les vues mois et liste ; sur grand écran, conserver aussi la semaine.
- Sur mobile, faire défiler les mois verticalement dans les deux sens, avec chargement progressif, nombre de mois montés limité et préservation de la position lors de l’ajout de mois précédents.
- Chaque mois affiche uniquement ses dates ; les cases nécessaires à l’alignement des semaines restent vides. Adapter le nombre de lignes au mois.
- Afficher jusqu’à trois aperçus dans chaque case : trois événements, ou un jour férié et deux événements. Afficher « +N » au-delà ; la vue jour donne accès à tous les événements.
- Semaines commençant le lundi ; le bouton « Aujourd’hui » doit recentrer les mois ou les années après un défilement lointain.
- Navigation entre périodes et retour à aujourd’hui.
- Sélection d’un jour, consultation des événements, création, modification et suppression.
- Au retour d’une journée vers les mois, ne pas conserver de fond gris sur la date consultée. Garder le repère d’aujourd’hui. Désactiver les effets de survol sur mobile et sur les appareils tactiles ; conserver les repères de focus au clavier.
- Recherche et filtrage par catégorie.
- Affichage des jours fériés, distincts des événements personnels et masquables.
- Mise en page utilisable sur téléphone, tablette et ordinateur ; boutons et champs nommés pour les technologies d’assistance.

### Événements

| Paramètre | Première version |
| --- | --- |
| Titre, catégorie, icône | Saisie et modification |
| Début et fin | Date et heure ; fin postérieure au début |
| Journée entière | Une ou plusieurs journées ; export `.ics` avec fin exclusive |
| Lieu, notes, lien | Champs facultatifs |
| Disponibilité | Occupé ou libre |
| Fuseau horaire | Europe/Paris par défaut, ou UTC ; heures affichées dans le fuseau de chaque événement, sans conversion automatique vers un fuseau commun |
| Rappels | Délais avant l’événement, stockés et transmis dans les alarmes `.ics` |
| Répétition | Aucune, quotidienne, hebdomadaire, mensuelle, annuelle ; intervalle et fin facultative |
| Pièces jointes | Un ou plusieurs fichiers locaux liés à l’événement |

L’objectif initial d’égalité avec tous les paramètres Apple dépasse cette première version. La gestion des participants et invitations, des réponses, de la visioconférence, du temps de trajet et des calendriers de comptes Apple n’est pas incluse. Les règles de répétition complexes et la modification d’une occurrence isolée d’une série devront faire l’objet d’une évolution dédiée. Toute règle importée qui ne peut pas être représentée doit être signalée, sans transformation silencieuse.

Dans l’implémentation actuelle, les changements portent sur la série entière. L’import accepte les répétitions simples avec fréquence, intervalle de 1 à 365 et fin facultative ; il écarte avec avertissement les règles comme `BYDAY`, `BYMONTH` ou `COUNT`, les séries avec exceptions et les fuseaux autres que Europe/Paris ou UTC. Une heure sans fuseau est interprétée en Europe/Paris avec un avertissement. Changer le fuseau par défaut ne convertit pas les événements déjà créés.

### Création groupée des périodes de travail

- Choisir une semaine, puis les jours à créer.
- Proposer les horaires **05:00–13:00** et **13:00–21:00**, avec horaires personnalisables.
- Saisir les informations communes une seule fois : titre, catégorie, icône, rappels.
- Afficher un récapitulatif avant création.
- Créer autant d’événements indépendants que de jours choisis, identifiés comme appartenant au même lot.
- Permettre ensuite la modification ou suppression de chaque événement.
- Prendre en charge un poste qui traverse minuit ; ne pas décaler les heures civiles lors d’un changement d’heure.
- Les semaines ne s’alternent pas automatiquement : l’utilisateur garde le choix de chaque semaine, conformément à ses horaires variables.

### Catégories et icônes

- Catégories initiales : travail, paiement, facture, concert, festival, anniversaire, sport et personnel.
- Nom, couleur et icône associés à chaque catégorie.
- Gestion des catégories dans l’application.
- Possibilité de choisir une icône propre à un événement.
- Les éléments de présentation propres à l’application ne sont pas présumés compatibles avec Calendrier Apple.

### Documents et sauvegardes

- Ajouter plusieurs documents depuis le sélecteur de fichiers du téléphone : billets, factures et autres pièces utiles.
- Copier leur contenu dans le stockage de l’application, puis les consulter ou les télécharger hors connexion.
- Conserver les documents dans l’application : ils ne sont pas transférés à Apple par l’export `.ics`.
- Fournir une sauvegarde locale complète, versionnée, avec événements, catégories, réglages et documents, ainsi qu’une restauration validée avant écriture.
- La restauration remplace toutes les données actuelles après confirmation explicite dans l’interface ; elle ne fusionne pas les deux calendriers.
- Limites applicatives actuelles : 20 Mo par document, 250 Mo par sauvegarde et 10 Mo par fichier `.ics` importé. Le quota global dépend du navigateur.
- Remonter clairement les erreurs de stockage ; une opération échouée ne doit pas être présentée comme réussie.
- Préserver les modifications enregistrées depuis un autre onglet : une écriture basée sur des données périmées est refusée avec une invitation à recharger l’application. La V1 ne fusionne pas automatiquement les changements concurrents.

## 4. Échanges avec Calendrier Apple

### Périmètre accepté

L’import/export `.ics` est un échange manuel de fichiers. Il ne lit pas automatiquement la base du calendrier du téléphone et ne propage pas les modifications dans les deux sens. Un identifiant stable d’événement permet de reconnaître un fichier déjà importé dans l’application ; la gestion des doublons après import dans un autre logiciel dépend également de ce logiciel.

L’import Tempo ignore les identifiants déjà présents ; il ne met pas à jour leurs événements existants. Un aperçu présente le nombre d’événements ajoutables, les doublons ignorés et les incompatibilités avant confirmation.

Apple documente l’import d’un fichier `.ics` depuis Mail sur iPhone. L’ouverture d’un fichier téléchargé depuis Safari ou Fichiers, et notamment l’import d’un lot de cinq événements, restent à valider sur un iPhone physique. Le libellé de l’application doit annoncer un téléchargement/export, sans promettre une écriture directe. [Guide iPhone Apple](https://support.apple.com/en-mt/guide/iphone/ipha0d932e96/ios).

Sur Mac, Calendrier permet d’exporter un calendrier et d’importer un fichier `.ics`. Ce parcours fournit également un moyen d’obtenir un fichier à importer dans la PWA. Les archives Apple `.icbu` ne font pas partie du format pris en charge. [Guide Calendrier Apple sur Mac](https://support.apple.com/guide/calendar/import-or-export-calendars-icl1023/mac).

### Abonnement en lecture seule

L’abonnement web ne nécessite pas EventKit : un service Node.js conserve le flux `.ics` après activation explicite. Il couvre ajouts, modifications et suppressions, avec identifiants stables, reprise après une modification hors connexion et révocation. La PWA ne publie pas lorsqu’elle est fermée. Le lien privé donne un accès en lecture seule ; la clé de publication reste distincte. Les documents restent locaux. L’interface indique le délai de mise à jour décidé par Apple.

### Évolution native

Apple fournit EventKit et EventKitUI aux applications natives pour accéder aux calendriers avec les autorisations adaptées. Une future application iOS, éventuellement avec un pont natif, devra étudier les autorisations, les identifiants d’événements, les conflits et la propagation bidirectionnelle des suppressions. [Documentation Apple EventKit](https://developer.apple.com/documentation/eventkit/accessing-calendar-using-eventkit-and-eventkitui).

## 5. Rappels et fonctionnement hors connexion

Les rappels sont enregistrés dans chaque événement et exportés en `VALARM`. Leur déclenchement après import relève de l’application de calendrier qui accepte le fichier et des réglages du téléphone. La première version ne promet pas d’alarme système lorsque la PWA est fermée.

Une PWA installée peut utiliser Web Push sur iOS à partir d’iOS 16.4, après accord de l’utilisateur. Ce mécanisme utilise un serveur d’envoi et une connexion ; il ne répond pas à lui seul au besoin d’alarmes locales garanties hors connexion. Il reste hors périmètre de la V1 entièrement locale. [WebKit — Web Push](https://webkit.org/blog/13878/), [Apple — envoi des notifications Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).

Le service worker sert à mettre l’application en cache. Il n’est pas un processus permanent et ne doit pas être utilisé comme minuteur fiable d’alertes futures. La conclusion de conception est de confier les alertes fermées à Calendrier Apple après import, ou à une future implémentation native. [MDN — fonctionnement hors connexion et en arrière-plan](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation).

Après un premier chargement réussi et l’activation du cache, la PWA doit se relancer sans réseau et permettre de consulter et modifier les données, ainsi que d’ouvrir les documents déjà enregistrés. La toute première installation nécessite une connexion. Les liens externes ne deviennent pas accessibles hors connexion.

## 6. Stockage et confidentialité

- Base **IndexedDB** pour les événements, catégories, réglages et documents binaires.
- Aucun compte requis. Un serveur conserve uniquement les copies `.ics` des abonnements activés explicitement ; sans activation, aucune donnée personnelle n’est envoyée.
- Les fichiers sont copiés dans l’espace privé du site ; cela ne correspond pas à un dossier directement visible dans l’application Fichiers.
- Demande de stockage persistant lorsque l’API est disponible et affichage de l’espace utilisé estimé.
- Les quotas et l’attribution du mode persistant sont décidés par le navigateur. La suppression des données du site ou de l’installation peut supprimer les données locales : la sauvegarde exportée est le mécanisme de récupération prévu. [WebKit — politique de stockage](https://webkit.org/blog/14403/updates-to-storage-policy/).
- Pas de transfert implicite des pièces jointes. Une sauvegarde téléchargée contient les données et documents de l’utilisateur et doit être conservée comme telle.
- Le stockage local et les sauvegardes ne sont pas un coffre chiffré : la V1 n’ajoute ni chiffrement applicatif, ni mot de passe. L’isolation est celle du navigateur et du compte de l’appareil.

## 7. Jours fériés

La zone Bretagne utilise les jours fériés nationaux du cas général : dates fixes et jours dépendant de Pâques. Le calcul est local afin de fonctionner sans réseau. L’affichage indique les dates du calendrier ; il ne détermine pas si l’utilisateur travaille effectivement ces jours-là. Les fêtes locales, les congés scolaires et les règles de l’employeur ne sont pas inclus. [Service Public — calendrier des jours fériés](https://www.service-public.gouv.fr/particuliers/vosdroits/F24496).

## 8. Architecture et livraison

- Application cliente en **React et TypeScript**, construite avec **Vite**.
- Modules séparés pour le moteur calendrier, l’échange `.ics`, le stockage local et l’interface.
- Manifeste PWA, icônes d’installation et service worker pour le cache de l’application.
- Le cache est généré au build à partir des fichiers de production, noms hashés compris. Il contient uniquement l’interface statique ; les données personnelles et documents restent dans IndexedDB. Les mises à jour attendent la fermeture des instances utilisant l’ancienne version.
- Déploiement possible sur un hébergement statique HTTPS ; `localhost` convient au développement. Un test depuis un téléphone nécessite une URL HTTPS accessible sur celui-ci.
- La configuration actuelle vise la racine du domaine. Le service worker est désactivé sur le serveur de développement ; vérifier le mode hors connexion avec la version de production.
- Tests automatisés sur les règles métier et le stockage ; compilation de production ; recette manuelle iPhone distincte.
- L’état de validation et les limites réellement constatées sont consignés dans [AVANCEMENT.md](./AVANCEMENT.md), sans assimiler un test automatisé à une validation sur iOS.

## 9. Critères d’acceptation

1. Depuis une installation sans données, créer cinq postes de 05:00 à 13:00, du lundi au vendredi, en une opération ; vérifier qu’ils sont indépendants.
2. Créer une autre semaine de 13:00 à 21:00 sans modifier la première ; modifier seulement le mercredi.
3. Recharger l’application : événements, catégories, réglages et documents restent présents.
4. Ajouter un concert avec lieu, notes, rappel et deux documents ; retrouver et ouvrir ces documents après rechargement sans réseau.
5. Exporter les postes en `.ics`, les réimporter dans la PWA et vérifier dates, heures, titres et rappels ; répéter l’import sans doublons internes.
6. Tester l’import Apple sur iPhone physique, notamment le lot de cinq postes, le fuseau Europe/Paris et les rappels. Documenter le parcours exact qui fonctionne.
7. Vérifier les journées entières, les événements traversant minuit et les dates proches des changements d’heure.
8. Vérifier les répétitions simples et leur fin ; une règle non prise en charge à l’import doit être signalée.
9. Vérifier les jours fériés de France métropolitaine, dont le lundi de Pâques et l’Ascension.
10. Installer la PWA en écran d’accueil, fermer puis relancer en mode avion après mise en cache complète.
11. Vérifier les thèmes clair et sombre, la navigation au clavier et l’usage sur un petit écran.
12. Exporter une sauvegarde complète et la restaurer ; un fichier invalide ne doit pas écraser les données existantes.
13. Ouvrir deux onglets, enregistrer un changement dans le premier puis tenter un enregistrement dans le second : le conflit doit être signalé sans écraser les données du premier.
14. Ouvrir une journée, choisir une autre date dans la semaine, puis franchir la limite du dimanche. Vérifier la mise à jour de la semaine, le retour aux mois sans date grisée, puis le retour à l’année et l’ouverture d’un mois choisi.
15. Vérifier le menu d’affichage à côté de la recherche, le passage calendrier/liste et l’absence d’effets de survol sur mobile.
16. Faire défiler les années dans les deux sens sans saut au chargement, revenir à l’année actuelle avec « Aujourd’hui », choisir un mois d’une autre année puis revenir à celle-ci. Vérifier les dates d’une année bissextile et l’absence de lettres des jours dans les mini-calendriers.
17. Choisir « Aucun » dans un événement, enregistrer et rouvrir : aucun rappel ne doit être exporté. Pouvoir rétablir un rappel ensuite.
18. Activer l’abonnement, ajouter/modifier/supprimer des événements, couper puis rétablir le réseau, et vérifier le flux avec le même lien. Révoquer le lien et vérifier qu’il ne permet plus la lecture, même après une ancienne requête retardée.

## 10. Évolutions identifiées

- Connexion native EventKit pour lecture/écriture directe avec Calendrier Apple.
- Alertes locales natives ; éventuel service Web Push si un serveur et la connectivité deviennent acceptables.
- Répétitions avancées, exceptions, édition d’une occurrence ou des suivantes.
- Gestion de plusieurs calendriers et des paramètres Apple absents de la V1.
- Synchronisation entre appareils, seulement après choix explicite d’une architecture et d’un mode de stockage.
