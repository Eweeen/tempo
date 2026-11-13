import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Plus } from "lucide-react";
import type { CalendarEvent, Category, Settings } from "../types";
import {
  dateKey,
  frenchHolidays,
  getOccurrences,
  monthCells,
} from "../lib/calendar";

const WINDOW_SIZE = 9;
const WINDOW_STEP = 3;
const monthIndex = (date: Date) => date.getFullYear() * 12 + date.getMonth();
const monthAt = (index: number) =>
  new Date(Math.floor(index / 12), index % 12, 1);
const label = (date: Date) =>
  date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
const dayLabel = (date: Date) =>
  date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
const colorStyle = (color: string): CSSProperties =>
  ({ "--event-color": color }) as CSSProperties;

interface Props {
  date: Date;
  navigationKey: number;
  continuous: boolean;
  events: CalendarEvent[];
  categories: Category[];
  settings: Settings;
  onVisibleMonth: (date: Date) => void;
  onOpenDay: (date: Date) => void;
  onEdit: (event: CalendarEvent) => void;
  onCreate: (date: Date) => void;
}

type ScrollTarget =
  | { kind: "month"; index: number }
  | { kind: "anchor"; index: number; offset: number };

function MonthSection({ month, ...props }: Props & { month: Date }) {
  const cells = useMemo(() => monthCells(month), [+month]);
  const occurrences = useMemo(
    () =>
      getOccurrences(
        props.events,
        month,
        new Date(month.getFullYear(), month.getMonth() + 1, 1),
      ),
    [props.events, +month],
  );
  const holidays = useMemo(
    () =>
      new Map(
        props.settings.showHolidays
          ? frenchHolidays(month.getFullYear(), props.settings.region).map(
              (h) => [h.date, h.name],
            )
          : [],
      ),
    [month.getFullYear(), props.settings.showHolidays, props.settings.region],
  );
  const categories = useMemo(
    () => new Map(props.categories.map((c) => [c.id, c])),
    [props.categories],
  );
  const today = dateKey(new Date());

  return (
    <section
      className="calendar-month"
      data-month={monthIndex(month)}
      aria-label={label(month)}
    >
      <h2 className="month-heading">{label(month)}</h2>
      <div
        className="month-grid"
        style={{ "--month-weeks": cells.length / 7 } as CSSProperties}
      >
        {cells.map((day, index) => {
          if (!day)
            return (
              <div
                className="month-blank"
                key={`empty-${index}`}
                aria-hidden="true"
              />
            );
          const key = dateKey(day);
          const end = dateKey(
            new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1),
          );
          const items = occurrences.filter(
            (o) => o.start < `${end}T00:00` && o.end > `${key}T00:00`,
          );
          const holiday = holidays.get(key);
          // Keep three readable rows; a holiday occupies one of them.
          const limit = holiday ? 2 : 3;
          const remaining = Math.max(0, items.length - limit);
          return (
            <div
              key={key}
              data-date={key}
              className={`month-cell ${index % 7 > 4 ? "weekend" : ""}`}
            >
              <div className="cell-top">
                <button
                  className={`day-number ${key === today ? "today" : ""}`}
                  aria-label={`Sélectionner le ${dayLabel(day)}${holiday ? ` · ${holiday}` : ""}`}
                  onClick={() => props.onOpenDay(day)}
                >
                  {day.getDate()}
                </button>
                {!props.continuous && (
                  <button
                    className="cell-add"
                    aria-label={`Ajouter un événement le ${dayLabel(day)}`}
                    onClick={() => props.onCreate(day)}
                  >
                    <Plus size={13} />
                  </button>
                )}
              </div>
              <div className="cell-events">
                {holiday && (
                  <button
                    className="holiday-chip"
                    title={holiday}
                    onClick={() => props.onOpenDay(day)}
                  >
                    {holiday}
                  </button>
                )}
                {items.slice(0, limit).map((o) => (
                  <button
                    key={o.key}
                    className={`event-chip ${o.event.allDay ? "all-day" : ""}`}
                    style={colorStyle(
                      categories.get(o.event.categoryId)?.color || "#8b7ac3",
                    )}
                    aria-label={`${o.event.title} · ${o.event.allDay ? "Toute la journée" : o.start.slice(11, 16)}`}
                    title={o.event.title}
                    onClick={() =>
                      props.continuous
                        ? props.onOpenDay(day)
                        : props.onEdit(o.event)
                    }
                  >
                    <span className="event-chip-dot" />
                    <strong>{o.event.title}</strong>
                    {!o.event.allDay && (
                      <time>
                        {o.start.slice(11, 16).replace(":", "h")}
                        {o.event.timezone === "UTC" ? " UTC" : ""}
                      </time>
                    )}
                  </button>
                ))}
              </div>
              {remaining > 0 && (
                <button
                  className="more-events"
                  aria-label={`Voir les ${items.length} événements du ${dayLabel(day)}`}
                  onClick={() => props.onOpenDay(day)}
                >
                  +{remaining}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Bidirectional month window: retain nine months and preserve the visible anchor. */
export function MonthCalendar(props: Props) {
  const { continuous, date, navigationKey, onVisibleMonth } = props;
  const [firstMonth, setFirstMonth] = useState(() => monthIndex(date) - 4);
  const scroller = useRef<HTMLDivElement>(null);
  const pending = useRef<ScrollTarget | null>({
    kind: "month",
    index: monthIndex(date),
  });
  const lastNavigation = useRef(navigationKey);
  const lastVisible = useRef(monthIndex(date));
  const frame = useRef(0);
  const visibleCallback = useRef(onVisibleMonth);
  visibleCallback.current = onVisibleMonth;

  useLayoutEffect(() => {
    if (lastNavigation.current === navigationKey) return;
    lastNavigation.current = navigationKey;
    pending.current = { kind: "month", index: monthIndex(date) };
    setFirstMonth(monthIndex(date) - 4);
  }, [navigationKey, date]);

  useLayoutEffect(() => {
    const container = scroller.current;
    const target = pending.current;
    if (!continuous || !container || !target) return;
    if (target.kind === "month" && firstMonth !== target.index - 4) return;
    const element = container.querySelector<HTMLElement>(
      `[data-month="${target.index}"]`,
    );
    if (!element) return;
    container.scrollTop +=
      element.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      (target.kind === "anchor" ? target.offset : 0);
    pending.current = null;
  }, [firstMonth, navigationKey, continuous]);

  useLayoutEffect(() => () => cancelAnimationFrame(frame.current), []);

  const handleScroll = () => {
    if (!continuous || frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const container = scroller.current;
      if (!container || pending.current) return;
      const top = container.getBoundingClientRect().top;
      const sections = [
        ...container.querySelectorAll<HTMLElement>("[data-month]"),
      ];
      const anchor = sections.find(
        (node) => node.getBoundingClientRect().bottom > top + 1,
      );
      const visible = sections.find(
        (node) => node.getBoundingClientRect().bottom > top + 60,
      );
      if (!anchor || !visible) return;
      const index = Number(visible.dataset.month);
      if (index !== lastVisible.current) {
        lastVisible.current = index;
        visibleCallback.current(monthAt(index));
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
        index: Number(anchor.dataset.month),
        offset: anchor.getBoundingClientRect().top - top,
      };
      setFirstMonth((previous) => previous + shift);
    });
  };

  const months = continuous
    ? Array.from({ length: WINDOW_SIZE }, (_, index) =>
        monthAt(firstMonth + index),
      )
    : [new Date(date.getFullYear(), date.getMonth(), 1)];
  return (
    <div className={`month-calendar ${continuous ? "continuous" : ""}`}>
      <div className="month-weekdays">
        {["Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam.", "Dim."].map(
          (day, i) => (
            <div key={day} className={i > 4 ? "weekend" : ""}>
              {day}
            </div>
          ),
        )}
      </div>
      <div
        className="months-scroll"
        ref={scroller}
        onScroll={handleScroll}
        aria-label={continuous ? "Mois défilants" : "Mois"}
        tabIndex={continuous ? 0 : undefined}
      >
        {months.map((month) => (
          <MonthSection {...props} key={monthIndex(month)} month={month} />
        ))}
      </div>
    </div>
  );
}
