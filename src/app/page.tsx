import Link from "next/link";
import { getCurrentTenant } from "@/lib/garages";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const tenant = await getCurrentTenant();

  if (!tenant) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
        <h1 className="text-4xl font-bold">Garage-AI</h1>
        <p className="max-w-xl text-center text-lg text-muted-foreground">
          AI-powered software for UK garages. MOT and service tracking, automated
          reminders, and AI-assisted client communication.
        </p>
        <div className="flex gap-3">
          <Button render={<Link href="/signup">Get started</Link>} />
          <Button
            variant="outline"
            render={<Link href="/staff/login">Staff login</Link>}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold" style={{ color: tenant.primary_color }}>
        {tenant.name}
      </h1>
      <p className="max-w-xl text-center text-muted-foreground">
        Welcome. Sign in to view your vehicles, MOT history, and book in for
        service.
      </p>
      <div className="flex gap-3">
        <Button render={<Link href="/login">Sign in</Link>} />
      </div>
    </main>
  );
}
