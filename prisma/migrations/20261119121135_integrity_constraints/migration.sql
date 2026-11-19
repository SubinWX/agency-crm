-- Integrity rules enforced by the database itself (not just the app).

-- Capacity can never be negative.
ALTER TABLE "CapacitySetting" ADD CONSTRAINT "capacity_non_negative" CHECK ("maxPerDay" >= 0);

-- Exactly one current version per image slot.
CREATE UNIQUE INDEX "work_image_one_current_version"
  ON "WorkImageVersion" ("imageId") WHERE "isCurrent";

-- A worker can only have one *active* assignment per work (history rows allowed).
CREATE UNIQUE INDEX "work_assignment_one_active"
  ON "WorkAssignment" ("workId", "workerId") WHERE "removedAt" IS NULL;

-- Capacity table is a singleton.
ALTER TABLE "CapacitySetting" ADD CONSTRAINT "capacity_singleton" CHECK ("id" = 1);
