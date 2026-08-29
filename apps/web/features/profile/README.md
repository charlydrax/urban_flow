# Feature `profile` — Profil de mobilité (F1, UF-107)

Écran « Mon profil » de la PWA : consultation et modification des préférences qui
pilotent le planificateur (F2), gestion du consentement RGPD et déconnexion.

Maquette de référence : Figma « 02 · Maquettes mobile → 3. PROFIL F1 ».

## Fichiers

| Fichier                     | Rôle                                                                     |
| --------------------------- | ------------------------------------------------------------------------ |
| `preferences.ts`            | Logique pure : options, bascule des modes, validation, **diff du PATCH** |
| `preferences.test.ts`       | Tests unitaires de cette logique (Vitest, environnement node)            |
| `account-card.tsx`          | Carte d'identité du compte + **option de déconnexion**                   |
| `mobility-profile-form.tsx` | Formulaire des préférences, câblé sur `GET`/`PATCH /api/users/me`        |

La page qui les assemble est `app/profil/page.tsx` (Server Component : métadonnées
et mise en page seulement).

## Pourquoi la logique est séparée du composant

Les tests web tournent en environnement **node** (`vitest.config.ts`), sans DOM.
Toutes les décisions du formulaire — quoi envoyer, quand refuser, quand ne rien
envoyer — vivent donc dans `preferences.ts`, où elles sont testables sans rendu.
Le composant ne garde que l'affichage et les états de chargement.

## Enregistrement différentiel

`buildProfilePatch(initial, draft)` ne retient que les champs réellement
modifiés, et renvoie `null` quand rien n'a bougé — le formulaire n'envoie alors
aucune requête. Deux raisons :

- **éco-conception (C5) / performance (C10)** : charge utile minimale, pas de
  requête inutile ;
- **robustesse** : réémettre un profil complet écraserait les modifications
  faites entre-temps depuis un autre appareil.

## Session et déconnexion

La page est privée par défaut : le middleware (UF-106) redirige toute navigation
sans session vers `/login`, et l'API répond `401` à tout appel sans token valide
(UF-104). Un `401` survenant pendant la consultation est capté par
l'intercepteur du client API, qui purge la session et redirige — le formulaire
n'affiche alors aucun message d'erreur, qui disparaîtrait avec la redirection.

Le bouton « Se déconnecter » de `AccountCard` appelle `signOut()` : purge du
cookie `httpOnly` côté API (le JS ne peut pas l'effacer — C11), puis vidage de
l'état client et retour à `/login`.

## Accessibilité (C7)

- Groupes de champs en `fieldset`/`legend` ; priorité en groupe de boutons radio.
- Chaque réglage porte une description reliée par `aria-describedby` ; l'état
  sélectionné n'est jamais signalé par la seule couleur (case cochée + libellé).
- Erreurs annoncées en `role="alert"`, confirmations en `role="status"`, chargement
  en `role="status"` + `aria-busy` (pas de vol de focus).
- Zones tactiles ≥ 44 px, pictogrammes décoratifs en `aria-hidden`.

## RGPD (C8) et accessibilité PMR (C12)

Le consentement à la géolocalisation se donne et se retire **du même geste** ; la
date de consentement initiale n'est pas réécrite tant que le choix ne change pas
(traçabilité). La préférence PMR est annoncée comme facultative et n'est utilisée
que pour le calcul d'itinéraires.

### Le libellé PMR dit ce que le serveur fait, pas moins (UF-602)

L'aide du champ disait « **privilégie** les stations avec ascenseurs et quais
adaptés ». Côté API, `reducedMobility` est un **filtre dur** : la requête envoyée
à OpenTripPlanner porte `wheelchair: true`, puis la fusion écarte tout candidat
non accessible (`itinerary-merger.ts`). « Privilégie » laissait donc croire que
les options écartées restaient visibles plus bas dans la liste.

Le texte annonce maintenant la contrainte réelle — « seuls les itinéraires
praticables en fauteuil roulant vous seront proposés » — et le planificateur
**répète** l'information au moment où elle agit, via `appliedConstraints`
(voir `docs/accessibility.md` §5). Une contrainte réglée une fois sur cette page
ne peut pas rester invisible sur celle où elle produit son effet (C7 — WCAG 3.3.2).
