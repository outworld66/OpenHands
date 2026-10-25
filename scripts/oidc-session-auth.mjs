/** Verify the browser's OIDC session through the local Agent Server. */
export function createOidcSessionAuthorizer(
  statusUrl,
  fetchImpl = (...args) => fetch(...args),
) {
  if (!statusUrl) return null;

  return async (req) => {
    const cookie = req.headers.cookie;
    if (typeof cookie !== "string" || !cookie) return false;

    const origin = req.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) return false;
      } catch {
        return false;
      }
    }

    try {
      const response = await fetchImpl(statusUrl, {
        headers: { accept: "application/json", cookie },
        redirect: "error",
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return false;
      const status = await response.json();
      return (
        status.enabled === true &&
        typeof status.user?.sub === "string" &&
        Array.isArray(status.roles) &&
        status.roles.some((role) => role === "user" || role === "admin")
      );
    } catch {
      return false;
    }
  };
}
