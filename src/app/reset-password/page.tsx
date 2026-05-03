import { ResetPasswordForm } from "./reset-password-form";
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
      <main className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Link invalid</CardTitle>
            <CardDescription>
              This reset link is missing or has expired.
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
      <ResetPasswordForm token={t} />
    </main>
  );
}
