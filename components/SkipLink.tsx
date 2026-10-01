/** First focusable element on every page: keyboard users jump past the sticky header to <main id="main">. */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-2 focus-visible:z-50 focus-visible:rounded-pill focus-visible:bg-primary-fill focus-visible:px-4 focus-visible:py-2.5 focus-visible:font-semibold focus-visible:text-on-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
    >
      Skip to content
    </a>
  );
}
