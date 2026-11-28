"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { PointPicker } from "@/components/maps";
import { Button, Card, ErrorText, Field, Input, Loading, PageHeader, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useRequireUser } from "@/lib/auth";
import { useAction, useApi } from "@/lib/hooks";
import type { Category, Event, LatLng, Report } from "@/lib/types";

function NewReportForm() {
  const user = useRequireUser();
  const router = useRouter();
  const params = useSearchParams();
  const categories = useApi<Category[]>(user ? "/categories" : null);
  const events = useApi<Event[]>(user ? "/events" : null);
  const { busy, error, run, setError } = useAction();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [eventId, setEventId] = useState(params.get("eventId") ?? "");
  const [location, setLocation] = useState<LatLng | null>(null);
  const [photoUrls, setPhotoUrls] = useState("");

  if (!user) return <Loading />;

  const useMyLocation = () =>
    navigator.geolocation.getCurrentPosition(
      (position) => setLocation({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => setError("Could not read your location. Click the map instead.")
    );

  // Show sub-categories under their parent ("Environment › Waste").
  const byId = new Map(categories.data?.map((c) => [c.id, c]) ?? []);
  const label = (category: Category): string => {
    const parent = category.parentId ? byId.get(category.parentId) : undefined;
    return parent ? `${label(parent)} › ${category.name}` : category.name;
  };
  const options = (categories.data ?? []).map((c) => ({ id: c.id, label: label(c) })).sort((a, b) => a.label.localeCompare(b.label));

  return (
    <>
      <PageHeader title="Report an issue" subtitle="Describe what you saw and mark where it is. A verifier will review it." />
      <form
        className="grid gap-4 lg:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!location) {
            setError("Click the map to mark where the issue is.");
            return;
          }
          const media = photoUrls
            .split(/\s+/)
            .map((url) => url.trim())
            .filter(Boolean)
            .map((url) => ({ url }));
          void run(async () => {
            const report = await api<Report>("POST", "/reports", {
              title,
              description,
              categoryId,
              location,
              eventId: eventId || undefined,
              media,
            });
            router.push(`/reports/${report.id}`);
          });
        }}
      >
        <Card>
          <div className="space-y-3">
            <Field label="Title">
              <Input required minLength={3} maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Overflowing garbage bin" />
            </Field>
            <Field label="Category">
              <Select required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Choose a category…</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Description">
              <Textarea required rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is the problem, and since when?" />
            </Field>
            <Field label="Event (optional)" hint="Link the report to a campaign you are part of.">
              <Select value={eventId} onChange={(e) => setEventId(e.target.value)}>
                <option value="">Not part of an event</option>
                {events.data?.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.title} — {ev.hostOrganization?.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Photo URLs (optional)" hint="One per line, http(s) links. Uploads come later.">
              <Textarea rows={2} value={photoUrls} onChange={(e) => setPhotoUrls(e.target.value)} placeholder="https://…" />
            </Field>
          </div>
        </Card>
        <Card title="Location" actions={<Button type="button" variant="secondary" onClick={useMyLocation}>Use my location</Button>}>
          <PointPicker value={location} onChange={setLocation} />
          <p className="mt-2 text-xs text-slate-500">
            {location ? `Selected ${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}` : "Click the map to place the issue."}
          </p>
        </Card>
        <div className="space-y-3 lg:col-span-2">
          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy}>
            {busy ? "Submitting…" : "Submit report"}
          </Button>
        </div>
      </form>
    </>
  );
}

export default function NewReportPage() {
  return (
    <Suspense fallback={<Loading />}>
      <NewReportForm />
    </Suspense>
  );
}
