import { ListPageSkeleton } from "@/components/staff/skeletons";

// Universal staff loading skeleton. Cascades to every /staff/* route without its
// own loading.tsx, so a navigation paints the page shape instantly (the shell
// persists across client navigations). Most staff pages are lists, so a table
// shape is the right default; chart/calendar routes override it.
export default function Loading() {
  return <ListPageSkeleton />;
}
