"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getUnreadNotificationCount } from "@/integrations/payload/queries";

const POLL_INTERVAL_MS = 30_000;
const CHANGED_EVENT = "lonvita:notifications-changed";

/** Call after marking notifications read — the bell badges refetch right away instead of
 * showing a stale dot until the next poll. */
export function notifyUnreadCountChanged() {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function useUnreadNotificationCount() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user) {
      setCount(0);
      return;
    }
    let active = true;
    const load = () => {
      getUnreadNotificationCount(String(user.id)).then((c) => {
        if (active) setCount(c);
      });
    };
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    window.addEventListener(CHANGED_EVENT, load);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener(CHANGED_EVENT, load);
    };
  }, [user]);

  return count;
}
