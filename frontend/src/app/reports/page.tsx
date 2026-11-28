"use client";

import { useState } from "react";
import { OverviewMap } from "@/components/maps";
import { ReportList } from "@/components/ReportList";
import { Card, LinkButton, Loading, PageHeader, Select } from "@/components/ui";
import { useRequireUser } from "@/lib/auth";
import { useApi } from "@/lib/hooks";
import type { Report, ReportStatus } from "@/lib/types";

const STATUSES: ReportStatus[] = ["SUBMITTED", "UNDER_REVIEW", "VERIFIED", "RESOLUTION_PENDING", "RESOLVED", "REOPENED", "REJECTED", "DUPLICATE"];

export default function ReportsPage() {
  const user = useRequireUser();
  // Verifiers start on the work that needs them: new submissions.
  const [status, setStatus] = useState<string>(user?.isPlatformAdmin ? "SUBMITTED" : "");
  const query = `/reports?limit=100${status ? `&status=${status}` : ""}`;
  const reports = useApi<Report[]>(user ? query : null);

  if (!user) return <Loading />;

  return (
    <>
      <PageHeader
        title={user.isPlatformAdmin ? "Review queue" : "My reports"}
        subtitle={user.isPlatformAdmin ? "All reports on the platform. Filter by status to find work to review." : "Reports you have submitted."}
        actions={<LinkButton href="/reports/new">Report an issue</LinkButton>}
      />
      <Card
        actions={
          <div className="w-52">
            <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll("_", " ").toLowerCase()}
                </option>
              ))}
            </Select>
          </div>
        }
        title={reports.data ? `${reports.data.length} report${reports.data.length === 1 ? "" : "s"}` : "Reports"}
      >
        {reports.data ? (
          <>
            {reports.data.length > 0 && (
              <div className="mb-3">
                <OverviewMap height={280} points={reports.data.map((r) => ({ id: r.id, label: r.title, location: r.location }))} />
              </div>
            )}
            <ReportList reports={reports.data} empty="No reports match." />
          </>
        ) : (
          <Loading />
        )}
      </Card>
    </>
  );
}
