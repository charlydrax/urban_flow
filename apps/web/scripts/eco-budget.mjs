#!/usr/bin/env node
/**
 * Budget de poids des pages — mesure d'éco-conception (UF-605 — C5, C10).
 *
 * ## Ce que le script mesure, et pourquoi pas ce que Next affiche
 *
 * `next build` imprime déjà un « First Load JS » par route. Cette valeur est
 * **non comprimée** : elle ne dit pas ce qui voyage réellement sur le réseau,
 * qui est la seule grandeur qui compte pour l'empreinte d'un chargement.
 * Ce script rejoue donc le calcul sur les fichiers produits, en gzip, et y
 * ajoute le **CSS** — que Next comptabilise à part alors qu'il est bloquant au
 * rendu et arrive par la même connexion.
 *
 * Le chiffre publié est donc : « octets transférés pour afficher cette page
 * la première fois, cache vide ». C'est celui qu'on peut comparer d'une version
 * à l'autre, et celui qui figure dans `docs/eco-conception.md`.
 *
 * ## Pourquoi un budget qui casse le build
 *
 * Une mesure ponctuelle rassure un jour et se périme le lendemain. Un budget
 * transforme l'éco-conception en contrainte vérifiable : une dépendance ajoutée
 * sans y penser fait échouer la commande, avec le nom de la route et l'écart.
 * C'est la même logique que l'audit d'accessibilité d'UF-602, qui tourne avec
 * les tests plutôt qu'en passe manuelle.
 *
 * ## Usage
 *
 * ```bash
 * npm run eco:budget              # build isolé + mesure + vérification
 * npm run eco:budget -- --no-build  # remesure la dernière sortie, sans rebâtir
 * npm run eco:budget -- --update    # réécrit les budgets sur la mesure du jour
 * ```
 *
 * Le build sort dans `.next-eco/`, **pas** dans `.next/` : les deux répertoires
 * sont partagés avec `npm run dev`, et bâtir par-dessus un serveur de
 * développement en cours lui retire ses chunks sous les pieds (voir
 * `next.config.ts`). La mesure reste donc lançable à tout moment.
 */

import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = path.join(WEB_ROOT, '.next-eco');
const BUDGET_FILE = path.join(WEB_ROOT, 'eco-budget.json');
const TSCONFIG = path.join(WEB_ROOT, 'tsconfig.json');

/**
 * Le layout racine est chargé par **toutes** les pages : ses chunks entrent
 * dans le coût de chacune. Le manifeste le publie comme une entrée à part.
 */
const LAYOUT_KEY = '/layout';

/**
 * Marge de tolérance au-dessus du budget, en octets.
 *
 * Un build n'est pas parfaitement déterministe (ordre des modules, hachage) :
 * quelques dizaines d'octets d'écart d'une exécution à l'autre sont normaux.
 * Sans marge, le budget crierait au loup sur du bruit et finirait ignoré —
 * le pire sort possible pour une garde-fou. 512 o laisse passer le bruit et
 * arrête une vraie régression, qui se compte en kilo-octets.
 */
const TOLERANCE_BYTES = 512;

/** Formate des octets en Ko à une décimale, unité de lecture du budget. */
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} ko`;

/**
 * Rejoue `next build` dans le répertoire isolé.
 *
 * Next.js **réécrit `tsconfig.json`** pendant la vérification des types (il y
 * ajoute le chemin de types du `distDir` courant, et reformate le fichier au
 * passage). Une mesure ne doit rien laisser derrière elle : le fichier est
 * donc sauvegardé avant, et restauré après, quoi qu'il arrive.
 */
function build() {
  const tsconfigBefore = fs.readFileSync(TSCONFIG);
  try {
    execFileSync('npx', ['next', 'build'], {
      cwd: WEB_ROOT,
      stdio: 'inherit',
      env: { ...process.env, NEXT_DIST_DIR: '.next-eco' },
      shell: process.platform === 'win32',
    });
  } finally {
    fs.writeFileSync(TSCONFIG, tsconfigBefore);
  }
}

/**
 * Poids gzip d'un asset du build.
 *
 * gzip et non brotli : c'est le plancher garanti par tous les navigateurs et
 * tous les hébergeurs. Mesurer en brotli publierait un chiffre plus flatteur
 * que ce que reçoit une partie des visiteurs — un budget doit être pessimiste.
 *
 * @returns Le poids comprimé, ou 0 si l'asset n'existe pas (chunk d'une
 *   version antérieure encore listé dans un manifeste périmé)
 */
function gzipSize(asset) {
  const file = path.join(DIST_DIR, asset);
  if (!fs.existsSync(file)) return 0;
  return gzipSync(fs.readFileSync(file), { level: 6 }).length;
}

/**
 * Mesure chaque route du manifeste applicatif.
 *
 * Les assets sont **dédoublonnés** avec ceux du layout avant d'être pesés : un
 * chunk partagé ne traverse le réseau qu'une fois, le compter deux fois
 * gonflerait artificiellement chaque page.
 *
 * @returns Une entrée par route : chemin public, poids JS et poids CSS
 */
function measure() {
  const manifestPath = path.join(DIST_DIR, 'app-build-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Aucun build à mesurer dans ${DIST_DIR}. Relancez sans --no-build.`);
  }

  const { pages } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const layoutAssets = pages[LAYOUT_KEY] ?? [];

  return Object.entries(pages)
    .filter(([route]) => route !== LAYOUT_KEY)
    .map(([route, assets]) => {
      const unique = [...new Set([...layoutAssets, ...assets])];
      const weigh = (ext) =>
        unique.filter((a) => a.endsWith(ext)).reduce((total, a) => total + gzipSize(a), 0);

      return {
        // `/page` → `/`, `/login/page` → `/login` : le chemin tel qu'il est
        // demandé, pour que le tableau se lise sans connaître le manifeste.
        route: route.replace(/\/page$/, '') || '/',
        js: weigh('.js'),
        css: weigh('.css'),
      };
    })
    .sort((a, b) => b.js + b.css - (a.js + a.css));
}

/** Budgets de référence, ou un objet vide au premier passage. */
function loadBudgets() {
  if (!fs.existsSync(BUDGET_FILE)) return {};
  return JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8')).routes ?? {};
}

/** Écrit les budgets mesurés (`--update`), avec la date de la mesure. */
function saveBudgets(rows) {
  const routes = Object.fromEntries(rows.map((r) => [r.route, r.js + r.css]));
  const content = {
    _comment:
      'Poids gzip (JS + CSS) transféré au premier chargement, en octets. ' +
      'Généré par `npm run eco:budget -- --update` (UF-605). ' +
      'Toute hausse doit être justifiée dans docs/eco-conception.md.',
    measuredAt: new Date().toISOString().slice(0, 10),
    routes,
  };
  fs.writeFileSync(BUDGET_FILE, `${JSON.stringify(content, null, 2)}\n`);
}

function main() {
  const args = process.argv.slice(2);
  const update = args.includes('--update');

  if (!args.includes('--no-build')) build();

  const rows = measure();
  const budgets = loadBudgets();

  if (update) {
    saveBudgets(rows);
    console.log(`\nBudgets réécrits dans ${path.relative(WEB_ROOT, BUDGET_FILE)}.\n`);
  }

  console.log('\nPoids transféré au premier chargement (gzip, cache vide) — UF-605\n');
  console.log(
    `${'Route'.padEnd(20)}${'JS'.padStart(10)}${'CSS'.padStart(10)}` +
      `${'Total'.padStart(10)}${'Budget'.padStart(10)}${'Écart'.padStart(10)}`,
  );
  console.log('-'.repeat(70));

  const overruns = [];

  for (const row of rows) {
    const total = row.js + row.css;
    const budget = budgets[row.route];
    const delta = budget === undefined ? null : total - budget;
    // `+` explicite sur les hausses : un tableau de chiffres nus se lit mal, et
    // c'est le signe du delta qui porte toute l'information.
    const deltaLabel =
      delta === null ? '—' : `${delta > 0 ? '+' : ''}${(delta / 1024).toFixed(1)} ko`;

    console.log(
      row.route.padEnd(20) +
        kb(row.js).padStart(10) +
        kb(row.css).padStart(10) +
        kb(total).padStart(10) +
        (budget === undefined ? '—' : kb(budget)).padStart(10) +
        deltaLabel.padStart(10),
    );

    if (delta !== null && delta > TOLERANCE_BYTES) {
      overruns.push({ route: row.route, delta });
    }
  }

  const heaviest = rows[0];
  console.log(
    `\nPage la plus lourde : ${heaviest.route} — ${kb(heaviest.js + heaviest.css)} transférés.`,
  );

  if (overruns.length > 0 && !update) {
    console.error('\nBudget dépassé :');
    for (const { route, delta } of overruns) {
      console.error(`  ${route} : +${kb(delta)} au-dessus du budget.`);
    }
    console.error(
      '\nSoit la hausse est justifiée — documentez-la dans docs/eco-conception.md et\n' +
        'relancez avec `--update` —, soit elle ne l’est pas et il faut alléger la page.\n',
    );
    process.exit(1);
  }

  console.log('');
}

main();
