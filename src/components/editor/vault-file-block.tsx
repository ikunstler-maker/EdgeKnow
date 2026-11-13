"use client";

import { createReactBlockSpec } from "@blocknote/react";
import { t } from "@/i18n";
import { useOptionalPages } from "@/components/pages/pages-provider";
import { VaultFileEmbed } from "@/components/files/vault-file-embed";

// A Vault file on a wiki page or in a task's description (VAULT-3): only its id is kept;
// the card is read live with the reader's own access.
export const vaultFileBlock = createReactBlockSpec(
  {
    type: "vaultFile",
    propSchema: { fileId: { default: "" } },
    content: "none",
  },
  {
    meta: { selectable: false },
    render: ({ block, editor }) => <VaultFileBlockBody fileId={block.props.fileId} editable={editor.isEditable} onPick={(fileId) => editor.updateBlock(block, { props: { fileId } })} />,
    toExternalHTML: () => <p>[{t.vault.embed.title}]</p>,
  },
);

function VaultFileBlockBody({ fileId, editable, onPick }: { fileId: string; editable: boolean; onPick: (id: string) => void }) {
  const shortId = useOptionalPages()?.workspace.shortId ?? "";
  return (
    <div className="my-1 w-full max-w-xl" contentEditable={false} data-vault-file-block>
      <VaultFileEmbed shortId={shortId} fileId={fileId} editable={editable} onPick={onPick} />
    </div>
  );
}
