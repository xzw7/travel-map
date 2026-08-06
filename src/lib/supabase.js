import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://dhpoetunxbbnjafktbfr.supabase.co";
const supabaseAnonKey =
  "sb_publishable_nzl5VXYVFdcuzExb49fLOQ_ST3Mwcit";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
