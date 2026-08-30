#!/usr/bin/env node
/**
 * Audit responsive & normes des écrans clés (UF-606 — C2, C3, C7).
 *
 * ## Pourquoi un script, et pas une passe manuelle
 *
 * « Vérifier que tout va bien sur mobile, tablette et desktop » est le genre de
 * recette qu'on coche une fois et qui se périme au ticket suivant. La régression
 * qui a motivé ce script en est l'illustration : une seule adresse un peu longue
 * dans l'historique des trajets élargissait la colonne du planificateur à 489 px
 * sur un écran de 375, et **toute** la page défilait horizontalement — en-tête et
 * pied de page compris. Rien dans les tests ne pouvait le voir : ni Vitest ni
 * jsdom n'ont de moteur de mise en page.
 *
 * Ce script rend donc la recette rejouable. Il pilote un Chrome sans interface
 * par le protocole DevTools, charge chaque écran clé à chaque point de rupture
 * de la charte, et **échoue** si un écran déborde ou si le HTML rendu s'écarte
 * des standards. Même logique que l'audit d'accessibilité d'UF-602 et que le
 * budget de poids d'UF-605 : une contrainte vérifiable plutôt qu'une intention.
 *
 * ## Ce qu'il contrôle
 *
 * | Contrôle                        | Ce qu'il attrape                          | C  |
 * | ------------------------------- | ----------------------------------------- | -- |
 * | Débordement horizontal          | grille sans plancher, élément trop large  | C2 |
 * | Taille des cibles tactiles      | bouton ou case trop petit au doigt        | C7 |
 * | Identifiants dupliqués          | HTML invalide, `for`/`aria` qui se perdent | C3 |
 * | Références ARIA pendantes       | libellé annoncé dans le vide              | C3 |
 * | Champ sans nom accessible       | saisie muette au lecteur d'écran          | C7 |
 * | Hiérarchie de titres            | `h2` sauté, plusieurs `h1`                | C3 |
 * | Imbrications interdites         | `<div>` dans `<p>`, bouton dans bouton    | C3 |
 * | Repères de page                 | `main` unique, `lang`, `<title>`          | C3 |
 *
 * Ces contrôles sont **structurels**. Ils ne remplacent pas l'audit axe-core
 * (`npm run test:a11y`), qui juge le rendu composant par composant, ni l'œil sur
 * les maquettes : un écran peut être valide, sans débordement, et laid.
 *
 * ## Usage
 *
 * ```bash
 * npm run dev                      # dans un autre terminal : web + API
 * npm run audit:responsive         # audite les écrans publics ET privés
 * npm run audit:responsive -- --shots ./captures   # écrit les captures
 * ```
 *
 * Les écrans privés (planificateur, profil, impact) exigent une session : le
 * script ouvre la sienne avec le compte de démonstration du seed
 * (`prisma/seed.ts`). Sans API joignable, il audite les écrans publics et le
 * signale, plutôt que de tout refuser.
 *
 * Variables d'environnement : `WEB_URL`, `API_URL`, `DEMO_EMAIL`,
 * `DEMO_PASSWORD`, `CHROME_PATH`.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3000';
const API_URL = process.env.API_URL ?? 'http://localhost:3001/api';
const DEMO_EMAIL = process.env.DEMO_EMAIL ?? 'marie@urbanflow.dev';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'UrbanFlow!2026';
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9333);

/**
 * Points de rupture audités — ceux de la charte, plus la largeur des maquettes.
 *
 * 375 et 1440 sont les deux formats **dessinés** (« 02 · MAQUETTES MOBILE » en
 * 375×812, « 03 · MAQUETTES DESKTOP » en 1440). 768 et 1024 sont les deux
 * bascules Tailwind du projet : c'est là que la mise en page change d'avis, donc
 * là qu'elle casse. Auditer 375 et 1440 seulement laisserait passer exactement
 * le genre de pliage d'en-tête qu'on a trouvé à 768.
 */
const VIEWPORTS = [
  { name: 'mobile 375', width: 375, height: 812, mobile: true },
  { name: 'tablette 768', width: 768, height: 1024, mobile: true },
  { name: 'paysage 1024', width: 1024, height: 768, mobile: false },
  { name: 'desktop 1440', width: 1440, height: 900, mobile: false },
];

/**
 * Écrans clés du parcours. `private` : exige une session ouverte.
 *
 * Le planificateur est passé à `false` avec UF-803 : il est **public** depuis
 * UF-801, et le laisser marqué privé faisait discrètement sauter l'écran le plus
 * large du produit dès que l'API n'était pas jointe — c'est-à-dire précisément
 * quand on lance l'audit sur un front seul.
 */
const ROUTES = [
  { path: '/', label: 'planificateur', private: false, settleMs: 6000 },
  { path: '/impact', label: 'impact', private: true, settleMs: 4000 },
  { path: '/profil', label: 'profil', private: true, settleMs: 4000 },
  { path: '/login', label: 'connexion', private: false, settleMs: 2500 },
  { path: '/register', label: 'inscription', private: false, settleMs: 2500 },
  { path: '/confidentialite', label: 'confidentialité', private: false, settleMs: 2500 },
];

/**
 * Plancher de cible tactile, en pixels CSS.
 *
 * 24 px est le seuil **AA** (WCAG 2.2, critère 2.5.8 « Target Size (Minimum) »),
 * pas les 44 px du critère AAA que vise la charte. Le script arrête donc ce qui
 * est hors norme, et le tableau de la charte reste l'objectif de qualité : un
 * garde-fou qui échoue sur un objectif ambitieux finit désactivé.
 *
 * La cible mesurée est le plus petit ancêtre **cliquable** : une case à cocher
 * de 16 px enveloppée dans un `<label>` rembourré est une cible de la taille du
 * label, ce que le doigt touche réellement.
 */
const MIN_TARGET_PX = 24;

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Le contrôle exécuté dans la page. Rendu en chaîne : il part par CDP. */
const AUDIT_SCRIPT = String.raw`JSON.stringify((() => {
  const findings = [];
  const add = (rule, detail) => findings.push({ rule, detail });
  const de = document.documentElement;

  // --- C2 : débordement horizontal --------------------------------------
  // On remonte les fautifs plutôt que le seul symptôme : « la page déborde »
  // n'aide personne, « ce <form> va jusqu'à 505 px » se corrige.
  if (de.scrollWidth > de.clientWidth + 1) {
    const guilty = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right <= de.clientWidth + 1 && r.left >= -1) continue;
      // Un enfant large dans un conteneur qui défile est voulu (tableau de la
      // politique de confidentialité) : ce n'est pas lui qui pousse la page.
      let p = el.parentElement, inScroller = false;
      while (p && p !== document.body) {
        if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) { inScroller = true; break; }
        p = p.parentElement;
      }
      if (inScroller) continue;
      // Le lien d'évitement vit hors écran par construction (WCAG 2.4.1).
      if (el.classList.contains('skip-link')) continue;
      guilty.push(el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).trim().split(/ +/)[0] : '')
        + ' [' + Math.round(r.left) + '→' + Math.round(r.right) + 'px]');
      // Huit fautifs listés et non trois (UF-803) : la barre d'onglets est en
      // position fixed et s'étire à la largeur de défilement du document. Elle
      // apparaît donc en tête de liste dès qu'une autre boîte déborde, et avec
      // ses deux enfants elle consommait à elle seule les trois places
      // disponibles — le vrai coupable n'était jamais imprimé.
    }
    add('debordement-horizontal', de.scrollWidth + 'px de contenu pour ' + de.clientWidth + 'px de fenêtre'
      + (guilty.length ? ' — ' + guilty.slice(0, 8).join(', ') : ''));
  }

  // --- C7 : cibles tactiles ---------------------------------------------
  const clickableAncestor = (el) => {
    let n = el;
    while (n && n !== document.body) {
      if (n.tagName === 'LABEL' || n.tagName === 'BUTTON' || n.tagName === 'A') return n;
      n = n.parentElement;
    }
    return el;
  };
  for (const el of document.querySelectorAll('button, [role=button], input[type=checkbox], input[type=radio], select')) {
    const target = clickableAncestor(el);
    const r = target.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;              // masqué
    if (getComputedStyle(target).visibility === 'hidden') continue;
    if (r.width < MIN_TARGET_PX || r.height < MIN_TARGET_PX) {
      const name = (target.innerText || target.getAttribute('aria-label') || el.value || '').trim().slice(0, 40);
      add('cible-tactile', Math.round(r.width) + '×' + Math.round(r.height) + 'px — « ' + name + ' »');
    }
  }

  // --- C3 : identifiants et références ------------------------------------
  const ids = new Map();
  for (const el of document.querySelectorAll('[id]')) ids.set(el.id, (ids.get(el.id) || 0) + 1);
  for (const [id, n] of ids) if (n > 1) add('id-duplique', '#' + id + ' × ' + n);

  for (const attr of ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns']) {
    for (const el of document.querySelectorAll('[' + attr + ']')) {
      for (const ref of el.getAttribute(attr).split(' ').filter(Boolean)) {
        if (!document.getElementById(ref)) add('reference-pendante', attr + ' → #' + ref);
      }
    }
  }
  for (const el of document.querySelectorAll('label[for]')) {
    if (!document.getElementById(el.htmlFor)) add('label-for-pendant', 'for="' + el.htmlFor + '"');
  }

  // --- C7 : tout champ porte un nom accessible ----------------------------
  for (const el of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
    const named = (el.labels && el.labels.length) || el.getAttribute('aria-label')
      || el.getAttribute('aria-labelledby') || el.title;
    if (!named) add('champ-sans-nom', el.outerHTML.slice(0, 80));
  }

  // --- C3 : hiérarchie de titres -----------------------------------------
  const levels = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => +h.tagName[1]);
  const h1 = levels.filter((n) => n === 1).length;
  if (h1 !== 1) add('titre-h1', h1 + ' élément(s) h1 — il en faut exactement un');
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] > levels[i - 1] + 1) add('niveau-saute', 'h' + levels[i - 1] + ' → h' + levels[i]);
  }

  // --- C3 : imbrications interdites par la spécification HTML -------------
  for (const p of document.querySelectorAll('p')) {
    const bad = p.querySelector('p, div, ul, ol, section, table, form, h1, h2, h3, h4, h5, h6');
    if (bad) add('imbrication-dans-p', '<p> contient <' + bad.tagName.toLowerCase() + '>');
  }
  for (const li of document.querySelectorAll('li')) {
    const parent = li.parentElement && li.parentElement.tagName;
    if (!['UL', 'OL', 'MENU'].includes(parent)) add('li-hors-liste', 'parent <' + String(parent).toLowerCase() + '>');
  }
  for (const list of document.querySelectorAll('ul, ol')) {
    for (const child of list.children) {
      if (!['LI', 'SCRIPT', 'TEMPLATE'].includes(child.tagName)) {
        add('enfant-de-liste', '<' + list.tagName.toLowerCase() + '> contient <' + child.tagName.toLowerCase() + '>');
      }
    }
  }
  for (const el of document.querySelectorAll('button, a[href]')) {
    const nested = el.querySelector('button, a[href], input:not([type=hidden]), select, textarea');
    if (nested) add('interactif-imbrique', el.tagName.toLowerCase() + ' > ' + nested.tagName.toLowerCase());
  }

  // --- C3 : repères de page ----------------------------------------------
  const mains = document.querySelectorAll('main').length;
  if (mains !== 1) add('repere-main', mains + ' élément(s) <main>');
  if (de.lang !== 'fr') add('langue', 'lang="' + de.lang + '" (attendu : fr)');
  if (!document.title) add('titre-page', 'document.title vide');
  for (const img of document.querySelectorAll('img')) {
    if (img.getAttribute('alt') === null) add('image-sans-alt', String(img.currentSrc || img.src).slice(0, 60));
  }

  // --- C3/C7 : formulaires et tableaux ------------------------------------
  for (const f of document.querySelectorAll('fieldset')) {
    if (!f.querySelector('legend')) add('fieldset-sans-legend', String(f.className).slice(0, 40));
  }
  for (const t of document.querySelectorAll('table')) {
    if (!t.querySelector('caption')) add('tableau-sans-caption', String(t.className).slice(0, 40));
    for (const th of t.querySelectorAll('th')) {
      if (!th.getAttribute('scope')) add('th-sans-scope', th.textContent.trim().slice(0, 30));
    }
  }

  return { title: document.title, findings };
})())`.replaceAll('MIN_TARGET_PX', String(MIN_TARGET_PX));

/** Minuscule client CDP — Node 22 apporte `WebSocket`, aucune dépendance requise. */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('connexion CDP impossible'));
  });

  let seq = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  };

  return {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      }),
    close: () => ws.close(),
  };
}

async function launchChrome() {
  const binary = chromeCandidates.find((p) => fs.existsSync(p));
  if (!binary) {
    console.error(
      'Chrome introuvable. Indiquez son chemin : CHROME_PATH=/chemin/vers/chrome npm run audit:responsive',
    );
    process.exit(2);
  }

  const profile = fs.mkdtempSync(path.join(process.env.TEMP ?? '/tmp', 'uf-audit-'));
  const child = spawn(
    binary,
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--disable-gpu',
      '--hide-scrollbars', // une barre de défilement fausserait clientWidth
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(400);
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return { child, profile, page };
    } catch {
      /* Chrome n'écoute pas encore. */
    }
  }
  child.kill();
  throw new Error("Chrome n'a pas ouvert son port de débogage.");
}

/** Ouvre une session avec le compte de démonstration ; `null` si l'API se tait. */
async function openSession() {
  try {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
    });
    if (!response.ok) return null;
    const cookie = response.headers.get('set-cookie');
    const match = cookie && /access_token=([^;]+)/.exec(cookie);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function main() {
  const shotsFlag = process.argv.indexOf('--shots');
  const shotsDir = shotsFlag === -1 ? null : (process.argv[shotsFlag + 1] ?? 'responsive-shots');
  if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

  const token = await openSession();
  if (!token) {
    console.warn(
      `⚠  Aucune session : ${API_URL} ne répond pas, ou le compte de démonstration n'existe pas\n` +
        '   (lancez `npm run db:seed`). Les écrans privés sont ignorés.\n',
    );
  }

  const { child, profile, page } = await launchChrome();
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  if (token) {
    await cdp.send('Network.setCookie', {
      name: 'access_token',
      value: token,
      domain: new URL(WEB_URL).hostname,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    });
  }

  const routes = ROUTES.filter((r) => token || !r.private);
  const failures = [];

  console.log(`\nAudit responsive & normes — ${WEB_URL}\n`);
  console.log('Écran'.padEnd(18) + 'Point de rupture'.padEnd(18) + 'Verdict');
  console.log('─'.repeat(58));

  for (const route of routes) {
    for (const viewport of VIEWPORTS) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.mobile,
      });
      await cdp.send('Page.navigate', { url: WEB_URL + route.path });
      await sleep(route.settleMs);

      const evaluated = await cdp.send('Runtime.evaluate', {
        expression: AUDIT_SCRIPT,
        returnByValue: true,
      });
      // Une exception dans la page rendrait `value` indéfini : sans ce garde-fou,
      // l'audit passerait pour cassé alors que c'est le contrôle qui a échoué.
      if (evaluated.exceptionDetails) {
        throw new Error(
          `Le contrôle a échoué sur ${route.path} : ` +
            (evaluated.exceptionDetails.exception?.description ?? evaluated.exceptionDetails.text),
        );
      }
      const { findings } = JSON.parse(evaluated.result.value);

      console.log(
        route.label.padEnd(18) +
          viewport.name.padEnd(18) +
          (findings.length === 0 ? 'OK' : `${findings.length} écart(s)`),
      );
      for (const finding of findings) {
        console.log(`    · ${finding.rule} : ${finding.detail}`);
        failures.push({ route: route.label, viewport: viewport.name, ...finding });
      }

      if (shotsDir) {
        const shot = await cdp.send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: true,
        });
        const file = `${viewport.width}-${route.label.replace(/\W+/g, '-')}.png`;
        fs.writeFileSync(path.join(shotsDir, file), Buffer.from(shot.data, 'base64'));
      }
    }
  }

  cdp.close();
  child.kill();
  // Ménage au mieux : sous Windows, Chrome garde brièvement la main sur son
  // fichier de rapport de plantage, et `rmSync` échoue en EBUSY. Ce serait
  // absurde de faire échouer un audit vert pour un fichier temporaire de 64 Ko.
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {
    /* Le répertoire temporaire sera balayé par le système. */
  }

  if (shotsDir) console.log(`\nCaptures écrites dans ${path.resolve(shotsDir)}`);

  if (failures.length > 0) {
    console.error(`\n${failures.length} écart(s) — l'audit échoue.\n`);
    process.exit(1);
  }

  console.log(
    `\n${routes.length} écran(s) × ${VIEWPORTS.length} points de rupture : aucun écart.\n`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(2);
});
