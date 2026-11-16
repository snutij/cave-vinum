import type { SiteConfig } from "../lib/config.ts";
import { DEMO_SLUG } from "../lib/config.ts";
import { esc } from "../lib/text.ts";

export const SHELL_CSS = `:root{color-scheme:dark}*{box-sizing:border-box}
html,body{margin:0;background:#120809}
body{font:16px/1.6 "Jost","Avenir Next","Helvetica Neue",system-ui,-apple-system,"Segoe UI",sans-serif;color:#f7f1e6}
a{color:#ead7a8}
.h-wrap{max-width:880px;margin:0 auto;padding:clamp(32px,6vw,72px) 20px 48px}
.h-hero{text-align:center}
.h-mono{display:block;width:56px;height:56px;margin:0 auto 12px;color:#c9a76b}
.h-title{margin:0;font-family:"Cormorant Garamond",Georgia,serif;font-weight:500;font-size:clamp(46px,8vw,80px);line-height:.95}
.h-title em{font-style:italic;font-weight:400;color:#e2c891}
.h-tag{margin:8px 0 0;font-family:"Cormorant Garamond",Georgia,serif;font-style:italic;font-size:clamp(18px,2.4vw,22px);color:rgba(247,241,230,.72)}
.h-lead{max-width:620px;margin:22px auto 0;color:rgba(247,241,230,.85)}
.h-cta{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:26px}
.h-btn{display:inline-block;padding:11px 20px;border-radius:999px;border:1px solid #c9a76b;color:#ead7a8;text-decoration:none;font-size:14px;letter-spacing:.04em}
.h-btn--main{background:#c9a76b;color:#120809;font-weight:500}
.h-btn:hover{filter:brightness(1.1)}
.h-sec{margin-top:clamp(40px,7vw,64px)}
.h-sec h2{margin:0 0 16px;font-family:"Cormorant Garamond",Georgia,serif;font-weight:500;font-size:clamp(28px,4vw,36px);color:#ead7a8;text-align:center}
.h-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
.h-card{padding:20px;border:1px solid rgba(201,167,107,.32);border-radius:14px;background:rgba(31,12,17,.7)}
.h-card h3{margin:0 0 6px;font-size:16px;font-weight:600;color:#f7f1e6}
.h-card p{margin:0;color:rgba(247,241,230,.78);font-size:15px}
.h-card .h-btn{margin-top:14px}
.h-num{display:inline-grid;place-items:center;width:28px;height:28px;margin-bottom:10px;border-radius:50%;border:1px solid #c9a76b;color:#c9a76b;font-size:13px}
details{border-bottom:1px solid rgba(201,167,107,.25);padding:14px 2px}
summary{cursor:pointer;font-weight:500}
details p{margin:10px 0 0;color:rgba(247,241,230,.8)}
table{border-collapse:collapse;margin-top:10px;font-size:14px}
td{padding:4px 14px 4px 0;border-bottom:1px solid rgba(201,167,107,.15)}
.h-foot{margin-top:56px;text-align:center;font-size:12px;letter-spacing:.12em;color:rgba(247,241,230,.5)}`;

export const MONOGRAM = `<svg class="h-mono" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="38.5" fill="none" stroke="currentColor"/><circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" opacity=".55"/><text x="40" y="49" text-anchor="middle" font-family="Georgia,serif" font-style="italic" font-size="29" fill="currentColor">CV</text></svg>`;

export function pageShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#120809">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;1,400&family=Jost:wght@400;500;600&display=swap" rel="stylesheet">
<style>${SHELL_CSS}</style>
</head>
<body>
<div class="h-wrap">
${body}
</div>
</body>
</html>
`;
}

const buttonLink = (href: string, label: string, modifier: string): string =>
  href ? `<a class="h-btn${modifier}" href="${esc(href)}">${esc(label)}</a>` : "";
const link = (href: string, label: string): string => buttonLink(href, label, "");
const primaryLink = (href: string, label: string): string => buttonLink(href, label, " h-btn--main");

/** Generic home page. It never lists or links to the configured caves. */
export function renderHome(site: SiteConfig, generatedAt: string): string {
  return pageShell("Cave Vinum", `<header class="h-hero">
  ${MONOGRAM}
  <h1 class="h-title">Cave <em>Vinum</em></h1>
  <p class="h-tag">Chaque vin a son heure.</p>
  <p class="h-lead">Un site tout simple pour savoir quelle bouteille ouvrir en premier. Tu remplis un Google Sheet, Cave Vinum trie ta cave chaque jour : à boire en priorité, prêt à boire, à garder, avec des idées d'accords mets-vins.</p>
  <div class="h-cta">${primaryLink(`./${DEMO_SLUG}/`, "Voir la démo")}${link(site.templateUrl, "Créer mon tableur")}${link(site.repoUrl, "Code source")}</div>
</header>

<section class="h-sec">
  <h2>Comment ça marche</h2>
  <div class="h-grid">
    <div class="h-card"><span class="h-num">1</span><h3>Remplis ton tableur</h3><p>Une ligne par vin et 4 informations obligatoires : le nom, la quantité, la couleur et l'année limite pour le boire. Des menus déroulants pour le reste.</p></div>
    <div class="h-card"><span class="h-num">2</span><h3>Publie-le</h3><p>Dans Google Sheets : Fichier › Partager › Publier sur le Web, onglet « Inventaire », format CSV.</p></div>
    <div class="h-card"><span class="h-num">3</span><h3>Consulte ta cave</h3><p>Ta page se met à jour toute seule : urgences, vins prêts, filtre par plat, recherche. Pensée pour le téléphone, même hors connexion.</p></div>
  </div>
</section>

<section class="h-sec">
  <h2>Avoir ma cave</h2>
  <div class="h-grid">
    <div class="h-card"><h3>Le plus simple</h3><p>Crée ta copie du tableur, remplis-la et publie-la. Envoie ensuite le lien CSV à la personne qui héberge ce site : ta cave sera en ligne à son adresse, par exemple <b>…/ton-prenom/</b>.</p>${link(site.templateUrl, "Créer mon tableur")}</div>
    <div class="h-card"><h3>En autonomie</h3><p>Le projet est open source et gratuit. Copie le dépôt (fork), connecte-le à un hébergeur statique comme Cloudflare Pages et suis le README.</p>${link(site.repoUrl, "Voir le dépôt")}</div>
  </div>
</section>

<section class="h-sec">
  <h2>Questions fréquentes</h2>
  <details><summary>Comment remplir « Boire avant » ?</summary>
    <p>C'est la dernière année où le vin sera à son meilleur. Sans indication du domaine ou du caviste, ajoute au millésime une durée de garde indicative :</p>
    <table>
      <tr><td>Bulles (brut sans année)</td><td>1 à 3 ans</td></tr>
      <tr><td>Rosé</td><td>1 à 2 ans</td></tr>
      <tr><td>Blanc sec léger</td><td>2 à 4 ans</td></tr>
      <tr><td>Blanc de garde (Bourgogne, Loire)</td><td>5 à 10 ans</td></tr>
      <tr><td>Rouge léger (Beaujolais, Loire)</td><td>3 à 6 ans</td></tr>
      <tr><td>Rouge de garde (Bordeaux, Rhône)</td><td>8 à 15 ans</td></tr>
      <tr><td>Liquoreux</td><td>10 ans et plus</td></tr>
    </table>
  </details>
  <details><summary>J'ai ouvert une bouteille, je fais quoi ?</summary><p>Baisse la quantité dans ton tableur. À 0, le vin passe en « Épuisé » et disparaît de la liste.</p></details>
  <details><summary>Quand ma page se met-elle à jour ?</summary><p>À chaque reconstruction du site, en général une fois par jour. Tes modifications apparaissent au plus tard le lendemain.</p></details>
  <details><summary>Qui peut voir ma cave ?</summary><p>Toute personne qui connaît son adresse. Les caves ne sont listées nulle part et ne sont pas indexées par les moteurs de recherche.</p></details>
  <details><summary>Combien d'accords mets-vins par vin ?</summary><p>La colonne Accords accepte plusieurs choix, mais 2 ou 3 suffisent : au-delà, le filtre « Quel plat ? » ne trie plus grand-chose.</p></details>
</section>

<footer class="h-foot">Cave Vinum · Mis à jour le ${esc(generatedAt)}</footer>`);
}

export function render404(): string {
  return pageShell("Cave introuvable · Cave Vinum", `<header class="h-hero">
  ${MONOGRAM}
  <h1 class="h-title">Cave <em>introuvable</em></h1>
  <p class="h-lead">Cette adresse ne correspond à aucune cave. Vérifie le lien qu'on t'a envoyé, en gardant la barre oblique finale (par exemple …/ton-prenom/).</p>
  <div class="h-cta">${primaryLink("/", "Accueil")}${link(`/${DEMO_SLUG}/`, "Voir la démo")}</div>
</header>`);
}
