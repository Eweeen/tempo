import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CalendarEvent, Category, Occurrence, Settings } from "../types";
import {
  addDays,
  dateKey,
  frenchHolidays,
  getOccurrences,
  startOfWeek,
} from "../lib/calendar";

const dayLabel = (date: Date) =>
  date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
const colorStyle = (color: string): CSSProperties =>
  ({ "--event-color": color }) as CSSProperties;
const timeLabel = (event: Occurrence) =>
  `${event.start.slice(11, 16)} – ${event.end.slice(11, 16)}${event.event.timezone === "UTC" ? " UTC" : ""}`;
const HOUR_HEIGHT = 64;

function layoutEvents(events: Occurrence[], day: Date) {
  const key = dateKey(day);
  const items = events
    .filter((o) => !o.event.allDay)
    .map((o) => ({
      o,
      start:
        o.start.slice(0, 10) < key
          ? 0
          : +o.start.slice(11, 13) * 60 + +o.start.slice(14, 16),
      end:
        o.end.slice(0, 10) > key
          ? 1440
          : +o.end.slice(11, 13) * 60 + +o.end.slice(14, 16),
      lane: 0,
      lanes: 1,
    }));
  let group: typeof items = [];
  let groupEnd = -1;
  const finish = () => {
    const lanes = Math.max(1, ...group.map((item) => item.lane + 1));
    group.forEach((item) => {
      item.lanes = lanes;
    });
    group = [];
  };
  items.forEach((item) => {
    if (item.start >= groupEnd) {
      finish();
      groupEnd = -1;
    }
    const used = new Set(
      group
        .filter((previous) => previous.end > item.start)
        .map((previous) => previous.lane),
    );
    while (used.has(item.lane)) item.lane++;
    group.push(item);
    groupEnd = Math.max(groupEnd, item.end);
  });
  finish();
  return items;
}

interface Props {
  date: Date;
  events: CalendarEvent[];
  categories: Category[];
  settings: Settings;
  onNavigate: (direction: number) => void;
  onEdit: (event: CalendarEvent) => void;
  onCreate: (date: Date) => void;
}

export function DayCalendar({
  date,
  events,
  categories,
  settings,
  onNavigate,
  onEdit,
  onCreate,
}: Props) {
  const scroll = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    horizontal: boolean;
  } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const suppressClickUntil = useRef(0);
  const [drag, setDrag] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [visibleTop, setVisibleTop] = useState(0);
  const days = useMemo(
    () =>
      [-1, 0, 1].map((offset) => {
        const day = addDays(
          new Date(date.getFullYear(), date.getMonth(), date.getDate()),
          offset,
        );
        return {
          day,
          offset,
          occurrences: getOccurrences(events, day, addDays(day, 1)),
        };
      }),
    [events, +date],
  );
  const current = days[1];
  const allDay = current.occurrences.filter((o) => o.event.allDay);
  const holiday = settings.showHolidays
    ? frenchHolidays(date.getFullYear(), settings.region).find(
        (h) => h.date === dateKey(date),
      )
    : undefined;
  const colors = useMemo(
    () => new Map(categories.map((c) => [c.id, c.color])),
    [categories],
  );
  const week = Array.from({ length: 7 }, (_, index) =>
    addDays(startOfWeek(date), index),
  );

  useEffect(() => {
    const first = current.occurrences.find((o) => !o.event.allDay);
    const hour =
      first && first.start.slice(0, 10) === dateKey(date)
        ? Math.max(0, +first.start.slice(11, 13) - 1)
        : 7;
    if (scroll.current) scroll.current.scrollTop = hour * HOUR_HEIGHT;
    // Preserve the vertical reading position when moving between adjacent days.
  }, []);
  useEffect(() => {
    clearTimeout(timer.current);
    gesture.current = null;
    setDrag(0);
    setAnimating(false);
    return () => clearTimeout(timer.current);
  }, [+date]);

  const reset = () => {
    gesture.current = null;
    setDrag(0);
  };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || animating) return;
    gesture.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      horizontal: false,
    };
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = gesture.current;
    if (!active || event.pointerId !== active.id || animating) return;
    const dx = event.clientX - active.x,
      dy = event.clientY - active.y;
    if (
      !active.horizontal &&
      Math.abs(dy) > 12 &&
      Math.abs(dy) > Math.abs(dx)
    ) {
      reset();
      return;
    }
    if (
      !active.horizontal &&
      Math.abs(dx) > 12 &&
      Math.abs(dx) > Math.abs(dy) * 1.3
    ) {
      active.horizontal = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (active.horizontal) {
      const width = viewport.current?.clientWidth || 390;
      setDrag(Math.max(-width, Math.min(width, dx)));
    }
  };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const active = gesture.current;
    if (!active || event.pointerId !== active.id) return;
    gesture.current = null;
    if (!active.horizontal) return;
    suppressClickUntil.current = performance.now() + 400;
    const dx = event.clientX - active.x,
      width = viewport.current?.clientWidth || 390;
    const direction =
      Math.abs(dx) > Math.max(45, width * 0.17) ? (dx < 0 ? 1 : -1) : 0;
    setAnimating(true);
    setDrag(direction ? -direction * width : 0);
    const duration = matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : 180;
    timer.current = window.setTimeout(() => {
      setAnimating(false);
      setDrag(0);
      if (direction) onNavigate(direction);
    }, duration);
  };

  return (
    <div
      className="day-view"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={reset}
      onClickCapture={(event) => {
        if (performance.now() < suppressClickUntil.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          if (!animating) onNavigate(event.key === "ArrowLeft" ? -1 : 1);
        }
      }}
    >
      <nav className="day-week-strip" aria-label="Semaine du jour sélectionné">
        {week.map((day, index) => (
          <button
            key={dateKey(day)}
            className={`${dateKey(day) === dateKey(date) ? "is-selected" : ""} ${dateKey(day) === dateKey(new Date()) ? "is-today" : ""}`}
            aria-label={`Afficher ${dayLabel(day)}`}
            aria-pressed={dateKey(day) === dateKey(date)}
            disabled={animating}
            onClick={() => {
              const offset = index - ((date.getDay() + 6) % 7);
              if (offset) onNavigate(offset);
            }}
          >
            <span className="day-week-label">
              {day.toLocaleDateString("fr-FR", { weekday: "short" })}
            </span>
            <span className="day-week-number">{day.getDate()}</span>
          </button>
        ))}
      </nav>
      <header className="day-navigation">
        <button
          className="icon-button"
          aria-label="Jour précédent"
          disabled={animating}
          onClick={() => onNavigate(-1)}
        >
          <ChevronLeft size={21} />
        </button>
        <h2 aria-live="polite">{dayLabel(date)}</h2>
        <button
          className="icon-button"
          aria-label="Jour suivant"
          disabled={animating}
          onClick={() => onNavigate(1)}
        >
          <ChevronRight size={21} />
        </button>
      </header>
      {(holiday || allDay.length > 0) && (
        <div className="day-all-day">
          <span>Journée</span>
          <div>
            {holiday && <p className="holiday-chip">{holiday.name}</p>}
            {allDay.map((o) => (
              <button
                key={o.key}
                className="event-chip all-day"
                style={colorStyle(colors.get(o.event.categoryId) || "#8b7ac3")}
                onClick={() => onEdit(o.event)}
              >
                <strong>{o.event.title}</strong>
              </button>
            ))}
          </div>
        </div>
      )}
      <div
        className="day-scroll"
        ref={scroll}
        onScroll={(event) =>
          setVisibleTop(Math.floor(event.currentTarget.scrollTop))
        }
      >
        <div className="day-pager" ref={viewport}>
          <div
            className={`day-track ${animating ? "animating" : ""}`}
            style={{ transform: `translateX(calc(-100% / 3 + ${drag}px))` }}
          >
            {days.map(({ day, offset, occurrences }) => (
              <section
                className="day-page"
                key={offset}
                aria-label={dayLabel(day)}
                aria-hidden={offset !== 0}
                inert={offset !== 0}
                data-active={offset === 0}
              >
                <div className="day-hour-labels">
                  {Array.from({ length: 24 }, (_, hour) => (
                    <span key={hour} style={{ top: hour * HOUR_HEIGHT }}>
                      {String(hour).padStart(2, "0")}:00
                    </span>
                  ))}
                </div>
                <div className="day-hours">
                  {Array.from({ length: 24 }, (_, hour) => (
                    <button
                      key={hour}
                      className="day-hour-slot"
                      aria-label={`Ajouter un événement le ${dayLabel(day)} à ${hour} heures`}
                      onClick={() => {
                        const start = new Date(day);
                        start.setHours(hour, 0, 0, 0);
                        onCreate(start);
                      }}
                    />
                  ))}
                  {layoutEvents(occurrences, day).map(
                    ({ o, start, end, lane, lanes }) => (
                      <button
                        key={o.key}
                        className="timed-event"
                        style={{
                          ...colorStyle(
                            colors.get(o.event.categoryId) || "#8b7ac3",
                          ),
                          top: (start / 60) * HOUR_HEIGHT,
                          height: Math.max(
                            ((end - start) / 60) * HOUR_HEIGHT,
                            26,
                          ),
                          left: `calc(${(lane / lanes) * 100}% + 3px)`,
                          width: `calc(${100 / lanes}% - 6px)`,
                        }}
                        onClick={() => onEdit(o.event)}
                      >
                        <span
                          className="day-event-content"
                          style={{
                            transform: `translateY(${Math.min(Math.max(visibleTop - (start / 60) * HOUR_HEIGHT, 0), Math.max(((end - start) / 60) * HOUR_HEIGHT - (o.event.location ? 86 : 65), 0))}px)`,
                          }}
                        >
                          <strong>
                            {o.event.icon} {o.event.title}
                          </strong>
                          <span>{timeLabel(o)}</span>
                          {o.event.location && (
                            <small>{o.event.location}</small>
                          )}
                        </span>
                      </button>
                    ),
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
