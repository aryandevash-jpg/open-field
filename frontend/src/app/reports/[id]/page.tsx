"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { OverviewMap } from "@/components/maps";
import { CollaborationPanel } from "@/components/CollaborationPanel";
import { ReasonAction } from "@/components/ReasonAction";
import { Badge, Button, Card, Empty, ErrorText, Field, Input, Loading, PageHeader, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useRequireUser } from "@/lib/auth";
import { formatDate, useAction, useApi } from "@/lib/hooks";
import {
  COORDINATOR_ROLES,
  type Assignment,
  type Category,
  type Comment,
  type HistoryEntry,
  type MyOrganization,
  type OrganizationDetail,
  type Report,
} from "@/lib/types";

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const user = useRequireUser();
  const report = useApi<Report>(user ? `/reports/${id}` : null);
  const history = useApi<HistoryEntry[]>(user ? `/reports/${id}/history` : null);
  const comments = useApi<Comment[]>(user ? `/reports/${id}/comments` : null);
  const assignments = useApi<Assignment[]>(user ? `/reports/${id}/assignments` : null);
  const categories = useApi<Category[]>(user ? "/categories?includeInactive=true" : null);
  const myOrgs = useApi<MyOrganization[]>(user ? "/organizations" : null);

  if (!user || report.loading) return <Loading />;
  if (report.error || !report.data) return <ErrorText>{report.error ?? "Report not found"}</ErrorText>;

  const r = report.data;
  const reloadAll = async () => {
    await Promise.all([report.reload(), history.reload(), assignments.reload(), comments.reload()]);
  };
  const category = categories.data?.find((c) => c.id === r.categoryId);
  const active = assignments.data?.find((a) => a.endedAt === null);

  return (
    <>
      <PageHeader
        title={r.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge status={r.status} />
            <span>{category?.name ?? "…"}</span>
            <span>· reported {formatDate(r.createdAt)}</span>
            {r.eventId && (
              <Link href={`/events/${r.eventId}`} className="text-emerald-800 hover:underline">
                · part of an event
              </Link>
            )}
            {r.duplicateOfReportId && (
              <Link href={`/reports/${r.duplicateOfReportId}`} className="text-emerald-800 hover:underline">
                · duplicate of another report
              </Link>
            )}
          </span>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Details">
            <p className="whitespace-pre-wrap text-sm text-slate-800">{r.description}</p>
            {r.media && r.media.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {r.media.map((m) => (
                  <a key={m.id} href={m.url} target="_blank" rel="noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.url} alt="Report photo" className="h-24 w-32 rounded border border-slate-200 object-cover" />
                  </a>
                ))}
              </div>
            )}
            <div className="mt-3">
              <OverviewMap height={240} points={[{ id: r.id, label: r.title, location: r.location }]} />
            </div>
          </Card>

          {user.isPlatformAdmin && <VerifierPanel report={r} onChanged={reloadAll} />}

          <WorkPanel report={r} active={active} myOrgs={myOrgs.data ?? []} onChanged={reloadAll} />

          <CommentsPanel reportId={r.id} comments={comments.data ?? []} onChanged={comments.reload} />
        </div>

        <div className="space-y-4">
          <Card title="Assignments">
            {assignments.data?.length ? (
              <ul className="space-y-3">
                {assignments.data.map((a) => (
                  <li key={a.id} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{a.team?.name}</span>
                      <Badge status={a.status} />
                    </div>
                    <p className="text-xs text-slate-500">
                      {a.organization?.name} · claimed {formatDate(a.createdAt)}
                    </p>
                    {a.completionNote && <p className="mt-1 text-xs text-slate-700">“{a.completionNote}”</p>}
                    {a.collaborations && a.collaborations.length > 0 && (
                      <ul className="mt-1 space-y-0.5 border-l-2 border-slate-200 pl-2">
                        {a.collaborations.map((c) => (
                          <li key={c.id} className="text-xs text-slate-600">
                            {c.organization.name} <Badge status={c.status} />
                            {c.teams.length > 0 && <span> · {c.teams.map((t) => t.team.name).join(", ")}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No team has taken this on yet.</Empty>
            )}
          </Card>

          <Card title="History">
            <ol className="space-y-2">
              {history.data?.map((h) => (
                <li key={h.id} className="text-sm">
                  <p className="font-medium text-slate-800">{h.action.replaceAll("_", " ").toLowerCase()}</p>
                  <p className="text-xs text-slate-500">
                    {h.actor.name} · {formatDate(h.createdAt)}
                  </p>
                  {h.reason && <p className="text-xs text-slate-700">“{h.reason}”</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}

// ------------------------------------
// Verifier actions (platform admins)
// ------------------------------------

function VerifierPanel({ report, onChanged }: { report: Report; onChanged: () => Promise<void> }) {
  const { busy, error, run } = useAction();
  const [duplicateOf, setDuplicateOf] = useState("");
  const act = (action: string, body?: unknown) => run(async () => {
    await api("POST", `/reports/${report.id}/${action}`, body);
    await onChanged();
  });
  const withReason = (action: string) => (reason?: string) => void act(action, reason ? { reason } : {});

  const s = report.status;
  const none = !["SUBMITTED", "REOPENED", "UNDER_REVIEW", "RESOLUTION_PENDING", "RESOLVED"].includes(s);

  return (
    <Card title="Verification">
      <div className="flex flex-wrap gap-2">
        {(s === "SUBMITTED" || s === "REOPENED") && <ReasonAction label="Start review" variant="primary" busy={busy} onSubmit={withReason("start-review")} />}
        {(s === "UNDER_REVIEW" || s === "REOPENED") && <ReasonAction label="Verify" variant="primary" busy={busy} onSubmit={withReason("verify")} />}
        {s === "UNDER_REVIEW" && (
          <>
            <ReasonAction label="Request information" requireReason placeholder="What is missing?" busy={busy} onSubmit={withReason("request-information")} />
            <ReasonAction label="Reject" variant="danger" requireReason placeholder="Why is it rejected?" busy={busy} onSubmit={withReason("reject")} />
          </>
        )}
        {s === "RESOLUTION_PENDING" && (
          <>
            <ReasonAction label="Approve resolution" variant="primary" busy={busy} onSubmit={withReason("resolve")} />
            <ReasonAction label="Return to team" requireReason placeholder="What still needs doing?" busy={busy} onSubmit={withReason("return-to-verified")} />
          </>
        )}
        {s === "RESOLVED" && <ReasonAction label="Reopen" requireReason placeholder="Why reopen?" busy={busy} onSubmit={withReason("reopen")} />}
        {none && <p className="text-sm text-slate-500">No verification action is needed in this status.</p>}
      </div>
      {s === "UNDER_REVIEW" && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void act("mark-duplicate", { duplicateOfReportId: duplicateOf.trim() });
          }}
        >
          <div className="min-w-64 flex-1">
            <Field label="Mark as duplicate of (report id)">
              <Input required value={duplicateOf} onChange={(e) => setDuplicateOf(e.target.value)} placeholder="Original report id" />
            </Field>
          </div>
          <Button type="submit" variant="secondary" disabled={busy}>
            Mark duplicate
          </Button>
        </form>
      )}
      <div className="mt-3">
        <ErrorText>{error}</ErrorText>
      </div>
    </Card>
  );
}

// ------------------------------------
// Claiming and working on the report
// ------------------------------------

function WorkPanel({
  report,
  active,
  myOrgs,
  onChanged,
}: {
  report: Report;
  active: Assignment | undefined;
  myOrgs: MyOrganization[];
  onChanged: () => Promise<void>;
}) {
  const coordinatorOrgs = myOrgs.filter((m) => COORDINATOR_ROLES.includes(m.role));
  const inLeadOrg = active ? myOrgs.find((m) => m.organization.id === active.organizationId) : undefined;
  const invitedCollaborations = (active?.collaborations ?? []).filter((c) =>
    coordinatorOrgs.some((m) => m.organization.id === c.organizationId)
  );

  if (report.status === "VERIFIED" && !active && coordinatorOrgs.length > 0) {
    return <ClaimPanel report={report} coordinatorOrgs={coordinatorOrgs} onChanged={onChanged} />;
  }
  if (active && inLeadOrg) {
    return <AssignmentPanel assignment={active} membership={inLeadOrg} onChanged={onChanged} />;
  }
  if (invitedCollaborations.length > 0) {
    return (
      <>
        {invitedCollaborations.map((c) => (
          <CollaborationPanel key={c.id} collaboration={c} onChanged={onChanged} />
        ))}
      </>
    );
  }
  return null;
}

function ClaimPanel({ report, coordinatorOrgs, onChanged }: { report: Report; coordinatorOrgs: MyOrganization[]; onChanged: () => Promise<void> }) {
  const [orgId, setOrgId] = useState(coordinatorOrgs[0]!.organization.id);
  const detail = useApi<OrganizationDetail>(`/organizations/${orgId}`);
  const [teamId, setTeamId] = useState("");
  const { busy, error, run } = useAction();

  return (
    <Card title="Take this on">
      <p className="mb-3 text-sm text-slate-600">
        Claim the report for one of your teams. The team must start within 24 hours or the claim expires.
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await api("POST", `/reports/${report.id}/assignments/claim`, { teamId });
            await onChanged();
          });
        }}
      >
        {coordinatorOrgs.length > 1 && (
          <div className="min-w-48">
            <Field label="Organization">
              <Select value={orgId} onChange={(e) => { setOrgId(e.target.value); setTeamId(""); }}>
                {coordinatorOrgs.map((m) => (
                  <option key={m.organization.id} value={m.organization.id}>
                    {m.organization.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        <div className="min-w-48">
          <Field label="Team">
            <Select required value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">Choose a team…</option>
              {detail.data?.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button type="submit" disabled={busy || !teamId}>
          Claim
        </Button>
      </form>
      {detail.data && detail.data.teams.length === 0 && (
        <p className="mt-2 text-sm text-slate-500">
          This organization has no teams yet. <Link href={`/organizations/${orgId}`} className="text-emerald-800 hover:underline">Create one</Link>.
        </p>
      )}
      <div className="mt-3">
        <ErrorText>{error}</ErrorText>
      </div>
    </Card>
  );
}

function AssignmentPanel({ assignment, membership, onChanged }: { assignment: Assignment; membership: MyOrganization; onChanged: () => Promise<void> }) {
  const isCoordinator = COORDINATOR_ROLES.includes(membership.role);
  const detail = useApi<OrganizationDetail>(isCoordinator ? `/organizations/${assignment.organizationId}` : null);
  const others = useApi<{ id: string; name: string }[]>(isCoordinator ? `/organizations/${assignment.organizationId}/other-organizations` : null);
  const { busy, error, run } = useAction();
  const [note, setNote] = useState("");
  const [photoUrls, setPhotoUrls] = useState("");
  const [transferTeam, setTransferTeam] = useState("");
  const [inviteOrg, setInviteOrg] = useState("");

  const act = (path: string, body?: unknown) => run(async () => {
    await api("POST", path, body);
    await onChanged();
  });

  return (
    <Card title={`Your organization's assignment · ${assignment.team?.name ?? ""}`} actions={<Badge status={assignment.status} />}>
      {assignment.status === "CLAIMED" && (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">Start before {formatDate(assignment.startDeadlineAt)} or the claim expires.</p>
          <Button disabled={busy} onClick={() => void act(`/assignments/${assignment.id}/start`)}>
            Start work
          </Button>
        </div>
      )}
      {assignment.status === "IN_PROGRESS" && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            const media = photoUrls.split(/\s+/).filter(Boolean).map((url) => ({ url }));
            void act(`/assignments/${assignment.id}/complete`, { note: note || undefined, media });
          }}
        >
          <Field label="Completion note">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done?" />
          </Field>
          <Field label="Evidence photo URLs (optional)" hint="One per line.">
            <Textarea rows={2} value={photoUrls} onChange={(e) => setPhotoUrls(e.target.value)} />
          </Field>
          <Button type="submit" disabled={busy}>
            Mark complete
          </Button>
        </form>
      )}

      {isCoordinator && (
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void act(`/assignments/${assignment.id}/transfer`, { teamId: transferTeam });
            }}
          >
            <div className="min-w-48">
              <Field label="Transfer to another team">
                <Select required value={transferTeam} onChange={(e) => setTransferTeam(e.target.value)}>
                  <option value="">Choose a team…</option>
                  {detail.data?.teams
                    .filter((t) => t.id !== assignment.teamId)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </Select>
              </Field>
            </div>
            <Button type="submit" variant="secondary" disabled={busy || !transferTeam}>
              Transfer
            </Button>
          </form>

          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void act(`/assignments/${assignment.id}/collaborations`, { organizationId: inviteOrg });
            }}
          >
            <div className="min-w-48">
              <Field label="Invite an organization to help">
                <Select required value={inviteOrg} onChange={(e) => setInviteOrg(e.target.value)}>
                  <option value="">Choose an organization…</option>
                  {others.data?.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button type="submit" variant="secondary" disabled={busy || !inviteOrg}>
              Invite
            </Button>
          </form>

          <Button variant="danger" disabled={busy} onClick={() => void act(`/assignments/${assignment.id}/cancel`)}>
            Cancel assignment
          </Button>
        </div>
      )}
      <div className="mt-3">
        <ErrorText>{error}</ErrorText>
      </div>
    </Card>
  );
}

function CommentsPanel({ reportId, comments, onChanged }: { reportId: string; comments: Comment[]; onChanged: () => Promise<void> }) {
  const [body, setBody] = useState("");
  const { busy, error, run } = useAction();
  return (
    <Card title="Comments">
      {comments.length === 0 ? (
        <Empty>No comments yet.</Empty>
      ) : (
        <ul className="mb-3 space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="text-sm">
              <p className="text-xs text-slate-500">
                <span className="font-medium text-slate-700">{c.author.name}</span> · {formatDate(c.createdAt)}
              </p>
              <p className="whitespace-pre-wrap text-slate-800">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await api("POST", `/reports/${reportId}/comments`, { body });
            setBody("");
            await onChanged();
          });
        }}
      >
        <Textarea rows={2} required value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment" />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={busy || !body.trim()}>
          Comment
        </Button>
      </form>
    </Card>
  );
}
