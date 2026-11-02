import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout";
import { ThemeProvider } from "@/lib/theme-context";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { StorageFolderProvider } from "@/lib/storage-folder-context";
import LoginPage from "@/pages/login";

import Dashboard from "@/pages/dashboard";
import PosPage from "@/pages/pos";
import InventoryPage from "@/pages/inventory";
import ServicesPage from "@/pages/services";
import TechniciansPage from "@/pages/technicians";
import TransactionsPage from "@/pages/transactions";
import CustomersPage from "@/pages/customers";
import DrawerPage from "@/pages/drawer";
import ReportsPage from "@/pages/reports";
import DefectiveItemsPage from "@/pages/defective";
import BackjobsPage from "@/pages/backjobs";
import UsersPage from "@/pages/users";
import ActivityPage from "@/pages/activity";
import BackupPage from "@/pages/backup";
import SettingsPage from "@/pages/settings";
import NotFound from "@/pages/not-found";
import TrackPage from "@/pages/track";

const queryClient = new QueryClient();

function AppContent() {
  const { user, loading } = useAuth();

  return (
    <Switch>
      {/* Public routes — no login required (customers can open these directly) */}
      <Route path="/track" component={TrackPage} />

      {/* Everything else stays behind the auth gate */}
      <Route>
        {loading ? (
          <div className="min-h-screen flex items-center justify-center bg-background">
            <div className="text-muted-foreground text-sm animate-pulse">Loading...</div>
          </div>
        ) : !user ? (
          <LoginPage />
        ) : (
          <AppLayout>
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/pos" component={PosPage} />
              <Route path="/inventory" component={InventoryPage} />
              <Route path="/services" component={ServicesPage} />
              <Route path="/technicians" component={TechniciansPage} />
              <Route path="/transactions" component={TransactionsPage} />
              <Route path="/customers" component={CustomersPage} />
              <Route path="/drawer" component={DrawerPage} />
              <Route path="/reports" component={ReportsPage} />
              <Route path="/defective" component={DefectiveItemsPage} />
              <Route path="/backjobs" component={BackjobsPage} />
              <Route path="/users" component={UsersPage} />
              <Route path="/activity" component={ActivityPage} />
              <Route path="/backup" component={BackupPage} />
              <Route path="/settings" component={SettingsPage} />
              <Route component={NotFound} />
            </Switch>
          </AppLayout>
        )}
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <StorageFolderProvider>
              <AuthProvider>
                <AppContent />
              </AuthProvider>
            </StorageFolderProvider>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
