"use client";

import Link from "next/link";
import { Badge, Empty } from "@/components/ui";
import { formatDate } from "@/lib/hooks";
import type { Report } from "@/lib/types";

export function ReportList({ reports, empty }: { reports: Report[]; empty: string }) {
  if (reports.length === 0) return <Empty>{empty}</Empty>;
  return (
    <ul className="divide-y divide-slate-100">
      {reports.map((report) => (
        <li key={report.id}>
          <Link href={`/reports/${report.id}`} className="flex items-center justify-between gap-3 px-1 py-2.5 hover:bg-slate-50">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{report.title}</p>
              <p className="text-xs text-slate-500">{formatDate(report.createdAt)}</p>
            </div>
            <Badge status={report.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
