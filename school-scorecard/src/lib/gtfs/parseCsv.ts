import { createReadStream } from 'fs';
import { createInterface } from 'readline';

/**
 * Simple streaming CSV parser: yields rows as string[].
 * Handles quoted fields (no commas inside for MVP).
 */
async function* readCsvRows(filePath: string): AsyncGenerator<string[]> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let headers: string[] = [];
  let first = true;
  for await (const line of rl) {
    const row = line.split(',').map((c) => c.replace(/^"|"$/g, '').trim());
    if (first) {
      headers = row;
      first = false;
      continue;
    }
    if (row.length !== headers.length) continue;
    yield row;
  }
}

/**
 * Parse CSV and return rows as objects keyed by header names.
 */
export async function parseCsvToObjects<T extends Record<string, string>>(
  filePath: string,
  headers: string[]
): Promise<T[]> {
  const rows: T[] = [];
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let first = true;
  let colNames: string[] = [];
  for await (const line of rl) {
    const values = line.split(',').map((c) => c.replace(/^"|"$/g, '').trim());
    if (first) {
      colNames = values.length >= headers.length ? values : headers;
      first = false;
      continue;
    }
    if (values.length < colNames.length) continue;
    const obj = {} as T;
    colNames.forEach((h, i) => {
      (obj as Record<string, string>)[h] = values[i] ?? '';
    });
    rows.push(obj);
  }
  return rows;
}

export { readCsvRows };
