"use client";

import { useState } from "react";
import { Star } from "lucide-react";

const WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

/** Clickable 1–5 stars that fill a hidden `name` input. */
export function StarRatingInput({ name, defaultValue = 0 }: { name: string; defaultValue?: number }) {
  const [value, setValue] = useState(defaultValue);
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="flex items-center gap-3">
      <input type="hidden" name={name} value={value || ""} required />
      <div className="flex" role="radiogroup" aria-label="Rating" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            onClick={() => setValue(n)}
            onMouseEnter={() => setHover(n)}
            className="p-0.5 transition hover:scale-110"
          >
            <Star className={`h-8 w-8 ${n <= shown ? "fill-amber-400 text-amber-400" : "text-slate-300"}`} />
          </button>
        ))}
      </div>
      <span className="text-sm font-medium text-slate-600">{WORDS[shown]}</span>
    </div>
  );
}

/** Read-only stars. */
export function Stars({ value, size = "h-4 w-4" }: { value: number; size?: string }) {
  return (
    <span className="inline-flex" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => <Star key={n} className={`${size} ${n <= value ? "fill-amber-400 text-amber-400" : "text-slate-300"}`} />)}
    </span>
  );
}
