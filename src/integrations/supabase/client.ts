import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { createPreviewSupabaseClient } from "@/lib/produtoImagensPreview";

function createSupabaseClient(): SupabaseClient {
  // Opt-in demonstration build only (see produtoImagensPreview.ts): no real
  // client is created, so the browser cannot reach the database at all. The
  // flag is compared inline so the bundler folds it and drops the demo code
  // from every normal build.
  if (import.meta.env.VITE_IMAGENS_PRODUTO_PREVIEW_MOCK === "true")
    return createPreviewSupabaseClient();

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY");
  }

  return createClient(supabaseUrl, supabasePublishableKey);
}

export const supabase = createSupabaseClient();
