// Shown at once while a section of the workspace is loading, so a click never
// looks ignored. Plain shapes only: no data, no text to translate.
export default function WorkspaceLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 md:px-12 md:pt-12 xl:max-w-6xl" aria-busy="true" data-loading>
      <div className="animate-pulse motion-reduce:animate-none">
        <div className="h-9 w-2/5 rounded-lg bg-surface" />
        <div className="mt-8 space-y-3">
          <div className="h-4 w-full rounded bg-surface" />
          <div className="h-4 w-11/12 rounded bg-surface" />
          <div className="h-4 w-4/5 rounded bg-surface" />
          <div className="h-4 w-3/5 rounded bg-surface" />
        </div>
      </div>
    </main>
  );
}
