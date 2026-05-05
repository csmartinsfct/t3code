import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type React from "react";

import { AppAtomRegistryProvider } from "~/rpc/atomRegistry";

export function OverlayRouteProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <AppAtomRegistryProvider>{children}</AppAtomRegistryProvider>
    </QueryClientProvider>
  );
}
