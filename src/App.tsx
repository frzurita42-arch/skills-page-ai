import { Routes, Route } from 'react-router';
import Layout from './components/Layout';
import Home from './pages/Home';
import LessonPath from './pages/LessonPath';
import Repos from './pages/Repos';
import Repository from './pages/Repository';
import Users from './pages/Users';
import UserProfile from './pages/UserProfile';
import Slides from './pages/Slides';
import SlideTool from './pages/SlideTool';
import Templates from './pages/Templates';
import Runs from './pages/Runs';
import Replay from './pages/Replay';
import PresetPlay from './pages/PresetPlay';
import About from './pages/About';
import Settings from './pages/Settings';
import Auth from './pages/Auth';
import AdminDashboard from './pages/AdminDashboard';
import AdminUsers from './pages/AdminUsers';
import AdminModerators from './pages/AdminModerators';
import AdminSettings from './pages/AdminSettings';
import AdminGate from './components/admin/AdminGate';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Repos is the default home; the Coach chat lives at /chat */}
        <Route path="/" element={<Repos />} />
        <Route path="/chat" element={<Home />} />
        <Route path="/lesson-path" element={<LessonPath />} />
        <Route path="/repos" element={<Repos />} />
        <Route path="/repos/:slug" element={<Repository />} />
        <Route path="/users" element={<Users />} />
        <Route path="/users/:id" element={<UserProfile />} />
        <Route path="/repos/:slug/play/:seq" element={<PresetPlay />} />
        <Route path="/slides" element={<Slides />} />
        <Route path="/slides/:slug" element={<SlideTool />} />
        {/* Slide templates are an admin-only management surface */}
        <Route
          path="/templates"
          element={
            <AdminGate minRole="admin">
              <Templates />
            </AdminGate>
          }
        />
        <Route path="/runs" element={<Runs />} />
        <Route path="/runs/:runId/replay" element={<Replay />} />
        <Route path="/about" element={<About />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/users" element={<AdminUsers />} />
        <Route path="/admin/moderators" element={<AdminModerators />} />
        <Route path="/admin/settings" element={<AdminSettings />} />
        <Route path="*" element={<Repos />} />
      </Route>
    </Routes>
  );
}
