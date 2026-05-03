import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./reset-password-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function ResetPasswordPage() {
  // Verify there is a valid session server-side before rendering the form.
  // The session was set by the callback route's exchangeCodeForSession.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Link invalid</CardTitle>
            <CardDescription>
              This reset link has expired or already been used.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <a href="/forgot-password" className="text-sm underline">
              Request a new reset link
            </a>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <ResetPasswordForm />
    </main>
  );
}
