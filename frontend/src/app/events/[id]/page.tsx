"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { OverviewMap } from "@/components/maps";
import { ReportList } from "@/components/ReportList";
import { Badge, Button, Card, Empty, ErrorText, Field, LinkButton, Loading, PageHeader, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useRequireUser } from "@/lib/auth";
import { formatDate, useAction, useApi } from "@/lib/hooks";
import { MANAGER_ROLES, type Event, type MyOrganization, type Participation, type Report } from "@/lib/types";

export default function EventPage() {
  const { id } = useParams<{ id: string }>();
  const user = useRequireUser();
  const event = useApi<Event>(user ? `/events/${id}` : null);
  const myOrgs = useApi<MyOrganization[]>(user ? "/organizations" : null);
  const { busy, error, run } = useAction();
  const [requestOrg, setRequestOrg] = useState("");

  const hostMembership = myOrgs.data?.find((m) => m.organization.id === event.data?.hostOrganizationId);
  const isHostManager = !!hostMembership && MANAGER_ROLES.includes(hostMembership.role);
  const participations = useApi<Participation[]>(hostMembership ? `/events/${id}/participations` : null);
  // Visible to host members and approved participants; others get 403, shown as a hint.
  const reports = useApi<Report[]>(user ? `/events/${id}/reports` : null);

  if (!user || event.loading) return <Loading />;
  if (event.error || !event.data) return <ErrorText>{event.error ?? "Event not found"}</ErrorText>;
  const e = event.data;
  const requestable = (myOrgs.data ?? []).filter((m) => MANAGER_ROLES.includes(m.role) && m.organization.id !== e.hostOrganizationId);

  const act = (path: string, body?: unknown) =>
    run(async () => {
      await api("POST", path, body);
      await Promise.all([event.reload(), participations.reload(), reports.reload()]);
    });

  return (
    <>
      <PageHeader
        title={e.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge status={e.status} /> Hosted by {e.hostOrganization?.name} · {formatDate(e.startsAt)}
            {e.endsAt && ` – ${formatDate(e.endsAt)}`}
          </span>
        }
        actions={e.status === "ACTIVE" && <LinkButton href={`/reports/new?eventId=${e.id}`}>Report for this event</LinkButton>}
      />
      {e.description && <p className="mb-4 text-sm text-slate-700">{e.description}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Event reports" className="lg:col-span-2">
          {reports.error ? (
            <Empty>Only the host and approved participating organizations can see this event&apos;s reports.</Empty>
          ) : !reports.data ? (
            <Loading />
          ) : (
            <>
              {reports.data.length > 0 && (
                <div className="mb-3">
                  <OverviewMap height={280} points={reports.data.map((r) => ({ id: r.id, label: r.title, location: r.location }))} />
                </div>
              )}
              <ReportList reports={reports.data} empty="No reports linked to this event yet." />
            </>
          )}
        </Card>

        <div className="space-y-4">
          {requestable.length > 0 && e.status === "ACTIVE" && (
            <Card title="Join this event">
              <form
                className="space-y-2"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  void act(`/events/${e.id}/participation-requests`, { organizationId: requestOrg });
                }}
              >
                <Field label="As organization">
                  <Select required value={requestOrg} onChange={(ev) => setRequestOrg(ev.target.value)}>
                    <option value="">Choose…</option>
                    {requestable.map((m) => (
                      <option key={m.organization.id} value={m.organization.id}>
                        {m.organization.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button type="submit" disabled={busy}>
                  Ask to participate
                </Button>
              </form>
            </Card>
          )}

          {hostMembership && (
            <Card title="Participating organizations">
              {!participations.data?.length ? (
                <Empty>No requests yet.</Empty>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {participations.data.map((p) => (
                    <li key={p.organizationId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span>{p.organization?.name}</span>
                      {p.status === "PENDING" && isHostManager ? (
                        <span className="flex gap-1">
                          <Button disabled={busy} onClick={() => void act(`/events/${e.id}/participations/${p.organizationId}/approve`)}>
                            Approve
                          </Button>
                          <Button variant="secondary" disabled={busy} onClick={() => void act(`/events/${e.id}/participations/${p.organizationId}/reject`)}>
                            Reject
                          </Button>
                        </span>
                      ) : (
                        <Badge status={p.status} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {isHostManager && e.status === "ACTIVE" && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <Button variant="secondary" disabled={busy} onClick={() => void act(`/events/${e.id}/complete`)}>
                    Mark event completed
                  </Button>
                </div>
              )}
            </Card>
          )}
          <ErrorText>{error}</ErrorText>
        </div>
      </div>
    </>
  );
}
