type Props = {
  brandColor?: string;
  intensity?: "default" | "strong" | "none";
};

export function AnimatedBackground({
  brandColor,
  intensity = "default",
}: Props) {
  if (intensity === "none") return null;

  const op = intensity === "strong" ? [0.55, 0.40, 0.32] : [0.35, 0.22, 0.18];

  if (brandColor) {
    return (
      <div
        className="fixed inset-0 pointer-events-none overflow-hidden z-0"
        aria-hidden
      >
        <div
          className="animate-blob absolute -top-40 -left-40 h-[600px] w-[600px] rounded-full blur-[120px]"
          style={{ backgroundColor: brandColor, opacity: op[0] }}
        />
        <div
          className="animate-blob animation-delay-2 absolute top-1/3 -right-40 h-[500px] w-[500px] rounded-full blur-[100px]"
          style={{ backgroundColor: brandColor, opacity: op[1] }}
        />
        <div
          className="animate-blob animation-delay-4 absolute bottom-0 left-1/3 h-[400px] w-[400px] rounded-full blur-[80px]"
          style={{ backgroundColor: brandColor, opacity: op[2] }}
        />
        <Grid />
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 pointer-events-none overflow-hidden z-0"
      aria-hidden
    >
      <div className="animate-blob absolute -top-40 -left-40 h-[600px] w-[600px] rounded-full bg-indigo-900/40 blur-[120px]" />
      <div className="animate-blob animation-delay-2 absolute top-1/3 -right-40 h-[500px] w-[500px] rounded-full bg-blue-900/30 blur-[100px]" />
      <div className="animate-blob animation-delay-4 absolute bottom-0 left-1/3 h-[400px] w-[400px] rounded-full bg-violet-900/25 blur-[80px]" />
      <Grid />
    </div>
  );
}

function Grid() {
  return (
    <svg
      className="absolute inset-0 h-full w-full opacity-[0.04]"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern
          id="grid-bg"
          width="40"
          height="40"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 40 0 L 0 0 0 40"
            fill="none"
            stroke="white"
            strokeWidth="0.5"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid-bg)" />
    </svg>
  );
}
