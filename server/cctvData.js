const fs = require("fs");
const path = require("path");

const CSV_PATH = path.resolve(__dirname, "cctvStatusD03.csv");
const VIDS_PATH = path.resolve(__dirname, "..", "vids.txt");
const VM_BASE = "https://cwwp2.dot.ca.gov/vm/loc/d3";

/** Parse one CSV line respecting double-quoted fields (e.g. "Hwy 5 at Pocket"). */
function parseCsvLine(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      i += 1;
      let field = "";
      while (i < line.length && line[i] !== '"') {
        field += line[i];
        i += 1;
      }
      if (line[i] === '"') i += 1;
      out.push(field);
      if (line[i] === ",") i += 1;
    } else {
      let field = "";
      while (i < line.length && line[i] !== ",") {
        field += line[i];
        i += 1;
      }
      out.push(field.trim());
      if (line[i] === ",") i += 1;
    }
  }
  return out;
}

/** Extract camera slug from currentImageURL (e.g. .../image/hwy80atantelope/hwy80atantelope.jpg -> hwy80atantelope). */
function slugFromImageUrl(url) {
  if (!url || typeof url !== "string") return null;
  const m = url.match(/\/cctv\/image\/([^/]+)\//);
  return m ? m[1] : null;
}

let cameras = [];
let camerasBySlug = new Map();
let featuredSlugs = [];

function loadCctvData() {
  cameras = [];
  camerasBySlug = new Map();

  if (!fs.existsSync(CSV_PATH)) return;

  const raw = fs.readFileSync(CSV_PATH, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return;

  const header = parseCsvLine(lines[0]);
  const col = (name) => header.indexOf(name);
  const idx = {
    locationName: col("locationName"),
    nearbyPlace: col("nearbyPlace"),
    longitude: col("longitude"),
    latitude: col("latitude"),
    route: col("route"),
    direction: col("direction"),
    inService: col("inService"),
    streamingVideoURL: col("streamingVideoURL"),
    currentImageURL: col("currentImageURL"),
  };

  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    if (row.length < header.length) continue;

    const get = (key) => (idx[key] >= 0 ? row[idx[key]] : undefined);
    const currentImageURL = get("currentImageURL");
    const slug = slugFromImageUrl(currentImageURL);
    if (!slug) continue;

    const refUrls = [];
    for (let r = 1; r <= 12; r++) {
      const refCol = r === 1 ? "referenceImage1UpdateAgoURL" : `referenceImage${r}UpdatesAgoURL`;
      const ci = header.indexOf(refCol);
      if (ci >= 0 && row[ci]) refUrls.push(row[ci]);
    }

    const lon = parseFloat(get("longitude"));
    const lat = parseFloat(get("latitude"));
    const inService = String(get("inService")).toLowerCase() === "true";

    cameras.push({
      slug,
      index: i,
      locationName: get("locationName") || "",
      nearbyPlace: get("nearbyPlace") || "",
      route: get("route") || "",
      direction: get("direction") || "",
      longitude: Number.isFinite(lon) ? lon : null,
      latitude: Number.isFinite(lat) ? lat : null,
      inService,
      streamingVideoURL: get("streamingVideoURL") || null,
      currentImageURL: currentImageURL || null,
      referenceImageUrls: refUrls,
      vmPageUrl: `${VM_BASE}/${slug}.htm`,
    });
    camerasBySlug.set(slug, cameras[cameras.length - 1]);
  }

  // Featured slugs from vids.txt (Caltrans VM page URLs)
  featuredSlugs = [];
  if (fs.existsSync(VIDS_PATH)) {
    const vidsRaw = fs.readFileSync(VIDS_PATH, "utf8");
    const urls = vidsRaw.split(/\r?\n/).map((u) => u.trim()).filter(Boolean);
    for (const u of urls) {
      const match = u.match(/\/([a-z0-9]+)\.htm$/i);
      if (match) featuredSlugs.push(match[1].toLowerCase());
    }
  }
}

function getCctvCameras(opts = {}) {
  const { inServiceOnly = false, withStreamOnly = false, featuredFirst = false } = opts;
  let list = [...cameras];
  if (inServiceOnly) list = list.filter((c) => c.inService);
  if (withStreamOnly) list = list.filter((c) => c.streamingVideoURL);
  if (featuredFirst && featuredSlugs.length) {
    list.sort((a, b) => {
      const aF = featuredSlugs.indexOf(a.slug);
      const bF = featuredSlugs.indexOf(b.slug);
      if (aF >= 0 && bF < 0) return -1;
      if (aF < 0 && bF >= 0) return 1;
      if (aF >= 0 && bF >= 0) return aF - bF;
      return 0;
    });
  }
  return list;
}

function getCctvBySlug(slug) {
  return camerasBySlug.get(slug) || null;
}

function getFeaturedSlugs() {
  return [...featuredSlugs];
}

// Load on first require
loadCctvData();

module.exports = {
  loadCctvData,
  getCctvCameras,
  getCctvBySlug,
  getFeaturedSlugs,
  slugFromImageUrl,
};
