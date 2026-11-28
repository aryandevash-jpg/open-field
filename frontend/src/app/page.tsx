"use client";

import Link from "next/link";
import { OverviewMap } from "@/components/maps";
import { ReportList } from "@/components/ReportList";
import { Card, LinkButton, Loading, PageHeader } from "@/components/ui";
import { useRequireUser } from "@/lib/auth";
import { useApi } from "@/lib/hooks";
import type { MyOrganization, Notification, Report } from "@/lib/types";

export default function HomePage() {
  const user = useRequireUser();
  const reports = useApi<Report[]>(user ? "/reports?limit=20" : null);
  const organizations = useApi<MyOrganization[]>(user ? "/organizations" : null);
  const notifications = useApi<{ items: Notification[]; unread: number }>(user ? "/notifications?limit=5" : null);

  if (!user) return <Loading />;

  return (
    <>
      <PageHeader
        title={`Hello, ${user.name}`}
        subtitle={user.isPlatformAdmin ? "You are a platform verifier: the review queue lists every report." : "Track your reports and your organizations' work."}
        actions={<LinkButton href="/reports/new">Report an issue</LinkButton>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={user.isPlatformAdmin ? "Latest reports" : "My reports"} className="lg:col-span-2" actions={<Link href="/reports" className="text-sm text-emerald-800 hover:underline">View all</Link>}>
          {reports.data ? (
            <>
              {reports.data.length > 0 && (
                <div className="mb-3">
                  <OverviewMap
                    height={260}
                    points={reports.data.map((r) => ({ id: r.id, label: `${r.title} (${r.status.toLowerCase()})`, location: r.location }))}
                  />
                </div>
              )}
              <ReportList reports={reports.data.slice(0, 8)} empty="No reports yet. Spotted a problem? Report it." />
            </>
          ) : (
            <Loading />
          )}
        </Card>
        <div className="space-y-4">
          <Card title="My organizations" actions={<Link href="/organizations" className="text-sm text-emerald-800 hover:underline">Manage</Link>}>
            {organizations.data?.length ? (
              <ul className="space-y-1">
                {organizations.data.map((m) => (
                  <li key={m.id}>
                    <Link href={`/organizations/${m.organization.id}`} className="flex justify-between rounded px-1 py-1 text-sm hover:bg-slate-50">
                      <span>{m.organization.name}</span>
                      <span className="text-xs text-slate-500">{m.role.toLowerCase()}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">You are not in any organization yet.</p>
            )}
          </Card>
          <Card title="Recent notifications" actions={<Link href="/notifications" className="text-sm text-emerald-800 hover:underline">All</Link>}>
            {notifications.data?.items.length ? (
              <ul className="space-y-2">
                {notifications.data.items.map((n) => (
                  <li key={n.id} className={`text-sm ${n.readAt ? "text-slate-500" : "font-medium text-slate-900"}`}>
                    {n.reportId ? <Link href={`/reports/${n.reportId}`} className="hover:underline">{n.title}</Link> : n.eventId ? <Link href={`/events/${n.eventId}`} className="hover:underline">{n.title}</Link> : n.title}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Nothing new.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
