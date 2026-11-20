"use client";

import { useState } from "react";
import { ImageInput } from "./image-input";
import { DefaultAvatarIcon, PersonAvatar, type GenderValue } from "./person-avatar";

/** Photo upload + Male/Female choice. The preview icon switches as soon as a gender is picked. */
export function PhotoGenderFields({ photo, gender, name }: { photo?: string | null; gender?: GenderValue; name?: string }) {
  const [g, setG] = useState<GenderValue>(gender ?? null);
  const [removing, setRemoving] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
      <PersonAvatar src={removing ? null : photo} gender={g} name={name} size={80} className="ring-4 ring-slate-100" />
      <div className="min-w-[14rem] flex-1 space-y-3">
        <div>
          <span className="label">Photo</span>
          <ImageInput name="photo" aspect={1} maxEdge={800} label={photo ? "Change photo" : "Add photo"} hint="Optional. Without a photo, the icon is shown." />
          {photo && (
            <label className="mt-1 flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" name="removePhoto" checked={removing} onChange={(e) => setRemoving(e.target.checked)} /> Remove photo
            </label>
          )}
        </div>
        <fieldset>
          <legend className="label">Gender</legend>
          <div className="flex flex-wrap gap-2">
            {([["MALE", "Male"], ["FEMALE", "Female"], ["", "Not set"]] as const).map(([v, l]) => (
              <label key={l} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                <input type="radio" name="gender" value={v} checked={(g ?? "") === v} onChange={() => setG((v || null) as GenderValue)} className="h-3.5 w-3.5" />
                <DefaultAvatarIcon gender={(v || null) as GenderValue} size={22} /> {l}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </div>
  );
}
