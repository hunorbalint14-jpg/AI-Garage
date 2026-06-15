import { listFeatureFlags } from "@/lib/feature-flags";
import { FlagToggle } from "./flag-toggle";

export default async function FeatureFlagsPage() {
  const flags = await listFeatureFlags();
  // Build-time flag: PPR is baked at `next build`, so it can't be toggled on a
  // live server — we can only report the running build's state.
  const pprEnabled = process.env.ENABLE_PPR === "true";

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

      {/* Build-time flags — read-only. These are baked into the deployed build
          (next.config / env at build time), so they can't be flipped live; this
          is a status readout, not a switch. */}
      <div>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#5a6170]">
          Build-time (read-only)
        </h2>
        <div className="overflow-hidden rounded-xl border border-[#23272f]">
          <div className="flex items-start justify-between gap-6 bg-[#15181d] px-4 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Partial Prerendering (PPR)</h3>
                <code className="rounded bg-[#0f1115] px-1.5 py-0.5 font-mono text-[10.5px] text-[#5a6170]">
                  ENABLE_PPR
                </code>
                <span className="rounded-[10px] border border-[#2c4458] bg-[#1f2a35] px-1.5 font-mono text-[10px] font-semibold text-[#7ec8ff]">
                  global · build-time
                </span>
              </div>
              <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-[#9aa1ad]">
                Serves a static shell instantly and streams the dynamic content (cacheComponents).
                Baked at build, so it can&apos;t be toggled here — set{" "}
                <code className="font-mono text-[#9aa1ad]">ENABLE_PPR=true</code> in the deploy
                environment and redeploy.
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold ${
                pprEnabled
                  ? "border-[#2a5a3a] bg-[#13301f] text-[#5fdd9d]"
                  : "border-[#3a3f47] bg-[#1c2026] text-[#9aa1ad]"
              }`}
            >
              {pprEnabled ? "ON" : "OFF"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
