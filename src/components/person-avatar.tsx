/**
 * Round profile picture. Without a photo it shows a default icon that follows
 * the person's gender (male / female / not set). Works in server and client components.
 */
export type GenderValue = "MALE" | "FEMALE" | null | undefined;

const TONES = {
  MALE: { bg: "#dbeafe", fg: "#2563eb" },
  FEMALE: { bg: "#fce7f3", fg: "#db2777" },
  NONE: { bg: "#e2e8f0", fg: "#64748b" },
};

export function DefaultAvatarIcon({ gender, size = 40, className = "" }: { gender?: GenderValue; size?: number; className?: string }) {
  const t = TONES[gender ?? "NONE"];
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={`shrink-0 rounded-full ${className}`} role="img" aria-label={gender === "MALE" ? "Male" : gender === "FEMALE" ? "Female" : "Person"}>
      <circle cx="32" cy="32" r="32" fill={t.bg} />
      {gender === "FEMALE" && (
        // long hair behind the head and shoulders
        <path d="M17 31c0-11 6.5-18 15-18s15 7 15 18v13c0 2-1.5 3-3 3H20c-1.5 0-3-1-3-3V31z" fill={t.fg} opacity="0.85" />
      )}
      {/* shoulders */}
      <path d="M10 60c0-11.5 9.8-19 22-19s22 7.5 22 19v4H10v-4z" fill={t.fg} />
      {/* neck + head */}
      <rect x="27" y="34" width="10" height="9" rx="3" fill="#fde7d4" />
      <circle cx="32" cy="27" r="11" fill="#fde7d4" />
      {gender === "MALE" && <path d="M21 26c0-8 5-12.5 11-12.5S43 18 43 26c-2.2-3.4-5.8-5.2-11-5.2S23.2 22.6 21 26z" fill={t.fg} />}
      {gender === "FEMALE" && <path d="M20.6 28c0-9 5.2-14 11.4-14s11.4 5 11.4 14c-3-1-6.8-4.2-8.4-8.2-2.6 4.4-8.6 7.2-14.4 8.2z" fill={t.fg} />}
      {!gender && <path d="M21.4 25.5C22 18.5 26.4 15 32 15s10 3.5 10.6 10.5C39.5 22.5 36 21.4 32 21.4s-7.5 1.1-10.6 4.1z" fill={t.fg} opacity="0.7" />}
    </svg>
  );
}

export function PersonAvatar({ src, name, gender, size = 40, className = "" }: { src?: string | null; name?: string; gender?: GenderValue; size?: number; className?: string }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name ?? ""} width={size} height={size} className={`shrink-0 rounded-full object-cover ${className}`} style={{ width: size, height: size }} />;
  }
  return <DefaultAvatarIcon gender={gender} size={size} className={className} />;
}

/** Male / Female / Not set selector for forms. */
export function GenderField({ value, name = "gender" }: { value?: GenderValue; name?: string }) {
  return (
    <fieldset>
      <legend className="label">Gender</legend>
      <div className="flex gap-2">
        {([["MALE", "Male"], ["FEMALE", "Female"], ["", "Not set"]] as const).map(([v, l]) => (
          <label key={l} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
            <input type="radio" name={name} value={v} defaultChecked={(value ?? "") === v} className="h-3.5 w-3.5" />
            <DefaultAvatarIcon gender={(v || null) as GenderValue} size={20} /> {l}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
