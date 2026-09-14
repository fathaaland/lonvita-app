"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const ZOOM = 1.3;
/** Finger travel (px) under which a touch counts as a tap rather than a drag. */
const TAP_SLOP_PX = 6;

interface Props {
  src: string;
  alt: string;
  /** Sizing of the frame, e.g. an aspect ratio — the photo is cropped to fill it. */
  className?: string;
}

type Position = { x: number; y: number };

const CENTER: Position = { x: 50, y: 50 };
const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

/**
 * Event cover photo that can be explored beyond its fixed crop (e.g. a portrait photo in a 16:10
 * frame) — zoomed in slightly and panned:
 * - mouse/pen: follows the hover position — pointing at the top edge shows the top of the photo;
 *   leaving the frame eases back to the centred crop.
 * - touch: drag the photo like a map (it moves with the finger); it stays where it was left so the
 *   finger doesn't cover it, and a quick tap puts it back to the centre. A drag that starts on the
 *   photo pans it instead of scrolling the page.
 */
export function PannableImage({ src, alt, className }: Props) {
  const [active, setActive] = useState(false);
  // Last pan position. Kept after deactivating so the zoom eases out around the same point
  // instead of jumping to the centre first.
  const [position, setPosition] = useState<Position>(CENTER);
  const [reducedMotion, setReducedMotion] = useState(false);
  const drag = useRef<{ startX: number; startY: number; from: Position; moved: boolean } | null>(null);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = () => setReducedMotion(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "touch") return;
    try {
      // Keep receiving moves when the finger slides past the frame's edge.
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer already gone — nothing to capture.
    }
    drag.current = { startX: e.clientX, startY: e.clientY, from: active ? position : CENTER, moved: false };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();

    if (e.pointerType !== "touch") {
      setPosition({
        x: clampPercent(((e.clientX - rect.left) / rect.width) * 100),
        y: clampPercent(((e.clientY - rect.top) / rect.height) * 100),
      });
      setActive(true);
      return;
    }

    const current = drag.current;
    if (!current) return;
    const dx = e.clientX - current.startX;
    const dy = e.clientY - current.startY;
    if (!current.moved && Math.abs(dx) + Math.abs(dy) < TAP_SLOP_PX) return;
    current.moved = true;
    // The photo moves with the finger: dragging right/down reveals more of its left/top.
    setPosition({
      x: clampPercent(current.from.x - (dx / rect.width) * 100),
      y: clampPercent(current.from.y - (dy / rect.height) * 100),
    });
    setActive(true);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "touch") return;
    const wasTap = drag.current && !drag.current.moved;
    drag.current = null;
    if (wasTap) setActive(false);
  };

  const zoom = active && !reducedMotion ? ZOOM : 1;

  return (
    <div
      className={cn("relative overflow-hidden bg-muted touch-none", className)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        drag.current = null;
      }}
      // A touch pointer also "leaves" when the finger lifts — only the mouse resets on leave.
      onPointerLeave={(e) => {
        if (e.pointerType !== "touch") setActive(false);
      }}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        width={512}
        height={320}
        className={cn("h-full w-full select-none object-cover will-change-transform", active && "cursor-move")}
        style={{
          objectPosition: active ? `${position.x}% ${position.y}%` : "50% 50%",
          transform: `scale(${zoom})`,
          transformOrigin: `${position.x}% ${position.y}%`,
          WebkitTouchCallout: "none",
          // While panning the photo follows the pointer directly; only the zoom itself and the way
          // back to centre are animated.
          transition: reducedMotion
            ? "none"
            : active
              ? "transform 300ms ease-out"
              : "transform 300ms ease-out, object-position 500ms ease-out",
        }}
      />
    </div>
  );
}
