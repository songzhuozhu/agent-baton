import { useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';

interface ModalProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  error?: string;
}

export function Modal({ title, children, onClose, busy = false, error }: ModalProps): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current!;
    const trigger = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  return <dialog ref={dialog} className="modal" aria-labelledby={titleId} aria-modal="true"
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="card-header">
      <h2 id={titleId} tabIndex={-1} autoFocus>{title}</h2>
      <button type="button" className="text-button" disabled={busy} onClick={onClose} aria-label={`关闭${title}`}>关闭</button>
    </div>
    {error && <p className="error-banner modal-error" role="alert">{error}</p>}
    {busy && <p className="operation-status" role="status">正在处理，请稍候…</p>}
    <fieldset className="modal-content" disabled={busy} aria-busy={busy}>{children}</fieldset>
  </dialog>;
}
