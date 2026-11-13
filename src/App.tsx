import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Flower2,
  Plus,
  Search,
  Settings2,
  WifiOff,
  X,
} from "lucide-react";
import type { AppData, CalendarEvent, Category, Occurrence } from "./types";
import {
  addDays,
  dateKey,
  frenchHolidays,
  getOccurrences,
  startOfWeek,
} from "./lib/calendar";
import {
  deleteAttachments,
  loadData,
  saveAttachments,
  saveData,
} from "./lib/storage";
import { exportCalendar } from "./lib/ics";
import { useCalendarSubscription } from "./lib/subscription";
import { downloadBlob, EventEditor, newEvent } from "./components/EventEditor";
import { WorkPlanner } from "./components/WorkPlanner";
import { SettingsPanel } from "./components/SettingsPanel";
import { Dialog } from "./components/Dialog";
import { MonthCalendar } from "./components/MonthCalendar";
import { DayCalendar } from "./components/DayCalendar";
import { YearCalendar } from "./components/YearCalendar";
import { ViewMenu, type DisplayMode } from "./components/ViewMenu";
import { ToastViewport, useToast } from "./components/Toast";

type View = "year" | "month" | "week" | "day" | "agenda";
type Modal =
  | "calendars"
  | "work"
  | "settings"
  | "data"
  | "categories"
  | "help"
  | null;
const fullDate = (day: Date) =>
  day.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
const clock = (value: string) => value.slice(11, 16).replace(":", "h");
const sameDay = (a: Date, b: Date) => dateKey(a) === dateKey(b);
const onDay = (o: Occurrence, day: Date) =>
  o.start < `${dateKey(addDays(day, 1))}T00:00` &&
  o.end > `${dateKey(day)}T00:00`;
const timeLabel = (o: Occurrence) =>
  o.event.allDay
    ? "Toute la journée"
    : `${clock(o.start)} – ${clock(o.end)}${o.event.timezone === "UTC" ? " UTC" : ""}`;
const colorStyle = (color: string): CSSProperties =>
  ({ "--event-color": color }) as CSSProperties;

function EventChip({
  occurrence,
  category,
  onClick,
  compact = false,
}: {
  occurrence: Occurrence;
  category?: Category;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      className={`event-chip ${occurrence.event.allDay ? "all-day" : ""}`}
      style={colorStyle(category?.color || "#8b7ac3")}
      onClick={onClick}
      title={`${occurrence.event.title} · ${timeLabel(occurrence)}`}
    >
      <span className="event-chip-dot" />
      {!compact && occurrence.event.icon && (
        <span>{occurrence.event.icon}</span>
      )}
      <strong>{occurrence.event.title}</strong>
      {!occurrence.event.allDay && (
        <time>
          {clock(occurrence.start)}
          {occurrence.event.timezone === "UTC" ? " UTC" : ""}
        </time>
      )}
    </button>
  );
}

function WeekView({
  date,
  events,
  categories,
  holidays,
  onSelect,
  onEdit,
}: {
  date: Date;
  events: Occurrence[];
  categories: Category[];
  holidays: Map<string, string>;
  onSelect: (day: Date) => void;
  onEdit: (event: CalendarEvent) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) =>
    addDays(startOfWeek(date), i),
  );
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 4 * 56;
  }, []);
  return (
    <div className="week-view">
      <div className="week-header">
        <span className="timezone-label">
          Heure
          <br />
          locale*
        </span>
        {days.map((day) => (
          <button
            key={dateKey(day)}
            onClick={() => onSelect(day)}
            className={sameDay(day, new Date()) ? "week-day today" : "week-day"}
          >
            <span>{day.toLocaleDateString("fr-FR", { weekday: "short" })}</span>
            <strong>{day.getDate()}</strong>
          </button>
        ))}
      </div>
      <div className="week-all-day">
        <small>Journée</small>
        {days.map((day) => (
          <div key={dateKey(day)}>
            {holidays.has(dateKey(day)) && (
              <span className="holiday-chip">{holidays.get(dateKey(day))}</span>
            )}
            {events
              .filter((o) => o.event.allDay && onDay(o, day))
              .map((o) => (
                <EventChip
                  key={o.key}
                  compact
                  occurrence={o}
                  category={categories.find((c) => c.id === o.event.categoryId)}
                  onClick={() => onEdit(o.event)}
                />
              ))}
          </div>
        ))}
      </div>
      <div className="week-scroll" ref={scroll}>
        <div className="week-timeline">
          <div className="hour-labels">
            {Array.from({ length: 24 }, (_, i) => (
              <span key={i} style={{ top: i * 56 }}>
                {String(i).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {days.map((day) => {
            const key = dateKey(day);
            const timed = events
              .filter((o) => !o.event.allDay && onDay(o, day))
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
            let group: typeof timed = [];
            let groupEnd = -1;
            const finishGroup = () => {
              const lanes = Math.max(1, ...group.map((x) => x.lane + 1));
              group.forEach((x) => {
                x.lanes = lanes;
              });
              group = [];
            };
            timed.forEach((item) => {
              if (item.start >= groupEnd) {
                finishGroup();
                groupEnd = -1;
              }
              const used = new Set(
                group.filter((x) => x.end > item.start).map((x) => x.lane),
              );
              while (used.has(item.lane)) item.lane++;
              group.push(item);
              groupEnd = Math.max(groupEnd, item.end);
            });
            finishGroup();
            return (
              <div className="timeline-column" key={key}>
                {Array.from({ length: 24 }, (_, h) => (
                  <button
                    key={h}
                    className="hour-slot"
                    aria-label={`${fullDate(day)}, ${h} heures`}
                    onClick={() => onSelect(day)}
                  />
                ))}
                {timed.map(({ o, start, end, lane, lanes }) => (
                  <button
                    key={o.key}
                    className="timed-event"
                    style={{
                      ...colorStyle(
                        categories.find((c) => c.id === o.event.categoryId)
                          ?.color || "#8b7ac3",
                      ),
                      top: (start / 60) * 56,
                      height: Math.max(((end - start) / 60) * 56, 24),
                      left: `calc(${(lane / lanes) * 100}% + 3px)`,
                      width: `calc(${100 / lanes}% - 6px)`,
                    }}
                    onClick={() => onEdit(o.event)}
                  >
                    <strong>
                      {o.event.icon} {o.event.title}
                    </strong>
                    <span>{timeLabel(o)}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <p className="week-note">
        * Horaires dans le fuseau de chaque événement. UTC indiqué le cas
        échéant.
      </p>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const subscription = useCalendarSubscription(data?.events);
  const dataRef = useRef<AppData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState(new Date());
  const [date, setDate] = useState(new Date());
  const [view, setView] = useState<View>("month");
  const calendarView = useRef<"year" | "month" | "day">("month");
  useEffect(() => {
    if (view === "year" || view === "month" || view === "day")
      calendarView.current = view;
  }, [view]);
  const [modal, setModal] = useState<Modal>(null);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobile, setMobile] = useState(
    () => matchMedia("(max-width: 600px)").matches,
  );
  const [calendarNavigation, setCalendarNavigation] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [offlineReady, setOfflineReady] = useState(false);
  const { notify } = useToast();
  useEffect(() => {
    if (subscription.error) notify(subscription.error, "error");
  }, [subscription.error, notify]);
  const searchRef = useRef<HTMLInputElement>(null);

  const receiveData = (next: AppData) => {
    dataRef.current = next;
    setData(next);
  };
  const load = () => {
    setLoadError("");
    loadData()
      .then(receiveData)
      .catch((err) =>
        setLoadError(
          err instanceof Error
            ? err.message
            : "Impossible d’ouvrir le stockage local.",
        ),
      );
  };
  useEffect(load, []);
  useEffect(() => {
    const media = matchMedia("(max-width: 600px)");
    const update = () => {
      setMobile(media.matches);
      if (media.matches)
        setView((previous) => (previous === "week" ? "day" : previous));
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const theme = () => {
      const dark =
        data?.settings.theme === "dark" ||
        (data?.settings.theme !== "light" && media.matches);
      const root = document.documentElement;
      root.dataset.theme = dark ? "dark" : "light";
      const palette = getComputedStyle(root);
      const background = palette.getPropertyValue("--bg").trim();
      // Paint the document and body explicitly, including the viewport outside
      // the calendar, instead of relying on background propagation from CSS.
      root.style.backgroundColor = "var(--bg)";
      document.body.style.backgroundColor = "var(--bg)";
      document.body.style.color = "var(--text)";
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", background);
    };
    theme();
    media.addEventListener("change", theme);
    return () => media.removeEventListener("change", theme);
  }, [data?.settings.theme]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    const swError = () =>
      notify(
        "Le cache hors connexion n’a pas pu être préparé. Rechargez avec une connexion.",
        "error",
      );
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    window.addEventListener("tempo-offline-error", swError);
    if ("serviceWorker" in navigator && import.meta.env.PROD)
      void navigator.serviceWorker.ready.then(() => setOfflineReady(true));
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener("tempo-offline-error", swError);
    };
  }, [notify]);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k" && !modal && !editing) {
        e.preventDefault();
        setSearchOpen(true);
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [modal, editing]);
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const rangeStart =
    view === "week"
      ? startOfWeek(date)
      : new Date(date.getFullYear(), date.getMonth(), 1);
  const rangeEnd =
    view === "week"
      ? addDays(rangeStart, 7)
      : new Date(date.getFullYear(), date.getMonth() + 1, 1);
  const visibleEvents = useMemo(
    () => (data?.events || []).filter((e) => !hidden.includes(e.categoryId)),
    [data?.events, hidden],
  );
  const occurrences = useMemo(
    () => getOccurrences(visibleEvents, rangeStart, rangeEnd),
    [visibleEvents, +rangeStart, +rangeEnd],
  );
  const holidayMap = useMemo(
    () =>
      new Map(
        data?.settings.showHolidays
          ? [date.getFullYear() - 1, date.getFullYear(), date.getFullYear() + 1]
              .flatMap((year) => frenchHolidays(year, data.settings.region))
              .map((h) => [h.date, h.name])
          : [],
      ),
    [data?.settings.showHolidays, data?.settings.region, date.getFullYear()],
  );
  const filtered = useMemo(
    () =>
      query.trim()
        ? (data?.events || [])
            .filter((e) =>
              `${e.title} ${e.location} ${e.notes} ${data?.categories.find((c) => c.id === e.categoryId)?.name}`
                .toLocaleLowerCase("fr")
                .includes(query.trim().toLocaleLowerCase("fr")),
            )
            .sort((a, b) => a.start.localeCompare(b.start))
        : [],
    [data, query],
  );
  const category = (id: string) => data?.categories.find((c) => c.id === id);
  const persist = async (next: AppData) => {
    await saveData(next);
    receiveData(next);
  };
  const exportEvents = (events: CalendarEvent[]) => {
    try {
      downloadBlob(
        new Blob([exportCalendar(events)], {
          type: "text/calendar;charset=utf-8",
        }),
        "tempo-calendrier.ics",
      );
      notify(
        "Calendrier .ics préparé. Consultez l’aide pour l’ajouter à Apple.",
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : "Export impossible.", "error");
    }
  };
  const selectDay = (day: Date) => {
    setSelected(day);
    setDate(day);
    setCalendarNavigation((previous) => previous + 1);
  };
  const goBack = () => {
    setQuery("");
    setSearchOpen(false);
    setView(view === "month" ? "year" : "month");
    setCalendarNavigation((previous) => previous + 1);
  };
  const changeDisplay = (mode: DisplayMode) => {
    setQuery("");
    setSearchOpen(false);
    setView(
      mode === "list"
        ? "agenda"
        : mode === "week"
          ? "week"
          : calendarView.current,
    );
  };
  const openDay = (day: Date) => {
    selectDay(day);
    setView("day");
  };
  const openNew = (day = selected) => {
    if (data) {
      setModal(null);
      setEditing(newEvent(day, data));
    }
  };
  const editEvent = (event: CalendarEvent) => {
    setEditing(event);
  };
  const openAtHour = (day: Date) => {
    if (!data) return;
    const event = newEvent(day, data);
    const hour = String(day.getHours()).padStart(2, "0");
    const end = new Date(day);
    end.setHours(day.getHours() + 1);
    setSelected(day);
    setEditing({
      ...event,
      start: `${dateKey(day)}T${hour}:00`,
      end: `${dateKey(end)}T${String(end.getHours()).padStart(2, "0")}:00`,
    });
  };
  const saveEvent = async (
    event: CalendarEvent,
    files: File[],
    removed: string[],
  ) => {
    const current = dataRef.current!;
    const existing = current.events.some((item) => item.id === event.id);
    const added = await saveAttachments(event.id, files);
    const nextEvent = {
      ...event,
      attachmentIds: [
        ...event.attachmentIds.filter((id) => !removed.includes(id)),
        ...added.map((a) => a.id),
      ],
    };
    try {
      await persist({
        ...current,
        events: current.events.some((e) => e.id === event.id)
          ? current.events.map((e) => (e.id === event.id ? nextEvent : e))
          : [...current.events, nextEvent],
      });
    } catch (error) {
      await deleteAttachments(added.map((a) => a.id)).catch(() => {});
      throw error;
    }
    let cleanupFailed = false;
    if (removed.length) {
      await deleteAttachments(removed).catch(() => {
        cleanupFailed = true;
      });
    }
    setHidden((previous) => previous.filter((id) => id !== event.categoryId));
    if (!existing || event.recurrence.frequency === "none") {
      selectDay(new Date(event.start.slice(0, 10) + "T12:00"));
    }
    notify(
      cleanupFailed
        ? "Événement enregistré. Certains documents retirés n’ont pas pu être effacés du stockage."
        : "Événement enregistré sur cet appareil.",
      cleanupFailed ? "info" : "success",
    );
  };
  const deleteEvent = async (event: CalendarEvent) => {
    await persist({
      ...dataRef.current!,
      events: dataRef.current!.events.filter((e) => e.id !== event.id),
    });
    let cleanupFailed = false;
    await deleteAttachments(event.attachmentIds).catch(() => {
      cleanupFailed = true;
    });
    notify(
      cleanupFailed
        ? "Événement supprimé. Le nettoyage des documents a échoué."
        : "Événement supprimé.",
      cleanupFailed ? "info" : "success",
    );
  };
  const createWork = async (events: CalendarEvent[]) => {
    await persist({
      ...dataRef.current!,
      events: [...dataRef.current!.events, ...events],
    });
    setHidden((previous) =>
      previous.filter((id) => !events.some((event) => event.categoryId === id)),
    );
    const first = new Date(events[0].start);
    selectDay(first);
    notify(`${events.length} périodes de travail ajoutées.`);
  };

  if (!data)
    return (
      <div className="loading-screen">
        {loadError ? (
          <>
            <p role="alert">{loadError}</p>
            <p>
              Le stockage local doit être accessible pour enregistrer vos
              événements.
            </p>
            <button className="primary-button" onClick={load}>
              Réessayer
            </button>
          </>
        ) : (
          <p role="status">Chargement du calendrier…</p>
        )}
      </div>
    );
  const monthName = date.toLocaleDateString("fr-FR", { month: "long" });
  const agendaDays = Array.from(
    {
      length: Math.round(
        (Date.UTC(
          rangeEnd.getFullYear(),
          rangeEnd.getMonth(),
          rangeEnd.getDate(),
        ) -
          Date.UTC(
            rangeStart.getFullYear(),
            rangeStart.getMonth(),
            rangeStart.getDate(),
          )) /
          86400000,
      ),
    },
    (_, i) => addDays(rangeStart, i),
  );
  const localStatus = !online
    ? "Hors connexion"
    : offlineReady
      ? "Disponible hors connexion"
      : import.meta.env.DEV
        ? "Cache hors connexion disponible en version de production"
        : "Préparation du cache hors connexion…";

  return (
    <div className="app-shell" data-offline-ready={offlineReady}>
      <header className="calendar-toolbar">
        <div className="period-navigation">
          {view !== "year" && (
            <button
              className="calendar-back"
              aria-label={
                view === "month" ? "Revenir à l’année" : "Revenir aux mois"
              }
              onClick={goBack}
            >
              <ChevronLeft size={23} />
              <span>{view === "month" ? date.getFullYear() : monthName}</span>
            </button>
          )}
        </div>
        <div className="toolbar-actions">
          {!online && (
            <span
              className="connection-status"
              role="status"
              aria-label="Hors connexion"
              title="Hors connexion"
            >
              <WifiOff size={17} />
            </span>
          )}
          <ViewMenu
            mode={
              view === "agenda" ? "list" : view === "week" ? "week" : "calendar"
            }
            mobile={mobile}
            onChange={changeDisplay}
          />
          <button
            className="icon-button"
            aria-label={searchOpen ? "Fermer la recherche" : "Rechercher"}
            aria-expanded={searchOpen}
            onClick={() => {
              setSearchOpen(!searchOpen);
              setQuery("");
            }}
          >
            {searchOpen ? <X size={22} /> : <Search size={22} />}
          </button>
          <button
            className="icon-button create-button"
            aria-label="Nouvel événement"
            onClick={() => openNew()}
          >
            <Plus size={28} />
          </button>
        </div>
      </header>
      {searchOpen && (
        <form
          className="calendar-search"
          role="search"
          onSubmit={(event) => event.preventDefault()}
        >
          <Search size={18} />
          <input
            ref={searchRef}
            aria-label="Rechercher un événement"
            placeholder="Rechercher"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSearchOpen(false);
                setQuery("");
              }
            }}
          />
          {query && (
            <button
              type="button"
              className="icon-button"
              aria-label="Effacer la recherche"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
            >
              <X size={18} />
            </button>
          )}
        </form>
      )}
      <main className="calendar-main">
        <section
          className={`calendar-surface view-${view}`}
          aria-label="Calendrier"
        >
          {query ? (
            <div className="search-results">
              <h2>
                Résultats de recherche <span>{filtered.length}</span>
              </h2>
              {filtered.length ? (
                filtered.map((event) => (
                  <button
                    className="search-result"
                    key={event.id}
                    onClick={() => editEvent(event)}
                  >
                    <span
                      className="result-icon"
                      style={colorStyle(
                        category(event.categoryId)?.color || "#8b7ac3",
                      )}
                    >
                      {event.icon || category(event.categoryId)?.icon || "📅"}
                    </span>
                    <div>
                      <strong>{event.title}</strong>
                      <span>
                        {new Date(event.start).toLocaleDateString("fr-FR", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}{" "}
                        ·{" "}
                        {event.allDay ? "Toute la journée" : clock(event.start)}
                        {event.recurrence.frequency !== "none"
                          ? " · Récurrent"
                          : ""}
                      </span>
                    </div>
                    <ChevronRight size={17} />
                  </button>
                ))
              ) : (
                <div className="empty-state">
                  <p>Aucun événement trouvé.</p>
                </div>
              )}
            </div>
          ) : view === "year" ? (
            <YearCalendar
              year={date.getFullYear()}
              navigationKey={calendarNavigation}
              onVisibleYear={(year) => {
                setDate(previous => previous.getFullYear() === year ? previous : new Date(year, 0, 1));
                setSelected(previous => previous.getFullYear() === year ? previous : new Date(year, 0, 1));
              }}
              onSelectMonth={(month) => {
                selectDay(month);
                setView("month");
              }}
            />
          ) : view === "month" ? (
            <MonthCalendar
              key={mobile ? "mobile" : "desktop"}
              date={date}
              navigationKey={calendarNavigation}
              continuous={mobile}
              events={visibleEvents}
              categories={data.categories}
              settings={data.settings}
              onVisibleMonth={(month) => {
                setDate(month);
                setSelected((previous) =>
                  previous.getFullYear() === month.getFullYear() &&
                  previous.getMonth() === month.getMonth()
                    ? previous
                    : month,
                );
              }}
              onOpenDay={openDay}
              onEdit={editEvent}
              onCreate={openNew}
            />
          ) : view === "day" ? (
            <DayCalendar
              date={date}
              events={visibleEvents}
              categories={data.categories}
              settings={data.settings}
              onNavigate={(direction) => selectDay(addDays(date, direction))}
              onEdit={editEvent}
              onCreate={openAtHour}
            />
          ) : view === "week" ? (
            <WeekView
              date={date}
              events={occurrences}
              categories={data.categories}
              holidays={holidayMap}
              onSelect={openDay}
              onEdit={editEvent}
            />
          ) : (
            <div className="agenda-view">
              {agendaDays.filter(
                (day) =>
                  occurrences.some((o) => onDay(o, day)) ||
                  holidayMap.has(dateKey(day)),
              ).length ? (
                agendaDays.map((day) => {
                  const items = occurrences.filter((o) => onDay(o, day));
                  const holiday = holidayMap.get(dateKey(day));
                  return items.length || holiday ? (
                    <div className="agenda-day" key={dateKey(day)}>
                      <button
                        className={`agenda-date ${sameDay(day, new Date()) ? "today" : ""}`}
                        onClick={() => openDay(day)}
                      >
                        <strong>{day.getDate()}</strong>
                        <span>
                          {day.toLocaleDateString("fr-FR", {
                            weekday: "short",
                          })}
                        </span>
                      </button>
                      <div className="agenda-day-events">
                        {holiday && (
                          <div className="agenda-holiday">
                            <Flower2 size={15} />
                            {holiday}
                            <span>Jour férié</span>
                          </div>
                        )}
                        {items.map((o) => (
                          <button
                            className="agenda-event"
                            key={o.key}
                            onClick={() => editEvent(o.event)}
                            style={colorStyle(
                              category(o.event.categoryId)?.color || "#8b7ac3",
                            )}
                          >
                            <i />
                            <div>
                              <strong>
                                {o.event.icon ||
                                  category(o.event.categoryId)?.icon}{" "}
                                {o.event.title}
                              </strong>
                              <span>
                                {timeLabel(o)}
                                {o.event.location
                                  ? ` · ${o.event.location}`
                                  : ""}
                              </span>
                            </div>
                            <ChevronRight size={16} />
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null;
                })
              ) : (
                <div className="empty-state">
                  <p>Aucun événement ce mois-ci.</p>
                  <button
                    className="secondary-button"
                    onClick={() => openNew()}
                  >
                    Créer un événement
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
      <nav className="calendar-bottom-bar" aria-label="Commandes du calendrier">
        <button
          onClick={() => {
            selectDay(new Date());
            setQuery("");
            setSearchOpen(false);
          }}
        >
          Aujourd’hui
        </button>
        <button onClick={() => setModal("calendars")} aria-haspopup="dialog">
          Calendriers
        </button>
        <button
          onClick={() => setModal("work")}
          aria-label="Ma semaine de travail"
          aria-haspopup="dialog"
        >
          Travail
        </button>
      </nav>

      {modal === "calendars" && (
        <Dialog title="Calendriers" onClose={() => setModal(null)}>
          <div className="dialog-body calendars-menu">
            <div className="calendar-filters">
              {data.categories.map((c) => (
                <label className="calendar-toggle" key={c.id}>
                  <input
                    type="checkbox"
                    checked={!hidden.includes(c.id)}
                    onChange={() =>
                      setHidden((previous) =>
                        previous.includes(c.id)
                          ? previous.filter((id) => id !== c.id)
                          : [...previous, c.id],
                      )
                    }
                    style={{ accentColor: c.color }}
                  />
                  <span>{c.icon}</span>
                  <span>{c.name}</span>
                </label>
              ))}
              <label className="calendar-toggle holiday-toggle">
                <input
                  type="checkbox"
                  checked={data.settings.showHolidays}
                  onChange={() => {
                    void persist({
                      ...data,
                      settings: {
                        ...data.settings,
                        showHolidays: !data.settings.showHolidays,
                      },
                    }).catch((error) =>
                      notify(
                        error instanceof Error
                          ? error.message
                          : "Impossible d’enregistrer cette préférence.",
                        "error",
                      ),
                    );
                  }}
                />
                <Flower2 size={18} />
                <span>
                  Jours fériés<small>France · Bretagne</small>
                </span>
              </label>
            </div>
            <div className="calendar-menu-actions">
              <button onClick={() => setModal("categories")}>
                <Plus size={19} />
                Gérer les calendriers
                <ChevronRight size={16} />
              </button>
              <button onClick={() => setModal("data")}>
                <ArrowDownToLine size={19} />
                Importer ou exporter
                <ChevronRight size={16} />
              </button>
              <button
                aria-label="Ouvrir les préférences"
                onClick={() => setModal("settings")}
              >
                <Settings2 size={19} />
                Réglages
                <ChevronRight size={16} />
              </button>
              <button onClick={() => setModal("help")}>
                <CircleHelp size={19} />
                Aide & installation
                <ChevronRight size={16} />
              </button>
            </div>
            <p className="local-status">{localStatus}</p>
          </div>
        </Dialog>
      )}
      {editing && (
        <EventEditor
          key={editing.id}
          initial={editing}
          data={data}
          existing={data.events.some((e) => e.id === editing.id)}
          onClose={() => setEditing(null)}
          onSave={saveEvent}
          onDelete={deleteEvent}
          onExport={(event) => exportEvents([event])}
        />
      )}
      {modal === "work" && (
        <WorkPlanner
          day={selected}
          data={data}
          onClose={() => setModal(null)}
          onCreate={createWork}
        />
      )}
      {modal && modal !== "work" && modal !== "calendars" && (
        <SettingsPanel
          data={data}
          subscription={subscription}
          initialTab={
            modal === "data"
              ? "data"
              : modal === "categories"
                ? "categories"
                : modal === "help"
                  ? "help"
                  : "general"
          }
          onClose={() => setModal(null)}
          onChange={persist}
          onRestore={(next) => {
            receiveData(next);
            setHidden([]);
          }}
          onExport={() => exportEvents(data.events)}
        />
      )}
      {!modal && !editing && <ToastViewport />}
    </div>
  );
}
