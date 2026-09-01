import { parse } from 'csv-parse/sync';

export interface CsvParseResult {
  columns: string[];
  rows: Record<string, string>[];
  rowCount: number;
}

/**
 * Parse CSV content and return structured data
 */
export function parseCsv(content: string): CsvParseResult {
  const records = parse(content, {
    columns: true, // Use first row as headers
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];
  
  if (records.length === 0) {
    return {
      columns: [],
      rows: [],
      rowCount: 0,
    };
  }
  
  // Get column names from first record
  const columns = Object.keys(records[0]);
  
  return {
    columns,
    rows: records,
    rowCount: records.length,
  };
}

/**
 * Get preview of CSV (first N rows)
 */
export function getCsvPreview(content: string, maxRows = 5): CsvParseResult {
  const result = parseCsv(content);
  return {
    ...result,
    rows: result.rows.slice(0, maxRows),
  };
}

/**
 * Validate that required columns exist in CSV
 */
export function validateCsvColumns(
  csvColumns: string[],
  requiredColumns: string[]
): { valid: boolean; missing: string[] } {
  const missing = requiredColumns.filter(col => !csvColumns.includes(col));
  return {
    valid: missing.length === 0,
    missing,
  };
}
