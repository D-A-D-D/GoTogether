/**
 * Reads the `token` from a URL fragment such as "#token=abc". Emailed links carry
 * their token after the `#` because browsers never send a fragment to a server:
 * it stays out of access logs and out of the Referer header. Anything that isn't
 * a fragment (a query string, say, which servers *do* see) is refused, so a link
 * built the wrong way fails visibly instead of working and leaking.
 */
export function tokenFromFragment(hash: string): string | null {
  if (!hash.startsWith('#')) return null;
  const token = new URLSearchParams(hash.slice(1)).get('token')?.trim();
  return token ? token : null;
}
