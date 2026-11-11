"use client";

import { useState } from "react";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { NewProjectForm } from "./new-project-form";

// The one primary action of the projects page: the form opens in a dialog
// instead of sitting on the page all the time.
export function NewProjectButton({ workspaceId, shortId }: { workspaceId: string; shortId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon="plus" onClick={() => setOpen(true)} data-new-project>
        {t.tasks.newProject}
      </Button>
      {open && (
        <Dialog title={t.tasks.newProject} onClose={() => setOpen(false)} width={520}>
          <NewProjectForm workspaceId={workspaceId} shortId={shortId} />
        </Dialog>
      )}
    </>
  );
}
