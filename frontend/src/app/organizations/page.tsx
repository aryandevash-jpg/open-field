"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Empty, ErrorText, Field, Input, Loading, PageHeader, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useRequireUser } from "@/lib/auth";
import { useAction, useApi } from "@/lib/hooks";
import type { MyOrganization } from "@/lib/types";

export default function OrganizationsPage() {
  const user = useRequireUser();
  const router = useRouter();
  const organizations = useApi<MyOrganization[]>(user ? "/organizations" : null);
  const { busy, error, run } = useAction();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  if (!user) return <Loading />;

  return (
    <>
      <PageHeader title="Organizations" subtitle="NGOs and community groups you belong to." />
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Your organizations" className="md:col-span-2">
          {!organizations.data ? (
            <Loading />
          ) : organizations.data.length === 0 ? (
            <Empty>You are not a member of any organization. Create one, or ask an owner to add you by email.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {organizations.data.map((m) => (
                <li key={m.id}>
                  <Link href={`/organizations/${m.organization.id}`} className="flex items-center justify-between px-1 py-2.5 hover:bg-slate-50">
                    <div>
                      <p className="text-sm font-medium">{m.organization.name}</p>
                      {m.organization.description && <p className="text-xs text-slate-500">{m.organization.description}</p>}
                    </div>
                    <span className="text-xs text-slate-500">{m.role.toLowerCase()}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Create an organization">
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const created = await api<{ id: string }>("POST", "/organizations", { name, description: description || undefined });
                router.push(`/organizations/${created.id}`);
              });
            }}
          >
            <Field label="Name">
              <Input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Description">
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <ErrorText>{error}</ErrorText>
            <Button type="submit" disabled={busy}>
              Create
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
