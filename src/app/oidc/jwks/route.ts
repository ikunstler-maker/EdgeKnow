import { oidcConfigured, publicJwks } from "@/lib/oidc";

// Public halves of our signing keys; the teams' projects check tokens against them.
export async function GET() {
  if (!oidcConfigured()) return new Response("Not configured", { status: 503 });
  return Response.json(publicJwks(), { headers: { "Cache-Control": "public, max-age=300" } });
}
