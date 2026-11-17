import { useMemo } from "react";
import { useCalendarWindow } from "../hooks/useCalendarWindow";
import { dateKey, monthCells } from "../lib/calendar";

const WINDOW_SIZE = 7;
const WINDOW_STEP = 2;

interface Props {
  year: number;
  navigationKey: number;
  onSelectMonth: (date: Date) => void;
  onVisibleYear: (year: number) => void;
}

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
  const { firstIndex: firstYear, scrollProps } = useCalendarWindow({
    index: year,
    navigationKey,
    size: WINDOW_SIZE,
    step: WINDOW_STEP,
    attribute: "data-year",
    onVisibleIndex: onVisibleYear,
  });

  return (
    <div
      className="year-view"
      {...scrollProps}
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
