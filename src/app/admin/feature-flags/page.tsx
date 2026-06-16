import { listFeatureFlags } from "@/lib/feature-flags";
import { FlagToggle } from "./flag-toggle";

export default async function FeatureFlagsPage() {
  const flags = await listFeatureFlags();

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[12.5px] text-[#9aa1ad]">
        Platform-wide capability switches. Toggling one takes effect across every garage within
        ~30 seconds. Flags fall back to their code default if the store is unavailable.
      </p>

      <div className="overflow-hidden rounded-xl border border-[#23272f]">
        {flags.map((flag, i) => (
          <div
            key={flag.key}
            className={`flex items-start justify-between gap-6 bg-[#15181d] px-4 py-4 ${
              i > 0 ? "border-t border-[#23272f]" : ""
            }`}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">{flag.label}</h2>
                <code className="rounded bg-[#0f1115] px-1.5 py-0.5 font-mono text-[10.5px] text-[#5a6170]">
                  {flag.key}
                </code>
                {flag.enabled !== flag.default && (
                  <span className="rounded-[10px] border border-[#5a4a1f] bg-[#2e2410] px-1.5 font-mono text-[10px] font-semibold text-[#f5c451]">
                    overridden
                  </span>
                )}
              </div>
              <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-[#9aa1ad]">
                {flag.description}
              </p>
              <p className="mt-1.5 font-mono text-[10.5px] text-[#5a6170]">
                default: {flag.default ? "on" : "off"}
              </p>
            </div>
            <FlagToggle flagKey={flag.key} initialEnabled={flag.enabled} />
          </div>
        ))}

        {flags.length === 0 && (
          <div className="bg-[#15181d] px-4 py-6 text-center text-sm text-[#5a6170]">
            No feature flags registered.
          </div>
        )}
      </div>
    </div>
  );
}
