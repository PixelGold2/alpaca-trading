/**
 * Small static centroid lookups used to place company-HQ-based events (e.g.
 * earnings) on the map when only a country/state is known, not exact
 * coordinates. Deliberately coarse — callers must set locationPrecision to
 * "region" (state) or "country" accordingly, never "city" or "exact", since
 * these are not real geocodes.
 */

export const US_STATE_CENTROIDS: Record<string, [number, number]> = {
  AL: [32.8, -86.8], AK: [64.2, -149.5], AZ: [34.2, -111.6], AR: [34.8, -92.4],
  CA: [37.2, -119.6], CO: [39.0, -105.5], CT: [41.6, -72.7], DE: [39.0, -75.5],
  FL: [27.8, -81.7], GA: [32.6, -83.4], HI: [20.3, -156.4], ID: [44.4, -114.6],
  IL: [40.0, -89.2], IN: [39.9, -86.3], IA: [42.1, -93.5], KS: [38.5, -98.4],
  KY: [37.5, -85.3], LA: [31.2, -91.9], ME: [45.4, -69.2], MD: [39.0, -76.8],
  MA: [42.3, -71.8], MI: [44.3, -85.4], MN: [46.3, -94.3], MS: [32.7, -89.7],
  MO: [38.5, -92.5], MT: [47.0, -109.6], NE: [41.5, -99.8], NV: [39.3, -116.6],
  NH: [43.7, -71.6], NJ: [40.1, -74.7], NM: [34.4, -106.1], NY: [42.9, -75.5],
  NC: [35.6, -79.4], ND: [47.5, -100.5], OH: [40.4, -82.8], OK: [35.6, -97.5],
  OR: [43.9, -120.6], PA: [40.9, -77.8], RI: [41.7, -71.5], SC: [33.9, -80.9],
  SD: [44.4, -100.3], TN: [35.9, -86.4], TX: [31.5, -99.3], UT: [39.3, -111.7],
  VT: [44.0, -72.7], VA: [37.5, -78.9], WA: [47.4, -120.5], WV: [38.6, -80.7],
  WI: [44.6, -89.9], WY: [43.0, -107.5], DC: [38.9, -77.0],
};

export const COUNTRY_CENTROIDS: Record<string, { name: string; coords: [number, number] }> = {
  US: { name: "USA", coords: [39.8, -98.6] },
  GB: { name: "United Kingdom", coords: [54.0, -2.0] },
  DE: { name: "Germany", coords: [51.2, 10.4] },
  FR: { name: "France", coords: [46.6, 2.4] },
  JP: { name: "Japan", coords: [36.2, 138.3] },
  CN: { name: "China", coords: [35.9, 104.2] },
  CA: { name: "Canada", coords: [56.1, -106.3] },
  IN: { name: "India", coords: [22.0, 79.0] },
  BR: { name: "Brazil", coords: [-10.3, -53.2] },
  KR: { name: "South Korea", coords: [36.5, 127.8] },
  TW: { name: "Taiwan", coords: [23.7, 121.0] },
  NL: { name: "Netherlands", coords: [52.1, 5.3] },
  CH: { name: "Switzerland", coords: [46.8, 8.2] },
  SG: { name: "Singapore", coords: [1.35, 103.8] },
  AU: { name: "Australia", coords: [-25.3, 133.8] },
  IE: { name: "Ireland", coords: [53.4, -8.2] },
  SE: { name: "Sweden", coords: [60.1, 18.6] },
  IL: { name: "Israel", coords: [31.0, 34.8] },
  ES: { name: "Spain", coords: [40.5, -3.7] },
  IT: { name: "Italy", coords: [42.8, 12.6] },
  HK: { name: "Hong Kong", coords: [22.3, 114.2] },
  MX: { name: "Mexico", coords: [23.6, -102.6] },
};

export function resolveHqLocation(
  countryCode: string | undefined,
  stateCode: string | undefined,
): { country: string; region?: string; latitude: number; longitude: number; precision: "region" | "country" } | null {
  const code = countryCode?.toUpperCase().trim();
  if (!code) return null;

  if (code === "US" && stateCode && US_STATE_CENTROIDS[stateCode.toUpperCase()]) {
    const [latitude, longitude] = US_STATE_CENTROIDS[stateCode.toUpperCase()];
    return { country: "USA", region: stateCode.toUpperCase(), latitude, longitude, precision: "region" };
  }

  const country = COUNTRY_CENTROIDS[code];
  if (!country) return null;
  const [latitude, longitude] = country.coords;
  return { country: country.name, latitude, longitude, precision: "country" };
}
