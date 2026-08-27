import { useCallback, useRef, type MouseEvent, type PointerEvent } from "react";

const DEFAULT_MS = 520;
const MOVE_CANCEL_PX = 12;

export type LongPressBind = {
  onPointerDown: (e: PointerEvent) => void;
  onPointerMove: (e: PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
  onContextMenu: (e: MouseEvent) => void;
};

/**
 * Long-press (phone) + right-click. After fire, the next click is suppressed
 * via `consumeClickSkip()`.
 */
export function useLongPress(
  onLongPress: (() => void) | null | undefined,
  ms = DEFAULT_MS
): { bind: LongPressBind; consumeClickSkip: () => boolean } {
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const skipClickRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
  }, []);

  const fire = useCallback(() => {
    if (!onLongPress) return;
    skipClickRef.current = true;
    onLongPress();
  }, [onLongPress]);

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      if (!onLongPress) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      skipClickRef.current = false;
      startRef.current = { x: e.clientX, y: e.clientY };
      clear();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        fire();
      }, ms);
    },
    [clear, fire, ms, onLongPress]
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const start = startRef.current;
      if (!start || timerRef.current == null) return;
      if (
        Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_CANCEL_PX
      ) {
        clear();
      }
    },
    [clear]
  );

  const endPress = useCallback(() => {
    clear();
  }, [clear]);

  const onContextMenu = useCallback(
    (e: MouseEvent) => {
      if (!onLongPress) return;
      e.preventDefault();
      e.stopPropagation();
      clear();
      fire();
    },
    [clear, fire, onLongPress]
  );

  const consumeClickSkip = useCallback(() => {
    if (!skipClickRef.current) return false;
    skipClickRef.current = false;
    return true;
  }, []);

  return {
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPress,
      onPointerCancel: endPress,
      onPointerLeave: endPress,
      onContextMenu,
    },
    consumeClickSkip,
  };
}
