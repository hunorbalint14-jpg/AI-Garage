import { AigLoader } from "@/components/ui/aig-loader";

// Customer portal home (and its sub-routes) — no persistent layout shell, so the
// branded full-screen loader is the right fit, matching /book and /plan.
export default function Loading() {
  return <AigLoader />;
}
