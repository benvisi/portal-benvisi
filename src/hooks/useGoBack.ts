import { useCallback } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";

import type { AppRoute } from "@/config/routes";

/**
 * Back-arrow navigation for page-level back buttons. Prefers a real
 * browser-history pop (`router.history.back()`) so that tapping the in-app
 * back arrow behaves exactly like a native swipe-back/hardware-back
 * gesture — same history stack, no extra forward-pushed entry that would
 * make the two diverge. Falls back to a normal forward navigation to
 * `fallbackTo` only when there is no prior in-app history entry to pop
 * (`router.history.canGoBack()` is false), e.g. a direct link or a page
 * refresh landed the employee straight on this page — this is the exact
 * navigation every one of these back buttons already performed before.
 */
export function useGoBack(fallbackTo: AppRoute) {
  const router = useRouter();
  const navigate = useNavigate();

  return useCallback(() => {
    if (router.history.canGoBack()) {
      router.history.back();
    } else {
      void navigate({ to: fallbackTo });
    }
  }, [router, navigate, fallbackTo]);
}
