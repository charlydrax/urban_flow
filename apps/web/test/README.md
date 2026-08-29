# `apps/web/test/` — harnais d'audit d'accessibilité (UF-602)

Outillage partagé de la suite `a11y` de Vitest. Rien ici n'est du code de
production : ces fichiers ne sont chargés que par les tests `*.test.tsx`.

Contraintes couvertes : **C7** (WCAG 2.1 AA), **C5** (l'audit ne ralentit pas la
suite unitaire).

| Fichier         | Rôle                                                                          |
| --------------- | ----------------------------------------------------------------------------- |
| `axe.ts`        | Exécute axe-core sur un DOM rendu et met en forme les violations en rapport   |
| `setup-a11y.ts` | Bouchons des API que jsdom n'implémente pas (`matchMedia`, observateurs)      |
| `fixtures.ts`   | Itinéraires du scénario nominal (Part-Dieu → Bellecour) partagés par la suite |

## Deux suites, deux environnements

`vitest.config.ts` déclare deux projets :

| Projet | Fichiers     | Env   | Ce qu'il prouve                                       |
| ------ | ------------ | ----- | ----------------------------------------------------- |
| `unit` | `*.test.ts`  | node  | la logique pure (`lib/`, helpers de `features/`)      |
| `a11y` | `*.test.tsx` | jsdom | le DOM **rendu** passe axe-core au niveau WCAG 2.1 AA |

Garder la suite unitaire en `node` n'est pas une coquetterie : jsdom coûte environ
une seconde de démarrage par fichier, et la grande majorité des tests du projet
n'ont jamais eu besoin d'un DOM.

```bash
npm run test           # les deux suites
npm run test:a11y      # l'audit seul
```

## Écrire un test d'audit

```tsx
import { render } from '@testing-library/react';
import { expectNoA11yViolations } from '../../test/axe';

it('ne viole aucune règle AA', async () => {
  render(<MonComposant />);
  await expectNoA11yViolations();
});
```

Un échec cite la **règle WCAG**, le sélecteur fautif et le correctif attendu :
le message d'erreur tient lieu de ligne de rapport d'audit.

## Ce que le harnais ne peut pas voir

axe analyse un DOM, pas un rendu — sans moteur de style, il ne mesure ni les
contrastes ni les tailles de cible. La règle `color-contrast` est donc désactivée
**explicitement**, et ces critères sont couverts ailleurs :

| Critère WCAG                 | Vérifié par                                         |
| ---------------------------- | --------------------------------------------------- |
| 1.4.3 Contraste (texte)      | `lib/design-tokens.test.ts`                         |
| 1.4.11 Contraste (non-texte) | `lib/route-map-layers.test.ts`                      |
| 2.5.5 Taille de cible        | passe Lighthouse manuelle — `docs/accessibility.md` |

Chaque bouchon de `setup-a11y.ts` comble un **manque de jsdom**, jamais un défaut
du produit : si un composant devait être neutralisé pour passer axe, ce serait le
composant qu'il faudrait corriger.

Rapport complet et écarts résiduels : [`docs/accessibility.md`](../../../docs/accessibility.md).
