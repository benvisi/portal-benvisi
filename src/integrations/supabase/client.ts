import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ugfogsseikupsfqqznzi.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnZm9nc3NlaWt1cHNmcXF6bnppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMDgxNjAsImV4cCI6MjA5OTY4NDE2MH0.vHoE7aqY7bdFzV-XXZKDCdL0JeA_azUDMs7JjQcJF2w";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
