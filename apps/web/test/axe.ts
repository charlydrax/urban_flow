import axe, { type AxeResults, type ElementContext, type RunOptions } from 'axe-core';

/**
 * Harnais d'audit accessibilité — axe-core exécuté sur le DOM rendu (UF-602).
 *
 * ## Pourquoi axe-core « nu » plutôt qu'un wrapper
 *
 * `jest-axe` / `vitest-axe` apportent surtout un matcher `toHaveNoViolations`
 * et une mise en forme. Ici, la mise en forme est justement ce qu'on veut
 * maîtriser : un échec doit citer la **règle WCAG**, le sélecteur fautif et le
 * correctif attendu, sinon le rapport d'audit demandé par la recette du ticket
 * se résume à « 3 violations » et n'aide personne. Une dépendance de moins, et
 * un message d'erreur qui tient lieu de rapport.
 *
 * ## Le périmètre exact : WCAG 2.1 niveau AA
 *
 * Les tags axe sélectionnés (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`) sont
 * la traduction littérale de la contrainte C7. Les règles « best-practice »
 * d'axe sont **exclues** : elles sont utiles mais ne relèvent pas de la norme,
 * et les mêler ferait échouer la CI sur des recommandations qu'aucun texte
 * n'impose — le ticket demande AA, pas AAA ni le goût d'un outil.
 *
 * ## Ce que cet audit ne peut pas voir
 *
 * axe analyse un DOM, pas un rendu. Sans moteur de style, il ne peut vérifier
 * ni les **contrastes** (`color-contrast` est inopérant sous jsdom) ni les
 * tailles de cible réelles. Ces deux points sont couverts autrement :
 *
 * | Critère WCAG                | Vérifié par                                    |
 * | --------------------------- | ---------------------------------------------- |
 * | 1.4.3 Contraste (texte)     | `lib/design-tokens.test.ts` (calcul des ratios) |
 * | 1.4.11 Contraste (non-texte)| `lib/route-map-layers.test.ts`                  |
 * | 2.5.5 Taille de cible       | passe Lighthouse manuelle — `docs/accessibility.md` |
 *
 * C'est la raison d'être du document d'audit : dire ce que l'automatisation
 * couvre, et par quoi le reste est couvert.
 */

/** Tags axe correspondant exactement à WCAG 2.1 niveau AA (C7). */
export const WCAG_21_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

/**
 * Règles désactivées, avec leur justification — jamais pour masquer un défaut.
 *
 * `color-contrast` : axe lit les couleurs calculées par le navigateur. jsdom
 * n'applique pas Tailwind, tous les éléments y sont noir sur transparent, et la
 * règle rendrait soit des faux positifs massifs, soit un « incomplete » inutile.
 * Les contrastes de la charte sont calculés et vérifiés ailleurs
 * (`lib/design-tokens.test.ts`), sur les valeurs source plutôt que sur un rendu.
 */
const DISABLED_RULES = ['color-contrast'] as const;

const RUN_OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: [...WCAG_21_AA_TAGS] },
  rules: Object.fromEntries(DISABLED_RULES.map((rule) => [rule, { enabled: false }])),
  // `resultTypes` réduit le travail d'axe aux violations : on ne lit ni les
  // « passes » ni les « inapplicable », les collecter coûterait du temps de CI
  // pour un rapport que personne n'ouvre (C5).
  resultTypes: ['violations'],
};

/**
 * Analyse un fragment de DOM et rend le résultat brut d'axe.
 *
 * @param container Racine à auditer — par défaut le `body` du document de test.
 */
export async function analyze(container: ElementContext = document.body): Promise<AxeResults> {
  return axe.run(container, RUN_OPTIONS);
}

/**
 * Met en forme les violations pour qu'un échec de test soit directement
 * lisible comme une ligne de rapport d'audit.
 */
function formatViolations(results: AxeResults): string {
  return results.violations
    .map((violation) => {
      const criteria = violation.tags
        .filter((tag) => tag.startsWith('wcag'))
        .join(', ')
        .toUpperCase();
      const targets = violation.nodes
        .map((node) => `      - ${node.target.join(' ')}\n        ${node.failureSummary ?? ''}`)
        .join('\n');
      return [
        `  [${violation.impact ?? 'n/a'}] ${violation.id} — ${violation.help}`,
        `    Critères : ${criteria || 'non étiqueté'}`,
        `    Référence : ${violation.helpUrl}`,
        targets,
      ].join('\n');
    })
    .join('\n\n');
}

/**
 * Assertion d'audit : échoue si le DOM viole une règle WCAG 2.1 AA.
 *
 * Couvre : C7. À appeler après chaque `render()` d'un composant exporté —
 * c'est ce qui fait de l'accessibilité une **régression détectable** et non une
 * relecture ponctuelle.
 *
 * @param container Racine à auditer (défaut : `document.body`).
 * @throws Une erreur détaillant chaque violation, sa règle et son sélecteur.
 */
export async function expectNoA11yViolations(container: ElementContext = document.body) {
  const results = await analyze(container);
  if (results.violations.length > 0) {
    throw new Error(
      `Audit WCAG 2.1 AA — ${results.violations.length} violation(s) :\n\n${formatViolations(results)}`,
    );
  }
}
