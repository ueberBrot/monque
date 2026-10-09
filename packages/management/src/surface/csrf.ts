const isCanonicalOrigin = function isCanonicalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === origin;
  } catch {
    return false;
  }
};
export const parseTrustedOrigins = function parseTrustedOrigins(
  origins: readonly string[],
): ReadonlySet<string> {
  for (const origin of origins) {
    if (!isCanonicalOrigin(origin)) {
      throw new TypeError(`Invalid trusted origin: ${origin}`);
    }
  }

  return new Set(origins);
};

interface MutationRequest {
  method: string;
  url: URL;
  headers: Record<string, string | string[] | undefined>;
}

export const isTrustedMutationRequest = function isTrustedMutationRequest(
  request: MutationRequest,
  trustedOrigins: ReadonlySet<string>,
): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    return true;
  }

  const { origin } = request.headers;

  if (origin !== undefined) {
    return (
      !Array.isArray(origin) &&
      isCanonicalOrigin(origin) &&
      (origin === request.url.origin || trustedOrigins.has(origin))
    );
  }

  const fetchSite = request.headers["sec-fetch-site"];
  return fetchSite === undefined || fetchSite === "same-origin" || fetchSite === "none";
};
