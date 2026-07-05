import { redirect } from "next/navigation";

// The /staff/support pages were replaced by the floating support widget
// (top-right cluster, every staff page). Old bookmarks land on the dashboard
// where the widget lives.
export default function SupportRedirect() {
  redirect("/staff");
}
