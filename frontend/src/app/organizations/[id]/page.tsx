"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { CollaborationPanel } from "@/components/CollaborationPanel";
import { AreaDrawer, OverviewMap } from "@/components/maps";
import { ReportList } from "@/components/ReportList";
import { Badge, Button, Card, Empty, ErrorText, Field, Input, Loading, PageHeader, Select, Tabs } from "@/components/ui";
import { api } from "@/lib/api";
import { useRequireUser } from "@/lib/auth";
import { formatDate, useAction, useApi } from "@/lib/hooks";
import {
  COORDINATOR_ROLES,
  MANAGER_ROLES,
  type Assignment,
  type Capability,
  type Category,
  type Collaboration,
  type LatLng,
  type OrganizationDetail,
  type Report,
  type ServiceArea,
} from "@/lib/types";

type Tab = "people" | "categories" | "areas" | "opportunities" | "work" | "collaborations";

export default function OrganizationPage() {
  const { id } = useParams<{ id: string }>();
  const user = useRequireUser();
  const org = useApi<OrganizationDetail>(user ? `/organizations/${id}` : null);
  const [tab, setTab] = useState<Tab>("opportunities");

  if (!user || org.loading) return <Loading />;
  if (org.error || !org.data) return <ErrorText>{org.error ?? "Organization not found"}</ErrorText>;

  const o = org.data;
  const isManager = MANAGER_ROLES.includes(o.myRole);
  const isCoordinator = COORDINATOR_ROLES.includes(o.myRole);

  return (
    <>
      <PageHeader title={o.name} subtitle={`${o.description ?? ""} You are ${o.myRole.toLowerCase()}.`} />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "opportunities", label: "Opportunities" },
          { id: "work", label: "Work board" },
          { id: "collaborations", label: "Collaborations" },
          { id: "people", label: "Members & teams" },
          { id: "categories", label: "Categories" },
          { id: "areas", label: "Service areas" },
        ]}
      />
      {tab === "people" && <PeopleTab org={o} isManager={isManager} onChanged={org.reload} />}
      {tab === "categories" && <CategoriesTab orgId={o.id} isManager={isManager} />}
      {tab === "areas" && <AreasTab orgId={o.id} isManager={isManager} />}
      {tab === "opportunities" && <OpportunitiesTab orgId={o.id} isCoordinator={isCoordinator} />}
      {tab === "work" && <WorkTab orgId={o.id} />}
      {tab === "collaborations" && <CollaborationsTab orgId={o.id} isCoordinator={isCoordinator} />}
    </>
  );
}

function PeopleTab({ org, isManager, onChanged }: { org: OrganizationDetail; isManager: boolean; onChanged: () => Promise<void> }) {
  const { busy, error, run } = useAction();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [teamName, setTeamName] = useState("");
  const [teamPick, setTeamPick] = useState<Record<string, string>>({});

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title={`Members (${org.memberships.length})`}>
        <ul className="mb-3 divide-y divide-slate-100">
          {org.memberships.map((m) => (
            <li key={m.id} className="flex justify-between py-2 text-sm">
              <span>
                {m.user.name} <span className="text-xs text-slate-500">{m.user.email}</span>
              </span>
              <span className="text-xs text-slate-500">{m.role.toLowerCase()}</span>
            </li>
          ))}
        </ul>
        {isManager && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await api("POST", `/organizations/${org.id}/members`, { email, role });
                setEmail("");
                await onChanged();
              });
            }}
          >
            <div className="min-w-48 flex-1">
              <Field label="Add member by email" hint="They need an OpenField account first.">
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
            </div>
            <div className="w-36">
              <Field label="Role">
                <Select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="MEMBER">Member</option>
                  <option value="COORDINATOR">Coordinator</option>
                  <option value="ADMIN">Admin</option>
                </Select>
              </Field>
            </div>
            <Button type="submit" disabled={busy}>
              Add
            </Button>
          </form>
        )}
      </Card>
      <Card title={`Teams (${org.teams.length})`}>
        {org.teams.length === 0 && <Empty>No teams yet. Teams are what you assign to reports.</Empty>}
        <ul className="mb-3 space-y-3">
          {org.teams.map((t) => {
            const inTeam = new Set(t.memberships.map((tm) => tm.organizationMembership.id));
            const candidates = org.memberships.filter((m) => !inTeam.has(m.id));
            return (
              <li key={t.id} className="rounded-md border border-slate-200 p-2">
                <p className="text-sm font-medium">{t.name}</p>
                <p className="text-xs text-slate-500">
                  {t.memberships.length ? t.memberships.map((tm) => tm.organizationMembership.user.name).join(", ") : "No members yet"}
                </p>
                {isManager && candidates.length > 0 && (
                  <form
                    className="mt-2 flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(async () => {
                        await api("POST", `/organizations/${org.id}/teams/${t.id}/members`, { membershipId: teamPick[t.id] });
                        await onChanged();
                      });
                    }}
                  >
                    <Select required value={teamPick[t.id] ?? ""} onChange={(e) => setTeamPick({ ...teamPick, [t.id]: e.target.value })}>
                      <option value="">Add a member…</option>
                      {candidates.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.user.name}
                        </option>
                      ))}
                    </Select>
                    <Button type="submit" variant="secondary" disabled={busy}>
                      Add
                    </Button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
        {isManager && (
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await api("POST", `/organizations/${org.id}/teams`, { name: teamName });
                setTeamName("");
                await onChanged();
              });
            }}
          >
            <div className="flex-1">
              <Field label="New team">
                <Input required minLength={2} value={teamName} onChange={(e) => setTeamName(e.target.value)} />
              </Field>
            </div>
            <Button type="submit" disabled={busy}>
              Create
            </Button>
          </form>
        )}
      </Card>
      <div className="md:col-span-2">
        <ErrorText>{error}</ErrorText>
      </div>
    </div>
  );
}

function CategoriesTab({ orgId, isManager }: { orgId: string; isManager: boolean }) {
  const categories = useApi<Category[]>("/categories");
  const capabilities = useApi<Capability[]>(`/organizations/${orgId}/categories`);
  const { busy, error, run } = useAction();

  if (!categories.data || !capabilities.data) return <Loading />;
  const selected = new Set(capabilities.data.map((c) => c.categoryId));
  const byParent = new Map<string | null, Category[]>();
  for (const c of categories.data) byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c]);

  const toggle = (categoryId: string) =>
    void run(async () => {
      await api(selected.has(categoryId) ? "DELETE" : "PUT", `/organizations/${orgId}/categories/${categoryId}`);
      await capabilities.reload();
    });

  const renderTree = (parentId: string | null, depth: number): React.ReactNode =>
    (byParent.get(parentId) ?? []).map((c) => (
      <div key={c.id}>
        <label className="flex items-center gap-2 py-1 text-sm" style={{ paddingLeft: depth * 20 }}>
          <input type="checkbox" checked={selected.has(c.id)} disabled={!isManager || busy} onChange={() => toggle(c.id)} />
          {c.name}
        </label>
        {renderTree(c.id, depth + 1)}
      </div>
    ));

  return (
    <Card title="Categories you handle">
      <p className="mb-3 text-sm text-slate-600">
        Ticking a category also covers everything beneath it: handling “Environment” means you are offered “Waste” reports too.
      </p>
      {categories.data.length === 0 ? <Empty>No categories exist yet. A platform admin creates them.</Empty> : renderTree(null, 0)}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function AreasTab({ orgId, isManager }: { orgId: string; isManager: boolean }) {
  const areas = useApi<ServiceArea[]>(`/organizations/${orgId}/service-areas`);
  const { busy, error, run } = useAction();
  const [points, setPoints] = useState<LatLng[]>([]);
  const [name, setName] = useState("");

  if (!areas.data) return <Loading />;
  const existing = areas.data.map((a) => ({ id: a.id, name: a.name, coordinates: a.area.coordinates }));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Map" className="lg:col-span-2">
        {isManager ? (
          <>
            <p className="mb-2 text-sm text-slate-600">Click the map to outline a new area (at least 3 points). Blue shapes are your current areas.</p>
            <AreaDrawer points={points} onAddPoint={(p) => setPoints([...points, p])} existing={existing} />
          </>
        ) : (
          <OverviewMap areas={existing} />
        )}
      </Card>
      <div className="space-y-4">
        {isManager && (
          <Card title="New area">
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                const ring = [...points, points[0]!].map((p) => [p.lng, p.lat]);
                void run(async () => {
                  await api("POST", `/organizations/${orgId}/service-areas`, { name, area: { type: "Polygon", coordinates: [ring] } });
                  setPoints([]);
                  setName("");
                  await areas.reload();
                });
              }}
            >
              <Field label="Name">
                <Input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} placeholder="North Pune" />
              </Field>
              <p className="text-xs text-slate-500">{points.length} point{points.length === 1 ? "" : "s"} placed</p>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy || points.length < 3}>
                  Save area
                </Button>
                <Button type="button" variant="ghost" onClick={() => setPoints(points.slice(0, -1))} disabled={points.length === 0}>
                  Undo
                </Button>
                <Button type="button" variant="ghost" onClick={() => setPoints([])} disabled={points.length === 0}>
                  Clear
                </Button>
              </div>
              <ErrorText>{error}</ErrorText>
            </form>
          </Card>
        )}
        <Card title="Current areas">
          {areas.data.length === 0 ? (
            <Empty>No service areas yet. You only receive independent reports inside your areas.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {areas.data.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                  {a.name}
                  {isManager && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api("DELETE", `/organizations/${orgId}/service-areas/${a.id}`);
                          await areas.reload();
                        })
                      }
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function OpportunitiesTab({ orgId, isCoordinator }: { orgId: string; isCoordinator: boolean }) {
  const reports = useApi<Report[]>(`/reports/opportunities?organizationId=${orgId}`);
  if (!reports.data) return <Loading />;
  return (
    <Card title="Reports offered to you">
      <p className="mb-3 text-sm text-slate-600">
        Verified reports in your service areas and categories that no team is working on.{" "}
        {isCoordinator ? "Open one to claim it for a team." : "Coordinators can claim them."}
      </p>
      {reports.data.length > 0 && (
        <div className="mb-3">
          <OverviewMap height={300} points={reports.data.map((r) => ({ id: r.id, label: r.title, location: r.location }))} />
        </div>
      )}
      <ReportList reports={reports.data} empty="Nothing to claim right now." />
    </Card>
  );
}

function WorkTab({ orgId }: { orgId: string }) {
  const assignments = useApi<Assignment[]>(`/organizations/${orgId}/assignments`);
  if (!assignments.data) return <Loading />;
  return (
    <Card title="Assignments">
      {assignments.data.length === 0 ? (
        <Empty>Your teams have not claimed any reports yet.</Empty>
      ) : (
        <ul className="divide-y divide-slate-100">
          {assignments.data.map((a) => (
            <li key={a.id}>
              <Link href={`/reports/${a.reportId}`} className="flex items-center justify-between gap-3 px-1 py-2.5 hover:bg-slate-50">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{a.report?.title}</p>
                  <p className="text-xs text-slate-500">
                    {a.team?.name} · claimed {formatDate(a.createdAt)}
                    {a.status === "CLAIMED" && ` · start by ${formatDate(a.startDeadlineAt)}`}
                  </p>
                </div>
                <Badge status={a.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CollaborationsTab({ orgId, isCoordinator }: { orgId: string; isCoordinator: boolean }) {
  const items = useApi<Collaboration[]>(`/collaborations?organizationId=${orgId}`);
  if (!items.data) return <Loading />;
  const received = items.data.filter((c) => c.organizationId === orgId);
  const sent = items.data.filter((c) => c.organizationId !== orgId);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-3">
        <h2 className="text-base font-semibold">Invitations received</h2>
        {received.length === 0 && <Card><Empty>No invitations.</Empty></Card>}
        {received.map((c) => (
          <div key={c.id}>
            <p className="mb-1 text-sm">
              <Link href={`/reports/${c.assignment?.report.id}`} className="font-medium text-emerald-800 hover:underline">
                {c.assignment?.report.title}
              </Link>{" "}
              <span className="text-slate-500">from {c.assignment?.organization.name}</span>
            </p>
            {isCoordinator ? (
              <CollaborationPanel collaboration={c} onChanged={items.reload} />
            ) : (
              <Badge status={c.status} />
            )}
          </div>
        ))}
      </div>
      <Card title="Invitations sent">
        {sent.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {sent.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  {c.organization.name} · <Link href={`/reports/${c.assignment?.report.id}`} className="text-emerald-800 hover:underline">{c.assignment?.report.title}</Link>
                </span>
                <Badge status={c.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
