import { redirect } from "next/navigation";

// Keeps every already-sent email link alive: the widget reads ?ticket= and
// opens the thread view.
export default async function TicketRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/staff?ticket=${id}`);
}
