"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Card, ErrorText, Field, Input } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useAction } from "@/lib/hooks";

export default function LoginPage() {
  const { login, user } = useAuth();
  const router = useRouter();
  const { busy, error, run } = useAction();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (user) router.replace("/");
  }, [user, router]);

  return (
    <div className="mx-auto mt-10 max-w-sm">
      <h1 className="mb-1 text-2xl font-semibold">Sign in to OpenField</h1>
      <p className="mb-5 text-sm text-slate-600">Report issues in your area and coordinate the teams that fix them.</p>
      <Card>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => login(email, password));
          }}
        >
          <Field label="Email">
            <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>
      <p className="mt-4 text-center text-sm text-slate-600">
        New here?{" "}
        <Link href="/register" className="font-medium text-emerald-800 hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
