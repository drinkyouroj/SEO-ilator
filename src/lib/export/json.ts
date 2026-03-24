export function serializeJson(rows: Record<string, unknown>[]): string {
  return JSON.stringify(rows, null, 2);
}

export function jsonContentDisposition(filename: string): string {
  return `attachment; filename="${filename}"`;
}
