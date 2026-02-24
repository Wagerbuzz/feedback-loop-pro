import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import Auth from "@/pages/Auth";
import DashboardView from "@/pages/DashboardView";
import InboxView from "@/pages/InboxView";
import ClustersView from "@/pages/ClustersView";
import ActionsView from "@/pages/ActionsView";
import RoadmapView from "@/pages/RoadmapView";
import PortalView from "@/pages/PortalView";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<DashboardView />} />
              <Route path="/inbox" element={<InboxView />} />
              <Route path="/clusters" element={<ClustersView />} />
              <Route path="/actions" element={<ActionsView />} />
              <Route path="/roadmap" element={<RoadmapView />} />
              <Route path="/portal" element={<PortalView />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
