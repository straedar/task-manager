import { useState } from "react";
import { Plus } from "lucide-react";
import { IdeaFormDialog } from "./IdeaFormDialog";

interface CreateIdeaDialogProps {
  onCreated: () => void;
}

export function CreateIdeaDialog({ onCreated }: CreateIdeaDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full gradient-accent text-white shadow-lg transition hover:scale-105 sm:h-16 sm:w-16"
        aria-label="Создать идею"
      >
        <Plus className="h-7 w-7 sm:h-8 sm:w-8" strokeWidth={2.5} />
      </button>

      <IdeaFormDialog open={open} onClose={() => setOpen(false)} onSaved={onCreated} />
    </>
  );
}
