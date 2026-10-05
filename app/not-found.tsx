import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <section className="pane w-full max-w-md" aria-labelledby="nf-title">
        <span className="pane-corner pane-corner--tr" aria-hidden="true" />
        <span className="pane-corner pane-corner--bl" aria-hidden="true" />
        <div className="pane-head">
          <h1 id="nf-title" className="pane-title">
            404 / no such lead
          </h1>
        </div>
        <div className="pane-body flex flex-col gap-4 p-6">
          <p className="pane-title--readable text-sm leading-relaxed">
            This record does not exist, was archived, or the id was mistyped.
          </p>
          <div>
            <Link className="btn btn--primary" href="/">
              Back to queue
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
