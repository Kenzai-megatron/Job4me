/** A query string with every value percent-encoded (spaces as %20, never "+"). */
export function query(params: Record<string, string | number | null | undefined>): string {
  return Object.entries(params)
    .filter(
      (entry): entry is [string, string | number] => entry[1] !== null && entry[1] !== undefined,
    )
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`)
    .join('&');
}
