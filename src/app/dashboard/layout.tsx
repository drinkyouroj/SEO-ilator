// src/app/dashboard/layout.tsx
import { AppShell } from "@/components/layout/AppShell";
import { ToastProvider } from "@/components/feedback/ToastProvider";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell>
      <ToastProvider>{children}</ToastProvider>
    </AppShell>
  );
}
