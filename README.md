# Tempo

Tempo est un calendrier personnel en français, installable en PWA. Il permet de préparer une semaine de travail en une seule opération, puis de gérer chaque poste indépendamment. Les événements, catégories, préférences et documents restent dans le navigateur de l’utilisateur.

Sans abonnement, les données restent locales. Un service Node.js facultatif permet de publier un calendrier `.ics` privé auquel Calendrier Apple peut s’abonner. La publication se fait uniquement après activation dans l’application ; les documents ne sont jamais envoyés. L’import/export manuel reste disponible.

Le périmètre détaillé se trouve dans [CAHIER_DES_CHARGES.md](./CAHIER_DES_CHARGES.md). Les résultats de validation et les limites de la recette iPhone figurent ci-dessous.

## Démarrer en local

Prérequis : Node.js 22 ou ultérieur et npm.

```sh
npm install
npm run dev
```

Ouvrir l’adresse indiquée par Vite, généralement `http://localhost:5173`. Le service worker est désactivé en développement : ce mode ne valide pas le lancement hors connexion.

Pour tester aussi l’abonnement, démarrer `npm run server` dans un second terminal. Vite et son aperçu transmettent `/api/` au service sur `127.0.0.1:3001`. Les flux sont conservés dans `.tempo-feeds/` (ignoré par Git). `TEMPO_FEED_DIR`, `TEMPO_FEED_HOST` et `TEMPO_FEED_PORT` configurent le service ; adapter aussi le proxy Vite si le port change.

Pour construire et servir la version de production :

```sh
npm run build
npm run preview
```

La compilation TypeScript précède le build Vite. Les fichiers à héberger sont générés dans `dist/`. L’aperçu utilise généralement `http://localhost:4173`.

## Lancer avec Docker

Prérequis : Docker et Docker Compose. Depuis la racine du projet :

```sh
docker compose up --build -d
```

Ouvrir **http://localhost:8080**. L’image compile l’application avec Node.js 22 et `npm ci`, puis sert uniquement les fichiers de production avec [NGINX Unprivileged](https://github.com/nginx/docker-nginx-unprivileged). Le conteneur fonctionne sans utilisateur root, avec un système de fichiers en lecture seule et un répertoire temporaire en mémoire. Son état de santé vérifie que la page est accessible.

```sh
docker compose ps
docker compose logs -f tempo
docker compose down
```

Le port peut être modifié au lancement :

```sh
TEMPO_PORT=8081 docker compose up --build -d
```

Par défaut, le serveur est accessible uniquement depuis cette machine (`127.0.0.1`). Pour écouter également sur les interfaces réseau, définir `TEMPO_BIND_ADDRESS=0.0.0.0`. Sur un domaine ou un téléphone, placer le service derrière un reverse proxy HTTPS : le conteneur sert du HTTP sur son port 8080 et l’installation PWA ainsi que le cache hors connexion nécessitent un contexte sécurisé. Héberger l’application à la racine du domaine, comme pour `dist/`.

Les données originales et documents restent dans IndexedDB. Compose lance également le service `subscriptions`, accessible uniquement via NGINX, et conserve les flux activés dans le volume `subscriptions`. Ne pas supprimer ce volume lors d’une mise à jour. Changer de domaine ou de port change l’espace de stockage et l’adresse d’abonnement : révoquer d’abord l’ancien lien, exporter une sauvegarde, puis la restaurer et créer un nouvel abonnement à la nouvelle adresse.

Pour reconstruire après une modification ou récupérer les mises à jour des images de base :

```sh
docker compose build --pull
docker compose up -d
```

Le HTML et les ressources PWA sont revalidés ; les fichiers JavaScript/CSS portant une empreinte Vite sont mis en cache durablement. Comme pour tout hébergement de Tempo, une nouvelle version du service worker s’active après fermeture des anciennes fenêtres de l’application.

Sans Compose, le conteneur suivant sert l’application locale et l’import/export manuel. L’abonnement nécessite aussi le service `subscriptions` sur un réseau Docker commun ; utiliser Compose pour ce parcours :

```sh
docker build -t tempo-calendar:local .
docker run --rm -p 127.0.0.1:8080:8080 --read-only --tmpfs /tmp:size=16m,mode=1777 tempo-calendar:local
```

## Utiliser Tempo

L’application s’ouvre directement sur le calendrier, sans panneau latéral ni bandeau. Sur téléphone, les mois défilent verticalement dans les deux sens. Chaque mois contient uniquement ses dates et affiche deux à trois aperçus par journée, puis « +N » si nécessaire.

1. **Travail**, en bas de l’écran : choisir la semaine, les jours et le modèle 05:00–13:00 ou 13:00–21:00 ; ajuster les horaires et valider le récapitulatif. Chaque jour devient un événement distinct. Les doublons détectés sont exclus du lot et les chevauchements sont signalés.
2. **Bouton +**, en haut à droite : ajouter un événement avec dates, type, rappels, lieu, notes et documents. Les événements peuvent couvrir une journée entière ou traverser minuit.
3. **Naviguer** : sur mobile, faire défiler les mois puis toucher une date pour ouvrir sa grille horaire. Balayer cette vue vers la gauche ou la droite pour changer de jour, utiliser les flèches ou toucher une date dans le bandeau de la semaine. Le bouton retour en haut à gauche ramène aux mois, puis aux années : faire défiler les années verticalement dans les deux sens et toucher un mini-calendrier pour ouvrir ce mois. Les mini-calendriers affichent uniquement les dates, sans événements ni lettres des jours. Le menu par icône à côté de la loupe permet de choisir « Calendrier » ou « Liste », ainsi que « Semaine » sur grand écran. « Aujourd’hui » recentre la vue sur le mois ou l’année actuelle. La loupe ouvre la recherche.
4. **Calendriers**, en bas de l’écran : filtrer les catégories ou accéder aux réglages, thèmes et options de personnalisation.
5. **Calendriers → Importer ou exporter** : échanger un `.ics`, télécharger une sauvegarde complète ou restaurer une sauvegarde existante.

Les jours fériés affichés par défaut sont ceux de France métropolitaine, applicables à la Bretagne.

## Installer sur iPhone et utiliser hors connexion

Héberger le contenu de `dist/` à la racine d’un site **HTTPS**, puis ouvrir cette adresse sur l’iPhone. Le manifeste et les chemins de ressources utilisent actuellement `/` ; un hébergement dans un sous-dossier nécessite d’adapter ces chemins.

Dans Safari, utiliser **Partager → Sur l’écran d’accueil**, puis ouvrir Tempo depuis son icône avec une connexion active. Attendre la préparation du cache avant de fermer l’application et de tester le mode avion. `localhost` convient au développement sur l’ordinateur ; son URL ne désigne pas cet ordinateur lorsqu’elle est ouverte sur le téléphone.

Le service worker de production précharge la page, le JavaScript, les styles, le manifeste et les icônes, y compris les noms de fichiers générés par Vite. Les données et documents sont lus séparément depuis IndexedDB. Après ce premier chargement, la consultation et la modification locales ne nécessitent pas de réseau. Les liens vers des sites externes restent dépendants de la connexion.

Une mise à jour attend la fermeture des onglets et fenêtres Tempo utilisant l’ancienne version. Fermer toutes les instances puis rouvrir l’application permet de passer à la nouvelle version sans mélanger ses fichiers avec ceux de la précédente.

Les barres ont un fond opaque assorti au thème. Le style Apple est explicitement `default` ; un véritable élément DOM fixe de 1 px, à `top: 0`, fournit la couleur de fond à iOS, et l’en-tête est `sticky`. Cette adaptation suit les essais du [fil PWA fourni](https://www.reddit.com/r/PWA/comments/1w5mqj1/ios_27_beta_blurs_the_top_edge_of_installed_pwas/), dont les témoignages divergent selon la version d’iOS. Le [signalement WebKit](https://bugs.webkit.org/show_bug.cgi?id=301994#c17) confirme que des problèmes natifs subsistent ; le correctif reste à valider sur un iPhone réel.

iOS peut conserver la configuration de barre d’état de l’installation précédente. Pour tester une nouvelle installation, **sauvegarder les données et révoquer l’abonnement éventuel avant de retirer l’icône**, puis ajouter à nouveau Tempo depuis Safari. Restaurer les données et recréer l’abonnement si nécessaire. Certaines versions d’iOS peuvent aussi exiger une relance complète après un changement de thème système.

## Échanger avec Calendrier Apple

### Abonnement automatique

Dans **Calendriers → Importer ou exporter → Abonnement Calendrier Apple**, choisir **Activer l’abonnement**, puis **S’abonner dans Calendrier Apple**. Le lien HTTPS peut aussi être copié dans **Calendrier → Calendriers → Ajouter un calendrier → Ajouter un abonnement**. Apple documente ces abonnements en lecture seule dans [son guide iPhone](https://support.apple.com/guide/iphone/use-multiple-calendars-iph3d1110d4/27/ios/27).

Tempo publie tous les événements enregistrés, même masqués par les filtres, avec titres, horaires, répétitions, notes, lieux, liens et rappels. Les documents sont exclus. Ajouts, modifications et suppressions mettent à jour le même flux, avec des UID stables et `LAST-MODIFIED`. iOS choisit la fréquence de récupération ; le flux suggère une heure mais ne peut pas imposer une actualisation immédiate. Modifier les événements dans Tempo et vérifier les alertes dans les options Apple de l’abonnement.

La publication se relance après chaque changement d’événements, au retour du réseau, à la réouverture et périodiquement lorsque l’app est visible. Les changements hors connexion restent dans IndexedDB et sont envoyés au prochain lancement connecté. **Une PWA fermée ne publie pas en arrière-plan.** « Publier maintenant » force une transmission au serveur, pas une actualisation de l’iPhone. Une erreur réseau ne bloque pas l’enregistrement local ; elle apparaît dans les réglages et une notification.

L’hébergement doit servir le site et `/api/` à la racine d’une adresse **HTTPS joignable depuis l’iPhone et les services Apple**, sans écran de connexion devant le flux. Un hébergement statique seul ne suffit pas. Compose fournit les deux services ; le reverse proxy HTTPS doit transmettre `/api/` au même NGINX que le site. Désactiver les journaux d’URL pour `/api/calendars/` également dans tout proxy amont, car les liens donnent accès aux événements.

La clé de publication aléatoire de 256 bits reste dans le stockage local du navigateur et ne figure pas dans le lien Apple. Le serveur utilise son empreinte SHA-256 comme identifiant de lecture. Quiconque possède le lien peut lire le calendrier ; cette URL ne permet pas de modifier le flux. **Désactiver l’abonnement → Révoquer le lien** efface la copie serveur et rend l’ancienne URL inutilisable. Retirer ensuite l’abonnement dans Apple pour effacer ses copies locales. Une recréation utilise un nouveau lien.

Les clés d’abonnement ne figurent pas dans la sauvegarde JSON et ne sont pas synchronisées entre appareils. Révoquer l’abonnement avant d’effacer les données du navigateur ou de changer d’adresse. Si la clé est perdue, l’hébergeur doit supprimer le flux `.ics` correspondant et créer un fichier vide de même identifiant avec l’extension `.revoked`. Une restauration de sauvegarde remplace aussi le contenu du flux actif lors de la publication suivante.

Le service fonctionne sans compte et sans dépendance Node supplémentaire, avec écritures atomiques dans le volume dédié. Limites par instance : 10 Mo par flux, 100 Mo au total, 1 000 identifiants (révoqués compris) et 120 requêtes d’écriture par minute. Il est prévu pour l’hébergement personnel de Tempo ; les quotas sont globaux. Les fichiers `.revoked` empêchent une requête retardée de recréer un flux supprimé et doivent être conservés. Les sauvegardes du volume contiennent des données personnelles lisibles.

### Import/export manuel

Dans **Calendriers → Importer ou exporter**, exporter les événements en `.ics`. Apple documente l’import depuis une pièce jointe dans **Mail sur iPhone** ; Calendrier sur Mac permet également d’importer et d’exporter des fichiers `.ics`. L’ouverture directe d’un téléchargement depuis Safari ou Fichiers et l’import de plusieurs événements doivent être vérifiés sur l’iPhone concerné. [Guide Apple iPhone](https://support.apple.com/fr-fr/guide/iphone/ipha0d932e96/ios), [guide Calendrier sur Mac](https://support.apple.com/guide/calendar/import-or-export-calendars-icl1023/mac).

L’import dans Tempo affiche un aperçu et les incompatibilités avant confirmation. Il ignore les identifiants déjà présents : réimporter un événement modifié ne met donc pas à jour sa copie existante. Dans Apple, un nouvel import peut produire des doublons. Aucune modification ou suppression n’est synchronisée automatiquement entre les deux applications.

Les pièces jointes restent dans Tempo. Les rappels compatibles sont exportés en `VALARM` ; après import, vérifier leur présence et les réglages de notifications dans Calendrier Apple. **Tempo ne déclenche pas d’alarme lorsqu’il est fermé.** Une future application iOS avec EventKit est la piste retenue pour la lecture/écriture directe du calendrier et les fonctions natives.

## Dates et répétitions prises en charge

- Fuseaux disponibles : **Europe/Paris** et **UTC**. Chaque événement conserve le sien ; les heures sont affichées dans ce fuseau, sans conversion automatique vers le fuseau du téléphone ou vers un fuseau commun. Les événements UTC sont signalés comme tels.
- Le réglage du fuseau s’applique aux nouveaux événements. Il ne convertit pas ceux qui existent déjà.
- Répétitions quotidiennes, hebdomadaires, mensuelles ou annuelles, avec intervalle de 1 à 365 et date de fin facultative. Modifier ou supprimer une série affecte la série entière.
- Les règles `.ics` avancées telles que `BYDAY`, `BYMONTH` ou `COUNT`, ainsi que les séries avec exceptions (`EXDATE`, `RDATE`, `RECURRENCE-ID`), ne sont pas importées ; l’aperçu le signale.
- Les invitations, participants, temps de trajet et paramètres Apple avancés ne sont pas gérés. Les heures importées sans fuseau sont interprétées en Europe/Paris avec un avertissement.

## Documents, sauvegarde et confidentialité

Les documents sont copiés dans IndexedDB, dans l’espace privé du site. Ils ne deviennent pas un dossier visible dans l’application Fichiers et ne sont pas envoyés à un serveur par Tempo. Les limites applicatives sont **20 Mo par document**, **250 Mo par sauvegarde JSON** et **10 Mo par fichier `.ics` importé**. Le quota disponible dépend aussi du navigateur.

La sauvegarde JSON contient les événements, calendriers, préférences et le contenu des documents. **Restaurer remplace toutes les données locales actuelles** ; l’interface demande confirmation avec le bouton « Remplacer et restaurer ». La structure et les fichiers sont validés avant la transaction de remplacement. Télécharger une sauvegarde préalable permet de revenir à l’état précédent.

Si Tempo est ouvert dans plusieurs onglets, une modification enregistrée dans l’un peut rendre les données de l’autre périmées. Dans ce cas, l’enregistrement est annulé avec un message de conflit afin de préserver les données déjà enregistrées. **Recharger l’onglet concerné avant de réessayer** ; les changements ne sont pas fusionnés automatiquement.

Le stockage local n’est pas un coffre chiffré : Tempo n’ajoute pas de chiffrement applicatif ni de mot de passe, et ses sauvegardes sont lisibles par toute personne qui possède le fichier. Une suppression des données du site, un changement d’origine ou d’appareil, ou une éviction du stockage peut rendre les données indisponibles. La demande de stockage persistant est proposée, mais son acceptation appartient au navigateur. Conserver une sauvegarde en dehors de l’application reste nécessaire.

## Tests

```sh
npm test
npm run build
npm run test:e2e
```

`npm test` exécute les tests Vitest du moteur calendrier, des échanges `.ics`, d’IndexedDB avec `fake-indexeddb`, du service worker et du serveur d’abonnement (serveurs HTTP temporaires sur loopback). `npm run test:watch` les relance pendant le développement.

Les tests Playwright lancent automatiquement l’aperçu de production sur `127.0.0.1:4173` et un service d’abonnement sur `127.0.0.1:3001`, avec stockage dans `test-results/subscriptions/`. Libérer le port 3001 et exécuter le build au préalable. La configuration actuelle utilise Chrome dans `/usr/bin/google-chrome`. Pour un autre emplacement, définir `PLAYWRIGHT_CHROMIUM_EXECUTABLE` avant de lancer les tests, par exemple :

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE="/chemin/vers/chrome" npm run test:e2e
```

Ces tests nécessitent la possibilité de démarrer un serveur local et un navigateur. Ils ne remplacent pas la recette sur un iPhone physique, notamment l’installation, l’ouverture hors connexion et l’import dans Calendrier Apple.

La validation du 13 novembre 2026 comprend **67 tests Vitest**, **20 parcours navigateur Chrome** et une compilation réussie. Elle couvre « Aucun », les thèmes, la publication après activation, les ajouts/modifications/suppressions, la reprise réseau, les onglets concurrents, la révocation et le renouvellement du lien. Les deux services Docker ont été construits et démarrés dans une instance de test : proxy NGINX, persistance après redémarrage, révocation, refus d’une ancienne requête et affichage à 390 px ont été vérifiés. L’hébergement HTTPS, le rendu de la barre d’état dans la PWA installée, l’abonnement et ses alertes sur un iPhone physique restent à vérifier.

## Architecture

| Emplacement | Rôle |
| --- | --- |
| `src/App.tsx`, `src/styles.css` | Calendrier, navigation, recherche, thèmes et mise en page |
| `src/components/` | Années et mois défilants, vue jour tactile avec semaine, menu d’affichage, éditeur d’événement, création groupée, réglages et dialogues |
| `src/types.ts` | Modèle des événements, catégories, réglages et documents |
| `src/lib/calendar.ts` | Dates civiles, occurrences, lots de travail et jours fériés |
| `src/lib/ics.ts` | Import/export iCalendar, fuseaux et alarmes compatibles |
| `src/lib/storage.ts` | IndexedDB, documents, validation, sauvegardes et détection des écritures concurrentes |
| `src/lib/subscription.ts` | Publication facultative, reprise réseau, sérialisation entre onglets et révocation |
| `server/subscriptions.mjs`, `server/Dockerfile` | Flux privés, stockage persistant, limites et service Node.js |
| `public/` | Manifeste PWA, icônes et modèle du service worker |
| `vite.config.ts` | Build et génération du pré-cache versionné à partir des fichiers produits |
| `Dockerfile`, `compose.yaml`, `docker/nginx.conf` | Image de production, lancement Docker et cache HTTP des ressources PWA |
| `tests/`, `tests/e2e/` | Tests métier et tests navigateur |

React et TypeScript portent l’interface ; Vite produit les fichiers statiques. `server/subscriptions.mjs` sert les abonnements activés, sans compte Apple ni EventKit. Aucun service distant n’est requis pour l’usage local et l’import/export manuel.
