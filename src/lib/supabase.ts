import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY!;

console.log(
  "SUPABASE_URL check:",
  supabaseUrl
    ? {
        protocol: supabaseUrl.startsWith("https://"),
        hasRestApi: supabaseUrl.includes("/rest/v1"),
        endsWithSupabaseCo: supabaseUrl.endsWith(".supabase.co"),
      }
    : "MISSING",
);

console.log(
  "SUPABASE_SERVICE_ROLE_KEY exists:",
  !!supabaseServiceRoleKey,
);

export const supabase = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
);