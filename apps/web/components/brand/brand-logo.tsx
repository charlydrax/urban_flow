/**
 * Marque UrbanFlow Mobility — source unique des deux déclinaisons du logo
 * (BUG-004).
 *
 * Le logo fourni est un **bloc combiné** : un emblème (ville, vélo,
 * trottinette, voiture, pris dans une vague) surmontant le mot-symbole
 * « UrbanFlow MOBILITY ». Les deux moitiés ne tiennent pas aux mêmes tailles,
 * d'où deux composants plutôt qu'un seul redimensionné :
 *
 * - `BrandLockup` — le bloc entier. Lisible à partir d'environ 140 px de large ;
 *   réservé aux endroits qui ont la place (rail de navigation desktop, écrans
 *   d'authentification).
 * - `BrandMark` — l'emblème seul, sans texte. C'est la déclinaison des petites
 *   tailles (barre de marque mobile), et celle dont dérive la favicon : sous
 *   ~60 px, le mot-symbole n'est plus qu'une tache grise.
 *
 * ## Pourquoi `<img>` et non `next/image` (C5)
 *
 * `next/image` apporte un composant client et son runtime. Ces deux images-ci
 * sont statiques, de dimensions fixes, déjà redimensionnées et compressées à la
 * taille d'affichage (PNG palettisé, < 45 ko à elles deux). L'optimiseur n'a
 * donc rien à optimiser, mais son runtime entrerait dans le lot JavaScript du
 * **layout racine**, c'est-à-dire de toutes les pages. Une balise `<img>` avec
 * `width`/`height` explicites rend le même service pour zéro octet de JS — et
 * les dimensions intrinsèques déclarées évitent le décalage de mise en page
 * (CLS) que la règle Next cherche justement à prévenir.
 *
 * ## Accessibilité (C7)
 *
 * Chaque composant accepte `alt`. La règle est celle de WCAG 1.1.1 : si le
 * logo est **le** contenu du lien, il porte le nom accessible (`alt="UrbanFlow
 * Mobility"`) ; s'il est posé à côté d'un texte qui dit déjà la même chose, il
 * est décoratif (`alt=""`) — sans quoi un lecteur d'écran annoncerait la marque
 * deux fois de suite.
 */

interface BrandImageProps {
  /**
   * Texte alternatif. Chaîne vide = image décorative, doublée par un texte
   * voisin (WCAG 1.1.1).
   */
  alt: string;
  /** Classes utilitaires de taille/mise en forme appliquées à l'image. */
  className?: string;
}

/** Dimensions intrinsèques des fichiers, pour réserver la place au chargement. */
const LOCKUP = { src: '/brand/logo-urbanflow.png', width: 480, height: 368 } as const;
const MARK = { src: '/brand/logo-urbanflow-mark.png', width: 179, height: 96 } as const;

/**
 * Bloc marque complet (emblème + mot-symbole).
 *
 * @param alt Nom accessible, ou `''` si un texte voisin porte déjà la marque.
 * @param className Classes de taille — prévoir au moins ~140 px de large.
 */
export function BrandLockup({ alt, className }: BrandImageProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- cf. en-tête du fichier (C5)
    <img
      src={LOCKUP.src}
      alt={alt}
      width={LOCKUP.width}
      height={LOCKUP.height}
      className={className}
      // La marque est au-dessus de la ligne de flottaison sur tous les écrans
      // où elle apparaît : la charger paresseusement retarderait le premier
      // rendu utile au lieu de l'alléger.
      loading="eager"
      decoding="async"
    />
  );
}

/**
 * Emblème seul, sans mot-symbole — déclinaison des petites tailles.
 *
 * @param alt Nom accessible, ou `''` si un texte voisin porte déjà la marque.
 * @param className Classes de taille.
 */
export function BrandMark({ alt, className }: BrandImageProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- cf. en-tête du fichier (C5)
    <img
      src={MARK.src}
      alt={alt}
      width={MARK.width}
      height={MARK.height}
      className={className}
      loading="eager"
      decoding="async"
    />
  );
}
