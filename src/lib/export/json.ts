export function serializeJson(rows: Record<string, unknown>[]): string {
  return JSON.stringify(rows, null, 2);
}

export function jsonContentDisposition(filename: string): string {
  const safe = filename.replace(/"/g, '\\"').replace(/[\r\n]/g, "");
  return `attachment; filename="${safe}"`;
}
