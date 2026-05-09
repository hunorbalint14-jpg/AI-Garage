export type PortalTheme = "dark" | "light" | "glass" | "workshop";

export type ThemeConfig = {
  outer: string;
  sidebar: string;
  content: string;
  sidebarText: string;
  sidebarSubtext: string;
  sidebarBorder: string;
  navActive: string;
  navInactive: string;
  showBlobs: boolean;
  blobIntensity: "default" | "strong" | "none";
};

export const PORTAL_THEMES: Record<PortalTheme, ThemeConfig> = {
  dark: {
    outer: "relative flex min-h-screen bg-[#050c1a]",
    sidebar:
      "relative z-10 flex w-60 shrink-0 flex-col border-r border-white/10 bg-[#0a1020]/50 backdrop-blur-md",
    content: "relative z-10 flex min-w-0 flex-1 flex-col bg-[#f8fafc]",
    sidebarText: "text-white",
    sidebarSubtext: "text-gray-400",
    sidebarBorder: "border-white/10",
    navActive: "bg-white/20 text-white",
    navInactive: "text-gray-400 hover:bg-white/10 hover:text-white",
    showBlobs: true,
    blobIntensity: "default",
  },
  light: {
    outer: "relative flex min-h-screen bg-gray-50",
    sidebar:
      "relative flex w-60 shrink-0 flex-col border-r border-gray-200 bg-white shadow-sm",
    content: "relative flex min-w-0 flex-1 flex-col bg-gray-50",
    sidebarText: "text-gray-900",
    sidebarSubtext: "text-gray-500",
    sidebarBorder: "border-gray-200",
    navActive: "text-white", // brand colour via inline style
    navInactive: "text-gray-500 hover:bg-gray-100 hover:text-gray-900",
    showBlobs: false,
    blobIntensity: "none",
  },
  glass: {
    outer: "relative flex min-h-screen bg-[#050c1a]",
    sidebar:
      "relative z-10 flex w-60 shrink-0 flex-col border-r border-white/5 bg-transparent backdrop-blur-sm",
    content:
      "relative z-10 flex min-w-0 flex-1 flex-col bg-white/[0.88] backdrop-blur-xl",
    sidebarText: "text-white",
    sidebarSubtext: "text-gray-300",
    sidebarBorder: "border-white/5",
    navActive: "text-white", // brand colour via inline style
    navInactive: "text-gray-300 hover:bg-white/10 hover:text-white",
    showBlobs: true,
    blobIntensity: "strong",
  },
  workshop: {
    outer: "flex min-h-screen bg-[#0e1014]",
    sidebar: "flex w-60 shrink-0 flex-col border-r border-[#2a2f37] bg-[#15181d]",
    content: "flex min-w-0 flex-1 flex-col bg-[#0e1014] text-foreground dark",
    sidebarText: "text-[#e6e8eb]",
    sidebarSubtext: "text-[#5a6170]",
    sidebarBorder: "border-[#2a2f37]",
    navActive: "bg-[#f4d35e] text-[#0e1014] font-bold",
    navInactive: "text-[#9aa1ad] hover:bg-[#1c2026] hover:text-[#e6e8eb]",
    showBlobs: false,
    blobIntensity: "none",
  },
};
