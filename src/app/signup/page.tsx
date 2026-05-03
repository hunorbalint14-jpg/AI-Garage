import Link from "next/link";
import { SignupForm } from "./signup-form";
import { AnimatedBackground } from "@/components/animated-background";

export default function SignupPage() {
  return (
    <div className="relative min-h-screen bg-[#050c1a] text-white overflow-x-hidden">
      <AnimatedBackground />

      <nav className="relative z-10 flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <Link href="/" className="text-xl font-bold tracking-tight">
          Garage<span className="text-indigo-400">AI</span>
        </Link>
        <Link href="/staff/login" className="text-sm text-gray-400 hover:text-white transition-colors">
          Already have an account? Sign in →
        </Link>
      </nav>

      <main className="relative z-10 flex min-h-[calc(100vh-72px)] items-center justify-center px-6 pb-12">
        <SignupForm />
      </main>
    </div>
  );
}
