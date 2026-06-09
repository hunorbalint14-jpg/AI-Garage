import { AigLoader } from "@/components/ui/aig-loader";

// Public token-gated quote page — standalone, so brand the cold load.
export default function Loading() {
  return <AigLoader />;
}
