import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * daisyUI's `modal` on a native `<dialog>`: modal while open, closed by Escape or the
 * backdrop unless `dismissible` is false. The dialog stays in the page's DOM, so it keeps
 * the page's daisyUI theme.
 */
export function DaisyModal({
  open,
  onClose,
  title,
  description,
  actions,
  children,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  actions: ReactNode;
  children?: ReactNode;
  dismissible?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      // jsdom has no showModal; the open attribute is enough there.
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
    } else if (!open && element.open) {
      if (typeof element.close === "function") element.close();
      else element.removeAttribute("open");
    }
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="modal modal-bottom sm:modal-middle"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
    >
      {open ? (
        <div className="modal-box">
          <h3 id={titleId} className="text-lg font-bold">
            {title}
          </h3>
          {description ? (
            <p id={descriptionId} className="py-3 text-sm text-base-content/70">
              {description}
            </p>
          ) : null}
          {children}
          <div className="modal-action">{actions}</div>
        </div>
      ) : null}
      <div className="modal-backdrop" onClick={() => dismissible && onClose()} aria-hidden="true" />
    </dialog>
  );
}
