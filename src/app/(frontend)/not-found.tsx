import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Home } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 text-center">
      <div className="space-y-4">
        <p className="text-6xl font-extrabold text-primary">404</p>
        <h1 className="text-2xl font-bold">Stránka nenalezena</h1>
        <p className="text-muted-foreground">Tato stránka neexistuje.</p>
        <Button asChild className="h-12"><Link href="/"><Home className="h-5 w-5" /> Na úvod</Link></Button>
      </div>
    </div>
  );
}
