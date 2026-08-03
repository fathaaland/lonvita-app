"use client";

const clientToken = process.env.NEXT_PUBLIC_PAYMENTS_CLIENT_TOKEN;

export function PaymentTestModeBanner() {
  if (!clientToken?.startsWith("pk_test_")) return null;
  return (
    <div className="w-full bg-warning/15 border-b border-warning/30 px-4 py-2 text-center text-xs text-warning-foreground">
      <strong>Testovací režim plateb.</strong> Použijte kartu <code>4242 4242 4242 4242</code> · libovolné budoucí datum · libovolné CVC.
    </div>
  );
}
