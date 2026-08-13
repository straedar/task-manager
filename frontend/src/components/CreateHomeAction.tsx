import { useState } from "react";
import { BookmarkPlus, CheckSquare, ListTodo, Plus } from "lucide-react";
import { Modal } from "./Modal";
import { CreateTaskDialog } from "./CreateTaskDialog";
import { CreateChecklistDialog } from "./CreateChecklistDialog";
import { CreatePresetDialog } from "./CreatePresetDialog";

interface CreateHomeActionProps {
  onCreated: () => void;
}

export function CreateHomeAction({ onCreated }: CreateHomeActionProps) {
  const [pickOpen, setPickOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);

  const anyDialogOpen = pickOpen || taskOpen || checklistOpen || presetOpen;

  return (
    <>
      {!anyDialogOpen && (
        <button
          type="button"
          onClick={() => setPickOpen(true)}
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full gradient-accent text-white shadow-lg transition hover:scale-105 sm:h-16 sm:w-16"
          aria-label="Создать"
        >
          <Plus className="h-7 w-7 sm:h-8 sm:w-8" strokeWidth={2.5} />
        </button>
      )}

      <Modal open={pickOpen} onClose={() => setPickOpen(false)} title="Что создать?">
        <div className="flex flex-col gap-3 p-5">
          <button
            type="button"
            onClick={() => {
              setPickOpen(false);
              setTaskOpen(true);
            }}
            className="flex w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3.5 text-left transition hover:border-orange-200 hover:bg-orange-50/50"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-500">
              <ListTodo className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-gray-900">Задача</span>
              <span className="block text-xs text-gray-500">Обычная задача с приоритетом</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setPickOpen(false);
              setChecklistOpen(true);
            }}
            className="flex w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3.5 text-left transition hover:border-sky-200 hover:bg-sky-50/50"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <CheckSquare className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-gray-900">Чеклист</span>
              <span className="block text-xs text-gray-500">
                Пункты со сроком или без срока
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setPickOpen(false);
              setPresetOpen(true);
            }}
            className="flex w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3.5 text-left transition hover:border-violet-200 hover:bg-violet-50/50"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
              <BookmarkPlus className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-gray-900">Пресет</span>
              <span className="block text-xs text-gray-500">
                Шаблон задачи или чеклиста для быстрого создания
              </span>
            </span>
          </button>
        </div>
      </Modal>

      <CreateTaskDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        onCreated={onCreated}
        hideTrigger
      />

      <CreateChecklistDialog
        open={checklistOpen}
        onClose={() => setChecklistOpen(false)}
        onCreated={onCreated}
      />

      <CreatePresetDialog open={presetOpen} onOpenChange={setPresetOpen} />
    </>
  );
}
