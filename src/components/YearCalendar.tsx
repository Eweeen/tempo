import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { dateKey, monthCells } from "../lib/calendar";

const WINDOW_SIZE = 7;
const WINDOW_STEP = 2;
const WINDOW_OFFSET = Math.floor(WINDOW_SIZE / 2);

interface Props {
  year: number;
  navigationKey: number;
  onSelectMonth: (date: Date) => void;
  onVisibleYear: (year: number) => void;
}

type ScrollTarget =
  | { kind: "year"; year: number }
  | { kind: "anchor"; year: number; offset: number };

function YearSection({
  year,
  onSelectMonth,
}: Pick<Props, "year" | "onSelectMonth">) {
  const now = new Date();
  const today = dateKey(now);
  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, month) => {
        const date = new Date(year, month, 1);
        return {
          date,
          name: date.toLocaleDateString("fr-FR", { month: "long" }),
          cells: monthCells(date),
        };
      }),
    [year],
  );

  return (
    <section
      className="calendar-year"
      data-year={year}
      aria-label={`Année ${year}`}
    >
      <h2 className="year-heading">{year}</h2>
      <div className="year-grid">
        {months.map(({ date, name, cells }) => (
          <button
            className="year-month"
            key={date.getMonth()}
            aria-label={`Ouvrir ${name} ${year}`}
            onClick={() => onSelectMonth(date)}
          >
            <span
              className={`year-month-name${year === now.getFullYear() && date.getMonth() === now.getMonth() ? " is-current" : ""}`}
            >
              {name}
            </span>
            <span className="year-month-grid" aria-hidden="true">
              {cells.map((day, index) => (
                <span
                  className={`year-date ${day && dateKey(day) === today ? "today" : ""}`}
                  key={index}
                >
                  {day?.getDate()}
                </span>
              ))}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Keep a bounded year window, preserving the visible position as it moves. */
export function YearCalendar({
  year,
  navigationKey,
  onVisibleYear,
  onSelectMonth,
}: Props) {
  const [firstYear, setFirstYear] = useState(year - WINDOW_OFFSET);
  const scroller = useRef<HTMLDivElement>(null);
  const pending = useRef<ScrollTarget | null>({ kind: "year", year });
  const lastNavigation = useRef(navigationKey);
  const lastVisible = useRef(year);
  const frame = useRef(0);
  const visibleCallback = useRef(onVisibleYear);
  visibleCallback.current = onVisibleYear;

  useLayoutEffect(() => {
    if (lastNavigation.current === navigationKey) return;
    lastNavigation.current = navigationKey;
    pending.current = { kind: "year", year };
    setFirstYear(year - WINDOW_OFFSET);
  }, [navigationKey, year]);

  useLayoutEffect(() => {
    const container = scroller.current;
    const target = pending.current;
    if (!container || !target) return;
    if (target.kind === "year" && firstYear !== target.year - WINDOW_OFFSET)
      return;
    const element = container.querySelector<HTMLElement>(
      `[data-year="${target.year}"]`,
    );
    if (!element) return;
    container.scrollTop +=
      element.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      (target.kind === "anchor" ? target.offset : 0);
    if (target.kind === "year") lastVisible.current = target.year;
    pending.current = null;
  }, [firstYear, navigationKey]);

  useLayoutEffect(() => () => cancelAnimationFrame(frame.current), []);

  const handleScroll = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const container = scroller.current;
      if (!container || pending.current) return;
      const top = container.getBoundingClientRect().top;
      const sections = [
        ...container.querySelectorAll<HTMLElement>("[data-year]"),
      ];
      const anchor = sections.find(
        (node) => node.getBoundingClientRect().bottom > top + 1,
      );
      const visible = sections.find(
        (node) => node.getBoundingClientRect().bottom > top + 60,
      );
      if (!anchor || !visible) return;
      const visibleYear = Number(visible.dataset.year);
      if (visibleYear !== lastVisible.current) {
        lastVisible.current = visibleYear;
        visibleCallback.current(visibleYear);
      }
      const threshold = container.clientHeight;
      const shift =
        container.scrollTop < threshold
          ? -WINDOW_STEP
          : container.scrollHeight -
                container.scrollTop -
                container.clientHeight <
              threshold
            ? WINDOW_STEP
            : 0;
      if (!shift) return;
      pending.current = {
        kind: "anchor",
        year: Number(anchor.dataset.year),
        offset: anchor.getBoundingClientRect().top - top,
      };
      setFirstYear((previous) => previous + shift);
    });
  };

  return (
    <div
      className="year-view"
      ref={scroller}
      onScroll={handleScroll}
      aria-label="Années défilantes"
      tabIndex={0}
    >
      {Array.from({ length: WINDOW_SIZE }, (_, index) => (
        <YearSection
          key={firstYear + index}
          year={firstYear + index}
          onSelectMonth={onSelectMonth}
        />
      ))}
    </div>
  );
}
