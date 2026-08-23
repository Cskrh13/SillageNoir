// generator.js — Générateur de listes d'armée
// Version corrigée — gestion de la Grande Bannière selon les données de l'armée

const MAGIC_ITEM_CATEGORY_KEYS = {
  "Armes magiques": "magic_weapon",
  "Armures magiques": "magic_armour",
  "Talismans": "talisman",
  "Bannières magiques": "magic_standard",
  "Objets enchantés": "enchanted_item",
  "Objets cabalistiques": "arcane_item"
};

const CATEGORY_DEFAULT_REQUIRES = {
  arcane_item: ["wizard"],
  magic_standard: ["grand_banner_bearer"]
};

const GRAND_BANNER_RE = /grande?\s+banni[eè]re/i;

/*
 * Infrastructure de chargement des données.
 * Les fichiers du dépôt sont des JSON indépendants.
 */
const PATHS = {
  catalog: "data/supplements.json",
  supplements: "data/supplements/",
  armies: "data/armees/",
  magicItems: "data/objets-magiques/",
  honours: "data/aptitudes/honneurs-elfiques.json"
};

async function getJSON(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Impossible de charger ${path} (${response.status})`);
  }
  return response.json();
}

function normalizeSupplement(raw, catalog) {
  return {
    ...(catalog || {}),
    ...(raw || {}),
    // L'identifiant du catalogue reste l'identifiant de sélection/sauvegarde.
    id: catalog?.id || raw?.id,
    dataId: raw?.id || catalog?.id,
    armies: Array.isArray(raw?.armies)
      ? raw.armies
      : (Array.isArray(catalog?.armies) ? catalog.armies : []),
    allowedUnits: Array.isArray(raw?.allowedUnits)
      ? raw.allowedUnits
      : (Array.isArray(catalog?.allowedUnits) ? catalog.allowedUnits : []),
    excludedUnits: Array.isArray(raw?.excludedUnits)
      ? raw.excludedUnits
      : (Array.isArray(catalog?.excludedUnits) ? catalog.excludedUnits : []),
    restrictions: {
      ...(catalog?.restrictions || {}),
      ...(raw?.restrictions || {}),
      global: {
        ...(catalog?.restrictions?.global || {}),
        ...(raw?.restrictions?.global || {})
      },
      units: {
        ...(catalog?.restrictions?.units || {}),
        ...(raw?.restrictions?.units || {})
      },
      categories: {
        ...(catalog?.restrictions?.categories || {}),
        ...(raw?.restrictions?.categories || {})
      }
    }
  };
}

function normalizeArmy(raw, id) {
  return {
    ...(raw || {}),
    id: raw?.id || id,
    units: Array.isArray(raw?.units) ? raw.units : [],
    restrictions: raw?.restrictions || {}
  };
}

async function loadHonours() {
  try {
    const raw = await getJSON(PATHS.honours);
    state.honours = Array.isArray(raw)
      ? raw
      : (Array.isArray(raw?.aptitudes) ? raw.aptitudes : []);
  } catch (e) {
    // Les honneurs sont facultatifs pour les armées qui n'en utilisent pas.
    state.honours = [];
    console.warn("Honneurs elfiques non chargés :", e);
  }
}

/*
 * Compatibilité entre les identifiants historiques utilisés dans les
 * suppléments et les vrais noms de fichiers présents dans data/objets-magiques.
 */
const MAGIC_ITEM_SOURCE_ALIASES = {
  "objets-magiques-courants": "communs",
  "objets magiques courants": "communs",
  "objets-magiques-communs": "communs",
  "royaumes-hauts-elfes": "hauts-elfes",
  "hauts-elfes": "hauts-elfes",
  "elfes-noirs": "elfes-noirs",
  "elfes-sylvains": "elfes-sylvains",
  "sillage-noir": "sillage-noir",
  "tour-dargent": "tour-d-argent",
  "tour-d-argent": "tour-d-argent",
  "courant-occidental": "courant-occidental"
};

function magicItemSourceId(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const key = raw
    .toLocaleLowerCase("fr")
    .replace(/\.json$/i, "")
    .replace(/\\/g, "/")
    .split("/")
    .pop();

  return (
    MAGIC_ITEM_SOURCE_ALIASES[key] ||
    key
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-|-$/g, "")
  );
}

async function loadMagicItemSource(source) {
  const id = magicItemSourceId(source);
  if (!id) return null;

  const raw = await getJSON(PATHS.magicItems + id + ".json");
  return {
    id: raw?.id || id,
    name: raw?.name || id,
    magicItems: raw?.magicItems && typeof raw.magicItems === "object"
      ? raw.magicItems
      : {}
  };
}

async function loadMagicItems(sources = []) {
  state.magicItems = {};

  if (!Array.isArray(sources)) {
    sources = [sources];
  }

  for (const source of sources) {
    if (!source) continue;

    const fileMap = {
      "objets-magiques-courants": "communs.json",
      "elfes-noirs": "elfes-noirs.json",
      "hauts-elfes": "hauts-elfes.json",
      "elfes-sylvains": "elfes-sylvains.json",
      "courant-occidental": "courant-occidental.json",
      "tour-dargent": "tour-d-argent.json",
      "sillage-noir": "sillage-noir.json"
    };

    const filename = fileMap[source] || `${source}.json`;

    try {
      const raw = await getJSON(
        "data/objets-magiques/" + filename
      );

      const collection = raw.magicItems || raw;

      for (const [category, items] of Object.entries(collection)) {
        if (!Array.isArray(items)) continue;

        if (!state.magicItems[category]) {
          state.magicItems[category] = [];
        }

        state.magicItems[category].push(
          ...items.map(item =>
            normalizeMagicItem(item, category)
          )
        );
      }

      console.log(
        `[MagicItems] Source chargée : ${source} → ${filename}`
      );

    } catch (e) {
      console.error(
        `[MagicItems] Impossible de charger ${source}`,
        e
      );
    }
  }
}


function isGrandBannerOption(o) {
  return !!(o && GRAND_BANNER_RE.test(String(o.name || "")));
}

function isGrandBannerBearer(entry, u) {
  if (!entry || !u) return false;

  return effectiveOptions(entry, u).some(
    o =>
      isGrandBannerOption(o) &&
      (entry.options || []).includes(o.id)
  );
}

function grandBannerBearerUid() {
  const found = state.list.find(item => {
    const u = getUnit(item.id);
    return u && isGrandBannerBearer(item, u);
  });

  return found ? found.uid : null;
}

/*
 * Détermine les personnages autorisés à porter la Grande Bannière
 * à partir des données de l'armée.
 *
 * Formats supportés :
 *
 * "battleStandardBearer": {
 *   "unit": "Noble",
 *   "points": 25
 * }
 *
 * ou :
 *
 * "battleStandardBearer": {
 *   "eligibleCategory": "dark-elf-master",
 *   "points": 25
 * }
 *
 * ou plusieurs unités :
 *
 * "battleStandardBearer": {
 *   "units": ["Noble", "Maître Elfe Noir"],
 *   "points": 25
 * }
 */
function battleStandardBearerConfig() {
  return (
    state.supplement?.restrictions?.global?.battleStandardBearer ||
    state.supplement?.battleStandardBearer ||
    state.army?.restrictions?.global?.battleStandardBearer ||
    state.army?.battleStandardBearer ||
    null
  );
}

function isBattleStandardBearerEligible(u) {
  const config = battleStandardBearerConfig();

  if (!u || !config) return false;

  const normalize = value =>
    String(value ?? "")
      .trim()
      .toLocaleLowerCase("fr");

  const unitId = normalize(u.id);
  const unitName = normalize(u.name);

  const candidates = [];

  if (config.unit) {
    candidates.push(config.unit);
  }

  if (Array.isArray(config.units)) {
    candidates.push(...config.units);
  }

  if (
    candidates.some(value => {
      const candidate = normalize(value);

      return (
        candidate === unitId ||
        candidate === unitName
      );
    })
  ) {
    return true;
  }

  /*
   * Compatibilité avec le format :
   *
   * "eligibleCategory": "dark-elf-master"
   */
  if (config.eligibleCategory) {
    const categories = Array.isArray(config.eligibleCategory)
      ? config.eligibleCategory
      : [config.eligibleCategory];

    if (
      categories.some(category => {
        const value = normalize(category);

        return (
          value === unitId ||
          value === unitName ||
          value === normalize(u.category)
        );
      })
    ) {
      return true;
    }
  }

  return false;
}

function isNobleUnit(u) {
  return isBattleStandardBearerEligible(u);
}

function isWizardUnit(u, entry) {
  if (!u) return false;

  const rules = [
    ...(Array.isArray(u.specialRules) ? u.specialRules : []),
    ...(Array.isArray(u.rules) ? u.rules : [])
  ]
    .map(r => String(r).toLocaleLowerCase("fr"));

  if (
    rules.some(r =>
      r.includes("sorcier") ||
      r.includes("wizard")
    )
  ) {
    return true;
  }

  if (entry?.wizardLevel != null) return true;

  if (u.wizardLevel != null) return true;

  return false;
}

function unitTroopType(u) {
  return String(
    u?.type ||
    u?.unitType ||
    u?.category ||
    ""
  ).toLocaleLowerCase("fr");
}

function renownMatches(requirement, entry, u) {
  if (!requirement) return true;

  if (typeof requirement === "string") {
    return (
      String(entry?.renown || "")
        .toLocaleLowerCase("fr") ===
      requirement.toLocaleLowerCase("fr")
    );
  }

  if (typeof requirement !== "object") return false;

  const value = String(
    entry?.renown ||
    u?.renown ||
    ""
  ).toLocaleLowerCase("fr");

  if (requirement.equals != null) {
    return (
      value ===
      String(requirement.equals).toLocaleLowerCase("fr")
    );
  }

  if (Array.isArray(requirement.anyOf)) {
    return requirement.anyOf.some(v =>
      value === String(v).toLocaleLowerCase("fr")
    );
  }

  return false;
}

function optionRequirementSatisfied(item, entry, u) {
  const explicit = item?.restriction?.requires;

  const requires = Array.isArray(explicit)
    ? explicit
    : (
        explicit != null
          ? [explicit]
          : (
              CATEGORY_DEFAULT_REQUIRES[item?.categoryKey] ||
              []
            )
      );

  if (item?.restriction?.override === "no-wizard-required") {
    return true;
  }

  return requires.every(req => {
    if (req === "wizard") {
      return isWizardUnit(u, entry);
    }

    if (req === "grand_banner_bearer") {
      return isGrandBannerBearer(entry, u);
    }

    if (
      req &&
      typeof req === "object" &&
      req.troopType
    ) {
      const allowed = (
        Array.isArray(req.troopType)
          ? req.troopType
          : [req.troopType]
      ).map(t =>
        String(t).toLocaleLowerCase("fr")
      );

      return allowed.some(t =>
        unitTroopType(u).includes(t)
      );
    }

    if (
      req &&
      typeof req === "object" &&
      req.renown
    ) {
      return renownMatches(req.renown, entry, u);
    }

    return true;
  });
}

function getUnit(id) {
  if (!id) return null;

  const allUnits = [];

  if (Array.isArray(state.units)) {
    allUnits.push(...state.units);
  }

  if (Array.isArray(state.supplement?.units)) {
    allUnits.push(...state.supplement.units);
  }

  if (Array.isArray(state.army?.units)) {
    allUnits.push(...state.army.units);
  }

  return (
    allUnits.find(u => u?.id === id) ||
    null
  );
}

function effectiveOptions(entry, u) {
  if (!u) return [];

  const options = [];

  if (Array.isArray(u.options)) {
    options.push(...u.options);
  }

  if (Array.isArray(entry?.optionsData)) {
    options.push(...entry.optionsData);
  }

  return options.map((option, index) => {
    if (typeof option === "string") {
      return {
        id: `${u.id}-option-${index}`,
        name: option,
        raw: option
      };
    }

    return {
      ...option,
      id:
        option.id ||
        `${u.id}-option-${index}`
    };
  });
}

function normalizeOptionName(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("fr");
}

function optionMatches(option, value) {
  const wanted = normalizeOptionName(value);

  if (!wanted) return false;

  return (
    normalizeOptionName(option?.name) === wanted ||
    normalizeOptionName(option?.id) === wanted
  );
}

function parsePointsFromOption(option) {
  if (!option) return 0;

  if (typeof option.points === "number") {
    return option.points;
  }

  if (
    typeof option.pointsPerModel === "number"
  ) {
    return option.pointsPerModel;
  }

  const text =
    typeof option === "string"
      ? option
      : option.name || "";

  const match = String(text).match(
    /([+-]?\d+)\s*pts?/i
  );

  return match
    ? Number(match[1])
    : 0;
}

function getOptionPoints(option) {
  return parsePointsFromOption(option);
}

function optionIdFor(option, unitId, index) {
  if (typeof option === "string") {
    return `${unitId}-option-${index}`;
  }

  return (
    option?.id ||
    `${unitId}-option-${index}`
  );
}

function normalizeOption(option, unitId, index) {
  if (typeof option === "string") {
    return {
      id: optionIdFor(option, unitId, index),
      name: option,
      points: parsePointsFromOption(option)
    };
  }

  return {
    ...option,
    id: optionIdFor(option, unitId, index)
  };
}

function getCharacterOptions(u) {
  if (!u) return [];

  return (u.options || []).map(
    (option, index) =>
      normalizeOption(option, u.id, index)
  );
}

function getMountOptions(u) {
  if (!u) return [];

  return getCharacterOptions(u).filter(option =>
    option.mountRef
  );
}

function isMountOption(option) {
  return !!option?.mountRef;
}

function getMountRef(option) {
  return option?.mountRef || null;
}

function getMountByRef(ref) {
  if (!ref) return null;

  const sources = [
    state.mounts,
    state.supplement?.mounts,
    state.army?.mounts
  ];

  for (const source of sources) {
    if (!Array.isArray(source)) continue;

    const found = source.find(
      mount => mount?.id === ref
    );

    if (found) return found;
  }

  return null;
}

function cloneProfile(profile) {
  if (!profile || typeof profile !== "object") {
    return null;
  }

  return {
    ...profile
  };
}

function getMountProfile(entry, u) {
  if (!entry || !u) return null;

  const selectedMount = getCharacterOptions(u)
    .find(option =>
      option.id === entry.options?.find(
        id => id === option.id
      ) &&
      isMountOption(option)
    );

  if (!selectedMount) return null;

  const mountRef = getMountRef(selectedMount);

  if (!mountRef) return null;

  const mount = getMountByRef(mountRef);

  if (!mount) return null;

  return cloneProfile(mount.profile);
}

function selectedMountOption(entry, u) {
  if (!entry || !u) return null;

  const options = getCharacterOptions(u);

  return options.find(option =>
    isMountOption(option) &&
    (entry.options || []).includes(option.id)
  ) || null;
}

function hasSelectedMount(entry, u) {
  return !!selectedMountOption(entry, u);
}

function getSelectedOptionObjects(entry, u) {
  if (!entry || !u) return [];

  const options = getCharacterOptions(u);
  const selected = entry.options || [];

  return options.filter(option =>
    selected.includes(option.id)
  );
}

function calculateSelectedOptionsPoints(entry, u) {
  return getSelectedOptionObjects(entry, u)
    .reduce(
      (total, option) =>
        total + getOptionPoints(option),
      0
    );
}

function calculateEntryPoints(entry) {
  const u = getUnit(entry?.id);

  if (!u) return 0;

  let total =
    Number(u.points || 0) *
    Number(entry.count || 1);

  if (
    u.category === "Personnages" ||
    String(u.type || "")
      .toLocaleLowerCase("fr")
      .includes("personnage")
  ) {
    total =
      Number(u.points || 0);
  }

  total +=
    calculateSelectedOptionsPoints(entry, u);

  if (entry.magicItems) {
    total += calculateMagicItemsPoints(
      entry.magicItems
    );
  }

  return total;
}

function calculateMagicItemsPoints(items) {
  if (!Array.isArray(items)) return 0;

  return items.reduce(
    (total, item) =>
      total + Number(item?.points || 0),
    0
  );
}

function effectiveBudget(u, type = "magicItemsLimit") {
  if (!u) return null;

  const options = getCharacterOptions(u);

  for (const option of options) {
    const text =
      String(option.name || "");

    const match = text.match(
      /objets?\s+magiques?\s+jusqu['’]?\s*[àa]?\s*(\d+)\s*pts?/i
    );

    if (match) {
      return Number(match[1]);
    }
  }

  if (u[type] != null) {
    return Number(u[type]);
  }

  return null;
}

function getMagicItemCategoryKey(category) {
  if (!category) return null;

  return (
    MAGIC_ITEM_CATEGORY_KEYS[category] ||
    category
  );
}

function normalizeMagicItem(item, category) {
  if (!item) return null;

  return {
    ...item,
    category,
    categoryKey:
      item.categoryKey ||
      getMagicItemCategoryKey(category)
  };
}

function getMagicItemsSources() {
  const global =
    state.supplement?.restrictions?.global
      ?.magicItems;

  if (!global) return [];

  if (Array.isArray(global.source)) {
    return global.source;
  }

  if (global.source) {
    return [global.source];
  }

  return [];
}

function getMagicItemsData() {
  const result = [];

  const collections = [
    state.magicItems,
    state.supplement?.magicItems,
    state.army?.magicItems
  ];

  for (const collection of collections) {
    if (!collection) continue;

    for (const [category, values] of Object.entries(
      collection
    )) {
      if (!Array.isArray(values)) continue;

      for (const item of values) {
        result.push(
          normalizeMagicItem(
            item,
            category
          )
        );
      }
    }
  }

  return result;
}

function magicItemAllowedForCharacter(
  item,
  entry,
  u
) {
  if (!item || !u) return false;

  return optionRequirementSatisfied(
    item,
    entry,
    u
  );
}

function getAvailableMagicItems(
  entry,
  u
) {
  return getMagicItemsData().filter(item =>
    magicItemAllowedForCharacter(
      item,
      entry,
      u
    )
  );
}

function selectedMagicItemCategories(entry) {
  const result = new Set();

  for (const item of entry?.magicItems || []) {
    if (item?.categoryKey) {
      result.add(item.categoryKey);
    }
  }

  return result;
}

function canTakeMagicItem(
  item,
  entry,
  u
) {
  if (!item || !entry || !u) return false;

  if (
    !magicItemAllowedForCharacter(
      item,
      entry,
      u
    )
  ) {
    return false;
  }

  const selected =
    selectedMagicItemCategories(entry);

  const categoryKey =
    item.categoryKey ||
    getMagicItemCategoryKey(
      item.category
    );

  if (
    categoryKey &&
    selected.has(categoryKey)
  ) {
    return false;
  }

  return true;
}

function canTakeMagicStandard(
  entry,
  u
) {
  if (!entry || !u) return false;

  return isBattleStandardBearerEligible(u);
}

function getBattleStandardPoints() {
  const config =
    battleStandardBearerConfig();

  if (!config) return 25;

  return Number(
    config.points ?? 25
  );
}

function battleStandardEnabled() {
  const config =
    battleStandardBearerConfig();

  if (!config) return false;

  if (config.enabled === false) {
    return false;
  }

  return true;
}

function battleStandardMax() {
  const config =
    battleStandardBearerConfig();

  if (!config) return 0;

  return Number(
    config.max ?? 1
  );
}

function canSelectGrandBanner(
  entry,
  u
) {
  if (!battleStandardEnabled()) {
    return false;
  }

  if (!isBattleStandardBearerEligible(u)) {
    return false;
  }

  const bearer =
    grandBannerBearerUid();

  if (
    bearer &&
    bearer !== entry.uid
  ) {
    return false;
  }

  return true;
}

function getCurrentArmyTotal() {
  return state.list.reduce(
    (total, entry) =>
      total + calculateEntryPoints(entry),
    0
  );
}

function getArmyLimit() {
  return Number(
    state.armySize ||
    state.pointsLimit ||
    0
  );
}

function getCategoryTotal(category) {
  return state.list.reduce(
    (total, entry) => {
      const u = getUnit(entry.id);

      if (!u || u.category !== category) {
        return total;
      }

      return (
        total +
        calculateEntryPoints(entry)
      );
    },
    0
  );
}

function getCategoryPercent(category) {
  const total =
    getCurrentArmyTotal();

  if (!total) return 0;

  return (
    getCategoryTotal(category) /
    total *
    100
  );
}

function getRestrictionForUnit(id) {
  return (
    state.supplement
      ?.restrictions
      ?.units
      ?.[id] ||
    state.army
      ?.restrictions
      ?.units
      ?.[id] ||
    null
  );
}

function getCategoryRestriction(
  category
) {
  return (
    state.supplement
      ?.restrictions
      ?.categories
      ?.[category] ||
    state.army
      ?.restrictions
      ?.categories
      ?.[category] ||
    null
  );
}

function getUnitCount(id) {
  return state.list
    .filter(entry => entry.id === id)
    .reduce(
      (total, entry) =>
        total +
        Number(entry.count || 1),
      0
    );
}

function getUnitEntryCount(id) {
  return state.list.filter(
    entry => entry.id === id
  ).length;
}

function maxPer1000Value(
  restriction
) {
  if (!restriction?.maxPer1000) {
    return Infinity;
  }

  return (
    Math.floor(
      getArmyLimit() / 1000
    ) *
    Number(
      restriction.maxPer1000
    )
  );
}

function unitRestrictionAllowsAdding(
  id
) {
  const restriction =
    getRestrictionForUnit(id);

  if (!restriction) return true;

  if (restriction.max != null) {
    if (
      getUnitEntryCount(id) >=
      Number(restriction.max)
    ) {
      return false;
    }
  }

  if (restriction.maxPer1000 != null) {
    if (
      getUnitEntryCount(id) >=
      maxPer1000Value(restriction)
    ) {
      return false;
    }
  }

  return true;
}

function groupRestrictionAllowsAdding(
  id
) {
  const restriction =
    getRestrictionForUnit(id);

  if (!restriction?.group) {
    return true;
  }

  const group = restriction.group;

  const members =
    Object.entries(
      state.supplement?.restrictions
        ?.units || {}
    )
      .filter(
        ([, value]) =>
          value?.group === group
      )
      .map(([unitId]) => unitId);

  const total =
    members.reduce(
      (sum, unitId) =>
        sum +
        getUnitEntryCount(unitId),
      0
    );

  if (
    restriction.maxPer1000 != null &&
    total >=
      maxPer1000Value(restriction)
  ) {
    return false;
  }

  return true;
}

function canAddUnit(id) {
  const u = getUnit(id);

  if (!u) return false;

  if (
    !unitRestrictionAllowsAdding(id)
  ) {
    return false;
  }

  if (
    !groupRestrictionAllowsAdding(id)
  ) {
    return false;
  }

  return true;
}

function createListEntry(id) {
  const u = getUnit(id);

  if (!u) return null;

  return {
    uid:
      `${id}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`,
    id,
    count:
      u.unitSize &&
      String(u.unitSize).includes("-")
        ? Number(
            String(u.unitSize)
              .split("-")[0]
          )
        : 1,
    options: [],
    magicItems: []
  };
}

function addUnitToList(id) {
  if (!canAddUnit(id)) {
    return false;
  }

  const entry =
    createListEntry(id);

  if (!entry) return false;

  state.list.push(entry);

  render();

  return true;
}

function removeUnitFromList(uid) {
  state.list =
    state.list.filter(
      entry =>
        entry.uid !== uid
    );

  render();
}

function findEntry(uid) {
  return state.list.find(
    entry =>
      entry.uid === uid
  );
}

function setUnitCount(
  uid,
  count
) {
  const entry =
    findEntry(uid);

  if (!entry) return;

  const u =
    getUnit(entry.id);

  if (!u) return;

  let value =
    Number(count);

  if (!Number.isFinite(value)) {
    value = 1;
  }

  const size =
    String(
      u.unitSize || ""
    );

  if (size.includes("-")) {
    const [min, max] =
      size
        .split("-")
        .map(Number);

    value =
      Math.max(
        min,
        Math.min(max, value)
      );
  } else if (
    Number.isFinite(
      Number(u.unitSize)
    )
  ) {
    value =
      Number(u.unitSize);
  }

  entry.count = value;

  render();
}

function incrementUnit(
  uid,
  amount = 1
) {
  const entry =
    findEntry(uid);

  if (!entry) return;

  setUnitCount(
    uid,
    Number(entry.count || 1) +
      amount
  );
}

function toggleOption(
  uid,
  optionId
) {
  const entry =
    findEntry(uid);

  if (!entry) return;

  const u =
    getUnit(entry.id);

  if (!u) return;

  const options =
    getCharacterOptions(u);

  const option =
    options.find(
      o => o.id === optionId
    );

  if (!option) return;

  if (
    isMountOption(option)
  ) {
    entry.options =
      entry.options.filter(
        id => {
          const other =
            options.find(
              o => o.id === id
            );

          return (
            !isMountOption(other) ||
            id === optionId
          );
        }
      );
  }

  if (
    entry.options.includes(
      optionId
    )
  ) {
    entry.options =
      entry.options.filter(
        id =>
          id !== optionId
      );
  } else {
    entry.options.push(
      optionId
    );
  }

  render();
}

function toggleMagicItem(
  uid,
  itemId
) {
  const entry =
    findEntry(uid);

  if (!entry) return;

  const u =
    getUnit(entry.id);

  if (!u) return;

  const item =
    getMagicItemsData()
      .find(
        value =>
          value.id === itemId
      );

  if (!item) return;

  if (
    !canTakeMagicItem(
      item,
      entry,
      u
    )
  ) {
    return;
  }

  if (!entry.magicItems) {
    entry.magicItems = [];
  }

  const existing =
    entry.magicItems.find(
      value =>
        value.id === itemId
    );

  if (existing) {
    entry.magicItems =
      entry.magicItems.filter(
        value =>
          value.id !== itemId
      );
  } else {
    entry.magicItems.push({
      ...item,
      points:
        Number(
          item.points || 0
        )
    });
  }

  render();
}

function toggleGrandBanner(
  uid
) {
  const entry =
    findEntry(uid);

  if (!entry) return;

  const u =
    getUnit(entry.id);

  if (!u) return;

  if (
    !canSelectGrandBanner(
      entry,
      u
    )
  ) {
    return;
  }

  const options =
    getCharacterOptions(u);

  const bannerOption =
    options.find(
      isGrandBannerOption
    );

  if (!bannerOption) return;

  toggleOption(
    uid,
    bannerOption.id
  );
}

function getGrandBannerOption(
  u
) {
  if (!u) return null;

  return getCharacterOptions(u)
    .find(
      isGrandBannerOption
    ) || null;
}

function renderGrandBannerItemSelector(
  entry,
  u
) {
  if (!entry || !u) return "";

  if (
    !isGrandBannerBearer(
      entry,
      u
    )
  ) {
    return "";
  }

  if (
    !battleStandardEnabled()
  ) {
    return "";
  }

  const items =
    getMagicItemsData()
      .filter(
        item =>
          item.categoryKey ===
          "magic_standard"
      );

  if (!items.length) {
    return "";
  }

  const selected =
    entry.magicItems || [];

  return `
    <div class="grand-banner-items">
      <div class="option-title">
        Bannière magique
      </div>

      <select
        class="grand-banner-select"
        data-entry-uid="${entry.uid}"
      >
        <option value="">
          Aucune bannière
        </option>

        ${items.map(item => `
          <option
            value="${item.id}"
            ${selected.some(
              selectedItem =>
                selectedItem.id === item.id
            ) ? "selected" : ""}
          >
            ${item.name}
            (+${Number(
              item.points || 0
            )} pts)
          </option>
        `).join("")}
      </select>
    </div>
  `;
}

function selectGrandBannerItem(
  uid,
  itemId
) {
  const entry =
    findEntry(uid);

  if (!entry) return;

  const u =
    getUnit(entry.id);

  if (!u) return;

  if (
    !isGrandBannerBearer(
      entry,
      u
    )
  ) {
    return;
  }

  const items =
    getMagicItemsData()
      .filter(
        item =>
          item.categoryKey ===
          "magic_standard"
      );

  if (!entry.magicItems) {
    entry.magicItems = [];
  }

  entry.magicItems =
    entry.magicItems.filter(
      item =>
        item.categoryKey !==
        "magic_standard"
    );

  if (itemId) {
    const item =
      items.find(
        value =>
          value.id === itemId
      );

    if (item) {
      entry.magicItems.push({
        ...item,
        points:
          Number(
            item.points || 0
          )
      });
    }
  }

  render();
}

function getEffectiveMagicItems(
  entry,
  u
) {
  return getAvailableMagicItems(
    entry,
    u
  );
}

function renderMagicItemsSelector(
  entry,
  u
) {
  if (!entry || !u) return "";

  const limit =
    effectiveBudget(
      u,
      "magicItemsLimit"
    );

  if (limit == null) {
    return "";
  }

  const items =
    getEffectiveMagicItems(
      entry,
      u
    );

  if (!items.length) {
    return "";
  }

  const selected =
    entry.magicItems || [];

  const normalItems =
    items.filter(
      item =>
        item.categoryKey !==
        "magic_standard"
    );

  return `
    <div class="magic-items-selector">
      <div class="option-title">
        Objets magiques
        <span>
          (${limit} pts)
        </span>
      </div>

      ${normalItems.map(item => {
        const checked =
          selected.some(
            selectedItem =>
              selectedItem.id ===
              item.id
          );

        return `
          <label class="magic-item-option">
            <input
              type="checkbox"
              data-magic-item-id="${item.id}"
              ${checked ? "checked" : ""}
            >
            <span>
              ${item.name}
            </span>
            <span>
              ${Number(
                item.points || 0
              )} pts
            </span>
          </label>
        `;
      }).join("")}
    </div>
  `;
}

function renderCharacterOptions(
  entry,
  u
) {
  if (!entry || !u) return "";

  const options =
    getCharacterOptions(u);

  if (!options.length) {
    return "";
  }

  const result = {
    mount: [],
    banner: [],
    normal: []
  };

  for (const option of options) {
    if (
      isGrandBannerOption(
        option
      )
    ) {
      result.banner.push(
        option
      );
    } else if (
      isMountOption(option)
    ) {
      result.mount.push(
        option
      );
    } else {
      result.normal.push(
        option
      );
    }
  }

  /*
   * Grande Bannière :
   * elle dépend maintenant exclusivement
   * de la configuration de l'armée.
   */
  const bearer =
    grandBannerBearerUid();

  result.banner =
    result.banner.filter(
      option => {
        if (
          !isGrandBannerOption(
            option
          )
        ) {
          return true;
        }

        if (
          !isBattleStandardBearerEligible(
            u
          )
        ) {
          return false;
        }

        return (
          !bearer ||
          bearer === entry.uid
        );
      }
    );

  let html = "";

  if (result.mount.length) {
    html += `
      <div class="character-options-group">
        <div class="option-title">
          Monture
        </div>

        ${result.mount.map(
          option => `
            <label class="character-option">
              <input
                type="checkbox"
                data-option-id="${option.id}"
                ${entry.options.includes(
                  option.id
                ) ? "checked" : ""}
              >
              <span>
                ${option.name}
              </span>
              <span>
                +${getOptionPoints(
                  option
                )} pts
              </span>
            </label>
          `
        ).join("")}
      </div>
    `;
  }

  if (result.normal.length) {
    html += `
      <div class="character-options-group">
        <div class="option-title">
          Options
        </div>

        ${result.normal.map(
          option => `
            <label class="character-option">
              <input
                type="checkbox"
                data-option-id="${option.id}"
                ${entry.options.includes(
                  option.id
                ) ? "checked" : ""}
              >
              <span>
                ${option.name}
              </span>
              <span>
                +${getOptionPoints(
                  option
                )} pts
              </span>
            </label>
          `
        ).join("")}
      </div>
    `;
  }

  if (result.banner.length) {
    html += `
      <div class="character-options-group">
        <div class="option-title">
          Grande Bannière
        </div>

        ${result.banner.map(
          option => `
            <label class="character-option">
              <input
                type="checkbox"
                data-option-id="${option.id}"
                ${entry.options.includes(
                  option.id
                ) ? "checked" : ""}
              >
              <span>
                ${option.name}
              </span>
              <span>
                +${getOptionPoints(
                  option
                )} pts
              </span>
            </label>
          `
        ).join("")}
      </div>
    `;
  }

  return html;
}

function renderUnitEntry(
  entry
) {
  const u =
    getUnit(entry.id);

  if (!u) return "";

  const total =
    calculateEntryPoints(entry);

  return `
    <div
      class="army-entry"
      data-entry-uid="${entry.uid}"
    >
      <div class="army-entry-header">
        <strong>
          ${u.name}
        </strong>

        <span>
          ${total} pts
        </span>

        <button
          type="button"
          data-remove-entry="${entry.uid}"
        >
          ×
        </button>
      </div>

      <div class="army-entry-body">
        ${
          u.category !==
          "Personnages"
            ? `
              <div class="unit-count">
                <button
                  type="button"
                  data-count-minus="${entry.uid}"
                >
                  −
                </button>

                <input
                  type="number"
                  min="1"
                  value="${entry.count || 1}"
                  data-count-input="${entry.uid}"
                >

                <button
                  type="button"
                  data-count-plus="${entry.uid}"
                >
                  +
                </button>
              </div>
            `
            : ""
        }

        ${renderCharacterOptions(
          entry,
          u
        )}

        ${renderMagicItemsSelector(
          entry,
          u
        )}

        ${renderGrandBannerItemSelector(
          entry,
          u
        )}
      </div>
    </div>
  `;
}

function getAvailableUnits() {
  const units = [];

  const sources = [
    state.supplement?.units,
    state.army?.units,
    state.units
  ];

  for (const source of sources) {
    if (!Array.isArray(source)) {
      continue;
    }

    for (const unit of source) {
      if (
        !units.some(
          existing =>
            existing.id ===
            unit.id
        )
      ) {
        units.push(unit);
      }
    }
  }

  return units;
}

function unitIsAllowedBySupplement(
  u
) {
  if (!u) return false;

  const allowed =
    state.supplement
      ?.allowedUnits;

  const excluded =
    state.supplement
      ?.excludedUnits;

  if (
    Array.isArray(excluded) &&
    excluded.includes(u.id)
  ) {
    return false;
  }

  if (
    Array.isArray(allowed) &&
    allowed.length
  ) {
    return allowed.includes(
      u.id
    );
  }

  return true;
}

function unitIsAllowedByArmy(
  u
) {
  if (!u) return false;

  const allowed =
    state.army?.allowedUnits;

  const excluded =
    state.army?.excludedUnits;

  if (
    Array.isArray(excluded) &&
    excluded.includes(u.id)
  ) {
    return false;
  }

  if (
    Array.isArray(allowed) &&
    allowed.length
  ) {
    return allowed.includes(
      u.id
    );
  }

  return true;
}

function unitIsSelectable(
  u
) {
  if (!u) return false;

  if (
    !unitIsAllowedBySupplement(
      u
    )
  ) {
    return false;
  }

  if (
    !unitIsAllowedByArmy(
      u
    )
  ) {
    return false;
  }

  return canAddUnit(u.id);
}

function renderUnitSelection() {
  const container =
    document.querySelector(
      "#unit-selection"
    );

  if (!container) return;

  const units =
    getAvailableUnits();

  container.innerHTML =
    units.map(u => {
      const selectable =
        unitIsSelectable(u);

      return `
        <button
          type="button"
          class="unit-select-button ${
            selectable
              ? ""
              : "disabled"
          }"
          data-add-unit="${u.id}"
          ${selectable
            ? ""
            : "disabled"}
        >
          <span>
            ${u.name}
          </span>

          <span>
            ${u.points ?? 0} pts
          </span>
        </button>
      `;
    }).join("");
}

function renderArmyList() {
  const container =
    document.querySelector(
      "#army-list"
    );

  if (!container) return;

  container.innerHTML =
    state.list
      .map(
        renderUnitEntry
      )
      .join("");
}

function renderArmyTotals() {
  const total =
    getCurrentArmyTotal();

  const element =
    document.querySelector(
      "#army-total"
    );

  if (element) {
    element.textContent =
      `${total} pts`;
  }
}

function render() {
  renderUnitSelection();
  renderArmyList();
  renderArmyTotals();

  if (
    typeof updatePieChart ===
    "function"
  ) {
    updatePieChart();
  }

  if (
    typeof updateRestrictions ===
    "function"
  ) {
    updateRestrictions();
  }
}

function attachGeneratorEvents() {
  document.addEventListener(
    "click",
    event => {
      const addButton =
        event.target.closest(
          "[data-add-unit]"
        );

      if (addButton) {
        addUnitToList(
          addButton.dataset
            .addUnit
        );

        return;
      }

      const removeButton =
        event.target.closest(
          "[data-remove-entry]"
        );

      if (removeButton) {
        removeUnitFromList(
          removeButton.dataset
            .removeEntry
        );

        return;
      }

      const plusButton =
        event.target.closest(
          "[data-count-plus]"
        );

      if (plusButton) {
        incrementUnit(
          plusButton.dataset
            .countPlus,
          1
        );

        return;
      }

      const minusButton =
        event.target.closest(
          "[data-count-minus]"
        );

      if (minusButton) {
        incrementUnit(
          minusButton.dataset
            .countMinus,
          -1
        );

        return;
      }
    }
  );

  document.addEventListener(
    "change",
    event => {
      const option =
        event.target.closest(
          "[data-option-id]"
        );

      if (option) {
        const entryElement =
          option.closest(
            "[data-entry-uid]"
          );

        if (entryElement) {
          toggleOption(
            entryElement.dataset
              .entryUid,
            option.dataset
              .optionId
          );
        }

        return;
      }

      const countInput =
        event.target.closest(
          "[data-count-input]"
        );

      if (countInput) {
        setUnitCount(
          countInput.dataset
            .countInput,
          countInput.value
        );

        return;
      }

      const magicItem =
        event.target.closest(
          "[data-magic-item-id]"
        );

      if (magicItem) {
        const entryElement =
          magicItem.closest(
            "[data-entry-uid]"
          );

        if (entryElement) {
          toggleMagicItem(
            entryElement.dataset
              .entryUid,
            magicItem.dataset
              .magicItemId
          );
        }

        return;
      }

      const bannerSelect =
        event.target.closest(
          ".grand-banner-select"
        );

      if (bannerSelect) {
        selectGrandBannerItem(
          bannerSelect.dataset
            .entryUid,
          bannerSelect.value
        );
      }
    }
  );
}


function $(id) {
  return document.getElementById(id);
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function uid() {
  return `entry-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function compositionRules() {
  return (
    state.supplement?.composition?.categories ||
    state.army?.composition?.categories ||
    {}
  );
}

function effectiveCategory(u) {
  return u?.category || u?.type || "";
}

function entryModelMin(u) {
  if (!u) return 1;
  if (u.unitSize != null) {
    const text = String(u.unitSize);
    const match = text.match(/(\d+)/);
    if (match) return Number(match[1]);
  }
  if (u.minSize != null) return Number(u.minSize) || 1;
  return 1;
}

function entryModelMax(u) {
  if (!u) return 1;
  if (u.unitSize != null) {
    const text = String(u.unitSize);
    const match = text.match(/(\d+)\s*-\s*(\d+)/);
    if (match) return Number(match[2]);
  }
  if (u.maxSize != null) return Number(u.maxSize) || 999;
  return 999;
}

function isAllowed(u) {
  return unitIsSelectable(u);
}

function canAdd(u) {
  if (!u) return false;
  return canAddUnit(u.id);
}

function entryPoints(entry) {
  return calculateEntryPoints(entry);
}

function initializeState() {
  if (
    typeof state !==
    "object"
  ) {
    window.state = {};
  }

  if (!Array.isArray(state.list)) state.list = [];
  if (!Array.isArray(state.catalog)) state.catalog = [];
  if (!Array.isArray(state.units)) state.units = [];
  if (!Array.isArray(state.mounts)) state.mounts = [];
  if (!state.magicItems || typeof state.magicItems !== "object") state.magicItems = {};
  if (!Array.isArray(state.honours)) state.honours = [];
  if (!Number.isFinite(Number(state.pointsLimit))) state.pointsLimit = 2000;
  if (typeof state.filter !== "string") state.filter = "";
  if (typeof state.category !== "string") state.category = "";
}

initializeState();

document.addEventListener(
  "DOMContentLoaded",
  () => {
    attachGeneratorEvents();
    render();
  }
);
function addUnit(id) {
  const u = getUnit(id);
  if (!isAllowed(u) || !canAdd(u)) return;
  state.list.push({
    uid: uid(),
    id,
    qty: entryModelMin(u),
    options: [],
    magicItems: []
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

// Monture actuellement sélectionnée pour une entrée (ou null).
function selectedMount(entry, unit) {
  const mountId = selectedOptions(entry).find(id => {
    const o = (unit.options || []).find(x => x.id === id);
    return o?.kind === "mount";
  });
  if (!mountId) return null;
  return (unit.options || []).find(o => o.id === mountId) || null;
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
    const option = (unit?.options || []).find(o => o.id === id);
    // les modificateurs de la monture s'appliquent au profil de la
    // monture elle-même, pas à celui du porteur : on les ignore ici.
    if (option && option.kind !== "mount") addMods(option);
  });
  selectedMagicObjects(entry).forEach(addMods);

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

  const rows = [`<tr><td class="stat-row-name">${esc(unit.name)}</td>${STAT_KEYS.map(k => `<td>${statDisplay(profile[k] ?? "—", data.modifiers[k] || 0)}</td>`).join("")}`];

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

// Équipement natif (fixe, non modifiable) de l'unité.
function renderEquipment(unit) {
  if (!unit.equipment?.length) return "";
  return `<div class="unit-block">
    <div class="profile-title">Équipement</div>
    <ul class="unit-block-list">${unit.equipment.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
  </div>`;
}

// Règles spéciales natives (fixes, toujours actives) de l'unité.
function renderNativeRules(unit) {
  if (!unit.rules?.length) return "";
  return `<div class="unit-block">
    <div class="profile-title">Règles spéciales</div>
    <ul class="unit-block-list">${unit.rules.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
  </div>`;
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

function availableMagicItems(entry) {
  const used = usedMagicItemIds(entry.uid);
  return magicItemList().filter(item => !used.has(String(item.id)));
}

function magicCost(entry){
  return selectedMagicObjects(entry).reduce((sum,item) => sum + Number(item.points || 0), 0);
}
function magicItemsLabel(entry){
  return selectedMagicObjects(entry).map(x => x.name);
}

// Bloc "Monture" : sélecteur dédié, uniquement si l'unité propose des montures.
function renderMountSelector(entry, u) {
  const mounts = (u.options || []).filter(o => o.kind === "mount");
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

// Bloc "Options de personnage" (ou "Options de l'unité") : bannières, armes,
// armures et autres options hors monture / objets magiques.
function renderCharacterOptions(entry, u) {
  const groups = optionGroups(u);
  const label = u.category === "Personnages" ? "Options de personnage" : "Options de l'unité";
  const hasAny = groups.banner.length || groups.weapon.length || groups.armour.length || groups.other.length;
  if (!hasAny) return "";

  let html = `<div class="options-box"><div class="options-title">${esc(label)}</div>`;
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

// Bloc "Objets magiques" : sélection par menu déroulant. Un objet déjà pris
// par une autre unité n'apparaît plus dans la liste (sauf s'il est marqué
// répétable dans les données), et disparaît du menu dès qu'il est ajouté ici.
function renderMagicItemsSelector(entry, u) {
  if (u.category !== "Personnages") return "";
  if (!state.magicItems) {
    return state.magicItemsLoading
      ? `<div class="no-options">Chargement des objets magiques…</div>`
      : "";
  }
  const chosen = selectedMagicObjects(entry);
  const available = availableMagicItems(entry);
  const limit = u.magicItemsLimit != null ? Number(u.magicItemsLimit)
    : (restrictionForUnit(u.id).magicItemsLimit != null ? Number(restrictionForUnit(u.id).magicItemsLimit) : null);
  const used = chosen.reduce((s,x)=>s+Number(x.points||0),0);

  let html = `<div class="options-box"><div class="options-title">Objets magiques${limit!=null?` (max ${formatPoints(limit)})`:""}</div>`;

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
        const disabledByLimit = limit != null && (used + Number(item.points||0)) > limit;
        return `<option value="${esc(item.id)}" ${disabledByLimit?"disabled":""}>${esc(item.category)} — ${esc(item.name)} (${formatPoints(item.points||0)})</option>`;
      }).join("")}
    </select>
  </label>`;

  if (!available.length && !chosen.length) html += `<small class="muted">Aucun objet magique disponible (tous déjà attribués).</small>`;
  html += `</div>`;
  return html;
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

    const limit = u.magicItemsLimit != null ? Number(u.magicItemsLimit)
      : (restrictionForUnit(u.id).magicItemsLimit != null ? Number(restrictionForUnit(u.id).magicItemsLimit) : null);
    if (limit != null && magicCost(item) > limit) errors.push(`${u.name} : objets magiques au-dessus de la limite de ${formatPoints(limit)}.`);
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

  // groups[categorie] contient des cartes ; chaque carte est soit normale
  // ({u, rule:null}), soit une carte "supplémentaire" générée par une règle
  // de recatégorisation active (ex. Éryndor Vareth, Honneur Garde
  // Maritime) : {u, rule}. Une même unité peut donc apparaître deux fois,
  // dans deux catégories différentes, sans être dupliquée dans les données
  // JSON — la carte normale ci-dessous n'est jamais modifiée par ce qui suit.
  const groups = {};
  units.forEach(u => (groups[effectiveCategory(u)] ||= []).push({ u, rule: null }));

  // Cartes additionnelles : dérivées uniquement de restrictions.reclassifications
  // (déjà utilisées pour la case "Compter comme choix de..." dans "Ma
  // liste") — aucune nouvelle donnée à saisir dans le JSON. On reprend
  // l'ensemble filtré/autorisé (pas seulement `units`, qui exclut déjà les
  // unités au maximum : le plafond pertinent ici est celui de la règle, pas
  // celui de l'unité) pour ne pas manquer une unité déjà à son maximum de
  // cartes normales mais encore éligible via la règle.
  filteredUnits().filter(u => u.points != null && isAllowed(u)).forEach(u => {
    activeReclassificationRulesFor(u).forEach(rule => {
      if (canAddAsReclassified(u, rule)) {
        (groups[rule.toCategory] ||= []).push({ u, rule });
      }
    });
  });

  if (!Object.values(groups).some(arr => arr.length)) {
    container.innerHTML = `<div class="empty">Aucune unité disponible ne correspond aux critères.</div>`;
    return;
  }

  container.innerHTML = sortByCategory(Object.entries(groups)).map(([cat, arr]) => `
    <section class="unit-group">
      <div class="group-head"><span>${esc(cat)}</span><span>${arr.length}</span></div>
      ${arr.map(({ u, rule }) => {
        if (!rule) {
          // Carte normale : comportement strictement inchangé.
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
        }
        // Carte "supplémentaire" issue d'une règle de recatégorisation :
        // le budget affiché (used/max) est celui de la règle, PARTAGÉ entre
        // toutes les unités qui l'utilisent (ex. 0-1 au total pour Éryndor,
        // toutes unités Spéciales/Rares confondues) — pas un compteur par
        // unité. Affichage volontairement minimal (nom + bouton) ; le détail
        // (points, budget partagé, règle d'origine) reste consultable via le
        // titre (info-bulle) du bouton plutôt qu'affiché en permanence.
        const used = reclassifiedCount(rule.id);
        const limitText = Number.isFinite(rule.max)
          ? `${used}/${rule.max} choix "${rule.toCategory}"${rule.label ? ` — ${rule.label}` : ""} (budget partagé)`
          : `choix "${rule.toCategory}" illimité${rule.label ? ` — ${rule.label}` : ""}`;
        return `<article class="unit-card">
          <div class="unit-main">
            <strong>${esc(u.name)}</strong>
          </div>
          <button class="add-btn" data-add-reclassified="${esc(u.id)}" data-rule-id="${esc(rule.id)}" title="${esc(`${formatPoints(u.points)} / figurine — ${limitText}`)}">＋ Ajouter</button>
        </article>`;
      }).join("")}

    </section>`).join("");

  container.querySelectorAll("[data-add]").forEach(b => b.onclick = () => addUnit(b.dataset.add));
  container.querySelectorAll("[data-add-reclassified]").forEach(b => b.onclick = () => addUnit(b.dataset.addReclassified, b.dataset.ruleId));
}

// --- Général de l'armée -----------------------------------------------
// Le Général est, par défaut, le Personnage ayant le plus haut Commandement
// (Cd) de la liste ; il est transféré automatiquement si un Personnage avec
// un Commandement plus élevé est ajouté, et retransféré s'il est retiré. En
// cas d'égalité, une coche manuelle (voir renderGeneralMarker) tranche entre
// les personnages à égalité. Un Noble porteur de la Grande Bannière ne peut
// jamais être Général.
function entryStatValue(item, u, key) {
  const n = numericStat(effectiveProfile(item, u).profile[key]);
  return n === null ? -Infinity : n;
}
function personnageGeneralPool() {
  return state.list
    .map(item => ({ item, u: getUnit(item.id) }))
    .filter(({item,u}) => u && u.category === "Personnages" && !isGrandBannerBearer(item, u));
}
function generalCandidates() {
  const pool = personnageGeneralPool();
  if (!pool.length) return [];
  const max = pool.reduce((m,{item,u}) => Math.max(m, entryStatValue(item,u,"Cd")), -Infinity);
  if (!Number.isFinite(max)) return [];
  return pool.filter(({item,u}) => entryStatValue(item,u,"Cd") === max);
}
function resolvedGeneralUid() {
  const cands = generalCandidates();
  if (!cands.length) return null;
  if (cands.length === 1) return cands[0].item.uid;
  if (state.generalUid && cands.some(c => c.item.uid === state.generalUid)) return state.generalUid;
  return cands[0].item.uid;
}
function setGeneral(uidValue) {
  if (!generalCandidates().some(c => c.item.uid === uidValue)) return;
  state.generalUid = uidValue;
  render();
}
// Badge "Général" (automatique) ou coche (en cas d'égalité de Cd) affiché à
// côté du nom d'un Personnage candidat.
function renderGeneralMarker(item, u) {
  if (u.category !== "Personnages") return "";
  const candidates = generalCandidates();
  if (!candidates.some(c => c.item.uid === item.uid)) return "";
  const resolved = resolvedGeneralUid();
  if (candidates.length === 1) {
    return item.uid === resolved ? ` <span class="general-badge" title="Général de l'armée">★ Général</span>` : "";
  }
  const checked = item.uid === resolved;
  return ` <label class="general-tie" title="Commandement à égalité : cocher pour désigner le Général"><input type="checkbox" data-set-general="${esc(item.uid)}" ${checked?"checked":""}> Général</label>`;
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
              </label>${renderGeneralMarker(item, unit)}
              ${expanded ? `<small>${formatPoints(unit.points)} / figurine · Taille ${min}${maxText}</small>` : ""}
            </div>
            <div class="entry-total">${formatPoints(entryPoints(item))}</div>
            <button class="remove" data-remove="${esc(item.uid)}" title="Retirer cette unité">×</button>
          </div>
          ${!expanded ? "" : `
          <div class="roster-entry-controls">
            <div class="qty-control"><button data-minus="${esc(item.uid)}">−</button><input class="qty-input" type="number" min="${min}" ${max===Infinity?"":`max="${max}"`} value="${item.qty}" data-qty-input="${esc(item.uid)}" aria-label="Effectif de ${esc(unit.name)}"><button data-plus="${esc(item.uid)}">+</button><span>figurine${item.qty > 1 ? "s" : ""}</span></div>
          </div>
          ${renderReclassificationToggle(item, unit)}
          ${renderStatsTable(item, unit)}
          ${renderEquipment(item, unit)}
          ${renderNativeRules(item, unit)}
          ${renderMountSelector(item, unit)}
          ${renderCharacterOptions(item, unit)}
          ${renderHonourSelector(item, unit)}
          ${renderMagicDomainSelector(item, unit)}
          ${renderMagicItemsSelector(item, unit)}
          ${renderGrandBannerItemSelector(item, unit)}
          ${renderBannerItemsSelector(item, unit)}
          ${renderChampionWeaponSelector(item, unit)}
          ${renderChampionMagicItemsSelector(item, unit)}
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
  container.querySelectorAll("[data-select-domain]").forEach(s => s.onchange = () => setMagicDomain(s.dataset.selectDomain, s.value));
  container.querySelectorAll("[data-set-general]").forEach(b => b.onchange = () => { if (b.checked) setGeneral(b.dataset.setGeneral); else render(); });
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
  // Une recatégorisation (ex. "compter comme choix de Base" via la
  // Réquisition avisée d'Éryndor) n'a de sens que tant que sa condition
  // reste vraie. Si elle ne l'est plus (le personnage qui l'accorde a été
  // retiré de la liste, par exemple), on la lève automatiquement : l'entrée
  // redevient simplement une unité normale de sa catégorie native, plutôt
  // que de rester bloquée sur une recatégorisation invalide.
  state.list.forEach(entry => {
    if (!entry.reclassified) return;
    const rule = findReclassificationRule(entry.reclassified);
    const u = getUnit(entry.id);
    if (!rule || !ruleAppliesToUnit(rule, u) || !conditionMet(rule.when)) entry.reclassified = null;
  });
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
    await loadMagicItems(getMagicItemsSources());
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
