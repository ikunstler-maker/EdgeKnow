"use client";

import { createReactBlockSpec } from "@blocknote/react";
import { t } from "@/i18n";
import { useOptionalPages } from "@/components/pages/pages-provider";
import { WishlistEmbed } from "@/components/wishlists/wishlist-embed";

// A colleague's wishlist on a wiki page (profile, step 4): only its id is stored in the
// page; the card is read live with the reader's own access.
export const wishlistBlock = createReactBlockSpec(
  {
    type: "wishlistEmbed",
    propSchema: { wishlistId: { default: "" } },
    content: "none",
  },
  {
    meta: { selectable: false },
    render: ({ block, editor }) => <WishlistBlockBody wishlistId={block.props.wishlistId} editable={editor.isEditable} onPick={(wishlistId) => editor.updateBlock(block, { props: { wishlistId } })} />,
    toExternalHTML: () => <p>[{t.wishlists.title}]</p>,
  },
);

function WishlistBlockBody({ wishlistId, editable, onPick }: { wishlistId: string; editable: boolean; onPick: (id: string) => void }) {
  const shortId = useOptionalPages()?.workspace.shortId ?? "";
  return (
    <div className="my-1 w-full max-w-md" contentEditable={false} data-wishlist-block>
      <WishlistEmbed shortId={shortId} wishlistId={wishlistId} editable={editable} onPick={onPick} />
    </div>
  );
}
