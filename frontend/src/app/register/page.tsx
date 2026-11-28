"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Card, ErrorText, Field, Input } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useAction } from "@/lib/hooks";

export default function RegisterPage() {
  const { register, user } = useAuth();
  const router = useRouter();
  const { busy, error, run } = useAction();
  const [form, setForm] = useState({ name: "", email: "", password: "" });

  useEffect(() => {
    if (user) router.replace("/");
  }, [user, router]);

  return (
    <div className="mx-auto mt-10 max-w-sm">
      <h1 className="mb-5 text-2xl font-semibold">Create your account</h1>
      <Card>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => register(form.name, form.email, form.password));
          }}
        >
          <Field label="Name">
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Password" hint="At least 8 characters.">
            <Input type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Creating…" : "Create account"}
          </Button>
        </form>
      </Card>
      <p className="mt-4 text-center text-sm text-slate-600">
        Already registered?{" "}
        <Link href="/login" className="font-medium text-emerald-800 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
