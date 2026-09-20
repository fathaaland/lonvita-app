"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { toast } from "sonner";
import { resetPasswordWithToken, PayloadApiError } from "@/integrations/payload/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock } from "lucide-react";
import { LonvitaLogo } from "@/components/LonvitaLogo";

const formSchema = z
  .object({
    password: z.string().min(8, "Heslo musí mít alespoň 8 znaků").max(128),
    passwordConfirm: z.string(),
  })
  .refine((v) => v.password === v.passwordConfirm, {
    message: "Hesla se neshodují",
    path: ["passwordConfirm"],
  });

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    const parsed = formSchema.safeParse({ password, passwordConfirm });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }

    setLoading(true);
    try {
      await resetPasswordWithToken(token, parsed.data.password);
      setDone(true);
      toast.success("Heslo bylo změněno.");
    } catch (error) {
      toast.error(
        error instanceof PayloadApiError ? error.message : "Nepodařilo se změnit heslo.",
      );
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-background flex items-center">
        <div className="mx-auto max-w-[420px] w-full px-4 py-8 space-y-5 text-center">
          <h1 className="text-2xl font-extrabold">Odkaz je neplatný</h1>
          <p className="text-muted-foreground">
            Tento odkaz pro obnovu hesla chybí nebo už není platný. Vyžádejte si prosím nový.
          </p>
          <Button asChild className="w-full h-12">
            <Link href="/auth">Zpět na přihlášení</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-background flex items-center">
        <div className="mx-auto max-w-[420px] w-full px-4 py-8 space-y-5 text-center">
          <h1 className="text-2xl font-extrabold">Heslo změněno</h1>
          <p className="text-muted-foreground">Nyní se můžete přihlásit novým heslem.</p>
          <Button asChild className="w-full h-12">
            <Link href="/auth">Přejít na přihlášení</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center">
      <div className="mx-auto max-w-[420px] w-full px-4 py-8 space-y-6">
        <div className="flex flex-col items-center text-center space-y-2">
          <LonvitaLogo size="lg" />
          <h1 className="text-2xl font-extrabold">Nastavit nové heslo</h1>
          <p className="text-muted-foreground text-sm">Zadejte nové heslo ke svému účtu.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-base">Nové heslo</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="pl-10 h-12 text-base"
                autoComplete="new-password"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="passwordConfirm" className="text-base">Zopakujte heslo</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                id="passwordConfirm"
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                placeholder="••••••••"
                className="pl-10 h-12 text-base"
                autoComplete="new-password"
              />
            </div>
          </div>
          <Button type="submit" disabled={loading} className="w-full h-14 text-base font-semibold">
            Nastavit heslo
          </Button>
        </form>
        <div className="text-center">
          <button
            type="button"
            onClick={() => router.push("/auth")}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Zpět na přihlášení
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  );
}
