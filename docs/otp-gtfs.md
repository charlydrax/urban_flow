# OpenTripPlanner & GTFS TCL — moteur de routage transports en commun (UF-301)

Mise en place du moteur de calcul d'itinéraires en transports en commun. C'est le
prérequis de tout le sprint « Service Itinéraire » : sans OTP en fonctionnement,
aucun calcul de trajet TC n'est possible (F3, C9).

**Contraintes couvertes** : F3 (intégration APIs transport), C9 (formats standards
GTFS / OSM), C10 (auto-hébergement — aucun quota d'API tiers, aucune coupure
externe), C5 (extrait géographique restreint, graphe mis en cache).

---

## 1. Pourquoi auto-héberger

Le calcul multimodal a besoin d'itinéraires **détaillés segment par segment** :
c'est ce découpage qui alimente le Service Carbone (empreinte CO₂ par segment,
puis tri par CO₂ croissant). Les API d'itinéraires grand public renvoient rarement
ce niveau de détail, et toujours sous quota.

OpenTripPlanner consomme deux jeux de données ouverts :

| Donnée       | Rôle                                                                              | Source                  |
| ------------ | --------------------------------------------------------------------------------- | ----------------------- |
| **GTFS TCL** | arrêts, lignes, horaires du réseau lyonnais                                       | SYTRAL Mobilités (ODbL) |
| **OSM Lyon** | réseau piéton et cyclable — rabattement vers les arrêts et correspondances à pied | OpenStreetMap (ODbL)    |

Sans le réseau OSM, OTP connaîtrait les arrêts mais serait incapable de relier une
adresse de départ à l'arrêt le plus proche : aucun itinéraire porte-à-porte.

---

## 2. Architecture du service

```
docker/otp/
├── Dockerfile        image OTP officielle + notre entrypoint
├── entrypoint.sh     construit le graphe s'il est absent, puis sert
├── fetch-data.sh     télécharge GTFS + OSM dans data/
├── test-route.sh     recette : Part-Dieu -> Bellecour
├── config/
│   ├── build-config.json    paramètres de construction du graphe
│   └── router-config.json   paramètres de routage du serveur
└── data/             GTFS + OSM téléchargés (jamais commités)
```

Deux montages dans le conteneur :

- `./docker/otp/data` et `./docker/otp/config` en **lecture seule** — les entrées ;
- le volume nommé `urbanflow_otp_graph` sur `/var/opentripplanner` — le **graphe
  construit**, qui survit à `docker compose down`.

L'entrypoint copie les entrées dans le volume avant de construire. OTP écrit son
graphe à côté de ses entrées : si le répertoire de travail était le dossier de
l'hôte, chaque build ferait transiter des centaines de mégaoctets par le partage
de fichiers Docker Desktop (lent sous Windows, et le graphe finirait synchronisé
sur OneDrive).

---

## 3. Démarrage

### Prérequis

Docker Desktop avec **au moins 8 Go de RAM alloués** (Settings → Resources). La
construction du graphe est l'étape gourmande ; le service en régime établi tient
dans beaucoup moins.

### Trois commandes

```bash
# 1. Télécharger les données (~85 Mo, une seule fois)
make otp-data

# 2. Démarrer OTP — construit le graphe au premier lancement (~5 à 15 min)
make otp-up

# 3. Suivre la construction
make otp-logs
```

Sans `make` installé, les équivalents directs :

```bash
./docker/otp/fetch-data.sh
docker compose up -d otp
docker compose logs -f otp
```

Le service est prêt quand les logs affichent `Grizzly server running`. Le
healthcheck Docker bascule alors sur `healthy` (`docker compose ps`).

---

## 4. Sources de données GTFS

> **À savoir** : le flux officiel TCL n'est plus téléchargeable anonymement.
> `download.data.grandlyon.com` répond désormais `401 Unauthorized` et exige une
> authentification HTTP Basic.

`fetch-data.sh` gère donc deux sources.

### Par défaut — miroir public Mobility Database

Aucun compte requis, le projet démarre immédiatement. C'est un **instantané daté**
du GTFS TCL : le graphe se construit normalement, mais les horaires ne couvrent
qu'une période passée.

**Conséquence pratique** : une requête d'itinéraire à la date du jour ne renverra
**aucun trajet**. Il faut interroger OTP avec une date comprise dans la fenêtre de
validité du flux. `fetch-data.sh` affiche cette fenêtre à chaque exécution et
avertit si la date du jour en sort :

```
[otp-data] fenêtre de validité du GTFS : 20220414 → 20220712
[otp-data] ATTENTION : la date du jour (20260825) est HORS de cette fenêtre.
```

Le script de recette `test-route.sh` choisit automatiquement une date valide en
interrogeant le graphe — c'est le moyen le plus simple de tester.

### Flux officiel à jour — avec un compte Grand Lyon

1. Créer un compte gratuit sur [data.grandlyon.com](https://data.grandlyon.com).
2. Renseigner les identifiants dans le `.env` racine (jamais commité — C4/C11) :

   ```dotenv
   GRANDLYON_USER=votre-identifiant
   GRANDLYON_PASSWORD=votre-mot-de-passe
   ```

3. Relancer `make otp-data-force` puis `make otp-rebuild`.

`fetch-data.sh` détecte les identifiants et bascule seul sur le flux officiel.

---

## 5. Mise à jour mensuelle du GTFS

Le SYTRAL republie son GTFS régulièrement (nouveaux horaires, travaux, lignes).
Le graphe doit être reconstruit pour en tenir compte.

```bash
make otp-rebuild
```

Cette cible enchaîne :

1. `fetch-data.sh --force` — retéléchargement du GTFS et de l'extrait OSM ;
2. recréation du conteneur avec `OTP_FORCE_REBUILD=1`, ce qui supprime le graphe
   existant et en construit un neuf ;
3. redémarrage automatique du serveur sur le nouveau graphe.

Équivalent sans `make` :

```bash
./docker/otp/fetch-data.sh --force
OTP_FORCE_REBUILD=1 docker compose up -d --force-recreate otp
docker compose logs -f otp
```

Le service reste indisponible pendant la reconstruction. En production, on
construirait le graphe à côté puis on basculerait ; pour l'environnement de
développement, l'interruption est acceptable.

Vérifier ensuite que la fenêtre de validité a bien avancé :

```bash
./docker/otp/fetch-data.sh   # réaffiche la fenêtre sans retélécharger
make otp-test                # recalcule Part-Dieu -> Bellecour
```

---

## 6. Persistance du graphe

Le graphe vit dans le volume nommé `dev_urbanflow_otp_graph`.

| Commande                  | Effet sur le graphe                                      |
| ------------------------- | -------------------------------------------------------- |
| `docker compose stop otp` | conservé                                                 |
| `docker compose down`     | **conservé** (les volumes nommés survivent)              |
| `docker compose down -v`  | supprimé — reconstruction complète au prochain démarrage |
| `make otp-rebuild`        | supprimé et reconstruit volontairement                   |

Au redémarrage, l'entrypoint détecte `graph.obj` et le recharge sans reconstruire :
le démarrage passe de plusieurs minutes à quelques secondes.

---

## 7. Tester

### Interface graphique — client de debug OTP

OTP embarque un client web permettant de poser des points sur une carte et de
visualiser les itinéraires :

```
http://localhost:8080
```

Points de repère du scénario de référence :

- **Lyon Part-Dieu** — 45.760515, 4.859057
- **Bellecour** — 45.757813, 4.832011

⚠️ Penser à régler la **date** du formulaire dans la fenêtre de validité du GTFS
(section 4), sinon aucun itinéraire ne s'affichera.

### Ligne de commande — recette automatisée

```bash
make otp-test
# ou : ./docker/otp/test-route.sh
# ou avec une date imposée : ./docker/otp/test-route.sh 2022-05-17
```

Le script vérifie la santé du serveur, choisit une date valide, demande un
itinéraire Part-Dieu → Bellecour et résume les trajets trouvés.

### API GraphQL

C'est l'API que consommera le connecteur du Service Itinéraire (UF-302) :

```
POST http://localhost:8080/otp/gtfs/v1
```

---

## 8. Dépannage

| Symptôme                                         | Cause probable                            | Correction                                                                                          |
| ------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `aucune donnée d'entrée dans /var/otp-seed/data` | données non téléchargées                  | `make otp-data`                                                                                     |
| Le conteneur redémarre en boucle                 | mémoire JVM insuffisante pendant le build | augmenter la RAM de Docker Desktop, ou baisser `OTP_MAX_MEMORY` dans `.env`                         |
| Le graphe se construit mais aucun itinéraire     | date de requête hors fenêtre de validité  | section 4 — utiliser `make otp-test`                                                                |
| `401 Unauthorized` au téléchargement             | identifiants Grand Lyon absents ou faux   | vérifier `GRANDLYON_USER` / `GRANDLYON_PASSWORD`, ou les retirer pour repasser sur le miroir public |
| `bad interpreter` au démarrage du conteneur      | script converti en CRLF                   | vérifier que `.gitattributes` est bien présent, puis `git checkout -- docker/otp`                   |
| Port 8080 déjà pris                              | autre service local                       | changer `OTP_PORT` dans `.env`                                                                      |

---

## 9. Recette UF-301

| Critère                                                              | Vérification                                                               |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `docker compose up` démarre OTP sans erreur, le graphe est construit | `docker compose up -d otp` puis `docker compose ps` → `healthy`            |
| L'API OTP répond à une requête de trajet test Lyon                   | `make otp-test` → itinéraires Part-Dieu → Bellecour                        |
| La procédure de mise à jour du GTFS est documentée                   | section 5, et cible `make otp-rebuild`                                     |
| Le volume du graphe persiste entre les redémarrages                  | `docker compose restart otp` → redémarrage sans reconstruction (section 6) |
