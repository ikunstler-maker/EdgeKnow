import type { Metadata } from "next";
import { t } from "@/i18n";
import { SERVICE_BRANDS } from "@/lib/services";
import { dataClient } from "@/lib/team-db/data";
import { VAULT_LIMIT, listVaultFiles } from "@/lib/vault";
import { getWorkspace } from "@/lib/workspace";
import { VaultBrowser } from "@/components/files/vault-browser";
import { ServiceIcon } from "@/components/services/service-icon";
import { Hint } from "@/components/ui/hint";

export const metadata: Metadata = { title: `${SERVICE_BRANDS.files.name} · ${t.app.name}` };

// Vault (VAULT-1): every file of the workspace the person can see in the services.
export default async function FilesPage({ params }: PageProps<"/w/[wid]/files">) {
  const { wid } = await params;
  const workspace = await getWorkspace(wid);
  if (!workspace) return null;
  const files = await listVaultFiles(await dataClient(wid), workspace.id, workspace.shortId);
  const perSource = new Map<string, number>();
  for (const file of files) perSource.set(file.source, (perSource.get(file.source) ?? 0) + 1);
  const limited = [...perSource.values()].some((n) => n >= VAULT_LIMIT);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:py-8">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="flex min-w-0 flex-1 items-center gap-2 text-xl font-semibold tracking-tight">
          <ServiceIcon serviceId="files" size={28} />
          <span className="truncate">{SERVICE_BRANDS.files.name}</span>
          <Hint label={SERVICE_BRANDS.files.name} text={t.vault.intro} />
        </h1>
      </header>
      <VaultBrowser files={files} limited={limited} />
    </main>
  );
}
