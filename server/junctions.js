const YT_DEFAULT = process.env.YOUTUBE_STREAM_URL || "https://www.youtube.com/watch?v=ydYDqZQpim8";

/** Demo junctions (matches prompt.json IDs). */
const junctions = [
  {
    id: "bkc-signal-1",
    name: "Bandra-Kurla Complex Junction",
    lat: 19.0596,
    lng: 72.8656,
    road_count: 4,
    multiplier_tier: 3,
    stream_url: YT_DEFAULT,
    description: "High-traffic 4-way junction. Rush hour multiplier peaks at 6.5x",
  },
  {
    id: "worli-signal-1",
    name: "Worli Sea Face Signal",
    lat: 19.0176,
    lng: 72.8156,
    road_count: 2,
    multiplier_tier: 1,
    stream_url: YT_DEFAULT,
    description: "Straight highway signal. Lower variance, steadier returns.",
  },
  {
    id: "dadar-tt-1",
    name: "Dadar TT Circle",
    lat: 19.0178,
    lng: 72.8478,
    road_count: 5,
    multiplier_tier: 4,
    stream_url: YT_DEFAULT,
    description: "5-road chaos junction. Highest variance. Up to 14x during peak.",
  },
];

function getJunctionById(id) {
  return junctions.find((j) => j.id === id);
}

module.exports = { junctions, getJunctionById };

