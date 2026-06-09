import { createAdminClient } from "@/lib/supabase/admin";

// Incident reads for /admin/health. Service-role, server-only.

export type IncidentSeverity = "SEV-1" | "SEV-2" | "SEV-3" | "SEV-4";
export type IncidentStatus = "Investigating" | "Identified" | "Monitoring" | "Resolved";

export type IncidentUpdate = {
  id: number;
  status: string;
  body: string;
  actor_email: string | null;
  public: boolean;
  created_at: string;
};

export type Incident = {
  id: string;
  ref: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  components: string[];
  published: boolean;
  acked_at: string | null;
  auto_declared: boolean;
  started_at: string;
  resolved_at: string | null;
  updates: IncidentUpdate[];
};

export async function fetchActiveIncidents(): Promise<Incident[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("incidents")
    .select(
      "id, ref, title, severity, status, components, published, acked_at, auto_declared, started_at, resolved_at, incident_updates(id, status, body, actor_email, public, created_at)",
    )
    .is("resolved_at", null)
    .order("started_at", { ascending: false });

  const rows = (data ?? []) as unknown as (Omit<Incident, "updates"> & { incident_updates: IncidentUpdate[] })[];
  return rows.map(({ incident_updates, ...rest }) => ({
    ...rest,
    components: rest.components ?? [],
    updates: [...(incident_updates ?? [])].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    ),
  }));
}
