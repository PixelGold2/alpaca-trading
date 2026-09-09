export interface ShippingRoute {
  id: string;
  name: string;
  /** [longitude, latitude] waypoints — a simplified path, not a precise navigational track. */
  path: [number, number][];
}

/**
 * The world's busiest container-shipping corridors, as a static reference
 * overlay — real-time vessel-density (AIS) data is a paid product
 * (MarineTraffic/Spire/Windward), so this ships as a fixed, well-known list
 * of corridors instead of pretending to show live traffic. Waypoints are
 * simplified approximations of the shipping lane, not turn-by-turn routes.
 */
export const SHIPPING_ROUTES: ShippingRoute[] = [
  {
    id: "asia-europe-suez",
    name: "Asia – Europe (via Suez Canal)",
    path: [
      [121.5, 31.2], // Shanghai
      [103.8, 1.3], // Singapore / Malacca Strait
      [79.8, 6.9], // Colombo
      [43.3, 12.5], // Bab-el-Mandeb
      [32.5, 30.0], // Suez Canal
      [20.0, 35.0], // Central Mediterranean
      [-5.5, 36.0], // Strait of Gibraltar
      [4.5, 51.9], // Rotterdam
    ],
  },
  {
    id: "trans-pacific",
    name: "Trans-Pacific (Asia – US West Coast)",
    path: [
      [121.5, 31.2], // Shanghai
      [-175.0, 35.0], // Mid North Pacific
      [-140.0, 34.0],
      [-118.2, 33.7], // Los Angeles / Long Beach
    ],
  },
  {
    id: "trans-atlantic",
    name: "Trans-Atlantic (Europe – US East Coast)",
    path: [
      [4.5, 51.9], // Rotterdam
      [-30.0, 45.0], // Mid North Atlantic
      [-60.0, 42.0],
      [-74.0, 40.7], // New York / New Jersey
    ],
  },
  {
    id: "asia-us-panama",
    name: "Asia – US East Coast (via Panama Canal)",
    path: [
      [121.5, 31.2], // Shanghai
      [-155.0, 25.0], // Central Pacific
      [-100.0, 12.0],
      [-79.5, 9.0], // Panama Canal
      [-81.0, 24.0], // Gulf of Mexico approach
      [-74.0, 40.7], // New York (US East Coast)
    ],
  },
  {
    id: "persian-gulf-hormuz",
    name: "Persian Gulf oil route (Strait of Hormuz)",
    path: [
      [50.0, 27.5], // Persian Gulf
      [56.25, 26.5], // Strait of Hormuz
      [65.0, 20.0], // Arabian Sea
      [72.8, 19.0], // Toward Mumbai / onward to Asia
    ],
  },
];
