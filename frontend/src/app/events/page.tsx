"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Empty, ErrorText, Field, Input, Loading, PageHeader, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useRequireUser } from "@/lib/auth";
import { formatDate, useAction, useApi } from "@/lib/hooks";
import { MANAGER_ROLES, type Event, type MyOrganization } from "@/lib/types";

export default function EventsPage() {
  const user = useRequireUser();
  const router = useRouter();
  const events = useApi<Event[]>(user ? "/events" : null);
  const myOrgs = useApi<MyOrganization[]>(user ? "/organizations" : null);
  const { busy, error, run } = useAction();
  const [form, setForm] = useState({ organizationId: "", title: "", description: "", startsAt: "", endsAt: "" });

  if (!user) return <Loading />;
  const hostable = (myOrgs.data ?? []).filter((m) => MANAGER_ROLES.includes(m.role));

  return (
    <>
      <PageHeader title="Events" subtitle="Campaigns that group reports and the organizations working on them." />
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Active events" className="md:col-span-2">
          {!events.data ? (
            <Loading />
          ) : events.data.length === 0 ? (
            <Empty>No active events.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {events.data.map((e) => (
                <li key={e.id}>
                  <Link href={`/events/${e.id}`} className="block px-1 py-2.5 hover:bg-slate-50">
                    <p className="text-sm font-medium">{e.title}</p>
                    <p className="text-xs text-slate-500">
                      Hosted by {e.hostOrganization?.name} · starts {formatDate(e.startsAt)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Host an event">
          {hostable.length === 0 ? (
            <p className="text-sm text-slate-500">Owners and admins of an organization can host events.</p>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  const created = await api<Event>("POST", "/events", {
                    organizationId: form.organizationId,
                    title: form.title,
                    description: form.description || undefined,
                    startsAt: new Date(form.startsAt).toISOString(),
                    endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : undefined,
                  });
                  router.push(`/events/${created.id}`);
                });
              }}
            >
              <Field label="Host organization">
                <Select required value={form.organizationId} onChange={(e) => setForm({ ...form, organizationId: e.target.value })}>
                  <option value="">Choose…</option>
                  {hostable.map((m) => (
                    <option key={m.organization.id} value={m.organization.id}>
                      {m.organization.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Title">
                <Input required minLength={3} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Save Our Lake" />
              </Field>
              <Field label="Description">
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </Field>
              <Field label="Starts">
                <Input type="datetime-local" required value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
              </Field>
              <Field label="Ends (optional)">
                <Input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
              </Field>
              <ErrorText>{error}</ErrorText>
              <Button type="submit" disabled={busy}>
                Create event
              </Button>
            </form>
          )}
        </Card>
      </div>
    </>
  );
}
