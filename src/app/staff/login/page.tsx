import { StaffLoginForm } from "./login-form";

type Props = {
  searchParams: Promise<{ email?: string }>;
};

export default async function StaffLoginPage({ searchParams }: Props) {
  const params = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <StaffLoginForm initialEmail={params.email ?? ""} />
    </main>
  );
}
