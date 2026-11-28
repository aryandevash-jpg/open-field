"use client";

import Link from "next/link";
import { Button, Card, Empty, Loading, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useRequireUser } from "@/lib/auth";
import { formatDate, useApi } from "@/lib/hooks";
import type { Notification } from "@/lib/types";

export default function NotificationsPage() {
  const user = useRequireUser();
  const notifications = useApi<{ items: Notification[]; unread: number }>(user ? "/notifications?limit=100" : null);

  if (!user || !notifications.data) return <Loading />;

  const open = async (n: Notification) => {
    if (!n.readAt) await api("POST", `/notifications/${n.id}/read`);
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={`${notifications.data.unread} unread`}
        actions={
          notifications.data.unread > 0 && (
            <Button variant="secondary" onClick={async () => { await api("POST", "/notifications/read-all"); await notifications.reload(); }}>
              Mark all as read
            </Button>
          )
        }
      />
      <Card>
        {notifications.data.items.length === 0 ? (
          <Empty>No notifications yet.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {notifications.data.items.map((n) => {
              const href = n.reportId ? `/reports/${n.reportId}` : n.eventId ? `/events/${n.eventId}` : null;
              const body = (
                <div className="flex items-start justify-between gap-3 py-2.5">
                  <p className={`text-sm ${n.readAt ? "text-slate-500" : "font-medium text-slate-900"}`}>
                    {!n.readAt && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-600" />}
                    {n.title}
                  </p>
                  <span className="whitespace-nowrap text-xs text-slate-500">{formatDate(n.createdAt)}</span>
                </div>
              );
              return (
                <li key={n.id}>
                  {href ? (
                    <Link href={href} onClick={() => void open(n)} className="block px-1 hover:bg-slate-50">
                      {body}
                    </Link>
                  ) : (
                    <button onClick={async () => { await open(n); await notifications.reload(); }} className="block w-full px-1 text-left hover:bg-slate-50">
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
