"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import * as Primitive from "@radix-ui/react-tooltip";
import { CircleHelp } from "lucide-react";
import styles from "./tooltip.module.css";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <Primitive.Provider delayDuration={450} skipDelayDuration={150}>
      {children}
    </Primitive.Provider>
  );
}

export function Tooltip({
  children,
  content,
  openOnClick = false,
}: {
  children: ReactElement;
  content: string;
  openOnClick?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const focusFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(focusFrame.current), []);
  function cancelFocusOpen() {
    cancelAnimationFrame(focusFrame.current);
  }
  const [state, setState] = useState<{
    open: boolean;
    container?: HTMLElement;
  }>({ open: false });
  function changeOpen(open: boolean) {
    // Native modal dialogs are in the top layer; body portals sit behind them.
    setState({
      open,
      container: trigger.current?.closest("dialog") ?? undefined,
    });
  }
  return (
    <Primitive.Root open={state.open} onOpenChange={changeOpen}>
      <Primitive.Trigger
        ref={trigger}
        asChild
        onFocus={(event) => {
          // Focus can scroll an offscreen control. Open after that scroll so
          // Radix's scroll-dismiss listener does not immediately hide its help.
          event.preventDefault();
          cancelFocusOpen();
          focusFrame.current = requestAnimationFrame(() => {
            focusFrame.current = requestAnimationFrame(() => {
              if (document.activeElement === trigger.current) changeOpen(true);
            });
          });
        }}
        onBlur={cancelFocusOpen}
        onKeyDown={(event) => {
          if (event.key === "Escape") cancelFocusOpen();
        }}
        onClick={(event) => {
          cancelFocusOpen();
          if (openOnClick) {
            event.preventDefault();
            changeOpen(true);
          }
        }}
      >
        {children}
      </Primitive.Trigger>
      <Primitive.Portal container={state.container}>
        <Primitive.Content
          className={styles.content}
          data-help-tooltip
          sideOffset={7}
          collisionPadding={12}
          hideWhenDetached
        >
          {content}
          <Primitive.Arrow className={styles.arrow} width={10} height={5} />
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}

export function HelpTip({
  label,
  content,
}: {
  label: string;
  content: string;
}) {
  return (
    <Tooltip content={content} openOnClick>
      <button
        type="button"
        className={styles.help}
        aria-label={`About ${label}`}
      >
        <CircleHelp size={16} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
