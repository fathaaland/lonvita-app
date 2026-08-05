"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getUnreadNotificationCount } from "@/integrations/payload/queries";

const POLL_INTERVAL_MS = 30_000;

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
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [user]);

  return count;
}
