(() => {
"use strict";

/*
  ARCHIVES DU COURANT — GÉNÉRATEUR V4
  ------------------------------------------------------------
  Données :
    data/supplements.json
    data/armees/*.json
    data/supplements/*.json

  Le générateur ne modifie jamais les fichiers data/.

  Principes :
    - une unité ajoutée = une entrée indépendante dans la liste ;
    - plusieurs entrées identiques sont possibles ;
    - chaque entrée possède son propre effectif et ses propres options ;
    - les options sont chiffrées automatiquement lorsqu'elles sont décrites
      dans les JSON ;
    - les restrictions min/max, maxPer1000 et maxPerCharacter sont prises en compte ;
    - les pourcentages de composition sont calculés sur le format choisi ;
    - les contraintes affichent toujours leur équivalent en points.
*/

const PATHS = {
  catalog: "data/supplements.json",
  armies: "data/armees/",
  supplements: "data/supplements/"
};

const state = {
  catalog: [],
  supplement: null,
  army: null,
  list: [],
  pointsLimit: 2000,
  filter: "",
  category: "Toutes",
  magicItems: null,
  magicItemsLoading: false
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

function normalizeOption(raw) {
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
      kind: inferOptionKind(name),
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
    kind: raw.kind || inferOptionKind(name),
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

function normalizeUnit(u, fallbackId = "") {
  if (!u || typeof u !== "object") return null;
  const points = u.points ?? u.cost ?? u.cout;
  const options = Array.isArray(u.options) ? u.options.map(normalizeOption).filter(Boolean) : [];

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
    rules: u.rules ?? u.regles ?? u.specialRules ?? [],
    profile: u.profile || u.profil || null,
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

function unitsFrom(raw) {
  if (Array.isArray(raw?.units)) return raw.units.map(u => normalizeUnit(u)).filter(Boolean);
  if (raw?.units && typeof raw.units === "object") {
    return Object.entries(raw.units).map(([id,u]) => normalizeUnit(u,id)).filter(Boolean);
  }
  return [];
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
        points: item.points == null ? 0 : Number(item.points)
      };
    });
  });
  return result;
}

async function loadMagicItems(armyId) {
  state.magicItems = null;
  if (!armyId) return;
  state.magicItemsLoading = true;
  try {
    const raw = await getJSON(PATHS.armies + "../objets-magiques/" + armyId + ".json");
    state.magicItems = normalizeMagicItems(raw);
  } catch (e) {
    // A missing magic-item file is not fatal: the army can still be built.
    state.magicItems = null;
  } finally {
    state.magicItemsLoading = false;
  }
}

function magicItemsForEntry(entry, unit) {
  if (!state.magicItems || !unit || unit.category !== "Personnages") return [];
  const categories = [];
  Object.entries(state.magicItems).forEach(([category, items]) => {
    categories.push(...items.map(item => ({...item, category})));
  });
  return categories;
}

function normalizeArmy(raw, fallbackId) {
  return {
    ...raw,
    id: raw.id || fallbackId,
    name: raw.name || raw.nom || armyLabel(fallbackId),
    units: unitsFrom(raw),
    composition: raw.composition || { categories: {} }
  };
}

function normalizeSupplement(raw, fallback) {
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
    units: unitsFrom(raw)
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
    (entry.options||[]).forEach(id=>{ const o=(u.options||[]).find(x=>x.id===id); if(o) names.push(String(o.name).toLocaleLowerCase("fr")); });
    [u.notes,u.specialRules,u.honours,u.honor,u.honneurs].forEach(v=>{
      if(Array.isArray(v)) v.forEach(x=>names.push(String(typeof x==='object'?(x.name||x.label||x.id||''):x).toLocaleLowerCase("fr")));
      else if(v) names.push(String(typeof v==='object'?(v.name||v.label||v.id||''):v).toLocaleLowerCase("fr"));
    });
  });
  return names;
}
function hasCondition(text, unit=null){
  const t=String(text||'').toLocaleLowerCase('fr');
  if(!t) return true;
  const names=allSelectedOptionNames();
  const generalIds=state.list.filter(x=>getUnit(x.id)?.category==='Personnages').map(x=>x.id);
  if(t.includes('eryndor') || t.includes('éryndor')) return generalIds.includes('eryndor-vareth');
  if(t.includes('garde maritime')) return generalIds.includes('eryndor-vareth') || names.some(n=>n.includes('garde maritime')) || state.list.some(x=>{
    const u=getUnit(x.id); return String(u?.notes||'').toLocaleLowerCase('fr').includes('honneur elfique garde maritime') || String(u?.notes||'').toLocaleLowerCase('fr').includes('honneur garde maritime');
  });
  if(t.includes('gardien de saphery')) return names.some(n=>n.includes('gardien de saphery'));
  if(t.includes('maître du savoir') || t.includes('maitre du savoir')) return names.some(n=>n.includes('maître du savoir')||n.includes('maitre du savoir'));
  return names.some(n=>t.replace(/^général avec l'honneur\s*/,'').replace(/^general avec l'honneur\s*/,'').split(/[,.]/)[0].trim() && n.includes(t.replace(/^général avec l'honneur\s*/,'').replace(/^general avec l'honneur\s*/,'').split(/[,.]/)[0].trim()));
}
function conditionalAllowed(u){
  const r=restrictionForUnit(u?.id);
  if(!r?.conditional) return true;
  const conditions=Array.isArray(r.conditional)?r.conditional:[r.conditional];
  return conditions.some(c=>hasCondition(c,u));
}
function effectiveCategory(u){
  if(!u) return 'Autres';
  // Éryndor permet explicitement à la Garde Maritime de devenir un choix de Base.
  if(u.id==='lothern-sea-guard' && hasCondition('Général avec l’Honneur Garde Maritime')) return 'Unités de Base';
  if(u.category==='Unités Spéciales' && u.id==='lothern-sea-guard' && state.list.some(x=>x.id==='eryndor-vareth')) return 'Unités de Base';
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

function optionCost(u, entry) {
  const selected = selectedOptions(entry);
  return selected.reduce((sum, id) => {
    const opt = u.options.find(o => o.id === id);
    if (!opt) return sum;
    return sum + Number(opt.points || 0) + Number(opt.pointsPerModel || 0) * Number(entry.qty || 0);
  }, 0);
}

function entryPoints(entry) {
  const u = getUnit(entry.id);
  if (!u || u.points == null) return 0;
  return Number(u.points) * Number(entry.qty || 0) + optionCost(u, entry) + magicCost(entry);
}

function getCategoryTotal(category) {
  return state.list.reduce((sum, item) => {
    const u = getUnit(item.id);
    return sum + (effectiveCategory(u) === category ? entryPoints(item) : 0);
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
    options: []
  });
  render();
  requestAnimationFrame(() => {
    const last = document.querySelector(`[data-entry="${CSS.escape(state.list.at(-1).uid)}"]`);
    last?.scrollIntoView({ behavior:"smooth", block:"nearest" });
  });
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

function setOption(uidValue, optionId, checked) {
  const entry = findEntry(uidValue);
  if (!entry) return;
  entry.options ||= [];
  if (checked && !entry.options.includes(optionId)) entry.options.push(optionId);
  if (!checked) entry.options = entry.options.filter(x => x !== optionId);
  render();
}

function setMagicBanner(uidValue,itemId){
  const entry=findEntry(uidValue); if(!entry) return;
  entry.magicBannerId=itemId||null;
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

function optionGroups(u) {
  const result = { banner:[], mount:[], weapon:[], armour:[], other:[] };
  (u.options || []).forEach(o => (result[o.kind] || result.other).push(o));
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
function magicBannersForOption(opt){
  const max=opt?.maxPoints!=null?Number(opt.maxPoints):Infinity;
  return magicItemList().filter(item=>{
    const c=String(item.category||'').toLocaleLowerCase('fr');
    const n=String(item.name||'').toLocaleLowerCase('fr');
    const isBanner=c.includes('banner')||c.includes('banni')||c.includes('standard')||n.includes('bannière')||n.includes('banniere');
    return isBanner && Number(item.points||0)<=max;
  });
}
function magicCost(entry){
  if(!entry?.magicBannerId) return 0;
  const item=magicItemList().find(x=>String(x.id)===String(entry.magicBannerId));
  return Number(item?.points||0);
}
function magicName(entry){
  if(!entry?.magicBannerId) return '';
  return magicItemList().find(x=>String(x.id)===String(entry.magicBannerId))?.name || '';
}

function renderOptionControls(entry, u) {
  if (!u.options?.length) return `<div class="no-options">Aucune option renseignée pour cette unité.</div>`;
  const groups = optionGroups(u);
  let html = "<div class=\"options-box\"><div class=\"options-title\">Options de l'unité</div>";

  const labels = { banner:"Bannière / étendard", mount:"Monture", weapon:"Arme", armour:"Armure / protection" };
  ["banner","mount","weapon","armour"].forEach(kind => {
    const arr = groups[kind];
    if (!arr.length) return;
    const current = entry.options.find(id => arr.some(o => o.id === id)) || "";
    html += `<label class="option-select-label">${labels[kind]}<select data-select-option="${esc(entry.uid)}" data-option-kind="${kind}"><option value="">Aucune</option>${arr.map(o => `<option value="${esc(o.id)}" ${o.id===current?"selected":""}>${esc(o.name)}${optionPrice(o)}</option>`).join("")}</select></label>`;
    if(kind === 'banner') {
      arr.forEach(o => {
        if(o.maxPoints == null) return;
        const choices=magicBannersForOption(o);
        html += `<label class="option-select-label magic-banner-choice"><span>Bannière magique ≤ ${o.maxPoints} pts</span><select data-magic-banner="${esc(entry.uid)}"><option value="">Aucune</option>${choices.map(item=>`<option value="${esc(item.id)}" ${String(item.id)===String(entry.magicBannerId||'')?'selected':''}>${esc(item.name)} — ${formatPoints(item.points||0)}</option>`).join('')}</select>${!choices.length?'<small class="muted">Aucun objet magique chargé pour cette armée.</small>':''}</label>`;
      });
    }
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
    const r = restrictionForUnit(item.id);
    if (!u) { errors.push(`Unité inconnue : ${item.id}.`); continue; }

    const minSize = entryModelMin(u);
    const maxSize = entryModelMax(u);
    if (item.qty < minSize) errors.push(`${u.name} : minimum ${minSize} figurine${minSize > 1 ? "s" : ""}.`);
    if (item.qty > maxSize) errors.push(`${u.name} : maximum ${maxSize} figurine${maxSize > 1 ? "s" : ""}.`);
  }

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
    (!q || `${u.name} ${u.category} ${Array.isArray(u.rules) ? u.rules.join(" ") : u.rules || ""}`.toLocaleLowerCase("fr").includes(q))
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
  const units = filteredUnits();
  if (!units.length) {
    container.innerHTML = `<div class="empty">Aucune unité ne correspond aux critères.</div>`;
    return;
  }

  const groups = {};
  units.forEach(u => (groups[effectiveCategory(u)] ||= []).push(u));

  container.innerHTML = Object.entries(groups).map(([cat, arr]) => `
    <section class="unit-group">
      <div class="group-head"><span>${esc(cat)}</span><span>${arr.length}</span></div>
      ${[
        ...arr.filter(u => !(u.points == null || !isAllowed(u) || !canAdd(u, true))),
        ...arr.filter(u =>  (u.points == null || !isAllowed(u) || !canAdd(u, true)))
      ].map((u, pos, ordered) => {
        const can = canAdd(u, true);
        const disabled = u.points == null || !isAllowed(u) || !can;
        const rules = Array.isArray(u.rules) ? u.rules.slice(0,3).join(" · ") : (u.rules || "");
        const entries = getEntriesForUnit(u.id).length;
        const max = maxEntriesForUnit(u);
        const limitText = Number.isFinite(max) ? `${entries}/${max} unité${max > 1 ? "s" : ""}` : `${entries} unité${entries > 1 ? "s" : ""}`;
        const firstDisabled = disabled && !ordered.slice(0,pos).some(x => x.points == null || !isAllowed(x) || !canAdd(x, true));
        const separator = firstDisabled ? `<div class="unavailable-separator">Unités actuellement indisponibles</div>` : "";
        return separator + `<article class="unit-card ${disabled ? "disabled" : ""}">
          <div class="unit-main">
            <strong>${esc(u.name)}</strong>
            <span class="unit-points">${u.points == null ? "Coût à renseigner" : formatPoints(u.points) + " / figurine"}</span>
            <small>${esc(u.unitSize ? "Taille : " + u.unitSize : "")} · ${esc(limitText)}</small>
            ${rules ? `<em>${esc(rules)}</em>` : ""}
          </div>
          <button class="add-btn" data-add="${esc(u.id)}" ${disabled ? "disabled" : ""}>＋ Ajouter</button>
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
  items.forEach(x => (groups[x.unit.category] ||= []).push(x));

  container.innerHTML = Object.entries(groups).map(([cat, arr]) => `
    <section class="roster-group">
      <div class="group-head"><span>${esc(cat)}</span><span>${formatPoints(arr.reduce((s,x)=>s+entryPoints(x.item),0))}</span></div>
      ${arr.map(({item,unit}, index) => {
        const min = entryModelMin(unit), max = entryModelMax(unit);
        const maxText = max === Infinity ? "" : ` / ${max}`;
        const selected = selectedOptions(item);
        const optionNames = selected.map(id => unit.options.find(o=>o.id===id)?.name).filter(Boolean);
        if(item.magicBannerId) optionNames.push(magicName(item));
        return `<article class="roster-entry" data-entry="${esc(item.uid)}">
          <div class="roster-entry-head">
            <div><span class="entry-number">${index+1}</span><strong>${esc(unit.name)}</strong><small>${formatPoints(unit.points)} / figurine · Taille ${min}${maxText}</small></div>
            <div class="entry-total">${formatPoints(entryPoints(item))}</div>
            <button class="remove" data-remove="${esc(item.uid)}" title="Retirer cette unité">×</button>
          </div>
          <div class="roster-entry-controls">
            <div class="qty-control"><button data-minus="${esc(item.uid)}">−</button><input class="qty-input" type="number" min="${min}" ${max===Infinity?"":`max="${max}"`} value="${item.qty}" data-qty-input="${esc(item.uid)}" aria-label="Effectif de ${esc(unit.name)}"><button data-plus="${esc(item.uid)}">+</button><span>figurine${item.qty > 1 ? "s" : ""}</span></div>
            <div class="selected-options">${optionNames.length ? optionNames.map(esc).join(" · ") : "Aucune option"}</div>
          </div>
          ${renderOptionControls(item, unit)}
        </article>`;
      }).join("")}
    </section>`).join("");

  container.querySelectorAll("[data-minus]").forEach(b => b.onclick = () => changeQty(b.dataset.minus,-1));
  container.querySelectorAll("[data-plus]").forEach(b => b.onclick = () => changeQty(b.dataset.plus,1));
  container.querySelectorAll("[data-qty-input]").forEach(i => { i.onchange = () => setQty(i.dataset.qtyInput,i.value); i.onkeydown = e => { if(e.key === "Enter") i.blur(); }; });
  container.querySelectorAll("[data-remove]").forEach(b => b.onclick = () => removeEntry(b.dataset.remove));
  container.querySelectorAll("[data-check-option]").forEach(b => b.onchange = () => setOption(b.dataset.checkOption,b.dataset.optionId,b.checked));
  container.querySelectorAll("[data-select-option]").forEach(s => s.onchange = () => setSelectOption(s.dataset.selectOption,s.dataset.optionKind,s.value));
  container.querySelectorAll("[data-magic-banner]").forEach(s => s.onchange = () => setMagicBanner(s.dataset.magicBanner,s.value));
}

function renderCompositionChart(){
  const chart=$('compositionChart'), legend=$('compositionLegend'), toggle=$('chartToggle');
  if(!chart||!legend) return;
  const cats=['Personnages','Unités de Base','Unités Spéciales','Unités Rares'];
  const values=cats.map(cat=>getCategoryTotal(cat));
  const total=values.reduce((a,b)=>a+b,0);
  const colors=['#8c7760','#6f806e','#657782','#765e5e'];
  let cursor=0;
  const stops=values.map((v,i)=>{const a=total?cursor/total*360:0; cursor+=v; const b=total?cursor/total*360:0; return `${colors[i]} ${a}deg ${b}deg`;}).join(',');
  chart.style.background=total?`conic-gradient(${stops})`:'conic-gradient(#4b5050 0 360deg)';
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
    version: 5,
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
        magicBannerId: item.magicBannerId || null
      })).filter(x => getUnit(x.id))
    : [];
  render();
  setStatus(`« ${p.name} » chargée.`, "ok");
}

function exportJSON() {
  const payload = {
    version: 4,
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
  state.list.forEach(item => { const u=getUnit(item.id); if(u) (groups[u.category] ||= []).push({u,item}); });
  Object.entries(groups).forEach(([cat,arr]) => {
    lines.push(cat.toUpperCase());
    lines.push("-".repeat(cat.length));
    arr.forEach(({u,item},i) => {
      const opts = selectedOptions(item).map(id=>u.options.find(o=>o.id===id)?.name).filter(Boolean);
      if(item.magicBannerId) opts.push(magicName(item));
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
  const rows = state.list.map((item,index) => {
    const u=getUnit(item.id); if(!u) return "";
    const opts=selectedOptions(item).map(id=>u.options.find(o=>o.id===id)?.name).filter(Boolean); if(item.magicBannerId) opts.push(magicName(item)); const optText=opts.join(", ");
    return `<tr><td>${index+1}</td><td>${esc(u.category)}</td><td>${esc(u.name)}</td><td>${item.qty}</td><td>${esc(optText)}</td><td>${entryPoints(item)}</td></tr>`;
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
    const raw = await getJSON(PATHS.catalog);
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
