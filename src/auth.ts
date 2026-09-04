import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

type JwtAuthenticatorOptions = {
  issuer: string;
  audience: string;
  jwks: JWTVerifyGetKey;
};

export function createJwtAuthenticator({ issuer, audience, jwks }: JwtAuthenticatorOptions) {
  return async (authorization: string | undefined): Promise<string | null> => {
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) return null;
    try {
      const { payload } = await jwtVerify(match[1], jwks, {
        issuer,
        audience,
        algorithms: ["RS256"],
      });
      const identity = payload.oid ?? payload.sub;
      return typeof identity === "string" && identity.length <= 200 ? identity : null;
    } catch {
      return null;
    }
  };
}

export function createEntraAuthenticatorFromEnvironment() {
  const tenantId = process.env.ENTRA_TENANT_ID?.trim();
  const clientId = process.env.ENTRA_CLIENT_ID?.trim();
  if (!tenantId && !clientId) return null;
  if (!tenantId || !clientId) throw new Error("ENTRA_TENANT_ID dan ENTRA_CLIENT_ID harus diisi bersama.");
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new Error("ENTRA_TENANT_ID tidak sah.");
  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  const jwks = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`));
  return createJwtAuthenticator({ issuer, audience: clientId, jwks });
}
