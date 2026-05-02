import Link from "next/link";
import { CustomerForm } from "./customer-form";

export default function NewCustomerPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          href="/staff/customers"
          className="text-sm text-muted-foreground underline"
        >
          ← Back to customers
        </Link>
        <h1 className="text-2xl font-bold">Add customer</h1>
      </div>
      <CustomerForm />
    </div>
  );
}
