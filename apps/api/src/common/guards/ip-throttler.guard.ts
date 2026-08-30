import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { throttleTracker } from '../throttling';

/**
 * Guard de limitation de débit de l'API Gateway (UF-604, révisé par UF-802).
 *
 * Il ne change ni les fenêtres ni les plafonds — ceux-ci restent déclarés dans
 * `common/throttling.ts` — mais **la clé sur laquelle on compte** :
 *
 * | Adresse de la requête | Clé du compteur     |
 * | --------------------- | ------------------- |
 * | `203.0.113.7`         | `203.0.113.7`       |
 * | `::ffff:203.0.113.7`  | `203.0.113.7`       |
 * | `2001:db8:1:2:a::9`   | `2001:db8:1:2::/64` |
 *
 * Le comportement par défaut de `@nestjs/throttler` — compter `req.ip` tel
 * quel — laissait un client IPv6 se donner un compteur neuf à chaque requête en
 * changeant d'adresse dans son propre bloc (RFC 4941). Sur un endpoint
 * authentifié, la portée du défaut restait limitée ; depuis qu'UF-801 a ouvert
 * `/routes/plan` sans compte, c'était le plafond de l'endpoint le plus coûteux
 * du système qui devenait contournable sans rien à prouver (C4 — OWASP A04).
 *
 * Le « pourquoi » du /64 et le traitement des adresses IPv4 encapsulées sont
 * détaillés sur `throttleTracker`, qui reste une fonction pure et testée à part
 * — ce guard n'est que le branchement.
 *
 * ⚠️ La justesse de `req.ip` derrière un reverse proxy dépend de `TRUST_PROXY`
 * (voir `main.ts`) : sans ce réglage, toutes les requêtes portent l'IP du proxy
 * et partagent un seul compteur ; avec ce réglage en exposition directe,
 * n'importe qui se forge une IP par un en-tête `X-Forwarded-For`.
 */
@Injectable()
export class IpThrottlerGuard extends ThrottlerGuard {
  /**
   * Rend la clé de comptage d'une requête.
   *
   * @param req Requête entrante — `req.ip` est résolu par Express, en tenant
   *   compte de `trust proxy` quand il est configuré
   * @returns Clé stable partagée par toutes les requêtes du même client
   */
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    return Promise.resolve(throttleTracker(req.ip as string | undefined));
  }
}
