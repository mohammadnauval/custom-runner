import { parse } from 'csv-parse/sync';

export interface CsvParseResult {
  columns: string[];
  rows: Record<string, string>[];
  rowCount: number;
}

/**
 * Parse CSV content. The first row is used as headers and the delimiter is
 * auto-detected between comma, semicolon and tab.
 */
export function parseCsv(content: string): CsvParseResult {
  // Strip UTF-8 BOM which would otherwise become part of the first column name
  const clean = content.replace(/^\uFEFF/, '');

  const records = parse(clean, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true,
    delimiter: [',', ';', '\t'],
  }) as Record<string, string>[];

  if (records.length === 0) {
    return { columns: [], rows: [], rowCount: 0 };
  }

  return {
    columns: Object.keys(records[0]),
    rows: records,
    rowCount: records.length,
  };
}

/**
 * Get preview of CSV (first N rows)
 */
export function getCsvPreview(content: string, maxRows = 5): CsvParseResult {
  const result = parseCsv(content);
  return { ...result, rows: result.rows.slice(0, maxRows) };
}
