"use client";

import { useState } from "react";
import { Badge, Button, Card, ErrorText, Field, Input, Loading, PageHeader, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useRequireUser } from "@/lib/auth";
import { useAction, useApi } from "@/lib/hooks";
import type { Category } from "@/lib/types";

// Platform admins manage the shared taxonomy. The database refuses invalid
// trees (cycles, active under inactive); those errors are shown as-is.
export default function CategoriesPage() {
  const user = useRequireUser();
  const categories = useApi<Category[]>(user?.isPlatformAdmin ? "/categories?includeInactive=true" : null);
  const { busy, error, run } = useAction();
  const [form, setForm] = useState({ name: "", slug: "", parentId: "" });

  if (!user) return <Loading />;
  if (!user.isPlatformAdmin) return <ErrorText>Only platform admins can manage categories.</ErrorText>;
  if (!categories.data) return <Loading />;

  const byParent = new Map<string | null, Category[]>();
  for (const c of categories.data) byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c]);

  const renderTree = (parentId: string | null, depth: number): React.ReactNode =>
    (byParent.get(parentId) ?? []).map((c) => (
      <div key={c.id}>
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 py-1.5 text-sm" style={{ paddingLeft: depth * 20 }}>
          <span>
            {c.name} <span className="text-xs text-slate-400">{c.slug}</span>
          </span>
          <span className="flex items-center gap-2">
            {!c.isActive && <Badge status="inactive" />}
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api("PATCH", `/categories/${c.id}/status`, { isActive: !c.isActive });
                  await categories.reload();
                })
              }
            >
              {c.isActive ? "Deactivate" : "Activate"}
            </Button>
          </span>
        </div>
        {renderTree(c.id, depth + 1)}
      </div>
    ));

  return (
    <>
      <PageHeader title="Categories" subtitle="The shared issue taxonomy every organization and report uses." />
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Taxonomy" className="md:col-span-2">
          {renderTree(null, 0)}
        </Card>
        <Card title="Add a category">
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await api("POST", "/categories", { name: form.name, slug: form.slug, parentId: form.parentId || null });
                setForm({ name: "", slug: "", parentId: "" });
                await categories.reload();
              });
            }}
          >
            <Field label="Name">
              <Input
                required
                minLength={2}
                value={form.name}
                onChange={(e) =>
                  setForm({ ...form, name: e.target.value, slug: e.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") })
                }
              />
            </Field>
            <Field label="Slug" hint="Lowercase letters, numbers and dashes.">
              <Input required value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
            </Field>
            <Field label="Parent (optional)">
              <Select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
                <option value="">Top level</option>
                {categories.data
                  .filter((c) => c.isActive)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <ErrorText>{error}</ErrorText>
            <Button type="submit" disabled={busy}>
              Add
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
