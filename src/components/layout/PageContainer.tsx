// src/components/layout/PageContainer.tsx
interface PageContainerProps {
  children: React.ReactNode;
  className?: string;
}

export function PageContainer({ children, className = "" }: PageContainerProps) {
  return (
    <div
      className={`mx-auto w-full max-w-7xl p-4 md:p-6 ${className}`.trim()}
    >
      {children}
    </div>
  );
}
