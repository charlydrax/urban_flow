import type { Request, Response } from 'express';

/**
 * Politique de compression des réponses de l'API Gateway (UF-605 — C5 / C10).
 *
 * ## Pourquoi c'est un sujet d'éco-conception, et pas seulement de performance
 *
 * L'octet le plus sobre est celui qu'on n'envoie pas. Sur `POST /routes/plan`,
 * la réponse la plus lourde du système, la mesure du ticket donne **10 624 o
 * bruts → 1 578 o en gzip, soit 85 % de trafic en moins** pour un calcul de
 * quelques millisecondes côté serveur. Le corps est du JSON très répétitif
 * (mêmes clés sur chaque segment, coordonnées voisines) : c'est exactement la
 * forme de données que gzip réduit le mieux.
 *
 * Ce que ça change concrètement, sur le terrain d'usage du produit : moins de
 * temps radio sur un réseau mobile dégradé — le poste de consommation
 * dominant d'un smartphone en mobilité —, et un itinéraire qui arrive avant
 * que l'usager n'abandonne dans un couloir de métro.
 *
 * ## Ce que la politique protège
 *
 * Comprimer une réponse **qui contient un secret** et dont une partie est
 * influencée par l'attaquant, c'est le motif d'attaque BREACH : la taille
 * comprimée fuit alors, octet par octet, le contenu du secret. `POST
 * /auth/login` et `POST /auth/register` renvoient un `accessToken` dans le
 * corps — ils sont donc exclus, explicitement et par leur chemin.
 *
 * L'exclusion est écrite noir sur blanc plutôt que laissée au hasard du seuil :
 * ces réponses passent aujourd'hui sous les 1 024 octets et ne seraient pas
 * comprimées de toute façon, mais un champ de plus dans le profil renvoyé
 * suffirait à les faire basculer — silencieusement. Une protection qui dépend
 * d'une taille qu'on ne contrôle pas n'est pas une protection.
 *
 * Voir `docs/eco-conception.md` (§ compression) et `docs/securite-owasp.md`.
 */

/**
 * Taille minimale, en octets, à partir de laquelle comprimer.
 *
 * En dessous, l'opération est contre-productive dans les deux sens : l'en-tête
 * gzip et le dictionnaire coûtent une trentaine d'octets qui annulent le gain
 * sur un petit corps, et on dépense du CPU — donc de l'énergie, des deux côtés
 * du réseau — pour transporter *plus* d'octets. La sobriété, ici, c'est de ne
 * rien faire.
 *
 * 1 024 o est le seuil par défaut de `compression` ; il est réaffirmé ici parce
 * qu'une valeur par défaut de dépendance n'est pas une décision traçable.
 */
export const COMPRESSION_THRESHOLD_BYTES = 1024;

/**
 * Chemins dont les réponses ne sont **jamais** comprimées (voir BREACH ci-dessus).
 *
 * Comparés en préfixe sur le chemin complet, préfixe global `/api` compris :
 * c'est ce que porte `req.path` au moment où le middleware s'exécute.
 */
const UNCOMPRESSED_PATHS = ['/api/auth/login', '/api/auth/register'];

/**
 * Décide si une réponse donnée doit être comprimée.
 *
 * Trois règles, dans l'ordre :
 * 1. `x-no-compression` sur la requête — échappatoire conventionnelle de la
 *    bibliothèque, utile pour diagnostiquer une réponse à la main ;
 * 2. chemin portant un secret dans le corps — jamais comprimé ;
 * 3. sinon, on s'en remet à l'heuristique de type de contenu de `compression`,
 *    passée en paramètre (elle écarte déjà les formats déjà comprimés : images,
 *    archives, vidéo).
 *
 * Fonction **pure** et testable sans serveur HTTP : c'est la raison d'être de
 * ce module. Une politique de sécurité qu'on ne peut pas tester en isolation
 * finit par n'être testée nulle part.
 *
 * @param req Requête entrante (seuls `path` et les en-têtes sont lus)
 * @param res Réponse en cours de construction
 * @param fallback Filtre par défaut de `compression`, consulté en dernier
 * @returns `true` si la réponse peut être comprimée
 */
export function shouldCompress(
  req: Pick<Request, 'path' | 'headers'>,
  res: Response,
  fallback: (req: Request, res: Response) => boolean,
): boolean {
  if (req.headers['x-no-compression']) {
    return false;
  }

  if (UNCOMPRESSED_PATHS.some((path) => req.path.startsWith(path))) {
    return false;
  }

  return fallback(req as Request, res);
}
