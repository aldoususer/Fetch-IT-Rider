"use client";

// Minimal signature pad — captures pointer events and outputs an SVG path
// string that can be POSTed to /api/bookings/[id]/proof.

import { useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";

type Point = { x: number; y: number };

export function SignaturePad({
  onChange,
  height = 160,
}: {
  onChange: (svgPath: string | null) => void;
  height?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drawing = useRef(false);
  // Rendered strokes (committed) + the in-progress stroke.
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [current, setCurrent] = useState<Point[]>([]);

  function getPoint(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 300;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
  }

  function start(e: React.PointerEvent<SVGSVGElement>) {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    drawing.current = true;
    setCurrent([getPoint(e)]);
  }

  function move(e: React.PointerEvent<SVGSVGElement>) {
    if (!drawing.current) return;
    e.preventDefault();
    setCurrent((prev) => [...prev, getPoint(e)]);
  }

  function end(e: React.PointerEvent<SVGSVGElement>) {
    if (!drawing.current) return;
    e.preventDefault();
    drawing.current = false;
    setStrokes((prev) => {
      const next = current.length > 1 ? [...prev, current] : prev;
      commitChange(next);
      return next;
    });
    setCurrent([]);
  }

  function commitChange(all: Point[][]) {
    if (all.length === 0) {
      onChange(null);
      return;
    }
    const svg = all
      .map((stroke) => {
        if (stroke.length === 0) return "";
        const d = stroke
          .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
          .join(" ");
        return `<path d="${d}" stroke="#1f2937" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />`;
      })
      .join("");
    onChange(svg);
  }

  function clear() {
    setStrokes([]);
    setCurrent([]);
    onChange(null);
  }

  function renderStroke(stroke: Point[], key: string) {
    if (stroke.length === 0) return null;
    const d = stroke
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
      .join(" ");
    return (
      <path
        key={key}
        d={d}
        stroke="#1f2937"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }

  return (
    <div className="space-y-2">
      <div
        className="relative rounded-lg border-2 border-dashed bg-card overflow-hidden touch-none"
        style={{ height }}
      >
        <svg
          ref={svgRef}
          viewBox="0 0 300 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full touch-none cursor-crosshair"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
        >
          {strokes.map((s, i) => renderStroke(s, `s-${i}`))}
          {renderStroke(current, "cur")}
        </svg>
        <div className="absolute bottom-1 left-2 text-xs text-muted-foreground pointer-events-none">
          Sign here
        </div>
        <div className="absolute bottom-1 right-2" style={{ lineHeight: 0 }}>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-7 w-7"
            onClick={clear}
            title="Clear"
          >
            <Eraser className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
