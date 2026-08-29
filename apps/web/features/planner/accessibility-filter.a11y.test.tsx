import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { describeAppliedConstraints, describeEmptyResult } from '../../lib/plan-feedback';
import { expectNoA11yViolations } from '../../test/axe';
import { PlanNotice } from './plan-notice';

/**
 * Le filtre PMR, tel que l'écran le montre (UF-602 — recette 4, C7/C12).
 *
 * ## Ce que ce fichier vérifie, et pourquoi il existe à part
 *
 * `plan-feedback.test.ts` vérifie déjà **ce qui se dit** ; ici on vérifie que
 * ça arrive bien à l'écran, dans un DOM que les technologies d'assistance
 * peuvent lire. Les deux étages sont nécessaires : un message parfait qui
 * n'atteint jamais le rendu ne sert à personne, et un rendu conforme qui
 * n'annonce rien non plus.
 *
 * La chaîne complète que le ticket demande de rendre visible :
 *
 * ```
 * profil « Itinéraires accessibles PMR »   (apps/web — mobility-profile-form)
 *        │  PATCH /users/me
 *        ▼
 * users.getPreferences().reducedMobility   (apps/api — étape 3 du flux)
 *        ├─► OTP : wheelchair: true        (transit.service — la requête change)
 *        ├─► fusion : filtre dur           (itinerary-merger — le candidat non
 *        │                                  accessible est écarté, pas rétrogradé)
 *        └─► réponse : appliedConstraints   (UF-602 — ce que le client peut lire)
 *                     │
 *                     ▼
 *        note « Filtre accessibilité actif » sur le panneau de résultats
 * ```
 */
describe('filtre d’accessibilité PMR à l’écran — WCAG 2.1 AA', () => {
  it('la note annonce le filtre sans interrompre la lecture (WCAG 4.1.3)', async () => {
    const notice = describeAppliedConstraints({ reducedMobility: true });
    expect(notice).not.toBeNull();

    render(<PlanNotice tone="info" role={notice!.role} message={notice!.message} />);

    // `status` et non `alert` : la contrainte fonctionne, il n'y a pas
    // d'urgence à couper la parole au lecteur d'écran.
    const region = screen.getByRole('status');
    expect(region.textContent).toMatch(/fauteuil roulant/i);
    expect(region.textContent).toMatch(/profil/i);

    await expectNoA11yViolations();
  });

  it('une liste vide sous filtre explique le vide au lieu de le constater (WCAG 3.3.1)', async () => {
    const notice = describeEmptyResult(
      [
        { source: 'transit', available: true },
        { source: 'sharedMobility', available: true },
        { source: 'cyclePaths', available: true },
      ],
      { reducedMobility: true },
    );

    render(<PlanNotice tone="info" role={notice.role} message={notice.message} />);

    const region = screen.getByRole('status');
    // Sans cette phrase, l'usager conclurait « ce trajet n'existe pas » alors
    // qu'il existe — mais pas sous la contrainte qu'il a lui-même posée.
    expect(region.textContent).toMatch(/fauteuil roulant/i);
    expect(region.textContent).toMatch(/décochez/i);

    await expectNoA11yViolations();
  });

  it('n’annonce rien quand aucune contrainte n’est active', () => {
    // Un bandeau permanent finirait par ne plus être lu — et rendrait le vrai
    // message invisible le jour où il paraît.
    expect(describeAppliedConstraints({ reducedMobility: false })).toBeNull();
  });
});
