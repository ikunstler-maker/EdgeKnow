import { NextResponse } from "next/server";
import { exportMyData } from "@/lib/my-data";
import { overLimit, tooManyRequests } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

// "Download my data": one JSON file with everything about the person.
export async function GET() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (await overLimit(supabase, "export")) return tooManyRequests();
  const file = await exportMyData(String(userId));
  return new NextResponse(JSON.stringify(file, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="edgeknow-my-data-${file.exported_at.slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
