import { useLayoutEffect, useRef, useState, type TouchEvent } from "react";

const SCROLL_IDLE_DELAY = 150;

type ScrollTarget =
  | { kind: "navigate"; index: number }
  | { kind: "anchor"; index: number; offset: number };

/** Recycle calendar sections only once touch scrolling and its inertia have stopped. */
export function useCalendarWindow({
  index,
  navigationKey,
  enabled = true,
  size,
  step,
  attribute,
  onVisibleIndex,
}: {
  index: number;
  navigationKey: number;
  enabled?: boolean;
  size: number;
  step: number;
  attribute: "data-month" | "data-year";
  onVisibleIndex: (index: number) => void;
}) {
  const offset = Math.floor(size / 2);
  const [firstIndex, setFirstIndex] = useState(index - offset);
  const scroller = useRef<HTMLDivElement>(null);
  const pending = useRef<ScrollTarget | null>({ kind: "navigate", index });
  const lastNavigation = useRef(navigationKey);
  const lastVisible = useRef(index);
  const restoredTop = useRef<number | null>(null);
  const touching = useRef(false);
  const frame = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const visibleCallback = useRef(onVisibleIndex);
  visibleCallback.current = onVisibleIndex;

  const cancelRecycle = () => clearTimeout(idleTimer.current);

  useLayoutEffect(() => {
    if (lastNavigation.current === navigationKey) return;
    lastNavigation.current = navigationKey;
    cancelRecycle();
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    pending.current = { kind: "navigate", index };
    setFirstIndex(index - offset);
  }, [navigationKey, index, offset]);

  useLayoutEffect(() => {
    const container = scroller.current;
    const target = pending.current;
    if (!enabled || !container || !target) return;
    if (target.kind === "navigate" && firstIndex !== target.index - offset)
      return;
    const element = container.querySelector<HTMLElement>(
      `[${attribute}="${target.index}"]`,
    );
    if (!element) return;
    const displacement =
      element.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      (target.kind === "anchor" ? target.offset : 0);
    container.scrollTop += displacement;
    // The resulting scroll event is an adjustment, not another request to recycle.
    restoredTop.current = container.scrollTop;
    if (target.kind === "navigate") lastVisible.current = target.index;
    pending.current = null;
  }, [firstIndex, navigationKey, enabled, attribute, offset]);

  useLayoutEffect(
    () => () => {
      cancelRecycle();
      cancelAnimationFrame(frame.current);
    },
    [],
  );

  const scheduleRecycle = () => {
    cancelRecycle();
    if (!enabled || touching.current) return;
    idleTimer.current = setTimeout(() => {
      const container = scroller.current;
      if (!container || touching.current || pending.current) return;
      const threshold = container.clientHeight;
      const shift =
        container.scrollTop < threshold
          ? -step
          : container.scrollHeight - container.scrollTop - threshold < threshold
            ? step
            : 0;
      if (!shift) return;
      const top = container.getBoundingClientRect().top;
      const anchor = [
        ...container.querySelectorAll<HTMLElement>(`[${attribute}]`),
      ].find((node) => node.getBoundingClientRect().bottom > top + 1);
      if (!anchor) return;
      const anchorIndex = Number(anchor.getAttribute(attribute));
      // A very tall viewport must never cause us to remove its visible anchor.
      if (
        anchorIndex < firstIndex + shift ||
        anchorIndex >= firstIndex + shift + size
      )
        return;
      pending.current = {
        kind: "anchor",
        index: anchorIndex,
        offset: anchor.getBoundingClientRect().top - top,
      };
      setFirstIndex((previous) => previous + shift);
    }, SCROLL_IDLE_DELAY);
  };

  const handleScroll = () => {
    cancelRecycle();
    const container = scroller.current;
    if (!enabled || !container) return;
    if (
      restoredTop.current !== null &&
      Math.abs(container.scrollTop - restoredTop.current) < 1
    )
      return;
    restoredTop.current = null;
    scheduleRecycle();
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (pending.current) return;
      const top = container.getBoundingClientRect().top;
      const visible = [
        ...container.querySelectorAll<HTMLElement>(`[${attribute}]`),
      ].find((node) => node.getBoundingClientRect().bottom > top + 60);
      if (!visible) return;
      const visibleIndex = Number(visible.getAttribute(attribute));
      if (visibleIndex !== lastVisible.current) {
        lastVisible.current = visibleIndex;
        visibleCallback.current(visibleIndex);
      }
    });
  };

  const handleTouchStart = () => {
    touching.current = true;
    cancelRecycle();
  };
  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    touching.current = event.touches.length > 0;
    scheduleRecycle();
  };

  return {
    firstIndex,
    scrollProps: {
      ref: scroller,
      onScroll: handleScroll,
      onTouchStart: handleTouchStart,
      onTouchEnd: handleTouchEnd,
      onTouchCancel: handleTouchEnd,
    },
  };
}
