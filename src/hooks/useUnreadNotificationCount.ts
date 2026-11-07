"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getUnreadNotificationCount } from "@/integrations/payload/queries";

/** 60–120 s, randomised per poll so thousands of open tabs don't hit the API in lockstep. */
const POLL_MIN_MS = 60_000;
const POLL_JITTER_MS = 60_000;
const CHANGED_EVENT = "lonvita:notifications-changed";

/** Call after marking notifications read — the bell badges refetch right away instead of
 * showing a stale dot until the next poll. */
export function notifyUnreadCountChanged() {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

/**
 * One poll per tab, shared by every badge (top nav, bottom nav, admin side nav each use the hook —
 * they used to poll on their own, three requests a tick). Paused while the tab is hidden; coming
 * back to it refetches at once.
 */
type Listener = (count: number) => void;
const listeners = new Set<Listener>();
let currentUserId: string | null = null;
let lastCount = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;

const publish = (count: number) => {
  lastCount = count;
  listeners.forEach((listener) => listener(count));
};

const load = () => {
  const userId = currentUserId;
  if (!userId) return;
  const mine = generation;
  getUnreadNotificationCount(userId)
    .then((count) => {
      if (mine === generation) publish(count);
    })
    .catch(() => {});
};

const schedule = () => {
  clearTimeout(timer);
  if (!currentUserId || document.visibilityState === "hidden") return;
  timer = setTimeout(() => {
    load();
    schedule();
  }, POLL_MIN_MS + Math.random() * POLL_JITTER_MS);
};

const onVisibility = () => {
  if (document.visibilityState === "visible") load();
  schedule();
};

const onChanged = () => load();

const start = (userId: string) => {
  if (currentUserId === userId) return;
  generation++;
  currentUserId = userId;
  lastCount = 0;
  load();
  schedule();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener(CHANGED_EVENT, onChanged);
};

const stop = () => {
  generation++;
  currentUserId = null;
  lastCount = 0;
  clearTimeout(timer);
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener(CHANGED_EVENT, onChanged);
};

export function useUnreadNotificationCount() {
  const { user } = useAuth();
  const userId = user ? String(user.id) : null;
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!userId) {
      setCount(0);
      return;
    }
    listeners.add(setCount);
    if (currentUserId === userId) setCount(lastCount);
    else start(userId);
    return () => {
      listeners.delete(setCount);
      if (listeners.size === 0) stop();
    };
  }, [userId]);

  return count;
}
