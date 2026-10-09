import { validateEnv } from "@/lib/env";

/** Local development only: what .env lacks, in the corner of every page rather than buried in
 * the server log. Production reports the same through the logger (payload.config onInit). */
export function EnvWarningBanner() {
  if (process.env.NODE_ENV !== "development") return null;

  const { missing, ok } = validateEnv();
  if (missing.length === 0) return null;

  return (
    <div
      role="status"
      className={`fixed bottom-4 right-4 z-[9999] max-w-[420px] rounded-lg border p-4 text-sm shadow-md ${
        ok ? "border-amber-500 bg-amber-50 text-amber-900" : "border-red-500 bg-red-50 text-red-900"
      }`}
    >
      <p className="mb-2 font-semibold">
        {ok ? "Chybí volitelné proměnné prostředí" : "Chybí povinné proměnné prostředí"}
      </p>
      <ul className="space-y-0.5">
        {missing.map((v) => (
          <li key={v.key}>
            <code className="font-mono">{v.key}</code>
            {v.required ? " (povinná)" : ""} — {v.description}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs opacity-70">
        Viz <code className="font-mono">.env.example</code>
      </p>
    </div>
  );
}
