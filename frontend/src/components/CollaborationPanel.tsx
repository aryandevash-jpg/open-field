"use client";

import { useState } from "react";
import { Badge, Button, Card, ErrorText, Field, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useAction, useApi } from "@/lib/hooks";
import type { Collaboration, OrganizationDetail } from "@/lib/types";

// Invited organization's side of a collaboration: accept/decline, then
// nominate teams. Shown on the report page and the organization page.
export function CollaborationPanel({ collaboration, onChanged }: { collaboration: Collaboration; onChanged: () => Promise<void> }) {
  const detail = useApi<OrganizationDetail>(collaboration.status === "ACCEPTED" ? `/organizations/${collaboration.organizationId}` : null);
  const { busy, error, run } = useAction();
  const [teamId, setTeamId] = useState("");
  const act = (path: string, body?: unknown) => run(async () => {
    await api("POST", path, body);
    await onChanged();
  });

  return (
    <Card title={`Collaboration invitation · ${collaboration.organization.name}`} actions={<Badge status={collaboration.status} />}>
      {collaboration.status === "INVITED" && (
        <div className="flex gap-2">
          <Button disabled={busy} onClick={() => void act(`/collaborations/${collaboration.id}/accept`)}>
            Accept
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void act(`/collaborations/${collaboration.id}/decline`)}>
            Decline
          </Button>
        </div>
      )}
      {collaboration.status === "ACCEPTED" && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void act(`/collaborations/${collaboration.id}/teams`, { teamId });
          }}
        >
          <div className="min-w-48">
            <Field label="Nominate a team">
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
            Nominate
          </Button>
          {collaboration.teams.length > 0 && (
            <p className="w-full text-sm text-slate-600">Nominated: {collaboration.teams.map((t) => t.team.name).join(", ")}</p>
          )}
        </form>
      )}
      <div className="mt-3">
        <ErrorText>{error}</ErrorText>
      </div>
    </Card>
  );
}
