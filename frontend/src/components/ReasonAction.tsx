"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";

// A button that, when the action needs a reason, first opens a small inline
// form for it. Keeps verifier and coordinator actions on one screen.
export function ReasonAction({
  label,
  variant = "secondary",
  requireReason = false,
  placeholder = "Reason",
  busy,
  onSubmit,
}: {
  label: string;
  variant?: "primary" | "secondary" | "danger";
  requireReason?: boolean;
  placeholder?: string;
  busy: boolean;
  onSubmit: (reason: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!requireReason) {
    return (
      <Button variant={variant} disabled={busy} onClick={() => onSubmit(undefined)}>
        {label}
      </Button>
    );
  }
  if (!open) {
    return (
      <Button variant={variant} disabled={busy} onClick={() => setOpen(true)}>
        {label}…
      </Button>
    );
  }
  return (
    <form
      className="flex w-full flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(reason);
      }}
    >
      <div className="min-w-48 flex-1">
        <Input autoFocus required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder} />
      </div>
      <Button type="submit" variant={variant} disabled={busy}>
        {label}
      </Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  );
}
