"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";

/**
 * Text box with a dropdown of existing values. Pick one, or type a new value.
 * Replaces the browser's <datalist>, which looks and behaves differently in each browser.
 */
export function ComboInput({ name, options, defaultValue = "", placeholder, newLabel = "Add new" }: { name: string; options: string[]; defaultValue?: string; placeholder?: string; newLabel?: string }) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [typed, setTyped] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  const q = value.trim().toLowerCase();
  // Show everything when the box was just opened; filter once the user types.
  const matches = typed && q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  const exact = options.some((o) => o.toLowerCase() === q);
  const items = [...matches.map((o) => ({ kind: "pick" as const, v: o })), ...(q && !exact ? [{ kind: "new" as const, v: value.trim() }] : [])];

  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const choose = (v: string) => {
    setValue(v);
    setOpen(false);
    setTyped(false);
    setActive(-1);
  };

  return (
    <div ref={box} className="relative">
      <input
        name={name}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        className="input pr-10"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setValue(e.target.value);
          setTyped(true);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(items.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(-1, a - 1));
          } else if (e.key === "Enter" && open && active >= 0 && items[active]) {
            e.preventDefault();
            choose(items[active].v);
          } else if (e.key === "Escape" || e.key === "Tab") {
            setOpen(false);
          }
        }}
      />
      <button type="button" tabIndex={-1} aria-label="Show options" onClick={() => { setOpen((o) => !o); setTyped(false); }} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500 hover:text-slate-700">
        <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && items.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
          {items.map((it, i) => (
            <li
              key={`${it.kind}-${it.v}`}
              role="option"
              aria-selected={it.v === value}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(it.v);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-2 px-3 py-2 ${i === active ? "bg-blue-50 text-blue-800" : "text-slate-700"}`}
            >
              {it.kind === "new" ? (
                <><Plus className="h-4 w-4 text-blue-600" /><span>{newLabel} “<b>{it.v}</b>”</span></>
              ) : (
                <><span className="flex-1">{it.v}</span>{it.v === value && <Check className="h-4 w-4 text-blue-600" />}</>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
