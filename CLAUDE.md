# CLAUDE.md — UrbanFlow Mobility

Contexte et règles pour Claude Code sur ce projet. À lire avant toute génération de code.

---

## 1. Le projet

**UrbanFlow Mobility** — plateforme de mobilité urbaine intelligente, développée pour le **Titre RNCP 36146 — Concepteur Développeur de Solutions Digitales (T6 CDSD)**, session septembre 2026, Digital Campus Paris, classe **B3DEV**.

**Client (fictif)** : métropole de 500 000 habitants en transition écologique (Claire Hénette, UrbanFlow Mobility).

**But du produit** : optimiser les déplacements en combinant transports en commun, vélos, trottinettes et covoiturage ; proposer des **itinéraires multimodaux** et afficher l'**empreinte carbone** de chaque option pour orienter vers les mobilités douces.

**Scénario nominal de référence (issu des diagrammes UML)** : Marie, connectée, saisit « Part-Dieu → Bellecour ». L'app combine TC + mobilités douces, calcule le CO₂ de chaque option et affiche les résultats triés sur la carte.

**Contraintes d'épreuve :**

- Projet **100 % original et individuel** (aucune réutilisation de projets antérieurs).
- Dossier projet : **PDF, 40 pages max** — fichier `NOM_Prénom_Titre6_B3DEV_Septembre2026.pdf`.
- Dépôt : **lundi 20 juillet 2026, 23h00** (Procertif + copie de secours par mail).
- Soutenance : 40 min (20 présentation + 20 échanges), 31 août → 11 septembre 2026.
- Usage de l'IA **limité, tracé et justifié** dans le dossier.

---

## 2. Stack technique (imposée par mes choix)

| Couche              | Techno                                                                   |
| ------------------- | ------------------------------------------------------------------------ |
| **Client PWA**      | **Next.js** (App Router) + TypeScript + **MapLibre GL JS** pour la carte |
| **API**             | **NestJS** (Node.js) + TypeScript — joue le rôle d'API Gateway           |
| **Base de données** | **PostgreSQL + PostGIS** (géospatial + profils utilisateurs)             |
| **Auth**            | **JWT** (vérifié au niveau de l'API Gateway)                             |
| **APIs externes**   | **GTFS** (transports en commun), **GBFS** (vélos/trottinettes partagés)  |
| **Styles**          | TailwindCSS, mobile-first                                                |
| **ORM**             | Prisma (avec support PostGIS via SQL brut quand nécessaire)              |
| **Tests**           | Jest / Vitest (services critiques : auth, itinéraires, carbone)          |
| **Lint**            | ESLint + Prettier (strict)                                               |

### Services applicatifs (architecture logique des diagrammes)

- **API Gateway (NestJS)** : point d'entrée, vérifie le JWT, orchestre les appels.
- **Service Itinéraire** : calcul multimodal, fusionne TC + mobilités douces.
- **Service Carbone** : calcule l'empreinte CO₂ par segment.
- **PostGIS** : profils, préférences, données géospatiales, historique.

> Ces services peuvent être des **modules NestJS** dans un même backend (monolithe modulaire) — pas besoin de microservices séparés pour le MVP.

---

## 3. Périmètre fonctionnel

### Obligatoires (les 3)

| ID     | Fonctionnalité                                                         |
| ------ | ---------------------------------------------------------------------- |
| **F1** | Inscription / connexion + gestion de profils de mobilité personnalisés |
| **F2** | Planificateur d'itinéraires multimodal avec géolocalisation temps réel |
| **F3** | Intégration d'APIs de transport (GTFS + GBFS vélos/trottinettes)       |

### Au choix — RETENUE

- ✅ **Calculateur d'empreinte carbone avec suivi personnel**
  - CO₂ calculé par segment d'itinéraire (Service Carbone).
  - Tri des itinéraires par empreinte croissante (oriente vers le durable).
  - Tableau de bord personnel : historique et impact des déplacements.

Les autres fonctionnalités du brief sont **hors périmètre** du prototype (mentionnables en roadmap dans le dossier).

---

## 4. Flux de référence (à respecter dans le code)

Diagramme de séquence du MVP — `POST /api/routes/plan {from, to, userId}` :

> ⚠️ **Écart assumé depuis UF-402** : l'endpoint définitif n'accepte **plus** de
> `userId` dans le corps (`{from, to}` seulement). L'identité vient du JWT
> vérifié à l'étape 2, et de lui seul — accepter un identifiant de compte depuis
> le corps de la requête est un défaut de conception (OWASP A01), même quand le
> serveur l'ignore. Le diagramme reste la référence du flux, pas du contrat.

1. Client PWA géolocalise (Geolocation API) et envoie la requête.
2. API Gateway **vérifie le JWT** → 401 si invalide/expiré.
3. Lecture des **préférences profil** dans PostGIS.
4. Service Itinéraire : appels **parallèles** (`Promise.all`) à GTFS, GBFS et requête PostGIS (`ST_DWithin` pistes cyclables).
5. Fusion en itinéraires multimodaux. (404 si aucun trajet.)
6. Service Carbone : `computeFootprint(segments)` pour chaque itinéraire.
7. Sauvegarde `search_history` (PostGIS).
8. Réponse `200 OK` + itinéraires + CO₂.
9. Client : **tri par empreinte croissante**, affichage carte, mise en cache via Service Worker.

**Dégradation gracieuse** : si une API externe est indisponible, le Service Itinéraire **ignore ce mode** et retourne les autres options. Si le réseau coupe après calcul, le Service Worker sert le dernier itinéraire en cache.

le design, l'affichage se trouve sur :
https://www.figma.com/design/LXCZajsGIhru5ArCyHhNym/UrbanFlow-Mobility-%E2%80%94-Maquettes-T6-CDSD?node-id=0-1&p=f&t=ZUfbkntVBcZJvP84-0

## si tu veux y accéder, utilise le mcp figma

## 5. Contraintes techniques C1→C12 (évaluées en soutenance ET revue de code)

| ID  | Domaine                   | Traduction dans le code                                                                    |
| --- | ------------------------- | ------------------------------------------------------------------------------------------ |
| C1  | PWA                       | `manifest`, service worker, installable, offline de base                                   |
| C2  | Responsive/UX             | Mobile-first, utilisable sur tout support                                                  |
| C3  | Normes & standards        | Lint strict, conventions des langages respectées                                           |
| C4  | Sécurité OWASP            | Validation des entrées, hash mots de passe (argon2/bcrypt), CSRF/XSS/injection, HTTPS, JWT |
| C5  | Éco-conception            | Assets optimisés, lazy loading, requêtes minimisées, cache, pas de polling inutile         |
| C6  | Géolocalisation           | Précision/fiabilité des positions, gestion des erreurs GPS                                 |
| C7  | Accessibilité WCAG 2.1 AA | Contrastes, navigation clavier, ARIA, focus visible, alternatives textuelles               |
| C8  | RGPD                      | Consentement géoloc, minimisation, droit à l'effacement, politique de confidentialité      |
| C9  | Interopérabilité          | Formats standards (GTFS, GBFS, GeoJSON), API REST documentée (Swagger)                     |
| C10 | Performances              | Connectivité variable : cache offline, appels parallèles, bundle optimisé                  |
| C11 | Sécurité données          | Chiffrement des données de déplacement, tokens httpOnly, logs sans données perso           |
| C12 | Normes transport          | Accessibilité PMR prise en compte dans les itinéraires                                     |

⚠️ **Règle** : pour toute fonctionnalité, identifier les contraintes C1–C12 impactées et le noter.

---

## 6. Architecture des dossiers

```
urbanflow/
├── apps/
│   ├── web/                      # Client PWA — Next.js
│   │   ├── public/manifest.json  # C1
│   │   ├── app/                  # App Router (pages, layouts)
│   │   ├── components/           # UI accessible (WCAG)
│   │   ├── features/             # auth/, planner/, profile/, carbon/
│   │   ├── lib/                  # client API, helpers MapLibre, geoloc
│   │   └── sw.ts                 # service worker (C1, C10)
│   └── api/                      # API Gateway — NestJS
│       ├── src/
│       │   ├── modules/
│       │   │   ├── auth/         # JWT, login/register (F1, C4)
│       │   │   ├── users/        # profils & préférences (F1)
│       │   │   ├── routes/       # planificateur (F2)
│       │   │   ├── transport/    # intégrations GTFS/GBFS (F3, C9)
│       │   │   └── carbon/       # calcul empreinte (feature retenue)
│       │   ├── common/           # guards, pipes de validation, filtres (C4)
│       │   └── prisma/           # schéma + migrations PostGIS
├── docs/                         # diagrammes UML, specs, captures (dossier)
└── CLAUDE.md
```

**Principes** : modularité par fonctionnalité (évolutivité/maintenabilité), séparation front/back, REST documenté en OpenAPI/Swagger (C9), secrets dans `.env` jamais commités.

---

## 7. Conventions de code & documentation

> Bien documenter le code est explicitement attendu pour ce projet.

- **Langue** : code et commits en anglais ; UI en français ; commentaires métier en français acceptés.
- **Commits** : Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
- **Branches** : `main` (stable, protégée), branches de ticket `feat/uf-xxx-description` (voir `docs/git-workflow.md`).
- **Nommage** : `camelCase` (vars/fonctions), `PascalCase` (composants/classes/types), `kebab-case` (fichiers).
- **TypeScript strict** : pas de `any` non justifié.
- **Validation serveur systématique** de toute entrée (class-validator / zod) — C4.

### Documentation attendue dans le code

- **JSDoc/TSDoc** sur toute fonction publique, service NestJS et composant exporté : but, paramètres, retour, et **contrainte(s) C couverte(s)** quand pertinent.
- **README par module** (`auth`, `routes`, `transport`, `carbon`) : rôle, endpoints, dépendances.
- **Swagger/OpenAPI** généré côté NestJS pour tous les endpoints.
- **Commentaires « pourquoi », pas « quoi »** : expliquer les choix techniques (ex. appels parallèles pour C10, `ST_DWithin` pour la recherche de pistes).
- **Schéma Prisma commenté** : chaque table/champ sensible annoté (RGPD/C8).

Exemple de docstring attendu :

```ts
/**
 * Calcule l'empreinte carbone d'un itinéraire, segment par segment.
 * Couvre : proposition de valeur écologique ; alimente le tri par CO₂ croissant.
 * @param segments Segments multimodaux de l'itinéraire
 * @returns Empreinte totale en grammes de CO₂
 */
```

---

## 8. Commandes (à compléter après init)

```bash
# Frontend (Next.js)
cd apps/web
npm run dev
npm run build
npm run lint
npm run test

# Backend (NestJS)
cd apps/api
npm run start:dev
npm run build
npm run test
npx prisma migrate dev      # migrations (penser aux extensions PostGIS)
npx prisma studio
```

Préproduction (UF-607) — images construites, journaux JSON, ports dédiés :

```bash
make preprod-up        # PWA sur 3100, API sur 3101, base sur 5434
make preprod-migrate   # migrations Prisma sur la base de préproduction
make preprod-logs-api  # journaux structurés de l'API
```

Initialisation PostGIS (à exécuter une fois sur la base) :

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

---

## 9. Rôle de Claude sur ce projet

- Concevoir, coder et déboguer le prototype en respectant **F1/F2/F3 + carbone** et **C1–C12**.
- **Documenter le code** au fur et à mesure (TSDoc, README de module, commentaires de justification) — c'est un attendu fort.
- Signaler les impacts **sécurité OWASP, RGPD, accessibilité, éco-conception** de chaque choix.
- Respecter le **flux de référence** (section 4) et l'architecture (section 6).
- **Ne pas rédiger le dossier à ma place** : assister, expliquer, relire — l'usage de l'IA doit rester limité et justifiable.
- Rester dans le périmètre : aucune fonctionnalité hors brief sans validation explicite.

---

## 10. Défauts connus, identifiés mais non corrigés

> Registre des problèmes **repérés et diagnostiqués** au fil des tickets, dont la
> correction a été volontairement remise à une passe dédiée. À traiter lors d'une
> session « correction de bugs ». Retirer l'entrée une fois le défaut corrigé.
>
> Chaque entrée est doublée d'une **issue GitHub portant le label `bug`** et une
> priorité `P0`→`P3` — le suivi mis en place par UF-607 (#80). Ce registre en est
> le rappel local : il est lu à chaque session, l'issue ne l'est pas. L'issue
> reste la référence pour le détail, les options écartées et la recette.
>
> **Procédure complète** (détection → priorisation → correction → validation),
> journalisation, remontée d'erreurs front et environnement de préproduction :
> [`docs/bug-process.md`](docs/bug-process.md) et
> [`docs/preproduction.md`](docs/preproduction.md).

> **Registre vide à ce jour.** BUG-001 (#87 — fins de ligne CRLF vs
> `endOfLine: "lf"`) était la seule entrée : corrigée le 29/08/2026 par la
> règle `* text=auto eol=lf` de `.gitattributes`. `npm run format:check` est
> désormais fiable sous Windows et fait partie de la CI.
