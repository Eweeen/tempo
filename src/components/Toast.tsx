import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Check, CircleAlert, Info, X } from "lucide-react";

type ToastTone = "success" | "error" | "info";
type Notification = { message: string; tone: ToastTone };
const ToastContext = createContext<{
  toast: Notification | null;
  notify: (message: string, tone?: ToastTone) => void;
  dismiss: () => void;
} | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Notification | null>(null);
  const notify = useCallback((message: string, tone: ToastTone = "success") => {
    setToast({ message, tone });
  }, []);
  const dismiss = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(dismiss, 6500);
    return () => window.clearTimeout(timeout);
  }, [toast, dismiss]);

  return (
    <ToastContext.Provider value={{ toast, notify, dismiss }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("ToastProvider manquant.");
  return context;
}

/** Render inside the active dialog so its notification stays accessible. */
export function ToastViewport() {
  const { toast, dismiss } = useToast();
  const Icon =
    toast?.tone === "error" ? CircleAlert : toast?.tone === "info" ? Info : Check;

  return (
    <div
      className="toast-region"
      role={toast?.tone === "error" ? "alert" : "status"}
      aria-atomic="true"
    >
      {toast && (
        <div className={`toast toast-${toast.tone}`}>
          <Icon size={18} aria-hidden="true" />
          <span>{toast.message}</span>
          <button
            type="button"
            className="icon-button small"
            aria-label="Fermer la notification"
            onClick={dismiss}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
