import { oidcConfigured, oidcIssuer } from "@/lib/oidc";

// OIDC discovery for the teams' Supabase projects: where our public keys are.
export async function GET(request: Request) {
  if (!oidcConfigured()) return new Response("Not configured", { status: 503 });
  const issuer = oidcIssuer(new URL(request.url).origin);
  return Response.json(
    {
      issuer,
      jwks_uri: `${issuer}/jwks`,
      authorization_endpoint: `${issuer.replace(/\/oidc$/, "")}/login`,
      response_types_supported: ["id_token"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["ES256"],
      claims_supported: ["sub", "email", "role", "aud", "iss", "exp", "iat"],
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
