import { ResetPasswordForm } from "./reset-password-form";
import { AnimatedBackground } from "@/components/animated-background";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Props = {
  searchParams: Promise<{ t?: string }>;
};

export default async function ResetPasswordPage({ searchParams }: Props) {
  const { t } = await searchParams;

  if (!t) {
    return (
      <div className="relative min-h-screen bg-[#050c1a] text-white">
        <AnimatedBackground />
        <main className="relative z-10 flex min-h-screen items-center justify-center px-6">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur-md text-center">
            <h2 className="text-xl font-bold">Link invalid</h2>
            <p className="mt-2 text-sm text-gray-400">
              This reset link is missing or has expired.
            </p>
            <a href="/forgot-password" className="mt-4 inline-block text-sm text-indigo-400 underline hover:text-indigo-300">
              Request a new reset link
            </a>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-[#050c1a] text-white">
      <AnimatedBackground />
      <main className="relative z-10 flex min-h-screen items-center justify-center px-6">
        <ResetPasswordForm token={t} />
      </main>
    </div>
  );
}
