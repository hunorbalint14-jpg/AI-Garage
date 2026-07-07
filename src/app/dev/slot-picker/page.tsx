import { notFound } from "next/navigation";
import { SlotPickerDemo } from "./demo";

// Dev-only proof page for <SlotPicker> in both themes (UX review F13
// acceptance: "a demo page or test proves both themes"). Fixture-driven —
// no consumers are wired here; issues #473/#474 do that.
export default function SlotPickerDemoPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <SlotPickerDemo />;
}
