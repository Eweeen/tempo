export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
}
export interface Recurrence {
  frequency: "none" | "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  until?: string;
}
export interface CalendarEvent {
  id: string;
  uid: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  categoryId: string;
  icon: string;
  location: string;
  notes: string;
  url: string;
  availability: "busy" | "free";
  alerts: number[];
  recurrence: Recurrence;
  timezone: string;
  attachmentIds: string[];
  createdAt: string;
  updatedAt: string;
  batchId?: string;
}
export interface Holiday {
  date: string;
  name: string;
}
export interface Occurrence {
  event: CalendarEvent;
  start: string;
  end: string;
  key: string;
}
export interface Attachment {
  id: string;
  eventId: string;
  name: string;
  type: string;
  size: number;
  blob: Blob;
}
export interface Settings {
  theme: "system" | "light" | "dark";
  region: "fr" | "alsace";
  showHolidays: boolean;
  defaultAlert: number;
  timezone: string;
}
export interface AppData {
  events: CalendarEvent[];
  categories: Category[];
  settings: Settings;
}
