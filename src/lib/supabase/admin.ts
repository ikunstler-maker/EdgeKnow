import "server-only";
import { createClient } from "@supabase/supabase-js";

// Server-only client with the secret key: bypasses RLS, so it is used only for
// what no user may do directly (reading the encrypted Drive access, background
// jobs). Never import it into code that runs in the browser.
export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
