export function hashParams(params: Record<string, unknown>): string {
  return JSON.stringify(Object.entries(params).sort((a, b) => a[0].localeCompare(b[0])));
}
