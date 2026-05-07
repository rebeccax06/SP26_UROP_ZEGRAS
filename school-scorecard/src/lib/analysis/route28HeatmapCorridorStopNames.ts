/**
 * Route 28 **inbound** corridor (Mattapan → Ruggles), in the order you specified.
 * Stray route numbers from pastes are omitted.
 *
 * Each row is `{ name, stopId }`: `stop_id` is the MBTA GTFS value that pairs with that
 * `stop_name` on trip **73766593** (Mattapan → Ruggles). The interactive heatmap uses this
 * array order and these `stopId`s as-is for the inbound Y-axis (no name-based reordering).
 *
 * Keep **exactly one row per stop** in corridor order.
 */

/** Single source of truth: display order = array order. */
export const ROUTE_28_MATTAPAN_TO_RUGGLES_CORRIDOR: readonly Readonly<{
  readonly name: string;
  readonly stopId: string;
}>[] = [
  { name: 'Mattapan', stopId: '18511' },
  { name: '1624 Blue Hill Ave @ Mattapan Sq', stopId: '1722' },
  { name: 'Blue Hill Ave @ Babson St', stopId: '1723' },
  { name: 'Blue Hill Ave opp Woodhaven St', stopId: '1724' },
  { name: '1458 Blue Hill Ave opp Almont St', stopId: '1725' },
  { name: 'Blue Hill Ave @ Mattapan Library', stopId: '1726' },
  { name: 'Blue Hill Ave @ Fessenden St', stopId: '1728' },
  { name: 'Blue Hill Ave @ Woolson St', stopId: '1730' },
  { name: 'Blue Hill Ave @ Morton St', stopId: '1731' },
  { name: 'Blue Hill Ave @ Woodrow Ave', stopId: '1732' },
  { name: 'Blue Hill Ave @ Arbutus St', stopId: '1733' },
  { name: 'Blue Hill Ave @ Callender St', stopId: '1734' },
  { name: 'Blue Hill Ave @ Westview St', stopId: '1735' },
  { name: 'Blue Hill Ave opp Health Ctr', stopId: '1736' },
  { name: 'Blue Hill Ave @ Harvard St', stopId: '1737' },
  { name: 'Blue Hill Ave @ Wales St', stopId: '381' },
  { name: 'Blue Hill Ave @ Charlotte St', stopId: '382' },
  { name: 'Blue Hill Ave @ Ellington St', stopId: '383' },
  { name: 'Blue Hill Ave @ Pasadena Rd', stopId: '384' },
  { name: 'Blue Hill Ave @ Castlegate Rd', stopId: '385' },
  { name: 'Warren St @ Sunderland St', stopId: '386' },
  { name: 'Warren St @ Intervale St', stopId: '387' },
  { name: 'Warren St @ Gaston St', stopId: '388' },
  { name: 'Warren St @ Quincy St', stopId: '390' },
  { name: 'Warren St @ Maywood St', stopId: '392' },
  { name: 'Warren St @ Woodbine St', stopId: '393' },
  { name: 'Warren St @ Waverly St', stopId: '394' },
  { name: 'Warren St @ Whiting St', stopId: '395' },
  { name: 'Warren St @ Moreland St', stopId: '396' },
  { name: 'Warren St @ Kearsarge Ave', stopId: '21151' },
  { name: 'Nubian', stopId: '64000' },
  { name: 'Malcolm X Blvd @ Shawmut Ave', stopId: '1148' },
  { name: "Malcolm X Blvd @ O'Bryant HS", stopId: '11149' },
  { name: 'Malcolm X Blvd @ Madison Park HS', stopId: '11148' },
  { name: 'Malcolm X Blvd @ Tremont St', stopId: '21148' },
  { name: 'Tremont St opp Prentiss St', stopId: '1224' },
  { name: 'Ruggles', stopId: '17861' },
];
