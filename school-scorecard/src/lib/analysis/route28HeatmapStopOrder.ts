/**
 * Route 28 heatmap Y-axis: GTFS `stop_id`s in project order.
 *
 * The **Mattapan → Ruggles** inbound corridor is defined in
 * `route28HeatmapCorridorStopNames.ts` (`ROUTE_28_MATTAPAN_TO_RUGGLES_CORRIDOR`).
 *
 * 1. **Mattapan → Ruggles** — corridor table order (`stop_id` per row).
 * 2. **Longwood → Mattapan (outbound-only)** — Trip `73766456` order, appended with deduping.
 * 3. **After Ruggles toward Longwood** — Tail of trip `73766593` (`1798` … `11780`).
 *
 * The interactive heatmap uses `getRoute28HeatmapYAxisStopIdsResolved()`; see `heatmapData.ts`.
 */

import { ROUTE_28_MATTAPAN_TO_RUGGLES_CORRIDOR } from '@/lib/analysis/route28HeatmapCorridorStopNames';

function normStopId(id: string): string {
  return String(id ?? '').trim();
}

async function resolveRoute28MattapanToRugglesStopIds(): Promise<string[]> {
  return ROUTE_28_MATTAPAN_TO_RUGGLES_CORRIDOR.map((row) => normStopId(row.stopId)).filter((id) => id.length > 0);
}

/** Longwood / Huntington → Mattapan (GTFS direction 0, trip 73766456). Appended after primary block. */
export const ROUTE_28_HEATMAP_LONGWOOD_TO_MATTAPAN_STOP_IDS: readonly string[] = [
  '11780',
  '11781',
  '1784',
  '1785',
  '17861', // deduped if already listed above; kept for outbound→Mattapan ordering when feeds differ
  '17862',
  '11257',
  '1259',
  '11323',
  '11259',
  '40001',
  '401',
  '404',
  '405',
  '406',
  '407',
  '410',
  '411',
  '412',
  '413',
  '414',
  '415',
  '416',
  '417',
  '419',
  '1706',
  '1708',
  '1709',
  '1710',
  '11712',
  '1713',
  '1714',
  '1716',
  '1717',
  '1718',
  '11719',
  '1720',
  '1721',
  '18511', // Mattapan (outbound terminus; also first id on Mattapan→Ruggles — deduped in Y-axis)
];

/** Continuation of trip 73766593 after `17861` Ruggles (toward Longwood). */
export const ROUTE_28_HEATMAP_POST_RUGGLES_STOP_IDS: readonly string[] = ['1798', '71391', '91391', '11780'];

/**
 * Full heatmap Y-axis: corridor-ordered Mattapan→Ruggles `stop_id`s, then Longwood→Mattapan and
 * post-Ruggles segments (de-duped).
 */
export async function getRoute28HeatmapYAxisStopIdsResolved(): Promise<string[]> {
  const primary = await resolveRoute28MattapanToRugglesStopIds();
  const seen = new Set<string>();
  const ids: string[] = [];
  const push = (id: string) => {
    const n = normStopId(id);
    if (!n || seen.has(n)) return;
    seen.add(n);
    ids.push(n);
  };
  for (const id of primary) push(id);
  for (const id of ROUTE_28_HEATMAP_LONGWOOD_TO_MATTAPAN_STOP_IDS) push(id);
  for (const id of ROUTE_28_HEATMAP_POST_RUGGLES_STOP_IDS) push(id);
  return ids;
}

export async function getRoute28HeatmapStopRankResolved(): Promise<Map<string, number>> {
  const rank = new Map<string, number>();
  (await getRoute28HeatmapYAxisStopIdsResolved()).forEach((id, i) => {
    rank.set(normStopId(id), i);
  });
  return rank;
}
