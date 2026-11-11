// 取り消せない操作の前に出す確認。ブラウザの confirm() ではなく、アプリの見た目で出す。
// 「やめる」を最初に選んだ状態で開き、Esc や外側の暗い所を押してもやめる。
import { useEffect, useId, useRef, type ReactNode } from "react";

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  confirmIcon,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  confirmIcon?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    cancelRef.current?.focus();
    return () => d.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      // Esc でやめる（ブラウザに閉じさせず、呼ぶ側の状態から消す）
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      // 外側の暗い所を押したときもやめる
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
          if (!inside) onCancel();
        }
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <div id={bodyId}>{children}</div>
      <div className="actions">
        <button ref={cancelRef} type="button" className="btn" onClick={onCancel}>
          やめる
        </button>
        <button type="button" className="btn primary" onClick={onConfirm}>
          {confirmIcon}
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
