export interface EndpointConfig {
  /** The API's own address (NEXT_PUBLIC_API_URL). */
  apiUrl: string;
  /** Whether sign-in goes through this site (NEXT_PUBLIC_AUTH_VIA_WEB) - see next.config.ts. */
  authViaWeb: boolean;
}

// The API has no route at /auth itself, only under it.
const isAuthPath = (path: string) => path.startsWith('/auth/');

/**
 * The address to call for an API path. Normally the API itself. With sign-in via
 * this site, the /auth routes - the ones that set and read the session cookie -
 * stay on this site's own address instead (relative, so the same origin), and Next
 * passes them on to the API. That makes the cookie belong to this site, which
 * browsers keep when the web app and the API sit on two unrelated domains (for
 * instance two free *.something.app subdomains) and drop when it belongs to the API.
 */
export function endpointUrl(path: string, config: EndpointConfig): string {
  return config.authViaWeb && isAuthPath(path) ? path : `${config.apiUrl}${path}`;
}
