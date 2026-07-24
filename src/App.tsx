import { Routes, Route } from 'react-router';
import Layout from './components/Layout';
import Home from './pages/Home';
import LessonPath from './pages/LessonPath';
import Repos from './pages/Repos';
import Repository from './pages/Repository';
import Slides from './pages/Slides';
import SlideTool from './pages/SlideTool';
import Templates from './pages/Templates';
import Runs from './pages/Runs';
import Replay from './pages/Replay';
import About from './pages/About';
import Settings from './pages/Settings';
import Auth from './pages/Auth';
import AdminDashboard from './pages/AdminDashboard';
import AdminUsers from './pages/AdminUsers';
import AdminModerators from './pages/AdminModerators';
import AdminSettings from './pages/AdminSettings';

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
        <Route path="/slides" element={<Slides />} />
        <Route path="/slides/:slug" element={<SlideTool />} />
        <Route path="/templates" element={<Templates />} />
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
