(() => {
"use strict";

/*
  ARCHIVES DU COURANT — GÉNÉRATEUR V5
  ------------------------------------------------------------
  Données :
    data/supplements.json
    data/armees/*.json
    data/supplements/*.json
    data/objets-magiques/*.json

  Le générateur ne modifie jamais les fichiers data/.

  Principes :
    - une unité ajoutée = une entrée indépendante dans la liste ;
    - plusieurs entrées identiques sont possibles ;
    - chaque entrée possède son propre effectif et ses propres options ;
    - les options sont chiffrées automatiquement lorsqu'elles sont décrites
      dans les JSON ;
    - les restrictions min/max, maxPer1000 et maxPerCharacter sont prises en compte ;
    - les pourcentages de composition sont calculés sur le format choisi ;
    - les contraintes affichent toujours leur équivalent en points ;
    - la colonne "Ma liste" affiche, pour chaque entrée, dans cet ordre :
        1. caractéristiques (figurine + monture le cas échéant), sous forme
           de tableau ;
        2. équipement natif ;
        3. règles spéciales natives ;
        4. options : monture / options de personnage / objets magiques ;
        5. options de règles spéciales (règles optionnelles / honneurs).
*/

const PATHS = {
  catalog: "data/supplements.json",
  armies: "data/armees/",
  supplements: "data/supplements/",
  // Fichier commun (toutes armées) des objets magiques universels — fusionné
  // avec le fichier spécifique de chaque armée dans loadMagicItems().
  commonMagicItems: "data/objets-magiques/communs.json",
  // Catalogue global des Honneurs Elfiques, chargé une seule fois au démarrage.
  honours: "data/aptitudes/honneurs-elfiques.json"
};

// Hiérarchie d'affichage standard des catégories, respectée partout où une
// liste ou un catalogue est présenté (colonne de gauche, "Ma liste" au
// centre, export TXT, impression). Toute catégorie absente de cette liste
// (ex. "Autres") est affichée après, par ordre alphabétique.
const CATEGORY_ORDER = ["Personnages", "Unités de Base", "Unités Spéciales", "Unités Rares"];
function categoryRank(cat) {
  const idx = CATEGORY_ORDER.indexOf(cat);
  return idx === -1 ? CATEGORY_ORDER.length : idx;
}
function sortByCategory(entries) {
  // entries : tableau de paires [categorie, ...]
  return entries.slice().sort((a, b) => {
    const r = categoryRank(a[0]) - categoryRank(b[0]);
    return r !== 0 ? r : String(a[0]).localeCompare(String(b[0]), "fr");
  });
}

const state = {
  catalog: [],
  supplement: null,
  army: null,
  list: [],
  pointsLimit: 2000,
  filter: "",
  category: "Toutes",
  magicItems: null,
  magicItemsLoading: false,
  // Catalogue global des Honneurs Elfiques (data/aptitudes/honneurs-elfiques.json),
  // indépendant de l'armée/supplément chargé — chargé une seule fois au démarrage.
  honours: []
};

const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
}[c]));

function uid() {
  return "u_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Impossible de charger ${url} (${r.status}).`);
  const text = await r.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`Le fichier ${url} contient un JSON invalide.`); }
}

function armyLabel(id) {
  return ({
    "elfes-noirs":"Elfes Noirs",
    "hauts-elfes":"Hauts-Elfes",
    "elfes-sylvains":"Elfes Sylvains"
  })[id] || String(id || "").replace(/[-_]/g," ").replace(/\b\w/g,m=>m.toUpperCase());
}

function normalizeOption(raw, kindOverride) {
  if (raw == null) return null;

  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return null;
    const match = text.match(/([+-]\s*\d+)\s*pts?(?:\s*\/\s*mod(?:èle|èles))?/i);
    const perModel = /\/\s*mod(?:èle|èles)/i.test(text);
    const limitMatch = text.match(/jusqu[’']?à\s*(\d+)\s*pts?/i);
    const points = match ? Number(match[1].replace(/\s/g,"")) : 0;
    const name = match ? text.slice(0, match.index).trim() : text;
    return {
      id: "opt-" + slug(name),
      name,
      points: Number.isFinite(points) ? points : 0,
      pointsPerModel: perModel ? points : 0,
      kind: kindOverride || inferOptionKind(name),
      maxPoints: limitMatch ? Number(limitMatch[1]) : null,
      raw: text
    };
  }

  if (typeof raw !== "object") return null;
  const name = raw.name || raw.nom || raw.label || "Option";
  const points = raw.points != null ? Number(raw.points) : 0;
  const pointsPerModel = raw.pointsPerModel != null
    ? Number(raw.pointsPerModel)
    : (raw.perModel ? points : 0);

  return {
    ...raw,
    id: String(raw.id || ("opt-" + slug(name))),
    name,
    points: Number.isFinite(points) ? points : 0,
    pointsPerModel: Number.isFinite(pointsPerModel) ? pointsPerModel : 0,
    kind: kindOverride || raw.kind || inferOptionKind(name),
    maxPoints: raw.maxPoints != null ? Number(raw.maxPoints) : null
  };
}

function inferOptionKind(name) {
  const s = String(name).toLocaleLowerCase("fr");
  if (s.includes("bannière") || s.includes("banniere") || s.includes("étendard") || s.includes("etendard")) return "banner";
  if (s.includes("monture") || s.includes("coursier") || s.includes("sang-froid") || s.includes("pegase") || s.includes("manticore") || s.includes("char") || s.includes("aigle") || s.includes("dragon") || s.includes("licorne")) return "mount";
  if (s.includes("armure") || s.includes("heaume") || s.includes("bouclier")) return "armour";
  if (s.includes("arme") || s.includes("lance") || s.includes("hallebarde") || s.includes("épée") || s.includes("epee") || s.includes("arc") || s.includes("arbalète") || s.includes("arbalete") || s.includes("poing")) return "weapon";
  return "other";
}

// Liste brute (texte ou objet) -> tableau de chaînes affichables.
function normalizeTextList(raw) {
  if (raw == null) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map(x => {
    if (typeof x === "string") return x.trim();
    if (x && typeof x === "object") return String(x.name || x.nom || x.label || x.text || "").trim();
    return "";
  }).filter(Boolean);
}

function normalizeUnit(u, fallbackId = "", mounts = []) {
  if (!u || typeof u !== "object") return null;
  const points = u.points ?? u.cost ?? u.cout;
  const { options, magicItemsLimit, bannerItemsLimit, championWeaponLimit } = classifyUnitOptions(u.options, mounts);

  // Règles spéciales optionnelles / honneurs (choisissables), distinctes des
  // règles spéciales natives (fixes, toujours actives).
  const ruleOptionsRaw = u.ruleOptions ?? u.optionsRegles ?? u.optionalRules
    ?? u.honours ?? u.honor ?? u.honneurs ?? [];
  const ruleOptions = Array.isArray(ruleOptionsRaw)
    ? ruleOptionsRaw.map(o => normalizeOption(o, "rule")).filter(Boolean)
    : [];

  let minSize = u.minSize != null ? Number(u.minSize) : null;
  let maxSize = u.maxSize != null ? Number(u.maxSize) : null;
  const size = String(u.unitSize ?? "").trim();
  if (minSize == null && size) {
    const range = size.match(/(\d+)\s*[-–]\s*(\d+)/);
    const plus = size.match(/(\d+)\s*\+/);
    const single = size.match(/^\d+$/);
    if (range) { minSize = Number(range[1]); maxSize = Number(range[2]); }
    else if (plus) { minSize = Number(plus[1]); maxSize = Infinity; }
    else if (single) { minSize = Number(single[0]); maxSize = Number(single[0]); }
  }

  return {
    ...u,
    id: String(u.id || fallbackId),
    name: u.name || u.nom || "Unité sans nom",
    category: u.category || u.categorie || "Autres",
    points: points == null || points === "" ? null : Number(points),
    options,
    ruleOptions,
    rules: normalizeTextList(u.rules ?? u.regles ?? u.specialRules),
    equipment: normalizeTextList(u.equipment ?? u.equipement ?? u.equipementNatif ?? u.equipementDeBase),
    profile: u.profile || u.profil || null,
    // Profil supplémentaire du chef d'unité (Sentinelle, Gardien, Héraut…),
    // affiché comme une ligne de caractéristiques additionnelle lorsque
    // l'option "champion" est cochée — alimenté plus tard dans les JSON.
    championProfile: u.championProfile || u.profilChef || null,
    // Budgets d'objets magiques : valeur numérique dérivée automatiquement
    // des phrases « Objets magiques jusqu'à X pts » / « Bannière magique
    // jusqu'à X pts » / « Arme magique jusqu'à X pts » présentes dans les
    // options brutes, ou surchargée explicitement par le JSON (u.xxxLimit).
    magicItemsLimit: u.magicItemsLimit != null ? Number(u.magicItemsLimit) : magicItemsLimit,
    bannerItemsLimit: u.bannerItemsLimit != null ? Number(u.bannerItemsLimit) : bannerItemsLimit,
    championWeaponLimit: u.championWeaponLimit != null ? Number(u.championWeaponLimit) : championWeaponLimit,
    source: u.source || "armée",
    unitSize: u.unitSize || "",
    minSize,
    maxSize,
    minEntries: u.minEntries ?? null,
    maxEntries: u.maxEntries ?? null,
    min: u.min ?? 0,
    max: u.max ?? Infinity
  };
}

function unitsFrom(raw, mounts = []) {
  if (Array.isArray(raw?.units)) return raw.units.map(u => normalizeUnit(u, "", mounts)).filter(Boolean);
  if (raw?.units && typeof raw.units === "object") {
    return Object.entries(raw.units).map(([id,u]) => normalizeUnit(u,id,mounts)).filter(Boolean);
  }
  return [];
}

// Profils de montures déclarés au niveau de l'armée/supplément (clé "mounts"
// ou "montures" du JSON), utilisés pour retrouver automatiquement les
// caractéristiques d'une monture choisie en option de personnage.
function normalizeMounts(raw) {
  const list = Array.isArray(raw?.mounts) ? raw.mounts
    : (Array.isArray(raw?.montures) ? raw.montures : []);
  return list.map(m => {
    if (!m || typeof m !== "object") return null;
    const name = m.name || m.nom || "";
    if (!name) return null;
    return {
      id: String(m.id || ("mount-" + slug(name))),
      name,
      points: m.points != null ? Number(m.points) : 0,
      profile: normalizeProfile(m.profile || m.profil),
      type: m.type || "",
      base: m.base || ""
    };
  }).filter(Boolean);
}

function normWords(name) {
  return slug(name).split("-").filter(Boolean);
}

// Rattache le nom d'une option de monture (ex. "Coursier bardé") au profil
// de monture correspondant dans le tableau "mounts" (ex. "Coursier elfe
// bardé"), même si le libellé n'est pas rigoureusement identique.
function matchMountProfile(name, mounts) {
  if (!mounts?.length || !name) return null;
  const words = normWords(name);
  if (!words.length) return null;
  let best = null, bestScore = -1;
  mounts.forEach(m => {
    const mWords = normWords(m.name);
    const overlap = words.filter(w => mWords.includes(w)).length;
    if (!overlap) return;
    const subsetBonus = words.every(w => mWords.includes(w)) ? 1 : 0;
    const score = overlap + subsetBonus - Math.abs(mWords.length - words.length) * 0.1;
    if (score > bestScore) { bestScore = score; best = m; }
  });
  return best;
}

const MAGIC_ITEMS_LIMIT_RE = /^objets?\s+magiques?\s+jusqu[’']?à\s*(\d+)\s*pts?/i;
const MAGIC_BANNER_LIMIT_RE = /^bannière\s+magique\s+jusqu[’']?à\s*(\d+)\s*pts?/i;
const MAGIC_WEAPON_LIMIT_RE = /arme\s+magique\s+jusqu[’']?à\s*(\d+)\s*pts?/i;

// Transforme le tableau brut d'options d'une unité en :
//  - une liste d'options normalisées réellement sélectionnables ;
//  - des budgets numériques (objets magiques / bannière magique / arme
//    magique du chef) extraits des phrases "... jusqu'à X pts", qui ne
//    sont plus des options cochables mais des limites de points ;
//  - le repérage du chef d'unité : par convention (livres d'armée), c'est
//    l'option à coût fixe placée juste avant "Porte-étendard".
function classifyUnitOptions(rawList, mounts) {
  const rawArr = Array.isArray(rawList) ? rawList : [];
  let magicItemsLimit = null, bannerItemsLimit = null, championWeaponLimit = null;
  const standardIndex = rawArr.findIndex(r => typeof r === "string" && /^porte-?[ée]tendard/i.test(r.trim()));
  const options = [];

  rawArr.forEach((raw, idx) => {
    if (typeof raw !== "string") {
      const o = normalizeOption(raw);
      if (o) options.push(o);
      return;
    }
    const text = raw.trim();
    if (!text) return;

    const magicMatch = text.match(MAGIC_ITEMS_LIMIT_RE);
    if (magicMatch) { magicItemsLimit = Number(magicMatch[1]); return; }

    const bannerMatch = text.match(MAGIC_BANNER_LIMIT_RE);
    if (bannerMatch) { bannerItemsLimit = Number(bannerMatch[1]); return; }

    const weaponMatch = text.match(MAGIC_WEAPON_LIMIT_RE);
    if (weaponMatch) { championWeaponLimit = Number(weaponMatch[1]); return; }

    let forcedKind = null;
    if (/^porte-?[ée]tendard/i.test(text)) forcedKind = "standard";
    else if (/^musicien/i.test(text)) forcedKind = "musician";
    // "Mur de boucliers" est une option tactique (case à cocher), pas une
    // pièce d'armure : évite qu'elle ne soit classée "armour" à cause du
    // mot "boucliers" et placée à tort dans le menu déroulant d'armure.
    else if (/^mur de boucliers/i.test(text)) forcedKind = "other";
    else if (standardIndex > 0 && idx === standardIndex - 1) {
      const perModel = /\/\s*mod(è|e)les?/i.test(text);
      if (!perModel) forcedKind = "champion";
    }

    const option = normalizeOption(text, forcedKind);
    if (!option) return;

    if (option.kind === "mount") {
      const matched = matchMountProfile(option.name, mounts);
      if (matched) {
        option.mountProfile = matched.profile;
        option.mountType = matched.type;
        option.mountBase = matched.base;
        // certaines options de monture n'indiquent pas leur coût dans le
        // texte source (ex. "Dragon solaire") : on le récupère alors sur
        // le profil de monture correspondant.
        if (!option.points && matched.points) option.points = matched.points;
      }
    }

    options.push(option);
  });

  return { options, magicItemsLimit, bannerItemsLimit, championWeaponLimit };
}


function normalizeMagicItems(raw) {
  if (!raw || typeof raw !== "object") return {};
  const source = raw.magicItems || raw.objetsMagiques || raw.categories || raw;
  const result = {};
  Object.entries(source).forEach(([category, items]) => {
    if (!Array.isArray(items)) return;
    result[category] = items.map((item, index) => {
      if (typeof item === "string") {
        return { id: "magic-" + slug(item), name: item, points: 0 };
      }
      const name = item.name || item.nom || "Objet magique";
      return {
        ...item,
        id: String(item.id || ("magic-" + slug(name) + "-" + index)),
        name,
        points: item.points == null ? 0 : Number(item.points),
        // certains objets (ex. talismans communs) peuvent être pris par
        // plusieurs unités simultanément : repeatable / unique==false / multiple
        repeatable: item.repeatable === true || item.unique === false || item.multiple === true
      };
    });
  });
  return result;
}

// Fusionne deux catalogues d'objets magiques déjà normalisés (par
// catégorie) : utilisé pour combiner les objets communs (toutes armées)
// avec ceux spécifiques à l'armée chargée.
function mergeMagicItems(a, b) {
  const result = {};
  [a, b].forEach(source => {
    Object.entries(source || {}).forEach(([category, items]) => {
      result[category] = [...(result[category] || []), ...items];
    });
  });
  return result;
}

async function loadMagicItems(armyId) {
  state.magicItems = null;
  state.magicItemsLoading = true;
  try {
    // Les objets communs (data/objets-magiques/communs.json) sont
    // disponibles pour toutes les armées ; ils sont fusionnés avec le
    // fichier spécifique de l'armée chargée (s'il existe).
    const [common, own] = await Promise.all([
      getJSON(PATHS.commonMagicItems).catch(() => null),
      armyId ? getJSON(PATHS.armies + "../objets-magiques/" + armyId + ".json").catch(() => null) : Promise.resolve(null)
    ]);
    const merged = mergeMagicItems(normalizeMagicItems(common), normalizeMagicItems(own));
    state.magicItems = Object.keys(merged).length ? merged : null;
  } catch (e) {
    // Un fichier d'objets magiques manquant n'est pas bloquant : l'armée
    // reste jouable, simplement sans objets magiques proposés.
    state.magicItems = null;
  } finally {
    state.magicItemsLoading = false;
  }
}

// Honneurs Elfiques : catalogue global (indépendant de l'armée), chargé une
// seule fois au démarrage — voir data/aptitudes/honneurs-elfiques.json,
// dont la clé racine est "aptitudes" (tableau d'objets {id, name, points,
// description…}), suivant le même schéma que les objets magiques.
function normalizeHonours(raw) {
  const source = Array.isArray(raw?.aptitudes) ? raw.aptitudes
    : (Array.isArray(raw?.honours) ? raw.honours
    : (Array.isArray(raw?.honneurs) ? raw.honneurs : []));
  return source.map((item, index) => {
    if (typeof item === "string") {
      return { id: "honneur-" + slug(item), name: item, points: 0, repeatable: false };
    }
    const name = item.name || item.nom || "Honneur";
    return {
      ...item,
      id: String(item.id || ("honneur-" + slug(name) + "-" + index)),
      name,
      points: item.points == null ? 0 : Number(item.points),
      repeatable: item.repeatable === true
    };
  });
}

async function loadHonours() {
  try {
    const raw = await getJSON(PATHS.honours);
    state.honours = normalizeHonours(raw);
  } catch (e) {
    // Un catalogue d'honneurs manquant ou vide n'est pas bloquant : le
    // sélecteur d'honneurs ne s'affiche simplement pour aucun personnage.
    state.honours = [];
  }
}

// --- Moteur d'effets des Honneurs Elfiques ---------------------------------
// Un Honneur Elfique n'est jamais codé en dur ici : `Generator` lit le champ
// `effects` de honneurs-elfiques.json (tableau d'objets {type, ...}) et en
// déduit les conséquences concrètes sur la fiche du personnage. Le texte
// narratif de l'Honneur (`description`) n'est jamais affiché — seules ses
// conséquences le sont, via les blocs Équipement / Règles spéciales /
// Monture déjà existants.
//
// Types d'effets pris en charge :
//   forbid_mount            — aucune option de monture proposée
//   restrict_mount           {match:[...]} — seules les montures dont le nom
//                             correspond à un des motifs restent proposées
//   forbid_option_match      {kind, match:[...]} — retire les options du kind
//                             donné dont le nom correspond à un des motifs
//   grant_option              {kind, name, points, exclusiveKind} — ajoute une
//                             option gratuite ; si exclusiveKind est défini et
//                             que cette option est sélectionnée, les autres
//                             options de ce kind disparaissent de la fiche
//   grant_special_rule        {name} — ajoute une règle spéciale au profil
//   replace_special_rule      {from, to} — remplace une règle spéciale native
//   stat_modifier              {stat, value} — modifie une caractéristique
//   unlock_unit                {unit, category, max} — rend une unité
//                             accessible dans la composition d'armée
function honourById(id) {
  return (state.honours || []).find(h => h.id === id) || null;
}
function honourEffectsList(entry) {
  const h = entry?.honour ? honourById(entry.honour) : null;
  return Array.isArray(h?.effects) ? h.effects : [];
}
// Comparaison de libellés insensible à la casse/accents/ordre des mots,
// utilisée pour rapprocher un motif de donnée ("phénix flamboyant") d'un
// nom d'option ou de règle affiché ("Phénix flamboyant, chevauché par...").
function matchesPattern(name, pattern) {
  const n = " " + slug(name).replace(/-/g, " ") + " ";
  const p = " " + slug(pattern).replace(/-/g, " ") + " ";
  return n.includes(p) || p.includes(n);
}
// Options réellement proposables pour une entrée : options natives de
// l'unité, filtrées/complétées par les effets de l'Honneur Elfique choisi
// (le cas échéant). C'est la seule source utilisée pour l'affichage des
// menus ET pour le calcul des coûts, afin qu'une option interdite par un
// Honneur ne puisse ni être affichée ni être comptabilisée.
function effectiveOptions(entry, u) {
  let opts = [...(u?.options || [])];
  const effects = honourEffectsList(entry);
  if (!effects.length) return opts;

  if (effects.some(e => e.type === "forbid_mount")) {
    opts = opts.filter(o => o.kind !== "mount");
  }
  const restrictMount = effects.find(e => e.type === "restrict_mount");
  if (restrictMount) {
    const patterns = restrictMount.match || [];
    opts = opts.filter(o => o.kind !== "mount" || patterns.some(p => matchesPattern(o.name, p)));
  }
  effects.filter(e => e.type === "forbid_option_match").forEach(e => {
    const patterns = e.match || [];
    opts = opts.filter(o => !(o.kind === e.kind && patterns.some(p => matchesPattern(o.name, p))));
  });

  const granted = effects.filter(e => e.type === "grant_option").map(e => ({
    id: "honour-opt-" + slug(e.name),
    name: e.name,
    points: Number(e.points || 0),
    pointsPerModel: 0,
    kind: e.kind || "other",
    maxPoints: null,
    honourGranted: true,
    exclusiveKind: e.exclusiveKind || null
  }));
  opts = opts.concat(granted);

  const selected = new Set(selectedOptions(entry));
  granted.forEach(g => {
    if (g.exclusiveKind && selected.has(g.id)) {
      opts = opts.filter(o => o.id === g.id || o.kind !== g.exclusiveKind);
    }
  });
  return opts;
}
// Options + règles optionnelles, telles que réellement disponibles pour
// cette entrée (utilisé partout où un id d'option doit être résolu en nom
// ou en coût — fiche, export, impression).
function effectivePool(entry, u) {
  return [...effectiveOptions(entry, u), ...(u?.ruleOptions || [])];
}
// Règles spéciales natives de l'unité, après ajout/remplacement par les
// effets de l'Honneur Elfique choisi.
function effectiveRules(entry, u) {
  let rules = [...(u?.rules || [])];
  const effects = honourEffectsList(entry);
  effects.filter(e => e.type === "replace_special_rule").forEach(e => {
    rules = rules.map(r => matchesPattern(r, e.from) ? e.to : r);
  });
  effects.filter(e => e.type === "grant_special_rule").forEach(e => {
    if (!rules.some(r => matchesPattern(r, e.name))) rules.push(e.name);
  });
  return rules;
}
// Une unité de la composition d'armée est débloquée par un Honneur Elfique
// dès qu'un personnage de la liste a choisi un Honneur dont un effet
// `unlock_unit` cible son id — sans qu'aucun nom d'Honneur ne soit testé en
// dur ici.
function honourUnlocksUnit(unitId) {
  if (!unitId) return false;
  return state.list.some(entry => honourEffectsList(entry).some(e => e.type === "unlock_unit" && e.unit === unitId));
}

function normalizeArmy(raw, fallbackId) {
  const mounts = normalizeMounts(raw);
  return {
    ...raw,
    id: raw.id || fallbackId,
    name: raw.name || raw.nom || armyLabel(fallbackId),
    mounts,
    units: unitsFrom(raw, mounts),
    composition: raw.composition || { categories: {} }
  };
}

function normalizeSupplement(raw, fallback) {
  const mounts = normalizeMounts(raw).length ? normalizeMounts(raw) : (fallback.mounts || []);
  return {
    ...fallback,
    ...raw,
    id: fallback.id || raw.id,
    name: raw.name || fallback.name,
    armies: Array.isArray(raw.armies) && raw.armies.length
      ? raw.armies
      : (Array.isArray(raw.army) ? raw.army : (raw.army ? [raw.army] : (fallback.armies || (fallback.army ? [fallback.army] : [])))),
    description: raw.description || fallback.description || "",
    allowedUnits: Array.isArray(raw.allowedUnits) ? raw.allowedUnits : (fallback.allowedUnits || []),
    excludedUnits: Array.isArray(raw.excludedUnits) ? raw.excludedUnits : (fallback.excludedUnits || []),
    restrictions: raw.restrictions || fallback.restrictions || {},
    specialRules: raw.specialRules || fallback.specialRules || [],
    mounts,
    units: unitsFrom(raw, mounts)
  };
}

function unitMap() {
  const map = new Map();
  (state.army?.units || []).forEach(u => map.set(u.id, u));
  (state.supplement?.units || []).forEach(u => map.set(u.id, u));
  return map;
}

function allUnits() {
  // Un supplément est une variante de sa liste d'armée de référence :
  // toutes les unités de l'armée restent disponibles sauf exclusion explicite.
  // Les unités propres au supplément sont ajoutées au catalogue.
  const map = unitMap();
  const excluded = new Set(state.supplement?.excludedUnits || []);
  return [...map.values()].filter(u => !excluded.has(u.id));
}

function getUnit(id) { return unitMap().get(id); }
function restrictionForUnit(id) { return state.supplement?.restrictions?.units?.[id] || {}; }

function compositionRules() {
  const armyCategories = state.army?.composition?.categories || {};
  const supplementCategories = state.supplement?.restrictions?.categories || {};
  const merged = {};
  Object.entries(armyCategories).forEach(([cat, rule]) => { merged[cat] = { ...(rule || {}) }; });
  Object.entries(supplementCategories).forEach(([cat, rule]) => {
    merged[cat] = { ...(merged[cat] || {}), ...(rule || {}) };
  });
  return merged;
}

function isAllowed(u) {
  if (!u) return false;
  const excluded = state.supplement?.excludedUnits || [];
  if (excluded.includes(u.id)) return false;
  if (!conditionalAllowed(u)) return false;
  const allowed = state.supplement?.allowedUnits || [];
  const native = (state.supplement?.units || []).some(x => x.id === u.id);
  return !allowed.length || native || allowed.includes(u.id);
}

function allSelectedOptionNames(){
  const names=[];
  state.list.forEach(entry=>{
    const u=getUnit(entry.id); if(!u) return;
    (entry.options||[]).forEach(id=>{
      const o=effectivePool(entry,u).find(x=>x.id===id);
      if(o) names.push(String(o.name).toLocaleLowerCase("fr"));
    });
    // Un honneur elfique choisi compte comme une option sélectionnée pour
    // l'évaluation des conditions (ex. l'honneur "Garde Maritime" débloque
    // les mêmes effets que le texte "Garde Maritime" trouvé ailleurs).
    if (entry.honour) {
      const h = (state.honours||[]).find(x=>x.id===entry.honour);
      if (h) names.push(String(h.name).toLocaleLowerCase("fr"));
    }
    [u.rules, u.equipment].forEach(v=>{
      normalizeTextList(v).forEach(x=>names.push(String(x).toLocaleLowerCase("fr")));
    });
  });
  return names;
}
// Aucun nom d'Honneur n'est testé en dur : un texte de condition libre (ex.
// "Général avec l'Honneur Garde Maritime") est simplement débarrassé de son
// préfixe générique, puis comparé aux noms d'options/règles/Honneurs
// réellement sélectionnés dans la liste (voir allSelectedOptionNames). Le
// cas "Éryndor Vareth" reste un identifiant de personnage nommé, pas un
// Honneur, et est traité séparément.
function hasCondition(text, unit=null){
  const t=String(text||'').toLocaleLowerCase('fr');
  if(!t) return true;
  const names=allSelectedOptionNames();
  const generalIds=state.list.filter(x=>getUnit(x.id)?.category==='Personnages').map(x=>x.id);
  if(t.includes('eryndor') || t.includes('éryndor')) return generalIds.includes('eryndor-vareth');
  const cleaned = t
    .replace(/^général avec l['’]honneur\s*/,'')
    .replace(/^general avec l['’]honneur\s*/,'')
    .split(/[,.]/)[0]
    .trim();
  if (cleaned) return names.some(n => n.includes(cleaned) || cleaned.includes(n));
  return names.some(n => t.includes(n) || n.includes(t));
}
function conditionalAllowed(u){
  const r=restrictionForUnit(u?.id);
  if(!r?.conditional){
    // Même sans condition textuelle déclarée, une unité reste débloquée par
    // un Honneur Elfique dont l'effet `unlock_unit` la cible explicitement.
    return true;
  }
  const conditions=Array.isArray(r.conditional)?r.conditional:[r.conditional];
  return conditions.some(c=>hasCondition(c,u)) || honourUnlocksUnit(u?.id);
}

// Une condition ("when") peut être :
//  - l'id exact d'un personnage/unité présent dans la liste (ex. "eryndor-vareth") ;
//  - l'id exact d'un honneur elfique choisi par une entrée (ex. "garde-maritime") ;
//  - un texte libre (nom d'honneur, d'option, de règle…), évalué avec le
//    même moteur que les conditions d'autorisation (hasCondition).
function conditionMet(when) {
  if (!when) return false;
  if (state.list.some(x => x.id === when)) return true;
  if (state.list.some(x => x.honour === when)) return true;
  return hasCondition(when);
}

function effectiveCategory(u){
  if(!u) return 'Autres';
  return u.category;
}

// --- Recatégorisation conditionnelle, par entrée --------------------------
// Déclarée au niveau du supplément (et non plus par unité), dans
// restrictions.reclassifications, ex. pour "Éryndor Vareth" :
//   "reclassifications": [
//     {
//       "id": "eryndor-base-choice",
//       "label": "Éryndor Vareth",
//       "when": "eryndor-vareth",
//       "fromCategories": ["Unités Spéciales", "Unités Rares"],
//       "toCategory": "Unités de Base",
//       "max": 1
//     }
//   ]
// Une telle règle rend éligibles TOUTES les unités des catégories listées
// (pas une unité en particulier) : dans l'exemple, la Garde Maritime, les
// Élémentaires de Courant, ou toute autre unité Spéciale/Rare. Le choix se
// fait ensuite entrée par entrée, via une case à cocher dans "Ma liste" —
// avec 3 Gardes Maritimes et un budget "max: 1", une seule peut être
// cochée comme choix de Base ; les 2 autres restent normalement des choix
// Spéciaux, sans qu'il faille tout recharger ni recalculer la liste.
function reclassificationRules() {
  return state.supplement?.restrictions?.reclassifications || [];
}
function findReclassificationRule(id) {
  return reclassificationRules().find(r => r.id === id) || null;
}
function ruleAppliesToUnit(rule, u) {
  if (!rule || !u) return false;
  const from = Array.isArray(rule.fromCategories) ? rule.fromCategories
    : (rule.fromCategory ? [rule.fromCategory] : []);
  return from.includes(u.category);
}
function activeReclassificationRulesFor(u) {
  if (!u) return [];
  return reclassificationRules().filter(rule => ruleAppliesToUnit(rule, u) && conditionMet(rule.when));
}
function reclassifiedCount(ruleId, excludeUid=null) {
  return state.list.filter(e => e.uid !== excludeUid && e.reclassified === ruleId).length;
}
function reclassificationSlotsLeft(rule, excludeUid=null) {
  if (!rule || rule.max == null) return Infinity;
  return Math.max(0, Number(rule.max) - reclassifiedCount(rule.id, excludeUid));
}

// Catégorie réellement utilisée pour une entrée précise de "Ma liste" (et
// pour les totaux/compositions) : celle de la règle de recatégorisation si
// l'entrée l'a cochée et que la condition est toujours active, sinon la
// catégorie normale de l'unité.
function entryEffectiveCategory(entry, u) {
  if (!u) return 'Autres';
  if (entry?.reclassified) {
    const rule = findReclassificationRule(entry.reclassified);
    if (rule && ruleAppliesToUnit(rule, u) && conditionMet(rule.when)) return rule.toCategory;
  }
  return u.category;
}

function getEntriesForUnit(id) {
  return state.list.filter(x => x.id === id);
}

function getCharacterEntryCount() {
  return state.list.filter(item => getUnit(item.id)?.category === "Personnages").length;
}

function maxEntriesForUnit(u) {
  if (!u) return 0;
  const r = restrictionForUnit(u.id);
  let max = Infinity;

  if (u.maxEntries != null) max = Math.min(max, Number(u.maxEntries));
  if (r.maxEntries != null) max = Math.min(max, Number(r.maxEntries));
  if (r.max != null && (u.category === "Personnages" || u.minSize === 1)) max = Math.min(max, Number(r.max));

  if (r.maxPer1000 != null) {
    const per = Number(r.maxPer1000);
    if (Number.isFinite(per) && per >= 0) max = Math.min(max, Math.floor(state.pointsLimit / 1000) * per);
  }

  if (r.maxPerCharacter != null) {
    max = Math.min(max, getCharacterEntryCount() * Number(r.maxPerCharacter));
  }

  if(r.group){
    const groupRules=Object.entries(state.supplement?.restrictions?.units||{}).filter(([id,rule])=>rule?.group===r.group);
    const groupMax=groupRules.reduce((m,[id,rule])=>{
      if(rule.maxPer1000==null) return m;
      return Math.min(m,Math.floor(state.pointsLimit/1000)*Number(rule.maxPer1000));
    },Infinity);
    const currentGroup=groupRules.reduce((n,[id])=>n+getEntriesForUnit(id).length,0);
    max=Math.min(max,Math.max(0,groupMax-currentGroup));
  }

  // Le nombre d'exemplaires qu'on peut AJOUTER pour cette unité n'est pas
  // plafonné par les règles de recatégorisation : celles-ci ne portent que
  // sur des entrées déjà présentes dans la liste (choix a posteriori, via
  // la case à cocher de "Ma liste"), pas sur l'ajout lui-même.
  return max;
}

function entryModelMin(u) {
  if (!u) return 1;
  return Number.isFinite(Number(u.minSize)) ? Number(u.minSize) : 1;
}

function entryModelMax(u) {
  if (!u) return 1;
  let max=(u.maxSize == null || u.maxSize === Infinity || !Number.isFinite(Number(u.maxSize))) ? Infinity : Number(u.maxSize);
  const r=restrictionForUnit(u.id);
  if(r.maxUnitSize!=null) max=Math.min(max,Number(r.maxUnitSize));
  return max;
}

function selectedOptions(entry) {
  return Array.isArray(entry.options) ? entry.options : [];
}

function selectedMagicItemIds(entry) {
  return Array.isArray(entry.magicItems) ? entry.magicItems : [];
}

function optionCost(u, entry) {
  const selected = selectedOptions(entry);
  const pool = effectivePool(entry, u);
  return selected.reduce((sum, id) => {
    const opt = pool.find(o => o.id === id);
    if (!opt) return sum;
    return sum + Number(opt.points || 0) + Number(opt.pointsPerModel || 0) * Number(entry.qty || 0);
  }, 0);
}

function honourCost(entry) {
  const h = (state.honours||[]).find(x => x.id === entry?.honour);
  return h ? Number(h.points||0) : 0;
}

function entryPoints(entry) {
  const u = getUnit(entry.id);
  if (!u || u.points == null) return 0;
  return Number(u.points) * Number(entry.qty || 0) + optionCost(u, entry) + magicCost(entry) + honourCost(entry);
}

function getCategoryTotal(category) {
  return state.list.reduce((sum, item) => {
    const u = getUnit(item.id);
    return sum + (entryEffectiveCategory(item, u) === category ? entryPoints(item) : 0);
  }, 0);
}

function getTotal() { return state.list.reduce((sum,item) => sum + entryPoints(item), 0); }

function canAdd(u, silent=false) {
  if (!u) return false;
  if (u.points == null || Number.isNaN(u.points)) {
    if (!silent) setStatus(`Coût non renseigné pour « ${u.name} » : ajout désactivé.`, "error");
    return false;
  }
  const currentEntries = getEntriesForUnit(u.id).length;
  const max = maxEntriesForUnit(u);
  const category=effectiveCategory(u);
  const categoryRule=compositionRules()[category]||{};
  if(categoryRule.maxPercent!=null){
    const cap=state.pointsLimit*Number(categoryRule.maxPercent)/100;
    const projected=getCategoryTotal(category)+Number(u.points||0)*entryModelMin(u);
    if(projected>cap+1e-9){
      if(!silent) setStatus(`${u.name} : l’ajout dépasserait la limite de ${categoryRule.maxPercent} % de ${category}.`,"error");
      return false;
    }
  }
  if (currentEntries >= max) {
    if (!silent) {
      const detail = Number.isFinite(max) ? ` (${max} unité${max > 1 ? "s" : ""} maximum)` : "";
      setStatus(`Maximum atteint pour ${u.name}${detail}.`, "error");
    }
    return false;
  }
  return true;
}

function addUnit(id) {
  const u = getUnit(id);
  if (!isAllowed(u) || !canAdd(u)) return;
  state.list.push({
    uid: uid(),
    id,
    qty: entryModelMin(u),
    options: [],
    magicItems: [],
    honour: null,
    // Choix "compte comme un choix de Base/Spécial/…" via une règle de
    // recatégorisation (ex. Éryndor Vareth) — voir reclassificationRules().
    reclassified: null,
    // La fiche complète n'est chargée que si l'entrée est développée ; par
    // défaut, seuls le nom et le coût total sont affichés dans "Ma liste".
    expanded: false
  });
  render();
  requestAnimationFrame(() => {
    const last = document.querySelector(`[data-entry="${CSS.escape(state.list.at(-1).uid)}"]`);
    last?.scrollIntoView({ behavior:"smooth", block:"nearest" });
  });
}

function toggleExpanded(uidValue) {
  const entry = findEntry(uidValue);
  if (!entry) return;
  entry.expanded = !entry.expanded;
  render();
}

function findEntry(uidValue) { return state.list.find(x => x.uid === uidValue); }

function changeQty(uidValue, delta) {
  const entry = findEntry(uidValue);
  if (!entry) return;
  const u = getUnit(entry.id);
  if (!u) return;
  const min = entryModelMin(u);
  const max = entryModelMax(u);
  const next = Number(entry.qty || 0) + delta;
  if (next < min) {
    setStatus(`${u.name} : minimum ${min} figurine${min > 1 ? "s" : ""} par unité.`, "error");
    return;
  }
  if (next > max) {
    setStatus(`${u.name} : maximum ${max} figurine${max > 1 ? "s" : ""} par unité.`, "error");
    return;
  }
  entry.qty = next;
  render();
}

function setQty(uidValue,value){
  const entry=findEntry(uidValue); if(!entry) return;
  const u=getUnit(entry.id); if(!u) return;
  const min=entryModelMin(u), max=entryModelMax(u);
  let next=Math.floor(Number(value));
  if(!Number.isFinite(next)) next=min;
  next=Math.max(min,next);
  if(max!==Infinity) next=Math.min(max,next);
  entry.qty=next; render();
}

function removeEntry(uidValue) {
  state.list = state.list.filter(x => x.uid !== uidValue);
  render();
}

// Décocher "Porte-étendard" ou "Chef" retire aussi l'objet magique associé
// (bannière magique / arme magique du chef) déjà choisi, pour éviter qu'il
// ne reste compté dans le total sans être visible dans l'interface.
function clearBudgetItemsForOption(entry, unit, option) {
  if (!option || !entry.magicItems?.length) return;
  let category = null;
  if (option.kind === "standard") category = "Bannières magiques";
  else if (option.kind === "champion") category = "Armes magiques";
  if (!category) return;
  const items = magicItemList();
  entry.magicItems = entry.magicItems.filter(id => {
    const item = items.find(x => String(x.id) === String(id));
    return !item || item.category !== category;
  });
}

function setOption(uidValue, optionId, checked) {
  const entry = findEntry(uidValue);
  if (!entry) return;
  entry.options ||= [];
  if (checked && !entry.options.includes(optionId)) entry.options.push(optionId);
  if (!checked) {
    entry.options = entry.options.filter(x => x !== optionId);
    const u = getUnit(entry.id);
    const option = u && (u.options || []).find(o => o.id === optionId);
    if (u && option) clearBudgetItemsForOption(entry, u, option);
  }
  render();
}

function setSelectOption(uidValue, kind, optionId) {
  const entry = findEntry(uidValue);
  const u = entry && getUnit(entry.id);
  if (!entry || !u) return;
  entry.options ||= [];
  const sameKind = u.options.filter(o => o.kind === kind).map(o => o.id);
  entry.options = entry.options.filter(id => !sameKind.includes(id));
  if (optionId) entry.options.push(optionId);
  render();
}

function addMagicItem(uidValue, itemId) {
  const entry = findEntry(uidValue);
  if (!entry || !itemId) return;
  entry.magicItems ||= [];
  if (!entry.magicItems.includes(itemId)) entry.magicItems.push(itemId);
  render();
}

function removeMagicItem(uidValue, itemId) {
  const entry = findEntry(uidValue);
  if (!entry) return;
  entry.magicItems = (entry.magicItems || []).filter(x => x !== itemId);
  render();
}

// Coche/décoche "Compter comme choix de Base…" pour une entrée. Le budget
// partagé (rule.max) est vérifié au moment de cocher — s'il n'y a plus de
// place, l'action est refusée avec un message explicite plutôt que
// silencieusement ignorée.
function setReclassified(uidValue, ruleId, checked) {
  const entry = findEntry(uidValue);
  if (!entry) return;
  if (!checked) { entry.reclassified = null; render(); return; }
  const rule = findReclassificationRule(ruleId);
  if (!rule) return;
  const slotsLeft = reclassificationSlotsLeft(rule, entry.uid);
  if (slotsLeft <= 0) {
    setStatus(`Plus de place disponible pour un choix de ${rule.toCategory}${rule.label?` (${rule.label})`:""}.`, "error");
    return;
  }
  entry.reclassified = ruleId;
  render();
}

function setHonour(uidValue, honourId) {
  const entry = findEntry(uidValue);
  if (!entry) return;
  entry.honour = honourId || null;
  render();
}


const STAT_KEYS = ["M","CC","CT","F","E","PV","I","A","Cd"];

function normalizeProfile(profile) {
  if (!profile || typeof profile !== "object") return null;
  const out = {};
  STAT_KEYS.forEach(k => {
    if (profile[k] !== undefined && profile[k] !== null && profile[k] !== "") out[k] = profile[k];
  });
  return Object.keys(out).length ? out : null;
}

function profileForOption(option) {
  if (!option || typeof option !== "object") return null;
  return normalizeProfile(option.profile || option.profil || option.mountProfile || option.profilMonture);
}

function modifierForObject(obj) {
  if (!obj || typeof obj !== "object") return {};
  return obj.modifiers || obj.profileModifiers || obj.statModifiers || obj.characteristics || obj.caracteristiques || {};
}

function numericStat(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^[-+]?\d+(?:[.,]\d+)?$/.test(value.trim())) return Number(value.replace(",", "."));
  return null;
}

function applyModifier(base, modifier) {
  const n = numericStat(base);
  const delta = numericStat(modifier);
  if (n === null || delta === null) return base;
  return n + delta;
}

function selectedMagicObjects(entry) {
  return selectedMagicItemIds(entry)
    .map(id => magicItemList().find(x => String(x.id) === String(id)))
    .filter(Boolean);
}

// Coût des objets magiques choisis pour une entrée, éventuellement limité à
// une catégorie (ex. "Bannières magiques", "Armes magiques") afin de
// vérifier un budget dédié (bannière du porte-étendard, arme du chef…).
function categoryMagicCost(entry, category) {
  return selectedMagicObjects(entry)
    .filter(x => !category || x.category === category)
    .reduce((sum, x) => sum + Number(x.points || 0), 0);
}

// Budget effectif (objets magiques / bannière magique / arme magique du
// chef) pour une unité : une restriction de supplément prévaut sur la
// valeur portée par l'unité elle-même (dérivée des données d'armée).
function effectiveBudget(u, key) {
  const r = restrictionForUnit(u?.id);
  if (r[key] != null) return Number(r[key]);
  return u?.[key] != null ? Number(u[key]) : null;
}

// Option sélectionnée d'un type donné ("mount", "champion", "standard"…)
// pour une entrée, ou null si aucune ne l'est.
function selectedOptionOfKind(entry, unit, kind) {
  const id = selectedOptions(entry).find(id => {
    const o = (unit.options || []).find(x => x.id === id);
    return o?.kind === kind;
  });
  if (!id) return null;
  return (unit.options || []).find(o => o.id === id) || null;
}

// Monture actuellement sélectionnée pour une entrée (ou null).
function selectedMount(entry, unit) {
  return selectedOptionOfKind(entry, unit, "mount");
}

function effectiveProfile(entry, unit) {
  const base = normalizeProfile(unit?.profile || unit?.profil) || {};
  const profile = {...base};
  const mods = {};
  const addMods = source => {
    const m = modifierForObject(source);
    Object.entries(m || {}).forEach(([key, value]) => {
      if (!STAT_KEYS.includes(key)) return;
      const n = numericStat(value);
      if (n === null) return;
      mods[key] = (mods[key] || 0) + n;
    });
  };

  selectedOptions(entry).forEach(id => {
    const option = effectiveOptions(entry, unit).find(o => o.id === id);
    // les modificateurs de la monture s'appliquent au profil de la
    // monture elle-même, pas à celui du porteur : on les ignore ici.
    if (option && option.kind !== "mount") addMods(option);
  });
  selectedMagicObjects(entry).forEach(addMods);
  // Modificateurs de caractéristiques accordés directement par l'Honneur
  // Elfique choisi (ex. Sang de Caledor : +1 CC), lus depuis ses données.
  honourEffectsList(entry).filter(e => e.type === "stat_modifier").forEach(e => {
    if (!STAT_KEYS.includes(e.stat)) return;
    const n = numericStat(e.value);
    if (n === null) return;
    mods[e.stat] = (mods[e.stat] || 0) + n;
  });

  const result = {};
  STAT_KEYS.forEach(key => {
    if (profile[key] === undefined) return;
    result[key] = applyModifier(profile[key], mods[key] || 0);
  });
  return {profile: result, modifiers: mods};
}

function statDisplay(value, modifier) {
  const mod = numericStat(modifier);
  if (!mod) return esc(value ?? "—");
  return `${esc(value)} <span class="stat-mod">(${mod > 0 ? "+" : ""}${mod})</span>`;
}

// Tableau de caractéristiques façon "fiche" : une ligne par figurine
// (porteur, puis monture si sélectionnée), comme sur l'exemple fourni.
function renderStatsTable(entry, unit) {
  const data = effectiveProfile(entry, unit);
  const profile = data.profile || {};
  const hasProfile = STAT_KEYS.some(k => profile[k] !== undefined);
  if (!hasProfile) return "";

  const mount = selectedMount(entry, unit);
  const mountProfile = mount ? profileForOption(mount) : null;

  // Le chef d'unité (Sentinelle, Gardien, Héraut…) affiche sa propre ligne
  // de caractéristiques uniquement si l'unité fournit un profil dédié
  // (championProfile) et que l'option correspondante est cochée.
  const champion = selectedOptionOfKind(entry, unit, "champion");
  const championProfile = champion ? normalizeProfile(unit.championProfile) : null;

  const rows = [`<tr><td class="stat-row-name">${esc(unit.name)}</td>${STAT_KEYS.map(k => `<td>${statDisplay(profile[k] ?? "—", data.modifiers[k] || 0)}</td>`).join("")}</tr>`];

  // La ligne du chef n'apparaît que si l'option est cochée et qu'un profil
  // dédié existe dans les données.
  if (champion && championProfile) {
    rows.push(`<tr><td class="stat-row-name">${esc(champion.name)}</td>${STAT_KEYS.map(k => `<td>${esc(championProfile[k] ?? "-")}</td>`).join("")}</tr>`);
  }

  // La ligne de la monture n'apparaît que si une monture est sélectionnée.
  if (mount) {
    rows.push(`<tr><td class="stat-row-name">${esc(mount.name)}</td>${STAT_KEYS.map(k => `<td>${mountProfile ? esc(mountProfile[k] ?? "-") : "-"}</td>`).join("")}</tr>`);
  }

  return `<div class="profile-block">
    <div class="profile-title">Caractéristiques</div>
    <table class="stat-table">
      <thead><tr><th>Figurine</th>${STAT_KEYS.map(k => `<th>${k}</th>`).join("")}</tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>
    ${mount && !mountProfile ? `<div class="profile-missing">Profil de monture non renseigné dans les données.</div>` : ""}
  </div>`;
}

// Équipement natif (fixe, non modifiable) de l'unité — affiché sur une
// seule ligne, éléments séparés par des virgules.
function renderEquipment(unit) {
  if (!unit.equipment?.length) return "";
  return `<div class="unit-block">
    <div class="profile-title">Équipement</div>
    <div class="unit-block-line">${unit.equipment.map(esc).join(", ")}</div>
  </div>`;
}

// Règles spéciales de l'unité — natives, puis ajoutées/remplacées par
// l'Honneur Elfique choisi le cas échéant (voir effectiveRules). Seul le
// résultat concret est affiché : jamais le texte de l'Honneur lui-même.
function renderNativeRules(entry, unit) {
  const rules = effectiveRules(entry, unit);
  if (!rules.length) return "";
  return `<div class="unit-block">
    <div class="profile-title">Règles spéciales</div>
    <div class="unit-block-line">${rules.map(esc).join(", ")}</div>
  </div>`;
}

function optionGroups(entry, u) {
  const result = { banner:[], mount:[], weapon:[], armour:[], champion:[], standard:[], musician:[], other:[] };
  effectiveOptions(entry, u).forEach(o => (result[o.kind] || result.other).push(o));
  return result;
}

function magicItemList(){
  const result=[];
  Object.entries(state.magicItems||{}).forEach(([category,items])=>{
    if(!Array.isArray(items)) return;
    items.forEach(item=>result.push({...item,category}));
  });
  return result;
}

// Honneurs Elfiques réellement proposables : tous ceux du catalogue global
// (data/aptitudes/honneurs-elfiques.json), filtrés par la restriction du
// supplément (restrictions.honours.allowed / .excluded), ex. pour le
// "Héritage de Saphery" de l'Ost du Courant Occidental :
//   "restrictions": {
//     "honours": { "allowed": ["maitre-du-savoir", "gardien-de-saphery", "pur-de-coeur", "garde-maritime"] }
//   }
function allowedHonours() {
  const all = state.honours || [];
  const restr = state.supplement?.restrictions?.honours || {};
  const allowed = Array.isArray(restr.allowed) ? restr.allowed : null;
  const excluded = new Set(Array.isArray(restr.excluded) ? restr.excluded : []);
  return all.filter(h => (!allowed || allowed.includes(h.id)) && !excluded.has(h.id));
}

// Identifiants d'objets magiques déjà pris par d'autres entrées de la liste.
// Un objet marqué "repeatable" (unique === false / multiple === true dans les
// données) reste disponible pour toutes les unités.
function usedMagicItemIds(excludeUid) {
  const used = new Set();
  state.list.forEach(e => {
    if (e.uid === excludeUid) return;
    selectedMagicItemIds(e).forEach(id => {
      const item = magicItemList().find(x => String(x.id) === String(id));
      if (item?.repeatable) return;
      used.add(String(id));
    });
  });
  return used;
}

function magicCost(entry){
  return selectedMagicObjects(entry).reduce((sum,item) => sum + Number(item.points || 0), 0);
}
function magicItemsLabel(entry){
  return selectedMagicObjects(entry).map(x => x.name);
}

// Bloc "Monture" : sélecteur dédié, uniquement si l'unité propose des montures.
function renderMountSelector(entry, u) {
  const mounts = effectiveOptions(entry, u).filter(o => o.kind === "mount");
  if (!mounts.length) return "";
  const current = entry.options.find(id => mounts.some(o => o.id === id)) || "";
  return `<div class="options-box">
    <div class="options-title">Monture</div>
    <label class="option-select-label">Monture
      <select data-select-option="${esc(entry.uid)}" data-option-kind="mount">
        <option value="">Aucune</option>
        ${mounts.map(o => `<option value="${esc(o.id)}" ${o.id===current?"selected":""}>${esc(o.name)}${optionPrice(o)}</option>`).join("")}
      </select>
    </label>
  </div>`;
}

// Bloc "Options de personnage" (ou "Options de l'unité") : commandement
// (chef / porte-étendard / musicien, à cocher indépendamment), bannières,
// armes, armures (menus, un seul choix possible) et autres options hors
// monture / objets magiques.
function renderCharacterOptions(entry, u) {
  const groups = optionGroups(entry, u);
  const label = u.category === "Personnages" ? "Options de personnage" : "Options de l'unité";
  const commandOptions = [...groups.champion, ...groups.standard, ...groups.musician];
  const hasAny = commandOptions.length || groups.banner.length || groups.weapon.length || groups.armour.length || groups.other.length;
  if (!hasAny) return "";

  let html = `<div class="options-box"><div class="options-title">${esc(label)}</div>`;

  // Chef d'unité / porte-étendard / musicien : cases à cocher indépendantes.
  if (commandOptions.length) {
    html += `<div class="check-options"><div class="check-options-title">Commandement</div>`;
    html += commandOptions.map(o => {
      const checked = entry.options.includes(o.id);
      return `<label class="check-option"><input type="checkbox" data-check-option="${esc(entry.uid)}" data-option-id="${esc(o.id)}" ${checked?"checked":""}><span>${esc(o.name)}${optionPrice(o)}</span></label>`;
    }).join("");
    html += `</div>`;
  }

  const labels = { banner:"Bannière / étendard", weapon:"Arme", armour:"Armure / protection" };
  ["banner","weapon","armour"].forEach(kind => {
    const arr = groups[kind];
    if (!arr.length) return;
    const current = entry.options.find(id => arr.some(o => o.id === id)) || "";
    html += `<label class="option-select-label">${labels[kind]}<select data-select-option="${esc(entry.uid)}" data-option-kind="${kind}"><option value="">Aucune</option>${arr.map(o => `<option value="${esc(o.id)}" ${o.id===current?"selected":""}>${esc(o.name)}${optionPrice(o)}</option>`).join("")}</select></label>`;
  });

  if (groups.other.length) {
    html += `<div class="check-options"><div class="check-options-title">Autres options</div>`;
    html += groups.other.map(o => {
      const checked = entry.options.includes(o.id);
      return `<label class="check-option"><input type="checkbox" data-check-option="${esc(entry.uid)}" data-option-id="${esc(o.id)}" ${checked?"checked":""}><span>${esc(o.name)}${optionPrice(o)}</span></label>`;
    }).join("");
    html += `</div>`;
  }

  html += "</div>";
  return html;
}

// Bloc générique de sélection d'objets magiques dans un budget de points
// donné, optionnellement restreint à une catégorie (armes, bannières…).
// Un objet déjà pris par une autre entrée n'apparaît plus dans la liste
// (sauf s'il est marqué répétable dans les données), et un objet dont le
// coût ferait dépasser le budget restant est proposé mais désactivé : il
// n'est donc plus possible de sélectionner un objet au-delà de la limite.
function renderBudgetItemSelector(entry, u, { limit, category, title }) {
  if (limit == null) return "";
  if (!state.magicItems) {
    return state.magicItemsLoading
      ? `<div class="no-options">Chargement des objets magiques…</div>`
      : "";
  }
  const chosenAll = selectedMagicObjects(entry);
  const chosen = category ? chosenAll.filter(x => x.category === category) : chosenAll;
  const used = chosen.reduce((s,x)=>s+Number(x.points||0),0);
  const otherEntriesUsed = usedMagicItemIds(entry.uid);
  const available = magicItemList().filter(item => {
    if (category && item.category !== category) return false;
    if (otherEntriesUsed.has(String(item.id))) return false;
    if (chosenAll.some(c => String(c.id) === String(item.id))) return false;
    return true;
  });

  let html = `<div class="options-box"><div class="options-title">${esc(title)} (max ${formatPoints(limit)})</div>`;

  if (chosen.length) {
    html += `<div class="check-options">` + chosen.map(item => `
      <label class="check-option magic-item-chosen">
        <span>${esc(item.name)} — ${formatPoints(item.points||0)}</span>
        <button type="button" class="remove" data-remove-magic="${esc(entry.uid)}" data-magic-id="${esc(item.id)}">×</button>
      </label>`).join("") + `</div>`;
  }

  html += `<label class="option-select-label">Ajouter un objet
    <select data-add-magic="${esc(entry.uid)}">
      <option value="">Choisir…</option>
      ${available.map(item => {
        const disabledByLimit = (used + Number(item.points||0)) > limit;
        return `<option value="${esc(item.id)}" ${disabledByLimit?"disabled":""}>${esc(item.category)} — ${esc(item.name)} (${formatPoints(item.points||0)})</option>`;
      }).join("")}
    </select>
  </label>`;

  if (!available.length && !chosen.length) html += `<small class="muted">Aucun objet magique disponible (tous déjà attribués).</small>`;
  html += `</div>`;
  return html;
}

// Objets magiques du personnage (arme, armure, talisman, bannière, objet
// enchanté ou cabalistique) : disponible uniquement pour les personnages
// portant la phrase "Objets magiques jusqu'à X pts" dans leurs options —
// les autres ne peuvent prendre aucun objet.
function renderMagicItemsSelector(entry, u) {
  const limit = effectiveBudget(u, "magicItemsLimit");
  if (limit == null) return "";
  return renderBudgetItemSelector(entry, u, { limit, category: null, title: "Objets magiques" });
}

// Bannière magique de l'unité : disponible seulement si l'unité définit un
// budget ("Bannière magique jusqu'à X pts") ET que l'option Porte-étendard
// est cochée pour cette entrée.
function renderBannerItemsSelector(entry, u) {
  const limit = effectiveBudget(u, "bannerItemsLimit");
  if (limit == null) return "";
  const standard = selectedOptionOfKind(entry, u, "standard");
  if (!standard) return "";
  return renderBudgetItemSelector(entry, u, { limit, category: "Bannières magiques", title: "Bannière magique" });
}

// Arme magique du chef d'unité : disponible seulement si l'unité définit un
// budget ("Arme magique jusqu'à X pts") ET que l'option de chef est cochée
// pour cette entrée.
function renderChampionWeaponSelector(entry, u) {
  const limit = effectiveBudget(u, "championWeaponLimit");
  if (limit == null) return "";
  const champion = selectedOptionOfKind(entry, u, "champion");
  if (!champion) return "";
  return renderBudgetItemSelector(entry, u, { limit, category: "Armes magiques", title: "Arme magique du chef" });
}

// Options de règles spéciales (règles optionnelles / honneurs proposés par
// l'unité), distinctes des règles spéciales natives affichées plus haut.
function renderRuleOptions(entry, u) {
  if (!u.ruleOptions?.length) return "";
  return `<div class="options-box">
    <div class="options-title">Options de règles spéciales</div>
    <div class="check-options">
      ${u.ruleOptions.map(o => {
        const checked = entry.options.includes(o.id);
        return `<label class="check-option"><input type="checkbox" data-check-option="${esc(entry.uid)}" data-option-id="${esc(o.id)}" ${checked?"checked":""}><span>${esc(o.name)}${optionPrice(o)}</span></label>`;
      }).join("")}
    </div>
  </div>`;
}

// Case "Compter comme choix de Base/Spécial/…" : n'apparaît que si une
// règle de recatégorisation du supplément (restrictions.reclassifications)
// s'applique à la catégorie normale de cette unité ET que sa condition
// (ex. Éryndor Vareth dans la liste) est active. La décision est prise
// entrée par entrée : le budget "max" est partagé entre toutes les unités
// concernées (Garde Maritime, Élémentaires de Courant…), pas par unité.
function renderReclassificationToggle(entry, u) {
  const active = activeReclassificationRulesFor(u);
  const currentRule = entry.reclassified ? findReclassificationRule(entry.reclassified) : null;
  // La règle déjà appliquée à cette entrée reste proposée (pour pouvoir la
  // décocher) même si elle ne serait plus "active" au sens strict.
  const rule = active[0] || (currentRule && ruleAppliesToUnit(currentRule, u) ? currentRule : null);
  if (!rule) return "";
  const checked = entry.reclassified === rule.id;
  const slotsLeft = reclassificationSlotsLeft(rule, entry.uid);
  const disabled = !checked && slotsLeft <= 0;
  const slotsText = Number.isFinite(rule.max) ? ` — ${slotsLeft + (checked?1:0)}/${rule.max} disponible${rule.max>1?"s":""}` : "";
  return `<div class="options-box">
    <label class="check-option">
      <input type="checkbox" data-reclassify="${esc(entry.uid)}" data-rule-id="${esc(rule.id)}" ${checked?"checked":""} ${disabled?"disabled":""}>
      <span>Compter comme choix de ${esc(rule.toCategory)}${rule.label?` (${esc(rule.label)})`:""}${esc(slotsText)}</span>
    </label>
  </div>`;
}

// Sélecteur "Honneur Elfique" : disponible pour les Personnages, filtré
// par la liste des honneurs autorisés par le supplément (le cas échéant).
// Le coût de l'honneur choisi s'ajoute au total de l'entrée, et son nom
// alimente les conditions (allSelectedOptionNames / hasCondition).
// N'affiche que le nom et le coût de l'Honneur choisi : jamais sa
// description, son texte de règles ou ses restrictions narratives — celles-
// ci sont uniquement *appliquées* (voir effectiveOptions/effectiveRules),
// et leurs conséquences concrètes apparaissent dans les blocs Monture /
// Équipement / Options / Règles spéciales de la fiche.
function renderHonourSelector(entry, u) {
  if (u.category !== "Personnages") return "";
  const pool = allowedHonours();
  if (!pool.length) return "";
  const current = entry.honour || "";
  return `<div class="options-box">
    <div class="options-title">Honneur Elfique</div>
    <label class="option-select-label">Honneur
      <select data-select-honour="${esc(entry.uid)}">
        <option value="">Aucun</option>
        ${pool.map(h => `<option value="${esc(h.id)}" ${h.id===current?"selected":""}>${esc(h.name)} (${formatPoints(h.points)})</option>`).join("")}
      </select>
    </label>
  </div>`;
}

function optionPrice(o) {
  const flat = Number(o.points || 0);
  const per = Number(o.pointsPerModel || 0);
  if (!flat && !per) return "";
  if (per && flat) return ` (+${flat} pts + ${per} pts/mod.)`;
  if (per) return ` (+${per} pts/mod.)`;
  return ` (+${flat} pts)`;
}

function validate() {
  const errors = [], warnings = [];
  const total = getTotal();

  if (!state.army) errors.push("Aucune armée de référence n'est chargée.");
  if (!state.supplement) errors.push("Aucun supplément n'est chargé.");
  if (total > state.pointsLimit) errors.push(`La liste dépasse le format de ${formatPoints(total - state.pointsLimit)}.`);

  const categories = compositionRules();
  for (const [cat, rule] of Object.entries(categories)) {
    const value = getCategoryTotal(cat);
    const minPts = rule.minPercent != null ? state.pointsLimit * Number(rule.minPercent) / 100 : null;
    const maxPts = rule.maxPercent != null ? state.pointsLimit * Number(rule.maxPercent) / 100 : null;
    if (minPts != null && value + 1e-9 < minPts)
      errors.push(`${cat} : il manque ${formatPoints(minPts - value)} pour atteindre ${rule.minPercent} %.`);
    if (maxPts != null && value - 1e-9 > maxPts)
      errors.push(`${cat} : ${formatPoints(value - maxPts)} au-dessus de la limite de ${rule.maxPercent} %.`);
  }

  for (const item of state.list) {
    const u = getUnit(item.id);
    if (!u) { errors.push(`Unité inconnue : ${item.id}.`); continue; }

    const minSize = entryModelMin(u);
    const maxSize = entryModelMax(u);
    if (item.qty < minSize) errors.push(`${u.name} : minimum ${minSize} figurine${minSize > 1 ? "s" : ""}.`);
    if (item.qty > maxSize) errors.push(`${u.name} : maximum ${maxSize} figurine${maxSize > 1 ? "s" : ""}.`);

    const limit = effectiveBudget(u, "magicItemsLimit");
    if (limit != null && magicCost(item) > limit) errors.push(`${u.name} : objets magiques au-dessus de la limite de ${formatPoints(limit)}.`);

    const bannerLimit = effectiveBudget(u, "bannerItemsLimit");
    if (bannerLimit != null) {
      const bannerCost = categoryMagicCost(item, "Bannières magiques");
      if (bannerCost > bannerLimit) errors.push(`${u.name} : bannière magique au-dessus de la limite de ${formatPoints(bannerLimit)}.`);
    }

    const weaponLimit = effectiveBudget(u, "championWeaponLimit");
    if (weaponLimit != null) {
      const weaponCost = categoryMagicCost(item, "Armes magiques");
      if (weaponCost > weaponLimit) errors.push(`${u.name} : arme magique du chef au-dessus de la limite de ${formatPoints(weaponLimit)}.`);
    }

    if (item.honour && !allowedHonours().some(h => h.id === item.honour)) {
      errors.push(`${u.name} : l'honneur elfique choisi n'est plus autorisé par ce supplément.`);
    }

    // Une monture imposée par l'Honneur Elfique choisi (restrict_mount avec
    // required:true, ex. Sang de Caledor, Garde Maritime) doit être prise —
    // "à pied" n'est alors plus une option légale.
    const requiredMount = honourEffectsList(item).find(e => e.type === "restrict_mount" && e.required);
    if (requiredMount && !selectedMount(item, u)) {
      errors.push(`${u.name} : l'honneur elfique choisi impose une monture, aucune n'est sélectionnée.`);
    }
  }

  // Budgets de recatégorisation (ex. Éryndor Vareth : 0-1 choix Spécial/Rare
  // en Base) : un budget partagé peut être dépassé après coup si la
  // condition qui le rendait actif a changé entre-temps (retrait du
  // personnage qui l'accorde, par exemple).
  reclassificationRules().forEach(rule => {
    const count = reclassifiedCount(rule.id);
    if (!count) return;
    if (!conditionMet(rule.when)) {
      errors.push(`Recatégorisation « ${rule.label || rule.id} » : la condition n'est plus remplie.`);
    } else if (rule.max != null && count > Number(rule.max)) {
      errors.push(`Recatégorisation « ${rule.label || rule.id} » : ${count} entrées comptées comme ${rule.toCategory}, maximum ${rule.max}.`);
    }
  });

  for (const u of allUnits()) {
    const r = restrictionForUnit(u.id);
    const entries = getEntriesForUnit(u.id).length;
    const max = maxEntriesForUnit(u);
    if (Number.isFinite(max) && entries > max) errors.push(`${u.name} : ${entries} unités, maximum ${max}.`);
    if (r.maxPer1000 != null) {
      const allowed = Math.floor(state.pointsLimit / 1000) * Number(r.maxPer1000);
      if (entries > allowed) errors.push(`${u.name} : maximum ${allowed} unité${allowed > 1 ? "s" : ""} à ${state.pointsLimit} points.`);
    }
    if (r.maxPerCharacter != null) {
      const characters = getCharacterEntryCount();
      const allowed = characters * Number(r.maxPerCharacter);
      if (entries > allowed) errors.push(`${u.name} : maximum ${allowed} unité${allowed > 1 ? "s" : ""} avec ${characters} personnage${characters > 1 ? "s" : ""}.`);
    }
    if (u.points == null) warnings.push(`Coût non renseigné : ${u.name}.`);
  }

  const global = state.supplement?.restrictions?.global || {};
  if (global.minPoints != null && total < Number(global.minPoints)) errors.push(`Minimum de ${global.minPoints} points requis.`);
  if (global.maxPoints != null && total > Number(global.maxPoints)) errors.push(`Maximum de ${global.maxPoints} points autorisé.`);

  return { errors:[...new Set(errors)], warnings:[...new Set(warnings)] };
}

function filteredUnits() {
  const q = state.filter.trim().toLocaleLowerCase("fr");
  return allUnits().filter(u =>
    (state.category === "Toutes" || effectiveCategory(u) === state.category) &&
    (!q || `${u.name} ${u.category} ${u.rules.join(" ")}`.toLocaleLowerCase("fr").includes(q))
  );
}

function renderCategories() {
  const categories = [...new Set(allUnits().map(u => effectiveCategory(u)))];
  const select = $("categoryFilter");
  const old = state.category;
  if (!categories.includes(old) && old !== "Toutes") state.category = "Toutes";
  select.innerHTML = `<option value="Toutes">Toutes les catégories</option>` + categories.map(c => `<option value="${esc(c)}" ${c === state.category ? "selected" : ""}>${esc(c)}</option>`).join("");
}

function formatPoints(n) { return Number(n || 0).toLocaleString("fr-FR") + " pts"; }

function renderAvailable() {
  const container = $("availableUnits");
  // Seules les unités réellement sélectionnables sont affichées : plus
  // d'unités grisées ni de séparateur "indisponibles" dans la colonne de
  // gauche — une unité qu'on ne peut pas ajouter (coût manquant, non
  // autorisée par le supplément, maximum atteint…) n'y apparaît plus.
  const units = filteredUnits().filter(u => u.points != null && isAllowed(u) && canAdd(u, true));
  if (!units.length) {
    container.innerHTML = `<div class="empty">Aucune unité disponible ne correspond aux critères.</div>`;
    return;
  }

  const groups = {};
  units.forEach(u => (groups[effectiveCategory(u)] ||= []).push(u));

  container.innerHTML = sortByCategory(Object.entries(groups)).map(([cat, arr]) => `
    <section class="unit-group">
      <div class="group-head"><span>${esc(cat)}</span><span>${arr.length}</span></div>
      ${arr.map(u => {
        const entries = getEntriesForUnit(u.id).length;
        const max = maxEntriesForUnit(u);
        const limitText = Number.isFinite(max) ? `${entries}/${max} unité${max > 1 ? "s" : ""}` : `${entries} unité${entries > 1 ? "s" : ""}`;
        return `<article class="unit-card">
          <div class="unit-main">
            <strong>${esc(u.name)}</strong>
            <span class="unit-points">${formatPoints(u.points)} / figurine</span>
            <small>${esc(limitText)}</small>
          </div>
          <button class="add-btn" data-add="${esc(u.id)}">＋ Ajouter</button>
        </article>`;
      }).join("")}
    </section>`).join("");

  container.querySelectorAll("[data-add]").forEach(b => b.onclick = () => addUnit(b.dataset.add));
}

function renderList() {
  const container = $("armyList");
  const items = state.list.map(item => ({ item, unit: getUnit(item.id) })).filter(x => x.unit);
  $("listEmpty").style.display = items.length ? "none" : "block";

  if (!items.length) { container.innerHTML = ""; return; }

  const groups = {};
  items.forEach(x => (groups[entryEffectiveCategory(x.item, x.unit)] ||= []).push(x));

  container.innerHTML = sortByCategory(Object.entries(groups)).map(([cat, arr]) => `
    <section class="roster-group">
      <div class="group-head"><span>${esc(cat)}</span><span>${formatPoints(arr.reduce((s,x)=>s+entryPoints(x.item),0))}</span></div>
      ${arr.map(({item,unit}, index) => {
        const expanded = !!item.expanded;
        const min = entryModelMin(unit), max = entryModelMax(unit);
        const maxText = max === Infinity ? "" : ` / ${max}`;
        const selected = selectedOptions(item);
        const pool = effectivePool(item, unit);
        const optionNames = selected.map(id => pool.find(o=>o.id===id)?.name).filter(Boolean);
        optionNames.push(...magicItemsLabel(item));
        if (item.honour) { const h=(state.honours||[]).find(x=>x.id===item.honour); if(h) optionNames.push(h.name); }
        // Fiche repliée par défaut : seuls le nom et le coût total de
        // l'entrée sont visibles. Cocher la case "onglet" charge la fiche
        // complète (caractéristiques, équipement, options, objets…).
        return `<article class="roster-entry ${expanded ? "expanded" : "collapsed"}" data-entry="${esc(item.uid)}">
          <div class="roster-entry-head">
            <div>
              <label class="entry-toggle">
                <input type="checkbox" data-toggle-expand="${esc(item.uid)}" ${expanded?"checked":""} title="Afficher la fiche complète">
                <span class="entry-number">${index+1}</span>
                <strong>${esc(unit.name)}</strong>
              </label>
              ${expanded ? `<small>${formatPoints(unit.points)} / figurine · Taille ${min}${maxText}</small>` : ""}
            </div>
            <div class="entry-total">${formatPoints(entryPoints(item))}</div>
            <button class="remove" data-remove="${esc(item.uid)}" title="Retirer cette unité">×</button>
          </div>
          ${!expanded ? "" : `
          <div class="roster-entry-controls">
            <div class="qty-control"><button data-minus="${esc(item.uid)}">−</button><input class="qty-input" type="number" min="${min}" ${max===Infinity?"":`max="${max}"`} value="${item.qty}" data-qty-input="${esc(item.uid)}" aria-label="Effectif de ${esc(unit.name)}"><button data-plus="${esc(item.uid)}">+</button><span>figurine${item.qty > 1 ? "s" : ""}</span></div>
            <div class="selected-options">${optionNames.length ? optionNames.map(esc).join(" · ") : "Aucune option"}</div>
          </div>
          ${renderReclassificationToggle(item, unit)}
          ${renderStatsTable(item, unit)}
          ${renderEquipment(unit)}
          ${renderNativeRules(item, unit)}
          ${renderMountSelector(item, unit)}
          ${renderCharacterOptions(item, unit)}
          ${renderHonourSelector(item, unit)}
          ${renderMagicItemsSelector(item, unit)}
          ${renderBannerItemsSelector(item, unit)}
          ${renderChampionWeaponSelector(item, unit)}
          ${renderRuleOptions(item, unit)}
          `}
        </article>`;
      }).join("")}
    </section>`).join("");

  container.querySelectorAll("[data-minus]").forEach(b => b.onclick = () => changeQty(b.dataset.minus,-1));
  container.querySelectorAll("[data-plus]").forEach(b => b.onclick = () => changeQty(b.dataset.plus,1));
  container.querySelectorAll("[data-qty-input]").forEach(i => { i.onchange = () => setQty(i.dataset.qtyInput,i.value); i.onkeydown = e => { if(e.key === "Enter") i.blur(); }; });
  container.querySelectorAll("[data-remove]").forEach(b => b.onclick = () => removeEntry(b.dataset.remove));
  container.querySelectorAll("[data-toggle-expand]").forEach(b => b.onchange = () => toggleExpanded(b.dataset.toggleExpand));
  container.querySelectorAll("[data-check-option]").forEach(b => b.onchange = () => setOption(b.dataset.checkOption,b.dataset.optionId,b.checked));
  container.querySelectorAll("[data-select-option]").forEach(s => s.onchange = () => setSelectOption(s.dataset.selectOption,s.dataset.optionKind,s.value));
  container.querySelectorAll("[data-add-magic]").forEach(s => s.onchange = () => { addMagicItem(s.dataset.addMagic, s.value); });
  container.querySelectorAll("[data-remove-magic]").forEach(b => b.onclick = () => removeMagicItem(b.dataset.removeMagic, b.dataset.magicId));
  container.querySelectorAll("[data-reclassify]").forEach(b => b.onchange = () => setReclassified(b.dataset.reclassify, b.dataset.ruleId, b.checked));
  container.querySelectorAll("[data-select-honour]").forEach(s => s.onchange = () => setHonour(s.dataset.selectHonour, s.value));
}

// Barre de proportions (remplace l'ancien diagramme circulaire) : un seul
// bandeau horizontal, un segment par catégorie, largeur proportionnelle à
// sa part dans le total de points de la liste actuelle.
function renderCompositionChart(){
  const chart=$('compositionChart'), legend=$('compositionLegend'), toggle=$('chartToggle');
  if(!chart||!legend) return;
  const cats=['Personnages','Unités de Base','Unités Spéciales','Unités Rares'];
  const values=cats.map(cat=>getCategoryTotal(cat));
  const total=values.reduce((a,b)=>a+b,0);
  const colors=['#c79a32','#5a2f24','#9a6f22','#a9503d'];

  chart.style.display = "flex";
  chart.style.overflow = "hidden";
  if (!chart.style.height) chart.style.height = "28px";
  if (!chart.style.borderRadius) chart.style.borderRadius = "6px";

  chart.innerHTML = total
    ? values.map((v,i) => {
        const pct = v/total*100;
        if (pct <= 0) return "";
        return `<div class="composition-bar-segment" style="flex:${pct} 0 0;height:100%;background:${colors[i]}" title="${esc(cats[i])} — ${formatPoints(v)} (${pct.toFixed(1)} % de la liste)"></div>`;
      }).join("")
    : `<div class="composition-bar-segment" style="flex:1 0 0;height:100%;background:#6a5a45"></div>`;
  chart.hidden=!(toggle?.checked);

  legend.innerHTML=cats.map((cat,i)=>{const pct=state.pointsLimit?values[i]/state.pointsLimit*100:0; return `<div><span class="legend-dot" style="background:${colors[i]}"></span><span>${cat}</span><strong>${formatPoints(values[i])}</strong><small>${pct.toFixed(1)} % du format</small></div>`;}).join('');
}

function renderSummary() {
  const total = getTotal();
  const result = validate();
  renderCompositionChart();
  $("totalPoints").textContent = total.toLocaleString("fr-FR");
  $("formatPoints").textContent = state.pointsLimit.toLocaleString("fr-FR");
  const remaining = state.pointsLimit - total;
  $("remainingPoints").textContent = `${remaining >= 0 ? "" : "−"}${Math.abs(remaining).toLocaleString("fr-FR")} pts`;
  $("remainingPoints").className = remaining >= 0 ? "remaining-ok" : "remaining-bad";
  $("unitCount").textContent = state.list.reduce((s,x)=>s+1,0);

  $("validation").innerHTML = result.errors.length
    ? `<div class="invalid">✗ ${result.errors.length} problème(s)</div><ul>${result.errors.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`
    : `<div class="valid">✓ Liste valide</div>`;

  $("warnings").innerHTML = result.warnings.length
    ? `<ul>${result.warnings.slice(0,8).map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`
    : `<span class="muted">Aucun avertissement.</span>`;

  const rules = compositionRules();
  $("constraints").innerHTML = Object.entries(rules).length
    ? Object.entries(rules).map(([cat,r]) => {
      const v = getCategoryTotal(cat);
      const pct = state.pointsLimit ? v/state.pointsLimit*100 : 0;
      const minPts = r.minPercent != null ? state.pointsLimit*Number(r.minPercent)/100 : null;
      const maxPts = r.maxPercent != null ? state.pointsLimit*Number(r.maxPercent)/100 : null;
      const messages = [];
      if (minPts != null) messages.push(pct < Number(r.minPercent) ? `Il manque ${formatPoints(minPts-v)}` : `Min. atteint`);
      if (maxPts != null) messages.push(pct > Number(r.maxPercent) ? `${formatPoints(v-maxPts)} en trop` : `Max. ${formatPoints(maxPts)}`);
      const statusClass = (minPts != null && v < minPts) || (maxPts != null && v > maxPts) ? "constraint-bad" : "constraint-ok";
      return `<div class="constraint ${statusClass}">
        <div><strong>${esc(cat)}</strong><small>${formatPoints(v)} · ${pct.toFixed(1)} %</small></div>
        <span>${esc(messages.join(" · ") || "Aucune limite")}</span>
      </div>`;
    }).join("")
    : `<span class="muted">Aucune contrainte de composition renseignée.</span>`;
}

function renderInfo() {
  $("supplementDescription").textContent = state.supplement?.description || "Aucune description renseignée.";
  $("sourceInfo").textContent = state.supplement?.source || "";
  $("armyInfo").textContent = state.army?.name || "";
  $("specialRules").innerHTML = (state.supplement?.specialRules || []).slice(0,8).map(r => {
    if (typeof r === "string") return `<li>${esc(r)}</li>`;
    return `<li><strong>${esc(r.name || r.id || "")}</strong>${r.text ? " — "+esc(r.text) : ""}</li>`;
  }).join("") || `<li>Aucune règle spéciale renseignée.</li>`;
}

function render() {
  renderCategories();
  renderAvailable();
  renderList();
  renderSummary();
  renderInfo();
}

function setStatus(message, type="") {
  $("status").textContent = message;
  $("status").className = "status " + type;
}

async function loadSupplement(id, keepArmy=false) {
  const catalog = state.catalog.find(x => x.id === id);
  if (!catalog) return;
  setStatus("Chargement du supplément…");
  try {
    const raw = await getJSON(PATHS.supplements + id + ".json");
    state.supplement = normalizeSupplement(raw, catalog);
    const armyId = keepArmy && state.army && state.supplement.armies.includes(state.army.id)
      ? state.army.id : state.supplement.armies[0];
    await loadArmy(armyId, true);
    state.list = [];
    render();
    setStatus(`${state.supplement.name} chargé.`, "ok");
  } catch(e) { setStatus(e.message, "error"); }
}

async function loadArmy(id, reset=true) {
  if (!state.supplement?.armies?.includes(id)) return;
  try {
    const raw = await getJSON(PATHS.armies + id + ".json");
    state.army = normalizeArmy(raw,id);
    if (reset) state.list = [];
    await loadMagicItems(id);
    updateSelectors();
    render();
    setStatus(`${state.supplement.name} · ${state.army.name}`, "ok");
  } catch(e) {
    state.army = null;
    render();
    setStatus(e.message, "error");
  }
}

function updateSelectors() {
  const s = $("supplementSelect");
  s.innerHTML = state.catalog.map(x => `<option value="${esc(x.id)}" ${x.id===state.supplement?.id?"selected":""}>${esc(x.name)}</option>`).join("");
  const armies = state.supplement?.armies || [];
  const a = $("armySelect");
  a.innerHTML = armies.map(id => `<option value="${esc(id)}" ${id===state.army?.id?"selected":""}>${esc(armyLabel(id))}</option>`).join("");
  $("armyField").style.display = armies.length > 1 ? "block" : "none";
}

function newList() {
  state.list = [];
  $("nameInput").value = "";
  render();
  setStatus("Nouvelle liste.", "ok");
}

const SAVE_KEY = "archivesCourantArmyLists";

function readSavedLists() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveList() {
  const name = $("nameInput").value.trim() || "Ma liste";
  const payload = {
    id: uid(),
    version: 6,
    supplementId: state.supplement?.id || "",
    armyId: state.army?.id || "",
    name,
    pointsLimit: state.pointsLimit,
    list: state.list,
    savedAt: new Date().toISOString()
  };
  const saves = readSavedLists().filter(x => !(x.supplementId === payload.supplementId && x.armyId === payload.armyId && x.name === name));
  saves.unshift(payload);
  localStorage.setItem(SAVE_KEY, JSON.stringify(saves.slice(0, 20)));
  setStatus(`« ${name} » sauvegardée dans ce navigateur.`, "ok");
}

function loadList() {
  const saves = readSavedLists();
  if (!saves.length) return setStatus("Aucune liste sauvegardée dans ce navigateur.", "error");

  const compatible = saves.filter(x => x.supplementId === state.supplement?.id && x.armyId === state.army?.id);
  if (!compatible.length) return setStatus("Aucune sauvegarde compatible avec le supplément et l'armée actuellement sélectionnés.", "error");

  const menu = compatible.map((x,i) => `${i+1}. ${x.name} — ${x.pointsLimit} pts — ${new Date(x.savedAt).toLocaleString("fr-FR")}`).join("\n");
  const answer = prompt(`Choisissez la liste à charger :\n\n${menu}\n\nEntrez son numéro.`);
  if (answer === null) return;
  const index = Number(answer) - 1;
  if (!Number.isInteger(index) || !compatible[index]) return setStatus("Numéro de sauvegarde invalide.", "error");

  const p = compatible[index];
  state.pointsLimit = Number(p.pointsLimit) || 2000;
  $("pointsInput").value = state.pointsLimit;
  $("nameInput").value = p.name || "Ma liste";
  state.list = Array.isArray(p.list)
    ? p.list.map(item => ({
        uid: item.uid || uid(),
        id: item.id,
        qty: Number(item.qty) || 1,
        options: Array.isArray(item.options) ? item.options : [],
        // compatibilité ascendante avec l'ancien format (une seule bannière magique)
        magicItems: Array.isArray(item.magicItems)
          ? item.magicItems
          : (item.magicBannerId ? [item.magicBannerId] : [])
      })).filter(x => getUnit(x.id))
    : [];
  render();
  setStatus(`« ${p.name} » chargée.`, "ok");
}

function exportJSON() {
  const payload = {
    version: 5,
    supplement: { id: state.supplement?.id, name: state.supplement?.name },
    army: { id: state.army?.id, name: state.army?.name },
    name: $("nameInput").value.trim() || "Ma liste",
    pointsLimit: state.pointsLimit,
    total: getTotal(),
    list: state.list.map(item => ({...item, points:entryPoints(item)})),
    exportedAt: new Date().toISOString()
  };
  download(`${slug(payload.name)}.json`, JSON.stringify(payload,null,2), "application/json");
  setStatus("Liste exportée en JSON.", "ok");
}

function exportTXT() {
  const lines = [
    $("nameInput").value.trim() || "Ma liste",
    `${state.supplement?.name || ""} · ${state.army?.name || ""}`,
    `Format : ${state.pointsLimit} points`,
    `Total : ${getTotal()} points`,
    ""
  ];
  const groups = {};
  state.list.forEach(item => { const u=getUnit(item.id); if(u) (groups[entryEffectiveCategory(item, u)] ||= []).push({u,item}); });
  sortByCategory(Object.entries(groups)).forEach(([cat,arr]) => {
    lines.push(cat.toUpperCase());
    lines.push("-".repeat(cat.length));
    arr.forEach(({u,item},i) => {
      const pool = effectivePool(item, u);
      const opts = selectedOptions(item).map(id=>pool.find(o=>o.id===id)?.name).filter(Boolean);
      opts.push(...magicItemsLabel(item));
      if (item.honour) { const h=(state.honours||[]).find(x=>x.id===item.honour); if(h) opts.push(h.name); }
      lines.push(`${i+1}. ${item.qty} figurine${item.qty>1?"s":""} — ${u.name}${opts.length?" — "+opts.join(", "):""} — ${entryPoints(item)} pts`);
    });
    lines.push("");
  });
  download(`${slug($("nameInput").value || "ma-liste")}.txt`, lines.join("\n"), "text/plain;charset=utf-8");
  setStatus("Liste exportée en TXT.", "ok");
}

function download(name, content, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], {type}));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

function printList() {
  const ordered = state.list
    .map(item => ({ item, u: getUnit(item.id) }))
    .filter(x => x.u)
    .sort((a,b) => categoryRank(entryEffectiveCategory(a.item, a.u)) - categoryRank(entryEffectiveCategory(b.item, b.u)));
  const rows = ordered.map(({item,u},index) => {
    const pool = effectivePool(item, u);
    const opts=selectedOptions(item).map(id=>pool.find(o=>o.id===id)?.name).filter(Boolean);
    opts.push(...magicItemsLabel(item));
    if (item.honour) { const h=(state.honours||[]).find(x=>x.id===item.honour); if(h) opts.push(h.name); }
    const optText=opts.join(", ");
    return `<tr><td>${index+1}</td><td>${esc(entryEffectiveCategory(item, u))}</td><td>${esc(u.name)}</td><td>${item.qty}</td><td>${esc(optText)}</td><td>${entryPoints(item)}</td></tr>`;
  }).join("");
  const w=window.open("","_blank");
  if(!w) return setStatus("La fenêtre d'impression a été bloquée.", "error");
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc($("nameInput").value||"Ma liste")}</title><style>body{font-family:Georgia,serif;margin:40px;color:#222}h1{font-size:28px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #aaa;padding:7px;text-align:left}.total{font-size:20px;margin:15px 0}</style></head><body><h1>${esc($("nameInput").value||"Ma liste")}</h1><p>${esc(state.supplement?.name||"")} · ${esc(state.army?.name||"")}</p><div class="total">${getTotal()} / ${state.pointsLimit} points</div><table><thead><tr><th>#</th><th>Catégorie</th><th>Unité</th><th>Effectif</th><th>Options</th><th>Points</th></tr></thead><tbody>${rows}</tbody></table><script>window.print()<\/script></body></html>`);
  w.document.close();
}

function slug(s) {
  return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || "liste";
}

$("supplementSelect").onchange = e => loadSupplement(e.target.value);
$("armySelect").onchange = e => loadArmy(e.target.value);
$("pointsInput").oninput = e => { state.pointsLimit=Math.max(1,Number(e.target.value)||1); render(); };
$("searchInput").oninput = e => { state.filter=e.target.value; renderAvailable(); };
$("categoryFilter").onchange = e => { state.category=e.target.value; renderAvailable(); };
$("newListBtn").onclick = newList;

function clearCurrentList() {
  if (confirm("Vider complètement cette liste ?")) {
    state.list = [];
    render();
    setStatus("Liste vidée.", "ok");
  }
}

const actions = {
  save: saveList, load: loadList, print: printList, txt: exportTXT, json: exportJSON, clear: clearCurrentList
};
[["saveBtn","save"],["saveTopBtn","save"],["loadBtn","load"],["loadTopBtn","load"],["printBtn","print"],["printTopBtn","print"],["exportTxtBtn","txt"],["exportTxtTopBtn","txt"],["exportJsonBtn","json"],["exportJsonTopBtn","json"],["clearBtn","clear"],["clearTopBtn","clear"]].forEach(([id,action]) => { if ($(id)) $(id).onclick = actions[action]; });

const chartToggle=$('chartToggle'); if(chartToggle) chartToggle.onchange=()=>renderCompositionChart();

async function init() {
  try {
    // Le catalogue d'Honneurs Elfiques est indépendant de l'armée/supplément :
    // chargé en parallèle du catalogue de suppléments, une seule fois.
    const [raw] = await Promise.all([getJSON(PATHS.catalog), loadHonours()]);
    state.catalog = Array.isArray(raw) ? raw : (raw.supplements || []);
    if (!state.catalog.length) throw new Error("Aucun supplément n'est défini.");
    updateSelectors();
    await loadSupplement(state.catalog[0].id);
  } catch(e) {
    console.error(e);
    setStatus(e.message, "error");
  }
}

init();
})();
