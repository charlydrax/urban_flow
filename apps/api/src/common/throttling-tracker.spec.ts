import { IPV6_TRACKED_PREFIX_BITS, throttleTracker, UNKNOWN_TRACKER } from './throttling';

/**
 * Recette 3 d'UF-802 : « `/api/routes/plan` reste protégé contre les abus en
 * accès public (rate limiting par IP effectif) ».
 *
 * Un plafond ne vaut que ce que vaut la clé sur laquelle il compte. Ces cas
 * portent donc sur `throttleTracker` : deux requêtes d'un même client doivent
 * tomber dans le même compartiment, et deux clients distincts dans deux
 * compartiments distincts — sans qu'aucun ne puisse s'en fabriquer un neuf.
 *
 * La fonction est pure : elle se teste sans monter d'application, contrairement
 * au comportement HTTP couvert par `throttling.spec.ts`.
 */
describe('clé de comptage du rate limiting (UF-802 — C4 / OWASP A04)', () => {
  describe('IPv4', () => {
    it('compte une adresse IPv4 telle quelle', () => {
      expect(throttleTracker('203.0.113.7')).toBe('203.0.113.7');
    });

    it('sépare deux adresses IPv4 différentes', () => {
      expect(throttleTracker('203.0.113.7')).not.toBe(throttleTracker('203.0.113.8'));
    });

    it('ramène une IPv4 encapsulée en IPv6 à la même clé que sa forme native', () => {
      // Node en écoute double pile rend `::ffff:203.0.113.7`. Sans cette
      // normalisation, le même client aurait deux compteurs selon la pile.
      expect(throttleTracker('::ffff:203.0.113.7')).toBe('203.0.113.7');
      expect(throttleTracker('127.0.0.1')).toBe(throttleTracker('::ffff:127.0.0.1'));
    });
  });

  describe('IPv6 — regroupement au réseau /64', () => {
    it('range deux adresses du même /64 dans le même compartiment', () => {
      // Le cas qui compte : un client IPv6 change librement d'adresse dans son
      // propre bloc (RFC 4941). S'il changeait aussi de compteur, le plafond
      // serait remis à zéro à chaque requête — donc inexistant.
      const first = throttleTracker('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
      const second = throttleTracker('2001:db8:1:2:1111:2222:3333:4444');

      expect(first).toBe(second);
      expect(first).toBe(`2001:db8:1:2::/${IPV6_TRACKED_PREFIX_BITS}`);
    });

    it('sépare deux réseaux /64 distincts', () => {
      expect(throttleTracker('2001:db8:1:2::1')).not.toBe(throttleTracker('2001:db8:1:3::1'));
    });

    it('lit les formes abrégées comme leur forme longue', () => {
      expect(throttleTracker('2001:db8::1')).toBe(throttleTracker('2001:0db8:0000:0000::99'));
      expect(throttleTracker('::1')).toBe(`0:0:0:0::/${IPV6_TRACKED_PREFIX_BITS}`);
    });

    it('ignore l’identifiant de zone d’une adresse lien-local', () => {
      expect(throttleTracker('fe80::1%eth0')).toBe(throttleTracker('fe80::2'));
    });

    it('ne fait pas dépendre la clé de la casse', () => {
      expect(throttleTracker('2001:DB8:1:2::1')).toBe(throttleTracker('2001:db8:1:2::1'));
    });
  });

  describe('entrées dégénérées', () => {
    it('regroupe les requêtes sans IP lisible plutôt que de les laisser sans compteur', () => {
      // En cas de doute, on plafonne plus fort : une voie non comptée serait
      // exactement la faille que le plafond est censé fermer.
      expect(throttleTracker(undefined)).toBe(UNKNOWN_TRACKER);
      expect(throttleTracker(null)).toBe(UNKNOWN_TRACKER);
      expect(throttleTracker('   ')).toBe(UNKNOWN_TRACKER);
    });

    it('garde une adresse IPv6 illisible entière plutôt que de la mutualiser', () => {
      // Trop de groupes, double `::`, caractère interdit : on ne sait pas la
      // réduire, mais on sait toujours la compter — et un compteur trop fin
      // reste préférable à un compartiment commun où tout le monde se gêne.
      expect(throttleTracker('2001:db8::1::2')).toBe('2001:db8::1::2');
      expect(throttleTracker('1:2:3:4:5:6:7:8:9')).toBe('1:2:3:4:5:6:7:8:9');
      expect(throttleTracker('2001:db8:zzzz::1')).toBe('2001:db8:zzzz::1');
    });
  });
});
