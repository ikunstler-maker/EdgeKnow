import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { PAGE_TREE_COLUMNS } from "@/lib/pages";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { workspaceData } from "@/lib/team-db/data";

// How long each step of opening a workspace page takes on the server, in
// milliseconds: for the platform admin only, numbers only (no names, no content).
// Open /api/admin/timing?w=<workspace short id> while signed in.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user.isPlatformAdmin) return new NextResponse(null, { status: 404 });
  const shortId = request.nextUrl.searchParams.get("w") ?? "";

  const steps: { step: string; ms: number }[] = [];
  const timed = async <T,>(step: string, run: () => PromiseLike<T>): Promise<T> => {
    const start = performance.now();
    try {
      return await run();
    } finally {
      steps.push({ step, ms: Math.round((performance.now() - start) * 10) / 10 });
    }
  };

  const started = performance.now();
  const supabase = await createClient();
  // Each one twice: the first call of a kind may also pay for opening a connection.
  for (const round of [1, 2]) {
    await timed(`session check (getClaims) #${round}`, () => supabase.auth.getClaims());
    await timed(`access check (has_platform_access) #${round}`, () => supabase.rpc("has_platform_access"));
    await timed(`own profile #${round}`, () => supabase.from("profiles").select("id").eq("id", user.id).maybeSingle());
  }
  const { data: workspace } = await timed("workspace by short id", () =>
    supabase.from("workspaces").select("id").eq("short_id", shortId).maybeSingle(),
  );
  if (workspace) {
    await timed("workspace role", () => supabase.rpc("workspace_role", { ws: workspace.id }));
    const admin = createAdminClient();
    if (admin) await timed("team database record (secret key)", () => admin.from("team_databases").select("workspace_id").eq("workspace_id", workspace.id).maybeSingle());
    const data = await timed("data client (where the workspace lives, pass for a team database)", () => workspaceData(shortId));
    if (data) {
      for (const round of [1, 2]) {
        await timed(`page tree from the ${data.location} database #${round}`, () =>
          data.client.from("pages").select(PAGE_TREE_COLUMNS).eq("workspace_id", workspace.id).is("deleted_at", null),
        );
        await timed(`task projects from the ${data.location} database #${round}`, () =>
          data.client.from("task_projects").select("id").eq("workspace_id", workspace.id),
        );
      }
    }
  }

  return NextResponse.json(
    { region: process.env.VERCEL_REGION ?? null, total_ms: Math.round(performance.now() - started), steps },
    { headers: { "Cache-Control": "no-store" } },
  );
}
