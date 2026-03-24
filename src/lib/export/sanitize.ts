/**
 * Prevent spreadsheet formula injection by prefixing dangerous characters.
 * Cells starting with =, +, -, @ are prefixed with a single quote.
 * Per DECISION-003 export safety requirements.
 */
export function sanitizeCell(value: string): string {
  if (value.length === 0) return value;
  if (value[0] === "=" || value[0] === "+" || value[0] === "-" || value[0] === "@") {
    return "'" + value;
  }
  return value;
}
