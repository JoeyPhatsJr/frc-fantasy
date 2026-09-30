// An unknown league 404s from app/l/[slug]/layout.tsx, and notFound() in a layout is handled one
// level up, so the root reuses the league "Nothing here" page.
export { default } from './l/[slug]/not-found';
