const { getCctvCameras, getCctvBySlug } = require("./cctvData");

/**
 * Junctions are built from Caltrans D3 CCTV CSV (cctvStatusD03.csv).
 * Each junction has live stream (HLS), current image, and reference (previous) images.
 * vids.txt lists featured VM page URLs; those cameras are ordered first.
 */
function buildJunctions() {
  const cameras = getCctvCameras({
    inServiceOnly: true,
    withStreamOnly: true,
    featuredFirst: true,
  });

  if (cameras.length === 0) {
    return [{
      id: "no-cctv",
      name: "No CCTV data",
      lat: 38.58,
      lng: -121.49,
      road_count: 0,
      multiplier_tier: 0,
      stream_url: null,
      description: "Load server/cctvStatusD03.csv and restart server.",
      currentImageURL: null,
      referenceImageUrls: [],
      vmPageUrl: null,
    }];
  }

  return cameras.map((c) => ({
    id: c.slug,
    name: c.locationName || c.slug,
    lat: c.latitude ?? 38.5,
    lng: c.longitude ?? -121.5,
    road_count: 2,
    multiplier_tier: 1,
    stream_url: c.streamingVideoURL,
    description: [c.nearbyPlace, c.route].filter(Boolean).join(" · ") || "Caltrans D3 CCTV",
    // Footage links (current + previous images and VM page)
    currentImageURL: c.currentImageURL,
    referenceImageUrls: c.referenceImageUrls || [],
    vmPageUrl: c.vmPageUrl,
  }));
}

const junctions = buildJunctions();

function getJunctionById(id) {
  const j = junctions.find((j) => j.id === id);
  if (j) return j;
  const c = getCctvBySlug(id);
  if (!c) return null;
  return {
    id: c.slug,
    name: c.locationName || c.slug,
    lat: c.latitude ?? 38.5,
    lng: c.longitude ?? -121.5,
    road_count: 2,
    multiplier_tier: 1,
    stream_url: c.streamingVideoURL,
    description: [c.nearbyPlace, c.route].filter(Boolean).join(" · ") || "Caltrans D3 CCTV",
    currentImageURL: c.currentImageURL,
    referenceImageUrls: c.referenceImageUrls || [],
    vmPageUrl: c.vmPageUrl,
  };
}

module.exports = { junctions, getJunctionById };
