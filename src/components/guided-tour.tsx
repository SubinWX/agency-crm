"use client";

import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { usePathname } from "next/navigation";
import { useCallback, useEffect } from "react";
import { TOURS, type TourPortal } from "./tour-steps";

export const START_TOUR_EVENT = "crm:start-tour";
const seenKey = (userId: string) => `crm.tour.v1.${userId}`;

/** Start the tour from anywhere (Help page, profile menu). */
export function startTour() {
  window.dispatchEvent(new Event(START_TOUR_EVENT));
}

const visible = (el: Element | null) => !!el && (el as HTMLElement).offsetParent !== null;

/**
 * Guided tour. Auto-starts once per user per browser on their home page;
 * can be restarted any time. Steps for elements that aren't visible (no
 * permission, collapsed on a phone) are skipped.
 */
export function GuidedTour({ portal, userId, homePath }: { portal: TourPortal; userId: string; homePath: string }) {
  const path = usePathname();

  const run = useCallback(() => {
    const steps = TOURS[portal]
      .filter((s) => !s.el || visible(document.querySelector(`[data-tour="${s.el}"]`)))
      .map((s) => ({
        ...(s.el ? { element: `[data-tour="${s.el}"]` } : {}),
        popover: { title: s.title, description: s.body },
      }));
    const d = driver({
      showProgress: true,
      animate: true,
      overlayOpacity: 0.55,
      stagePadding: 6,
      stageRadius: 10,
      popoverClass: "crm-tour",
      nextBtnText: "Next →",
      prevBtnText: "← Back",
      doneBtnText: "Finish",
      progressText: "{{current}} of {{total}}",
      steps,
      onDestroyed: () => {
        try {
          localStorage.setItem(seenKey(userId), new Date().toISOString());
        } catch {
          /* storage blocked — the tour may show again, that's fine */
        }
      },
    });
    d.drive();
  }, [portal, userId]);

  useEffect(() => {
    const onStart = () => run();
    window.addEventListener(START_TOUR_EVENT, onStart);
    return () => window.removeEventListener(START_TOUR_EVENT, onStart);
  }, [run]);

  // First visit to the home page → show the tour once.
  useEffect(() => {
    if (path !== homePath) return;
    let seen = true;
    try {
      seen = !!localStorage.getItem(seenKey(userId));
    } catch {
      seen = true;
    }
    if (seen) return;
    const t = setTimeout(run, 900);
    return () => clearTimeout(t);
  }, [path, homePath, userId, run]);

  return null;
}
