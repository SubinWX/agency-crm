"use client";

import { startTour } from "./guided-tour";

export function TourButton({ light = false }: { light?: boolean }) {
  return (
    <button type="button" onClick={startTour} className={light ? "btn bg-white text-slate-900 hover:bg-indigo-50" : "btn-primary"}>
      ✨ Take the guided tour
    </button>
  );
}
