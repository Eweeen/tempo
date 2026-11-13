# Tempo

Tempo est un calendrier personnel en français, installable en PWA. Il permet de préparer une semaine de travail en une seule opération, puis de gérer chaque poste indépendamment. Les événements, catégories, préférences et documents restent dans le navigateur de l’utilisateur.

Le projet ne contient ni serveur de données personnelles, ni authentification, ni synchronisation distante. Les échanges avec Calendrier Apple passent par des fichiers `.ics` importés ou exportés manuellement.

Le périmètre détaillé se trouve dans [CAHIER_DES_CHARGES.md](./CAHIER_DES_CHARGES.md). Les fonctionnalités réalisées, les résultats de validation et la recette iPhone restante sont suivis dans [AVANCEMENT.md](./AVANCEMENT.md).

## Démarrer en local

Prérequis : Node.js 22 ou ultérieur et npm.

```sh
npm install
npm run dev
```

Ouvrir l’adresse indiquée par Vite, généralement `http://localhost:5173`. Le service worker est désactivé en développement : ce mode ne valide pas le lancement hors connexion.

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

Les événements et documents restent dans IndexedDB côté navigateur : aucun volume de données ni base de données serveur n’est nécessaire. Changer de domaine ou de port change l’espace de stockage du navigateur ; exporter une sauvegarde depuis l’ancienne adresse puis la restaurer sur la nouvelle permet de transférer ses données.

Pour reconstruire après une modification ou récupérer les mises à jour des images de base :

```sh
docker compose build --pull
docker compose up -d
```

Le HTML et les ressources PWA sont revalidés ; les fichiers JavaScript/CSS portant une empreinte Vite sont mis en cache durablement. Comme pour tout hébergement de Tempo, une nouvelle version du service worker s’active après fermeture des anciennes fenêtres de l’application.

Sans Compose :

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

## Échanger avec Calendrier Apple

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

`npm test` exécute les tests Vitest du moteur calendrier, des échanges `.ics`, d’IndexedDB avec `fake-indexeddb` et du service worker. `npm run test:watch` les relance pendant le développement.

Les tests Playwright lancent automatiquement l’aperçu de production sur `127.0.0.1:4173` ; exécuter le build au préalable. La configuration actuelle utilise Chrome dans `/usr/bin/google-chrome`. Pour un autre emplacement, définir `PLAYWRIGHT_CHROMIUM_EXECUTABLE` avant de lancer les tests, par exemple :

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE="/chemin/vers/chrome" npm run test:e2e
```

Ces tests nécessitent la possibilité de démarrer un serveur local et un navigateur. Ils ne remplacent pas la recette sur un iPhone physique, notamment l’installation, l’ouverture hors connexion et l’import dans Calendrier Apple.

La dernière validation du 13 novembre 2026 comprend **14 parcours navigateur Chrome** et une compilation réussie, après ajout des années défilantes. Les gestes tactiles, le chargement des mois et des années dans les deux sens, le bandeau de semaine et les retours ont été testés ; les captures sur mobile à 390 px et ordinateur ont été vérifiées. Les **59 tests unitaires** ont réussi lors d’une étape précédente et n’ont pas été relancés pour cette dernière évolution d’interface. L’application n’est pas encore déployée ; l’hébergement HTTPS et la recette iPhone restent à effectuer. Le détail des parcours est consigné dans [AVANCEMENT.md](./AVANCEMENT.md).

## Architecture

| Emplacement | Rôle |
| --- | --- |
| `src/App.tsx`, `src/styles.css` | Calendrier, navigation, recherche, thèmes et mise en page |
| `src/components/` | Années et mois défilants, vue jour tactile avec semaine, menu d’affichage, éditeur d’événement, création groupée, réglages et dialogues |
| `src/types.ts` | Modèle des événements, catégories, réglages et documents |
| `src/lib/calendar.ts` | Dates civiles, occurrences, lots de travail et jours fériés |
| `src/lib/ics.ts` | Import/export iCalendar, fuseaux et alarmes compatibles |
| `src/lib/storage.ts` | IndexedDB, documents, validation, sauvegardes et détection des écritures concurrentes |
| `public/` | Manifeste PWA, icônes et modèle du service worker |
| `vite.config.ts` | Build et génération du pré-cache versionné à partir des fichiers produits |
| `Dockerfile`, `compose.yaml`, `docker/nginx.conf` | Image de production, lancement Docker et cache HTTP des ressources PWA |
| `tests/`, `tests/e2e/` | Tests métier et tests navigateur |

React et TypeScript portent l’interface ; Vite produit un site statique. Aucun secret, compte Apple, accès EventKit ou service distant n’est requis pour utiliser cette version.
