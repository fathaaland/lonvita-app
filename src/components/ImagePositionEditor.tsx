"use client";

import { useRef, useState } from "react";
import { Move } from "lucide-react";
import { cn } from "@/lib/utils";

export type ImagePosition = { x: number; y: number };

export const CENTERED_IMAGE_POSITION: ImagePosition = { x: 50, y: 50 };

const KEYBOARD_STEP = 5;

const clampPercent = (value: number) => Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;

interface Props {
  src: string;
  value: ImagePosition;
  onChange: (value: ImagePosition) => void;
  /** Sizing of the frame — must match the crop the photo is shown in (16:10 cards and detail). */
  className?: string;
}

/**
 * Brief §4 "Nahrání fotografie k akci, s pevně daným ořezem pro přehledovou stránku" — the organizer
 * chooses which part of the photo the fixed crop shows by pressing the mouse button (or a finger)
 * on it and dragging the photo where they want it. The result is a CSS object-position in percent,
 * stored on the event, so every same-ratio crop (dashboard cards, event detail) frames it the same.
 */
export function ImagePositionEditor({ src, value, onChange, className }: Props) {
  const imageRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ startX: number; startY: number; from: ImagePosition; overflowX: number; overflowY: number } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const image = imageRef.current;
    if (!image?.naturalWidth || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();

    // How far the covered photo overhangs the frame on each axis — dragging by exactly that many
    // pixels moves it from one edge to the other, so the photo tracks the pointer 1:1.
    const frame = e.currentTarget.getBoundingClientRect();
    const scale = Math.max(frame.width / image.naturalWidth, frame.height / image.naturalHeight);
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      from: value,
      overflowX: image.naturalWidth * scale - frame.width,
      overflowY: image.naturalHeight * scale - frame.height,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer already gone — nothing to capture.
    }
    setDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    // The photo moves with the pointer: dragging it right/down brings its left/top into view.
    const shift = (from: number, delta: number, overflow: number) =>
      overflow > 1 ? clampPercent(from - (delta / overflow) * 100) : from;
    onChange({
      x: shift(current.from.x, e.clientX - current.startX, current.overflowX),
      y: shift(current.from.y, e.clientY - current.startY, current.overflowY),
    });
  };

  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [KEYBOARD_STEP, 0],
      ArrowRight: [-KEYBOARD_STEP, 0],
      ArrowUp: [0, KEYBOARD_STEP],
      ArrowDown: [0, -KEYBOARD_STEP],
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    onChange({ x: clampPercent(value.x + move[0]), y: clampPercent(value.y + move[1]) });
  };

  return (
    <div
      role="group"
      tabIndex={0}
      aria-label="Výřez fotografie — přetáhněte fotku myší, prstem nebo šipkami"
      className={cn(
        "relative overflow-hidden rounded-2xl bg-muted touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-ring",
        dragging ? "cursor-grabbing" : "cursor-grab",
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
    >
      <img
        ref={imageRef}
        src={src}
        alt=""
        draggable={false}
        className="pointer-events-none h-full w-full object-cover"
        style={{ objectPosition: `${value.x}% ${value.y}%` }}
      />
      <span className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-card/95 px-3 py-1.5 text-xs font-semibold shadow">
        <Move className="h-3.5 w-3.5" /> Přetažením nastavte výřez
      </span>
    </div>
  );
}
