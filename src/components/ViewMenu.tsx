import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  CalendarRange,
  Check,
  ChevronDown,
  List,
} from "lucide-react";

export type DisplayMode = "calendar" | "week" | "list";

export function ViewMenu({
  mode,
  mobile,
  onChange,
}: {
  mode: DisplayMode;
  mobile: boolean;
  onChange: (mode: DisplayMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const Icon =
    mode === "list" ? List : mode === "week" ? CalendarRange : CalendarDays;
  const items = [
    { id: "calendar" as const, label: "Calendrier", icon: CalendarDays },
    ...(!mobile
      ? [{ id: "week" as const, label: "Semaine", icon: CalendarRange }]
      : []),
    { id: "list" as const, label: "Liste", icon: List },
  ];

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div className="view-menu" ref={root}>
      <button
        ref={trigger}
        className="icon-button view-menu-trigger"
        aria-label="Choisir l’affichage"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "display-menu" : undefined}
        onClick={() => setOpen((previous) => !previous)}
      >
        <Icon size={21} />
        <ChevronDown size={11} />
      </button>
      {open && (
        <div
          ref={menu}
          id="display-menu"
          role="menu"
          aria-label="Affichage"
          className="view-dropdown"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
            if (event.key === "Tab") close();
            const buttons = [
              ...(menu.current?.querySelectorAll<HTMLButtonElement>(
                '[role="menuitemradio"]',
              ) || []),
            ];
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        buttons.length) %
                      buttons.length;
              buttons[next]?.focus();
            }
          }}
        >
          {items.map((item) => (
            <button
              key={item.id}
              role="menuitemradio"
              aria-checked={mode === item.id}
              tabIndex={-1}
              onClick={() => {
                onChange(item.id);
                close();
              }}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {mode === item.id && <Check size={17} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
