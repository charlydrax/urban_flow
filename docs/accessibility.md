# Accessibilité WCAG 2.1 AA — méthode, audit et écarts résiduels (UF-602)

Rapport d'audit d'accessibilité d'UrbanFlow : **ce qui est vérifié, par quel outil,
avec quel résultat, et ce qui ne l'est pas — avec la raison**.

Contraintes couvertes : **C7** (WCAG 2.1 niveau AA), **C12** (accessibilité PMR prise
en compte dans les itinéraires), **C2** (mobile-first, cibles tactiles).

Code : [`apps/web/test/axe.ts`](../apps/web/test/axe.ts) (harnais d'audit),
[`apps/web/lib/design-tokens.test.ts`](../apps/web/lib/design-tokens.test.ts) (contrastes),
[`apps/web/eslint.config.mjs`](../apps/web/eslint.config.mjs) (analyse statique du JSX),
[`apps/web/lib/plan-feedback.ts`](../apps/web/lib/plan-feedback.ts) (annonce du filtre PMR).

---

## 1. Le parti pris : trois étages, aucun redondant

L'accessibilité n'est pas vérifiable par un seul outil. Chacun de ceux utilisés ici
voit une chose que les deux autres ne peuvent pas voir :

| Étage              | Outil                             | Ce qu'il voit                                   | Ce qu'il ne peut pas voir                                |
| ------------------ | --------------------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| **Statique**       | `eslint-plugin-jsx-a11y` _strict_ | Le JSX, y compris les branches jamais rendues   | Un `aria-describedby` qui pointe dans le vide au runtime |
| **DOM rendu**      | `axe-core` sous jsdom             | L'arbre d'accessibilité réel des composants     | Les couleurs et les tailles (pas de moteur de style)     |
| **Valeurs source** | Tests de contraste maison         | Les ratios calculés sur les tokens de la charte | Ce que le navigateur compose réellement à l'écran        |
| **Page complète**  | Lighthouse (manuel)               | La page assemblée, dans un vrai navigateur      | Rien de plus — mais il faut la lancer à la main          |

Le point important est la ligne « DOM rendu » : `axe-core` sous jsdom **ne peut pas**
mesurer les contrastes, faute de moteur de style. La règle `color-contrast` est donc
explicitement désactivée dans le harnais, et les contrastes sont vérifiés ailleurs,
sur les valeurs de la charte plutôt que sur un rendu. Faire semblant de les auditer
avec axe aurait produit un rapport rassurant et faux.

---

## 2. Lancer l'audit

```bash
# Audit d'accessibilité seul (axe-core sur les composants rendus)
npm run test:a11y

# Analyse statique du JSX (jeu strict jsx-a11y)
npm run lint --workspace apps/web

# Contrastes de la charte, inclus dans la suite unitaire
npx vitest run --project unit --root apps/web lib/design-tokens.test.ts
```

L'audit tourne **avec `npm test`** : un écart WCAG casse la CI comme un test métier,
au lieu d'attendre une passe manuelle que personne ne relance.

---

## 3. Résultat de l'audit automatisé

Dernière exécution sur la branche `feat/uf-602-accessibility-wcag-aa` :

| Suite                                                 | Composants audités                                                | Violations AA |
| ----------------------------------------------------- | ----------------------------------------------------------------- | ------------- |
| `components/layout/layout.a11y.test.tsx`              | En-tête (connecté / déconnecté), bandeau hors-ligne               | **0**         |
| `features/auth/auth.a11y.test.tsx`                    | Connexion, inscription (dans leur coque `AuthShell`)              | **0**         |
| `features/profile/profile.a11y.test.tsx`              | Profil de mobilité (chargé et en erreur)                          | **0**         |
| `features/planner/planner.a11y.test.tsx`              | Liste d'itinéraires, détail carbone, squelette, messages d'échec  | **0**         |
| `features/planner/planner.a11y.test.tsx` (UF-804)     | Chips heure/voyageurs, sélecteur de modes, bandeau éco, cartes F3 | **0**         |
| `features/planner/accessibility-filter.a11y.test.tsx` | Note « filtre accessibilité actif »                               | **0**         |
| **Total**                                             | **27 assertions, dont 14 passes axe complètes**                   | **0**         |

Périmètre exact des règles : tags axe `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`.
Les règles « best-practice » d'axe sont **exclues** — elles sont utiles mais ne
relèvent pas de la norme, et les mêler ferait échouer la CI sur des recommandations
qu'aucun texte n'impose. Le ticket demande AA, pas le goût d'un outil.

### Contrastes (vérifiés sur les tokens de la charte)

| Couple                                    | Ratio   | Seuil AA                        |
| ----------------------------------------- | ------- | ------------------------------- |
| Ink 900 sur fond de page                  | ≥ 7:1   | 4.5:1 (AAA atteint)             |
| Textes colorés sur blanc                  | ≥ 4.5:1 | 4.5:1                           |
| Blanc sur boutons pleins (primary/action) | ≥ 3:1   | 3:1 (texte gras)                |
| Couleurs de modes sur blanc               | ≥ 3:1   | 3:1 (objets graphiques, 1.4.11) |
| Anneau de focus (action sur blanc)        | ≥ 3:1   | 3:1 (2.4.11)                    |
| Bandeaux d'état sur fond teinté           | ≥ 4.5:1 | 4.5:1                           |

Ces seuils sont **assertés**, pas documentés : `lib/design-tokens.test.ts` échoue si
un token de la charte est modifié sous le seuil.

---

## 4. Ce qui est en place, critère par critère

| Critère WCAG 2.1 AA                | Comment il est tenu                                                                                    | Où                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| 1.1.1 Contenu non textuel          | Tous les emoji sont `aria-hidden` et doublés d'un libellé écrit ; la carte a une alternative textuelle | `itinerary-cards.ts`, `map-view.tsx`                            |
| 1.3.1 Information et relations     | `fieldset`/`legend` sur chaque question à choix multiples, landmarks header/nav/main/footer            | `mobility-profile-form.tsx`, `app/layout.tsx`                   |
| 1.3.5 Identifier le but d'un champ | `autocomplete` standard sur email et mots de passe                                                     | `login-form.tsx`, `register-form.tsx`                           |
| 1.4.1 Utilisation de la couleur    | Chaque information colorée est **doublée** : pictogramme, libellé, et niveau nommé dans l'`aria-label` | `itinerary-card.tsx`, `carbon-badge.ts`                         |
| 1.4.3 / 1.4.11 Contrastes          | Tokens de la charte assertés au seuil texte (4.5:1) et objets graphiques (3:1)                         | `design-tokens.test.ts`, `route-map-layers.test.ts`             |
| 2.1.1 Clavier                      | Aucun gestionnaire de clic sur élément non focusable ; motifs natifs (radio, checkbox, `<details>`)    | vérifié par `jsx-a11y` strict                                   |
| 2.3.3 Animations                   | `prefers-reduced-motion` coupe le halo du marqueur et les transitions                                  | `app/globals.css`                                               |
| 2.4.1 Contourner des blocs         | Lien d'évitement « Aller au contenu principal », visible au focus                                      | `app/layout.tsx`, `.skip-link`                                  |
| 1.3.1 / 2.4.1 Repères              | **Un seul** repère `navigation` nommé, quelle que soit sa forme (onglets ou rail) — UF-803             | `app-nav.tsx`, `layout.a11y.test.tsx`                           |
| 2.4.7 Focus visible                | Anneau global `3px` sur `:focus-visible`, rétabli sur les contrôles MapLibre                           | `app/globals.css`                                               |
| 2.5.5 Taille de cible              | Cibles ≥ 44 px sur écran tactile ; la carte de résultat entière est un `<label>`                       | `globals.css`, `itinerary-card.tsx`                             |
| 3.3.1 Identification des erreurs   | Chaque cas non nominal a son message ; un vide filtré dit **pourquoi** il est vide                     | `plan-feedback.ts`                                              |
| 3.3.2 Étiquettes et instructions   | Aides reliées par `aria-describedby`, jamais seulement posées à côté                                   | `input-field.tsx`, `mobility-profile-form.tsx`                  |
| 4.1.2 Nom, rôle, valeur            | Groupes radio nommés, `aria-current="page"` sur l'onglet ouvert, combobox ARIA 1.2                     | `itinerary-list.tsx`, `app-nav.tsx`, `address-autocomplete.tsx` |
| 4.1.3 Messages de statut           | `status` par défaut, `alert` réservé aux vraies pannes ; régions live montées **d'avance**             | `plan-feedback.ts`, `offline-banner.tsx`                        |

---

## 5. L'option PMR, et son effet réel sur les itinéraires (C12)

C'est la partie du ticket qui ne se règle pas avec des attributs ARIA : une case
cochée dans un profil doit **changer les itinéraires proposés**, et l'usager doit
pouvoir relier ce qu'il voit à ce qu'il a coché.

### La chaîne complète

```
profil « Itinéraires accessibles PMR »          apps/web — mobility-profile-form.tsx
       │  PATCH /users/me { preferences: { reducedMobility: true } }
       ▼
users.getPreferences().reducedMobility          apps/api — étape 3 du flux
       │
       ├─► requête OpenTripPlanner : wheelchair: true
       │        transit.service.ts — le moteur GTFS ne renvoie que des trajets
       │        praticables (arrêts et courses marqués accessibles)
       │
       ├─► fusion : filtre DUR
       │        itinerary-merger.ts — `if (prefs.reducedMobility && !candidate.accessible)
       │        return false`. Le candidat est **écarté**, pas rétrogradé : proposer
       │        un trajet impraticable en fauteuil serait une faute, pas une option.
       │
       └─► réponse : appliedConstraints: { reducedMobility: true }        ← UF-602
                │
                ▼
       note « Filtre accessibilité actif » sur le panneau de résultats
       et, si la liste est vide, un message qui impute le vide au filtre
```

### Ce qu'UF-602 a ajouté à cette chaîne

Les trois premières étapes existaient depuis UF-302/UF-401. Il leur manquait la
dernière, et c'était un défaut d'accessibilité à part entière : le filtre agissait
**sans que rien à l'écran ne le dise**.

Concrètement, un usager en fauteuil qui obtenait une option au lieu de quatre ne
pouvait pas savoir si le réseau était pauvre ou si son propre réglage — coché des
semaines plus tôt, sur une autre page — avait écarté le reste. C'est le même défaut
que d'afficher une liste filtrée en cachant le filtre actif (WCAG 3.3.1).

La réponse `POST /routes/plan` publie donc `appliedConstraints`, et l'écran en tire
deux messages distincts :

| Situation                    | Message                                                                          | Rôle     |
| ---------------------------- | -------------------------------------------------------------------------------- | -------- |
| Liste non vide, filtre actif | « Filtre accessibilité actif : seuls les itinéraires praticables… »              | `status` |
| Liste vide, filtre actif     | « Aucun itinéraire praticable en fauteuil roulant… décochez… dans votre profil » | `status` |
| Liste vide, aucune source    | « Aucune de nos sources n'a répondu » — la panne l'emporte sur le filtre         | `alert`  |

Le ton est `info`/`status` et non `warning` : la contrainte fait exactement ce qu'on
lui demande. La peindre en orange ferait chercher un problème dans un réglage
volontaire, et suggérerait de le retirer — ce qui n'est pas notre rôle.

### Le libellé du profil a été corrigé

L'aide du champ disait « **Privilégie** les stations avec ascenseurs et quais
adaptés ». Le serveur, lui, applique un filtre dur. Promettre moins que la
contrainte réelle laissait croire que les options écartées restaient visibles plus
bas dans la liste. Le texte dit maintenant ce que le code fait :
« Seuls les itinéraires praticables en fauteuil roulant vous seront proposés ».

---

## 6. Passe Lighthouse — procédure

L'audit automatisé ne remplace pas une passe navigateur : Lighthouse voit la page
**assemblée**, avec ses styles, ce que jsdom ne peut pas faire.

```bash
# 1. Base + API + web (voir README)
make up && npm run dev

# 2. Purger .next si un `npm run build` a eu lieu entre-temps (cf. README)
#    — build et dev partagent leurs répertoires de sortie.

# 3. Chrome → DevTools → onglet Lighthouse
#    Catégorie : Accessibility uniquement · Mode : Navigation · Appareil : Mobile
#    Pages à passer : /  ·  /login  ·  /register  ·  /profil  ·  /impact
```

À compléter après chaque passe :

| Page        | Score accessibilité | Écarts relevés | Date |
| ----------- | ------------------- | -------------- | ---- |
| `/`         | _à relever_         |                |      |
| `/login`    | _à relever_         |                |      |
| `/register` | _à relever_         |                |      |
| `/profil`   | _à relever_         |                |      |
| `/impact`   | _à relever_         |                |      |

> Ce tableau est **volontairement vide** : la passe Lighthouse est manuelle et n'a
> pas été exécutée dans cette branche. Y inscrire un score plausible serait
> exactement le genre de rapport d'audit qui ne vaut rien.

---

## 7. Écarts résiduels, et pourquoi ils sont assumés

| Écart                                                | Pourquoi il subsiste                                                                                                                                                                                                      | Compensation                                                                                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **La carte MapLibre n'est pas navigable au clavier** | Le canvas WebGL n'expose aucun contenu à l'arbre d'accessibilité. Le rendre praticable au clavier demanderait de réimplémenter en DOM tout ce qu'il dessine — hors périmètre d'un prototype.                              | Alternative textuelle obligatoire (`textAlternative`) : itinéraires, durées et empreintes sont **intégralement** lisibles dans le panneau de résultats, sans jamais toucher la carte. |
| **`color-contrast` désactivé dans axe**              | Inopérant sous jsdom, faute de moteur de style. Le laisser actif produirait soit des faux positifs massifs, soit un « incomplete » qui ne prouve rien.                                                                    | Contrastes assertés sur les tokens source (`design-tokens.test.ts`) + passe Lighthouse.                                                                                               |
| **Tailles de cible non vérifiées automatiquement**   | Même raison : une taille de cible se mesure sur un rendu, pas sur un DOM.                                                                                                                                                 | `min-h-11` (44 px) posé sur les contrôles tactiles, media query `pointer: coarse` sur les contrôles MapLibre ; à confirmer en passe Lighthouse.                                       |
| **Pas de test avec un lecteur d'écran réel**         | NVDA/VoiceOver ne s'automatisent pas dans cette CI. axe vérifie l'arbre d'accessibilité, pas l'énoncé effectif.                                                                                                           | Les `aria-label` composés sont testés **comme du texte** (`itinerary-cards.test.ts`) : on vérifie la phrase produite, pas seulement sa présence.                                      |
| **`jsx-a11y` : deux règles reparamétrées**           | `no-noninteractive-element-to-interactive-role` refuse `ul[role=listbox]`, que le patron combobox du WAI-ARIA APG recommande ; `label-has-associated-control` ne descend que de deux niveaux de JSX.                      | Reparamétrées avec justification en commentaire, **jamais désactivées** — voir `eslint.config.mjs`.                                                                                   |
| **Accessibilité PMR limitée par la donnée GTFS**     | Le flux TCL miroir date de 2022 et tous les arrêts ne portent pas `wheelchair_boarding`. OTP traite l'absence d'information comme « non praticable » sous contrainte, donc la liste peut être plus courte que la réalité. | Comportement **prudent par construction**, assumé dans `otp.mapper.ts` : mieux vaut ne pas proposer un trajet incertain que d'en proposer un impraticable.                            |

---

## 8. Ce que la revue de soutenance peut vérifier en trois minutes

1. `npm run test:a11y` → 27 assertions, 0 violation WCAG 2.1 AA.
2. `Tab` depuis le haut de n'importe quelle page → le lien d'évitement paraît en premier,
   puis chaque contrôle porte un anneau de focus visible.
3. Profil → cocher « Itinéraires accessibles PMR » → relancer une recherche → la note
   « Filtre accessibilité actif » apparaît au-dessus de la liste, et la liste est
   restreinte aux options `♿ Accessible`.
4. `npm run lint --workspace apps/web` → le jeu strict `jsx-a11y` passe sans exception
   locale (`eslint-disable`) dans le code de production.
