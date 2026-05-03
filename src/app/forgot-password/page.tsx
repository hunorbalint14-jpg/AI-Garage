import { ForgotPasswordForm } from "./forgot-password-form";
import { AnimatedBackground } from "@/components/animated-background";

export default function ForgotPasswordPage() {
  return (
    <div className="relative min-h-screen bg-[#050c1a] text-white">
      <AnimatedBackground />
      <main className="relative z-10 flex min-h-screen items-center justify-center px-6">
        <ForgotPasswordForm />
      </main>
    </div>
  );
}
