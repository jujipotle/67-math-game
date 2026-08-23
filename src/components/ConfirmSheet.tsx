"use client";

type ConfirmSheetProps = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmSheet({
  title,
  body,
  confirmLabel = "Quit",
  cancelLabel = "Resume",
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-30"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-sm p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-semibold mb-1">{title}</div>
        {body ? <p className="text-sm text-neutral-500 mb-4">{body}</p> : <div className="mb-3" />}
        <button
          type="button"
          onClick={onConfirm}
          className="w-full h-12 mb-2 rounded-xl bg-neutral-900 text-white font-medium"
        >
          <span className="inline-flex items-center justify-center gap-1.5 leading-tight">
            <span>{confirmLabel}</span>
            <span className="text-[11px] text-neutral-400">(esc)</span>
          </span>
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="w-full h-11 rounded-xl border border-neutral-200 text-sm text-neutral-500"
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
