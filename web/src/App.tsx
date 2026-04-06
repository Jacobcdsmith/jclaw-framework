import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import Overview from "./pages/Overview.tsx";
import Sessions from "./pages/Sessions.tsx";
import SessionDetail from "./pages/SessionDetail.tsx";
import Prompts from "./pages/Prompts.tsx";
import Templates from "./pages/Templates.tsx";
import Providers from "./pages/Providers.tsx";
import Search from "./pages/Search.tsx";

export default function App() {
  return (
    <BrowserRouter>
      <div className="layout">
        <aside className="sidebar">
          <div className="sidebar-top-bar" />
          <div className="sidebar-logo">
            JCLAW
            <span>gate dashboard v2</span>
          </div>
          <div className="sidebar-section-label">navigation</div>
          <NavLink
            to="/"
            end
            className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}
          >
            <span className="nav-icon">◈</span>
            Overview
          </NavLink>
          <NavLink
            to="/sessions"
            className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}
          >
            <span className="nav-icon">◷</span>
            Sessions
          </NavLink>
          <NavLink
            to="/prompts"
            className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}
          >
            <span className="nav-icon">◧</span>
            Prompts
          </NavLink>
          <NavLink
            to="/templates"
            className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}
          >
            <span className="nav-icon">◫</span>
            Templates
          </NavLink>
          <div className="sidebar-section-label" style={{ marginTop: "4px" }}>config</div>
          <NavLink
            to="/providers"
            className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}
          >
            <span className="nav-icon">⚙</span>
            Providers
          </NavLink>
          <NavLink
            to="/search"
            className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}
          >
            <span className="nav-icon">◉</span>
            Search
          </NavLink>
          <div className="sidebar-spacer" />
          <div className="sidebar-bottom-bar" />
        </aside>
        <main className="main">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/sessions" element={<Sessions />} />
            <Route path="/sessions/:id" element={<SessionDetail />} />
            <Route path="/prompts" element={<Prompts />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/providers" element={<Providers />} />
            <Route path="/search" element={<Search />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
