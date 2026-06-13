import { Routes, Route, Outlet } from "react-router-dom";
import { Navbar } from "./components/navbar";
import { Toaster } from "./components/ui/toaster";
import { NewMessageWatcher } from "./components/new-message-watcher";
import { EscrowPoller } from "./components/escrow-poller";
import { EventPoller } from "./components/event-poller";
import HomePage from "./pages/HomePage";
import JobsPage from "./pages/JobsPage";
import CreatePage from "./pages/CreatePage";
import DashboardPage from "./pages/DashboardPage";
import FreelancerPage from "./pages/FreelancerPage";
import AdminPage from "./pages/AdminPage";
import DisputesPage from "./pages/DisputesPage";
import ApprovalsPage from "./pages/ApprovalsPage";
import FreelancersPage from "./pages/FreelancersPage";
import MessagesPage from "./pages/MessagesPage";
import Debugger from "./pages/Debugger";
import AnalyticsPage from "./pages/AnalyticsPage";

const AppLayout = () => (
  <>
    <Navbar />
    <div className="pt-16">
      <Outlet />
    </div>
    <NewMessageWatcher />
    <EscrowPoller />
    <EventPoller />
    <Toaster />
  </>
);

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/freelancers" element={<FreelancersPage />} />
        <Route path="/create" element={<CreatePage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/freelancer" element={<FreelancerPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/disputes" element={<DisputesPage />} />
        <Route path="/approvals" element={<ApprovalsPage />} />
        <Route path="/messages" element={<MessagesPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/debug" element={<Debugger />} />
        <Route path="/debug/:contractName" element={<Debugger />} />
      </Route>
    </Routes>
  );
}

export default App;
