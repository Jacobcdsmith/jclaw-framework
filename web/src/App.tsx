import { useState } from "react";
import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import Overview from "./pages/Overview.tsx";
import Sessions from "./pages/Sessions.tsx";
import SessionDetail from "./pages/SessionDetail.tsx";
import Prompts from "./pages/Prompts.tsx";
import Templates from "./pages/Templates.tsx";
import Providers from "./pages/Providers.tsx";
import Search from "./pages/Search.tsx";
import Chat from "./pages/Chat.tsx";
import Terminal from "./pages/Terminal.tsx";
import Activity from "./pages/Activity.tsx";

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  function closeSidebar() {
    setSidebarOpen(false);
  }

  return (
    <BrowserRouter>
      <div className="layout">
        {/* Mobile overlay backdrop */}
        {sidebarOpen && (
          <div className="sidebar-overlay" onClick={closeSidebar} />
        )}

        <aside className={"sidebar" + (sidebarOpen ? " sidebar-open" : "")}>
          <div className="sidebar-top-bar" />
          <div className="sidebar-logo">
            JCLAW
            <span>gate dashboard v2</span>
          </div>

          <div className="sidebar-section-label">navigation</div>
          <NavLink to="/" end className={({ isActive }) => "nav-item" + (isActive ? " active" : "")} onClick={closeSidebar}>
            <span className="nav-icon">◈</span>Overview
          </NavLink>
          <NavLink to="/sessions" className={({ isActive }) => "nav-item" + (isActive ? " active" : "")} onClick={closeSidebar}>
            <span className="nav-icon">◷</span>Sessions
          </NavLink>
          <NavLink to="/prompts" className={({ isActive }) => "nav-item" + (isActive ? " active" : "")} onClick={closeSidebar}>
            <span className="nav-icon">◧</span>Prompts
          </NavLink>
          <NavLink to="/templates" className={({ isActive }) => "nav-item" + (isActive ? " active" : "")} onClick={closeSidebar}>
            <span className="nav-icon">◫</span>Templates
          </NavLink>

          <div className="sidebar-section-label" style={{ marginTop: "4px" }}>live</div>
          <NavLink to="/chat" className={({ isActive }) => "nav-item" + (isActive ? " active" : "")} onClick={closeSidebar}>
            <span className="nav-icon">▶</span>Chat
          </NavLink>
          <NavLink to="/terminal" className={({ isActive }) => "nav-item" + (isActive ? " active" : "")} onClick={closeSidebar}>
            <span className="nav-icon">&gt;_</span>Terminal
          </NavLink>
          <NavLink to="/activity" className={({ isActive }) => "nav-item" + (isActive ? " active" : "")} onClick={closeSidebar}>
            <span className="nav-icon">◉</span>Activity
          </NavLink>

          <div className="sidebar-section-label" style={{ marginTop: "4px" }}>config</div>
          <NavLink to="/providers" className={({ isActive }) => "nav-item" + (isActive ? " active" : "")} onClick={closeSidebar}>
            <span className="nav-icon">⚙</span>Providers
          </NavLink>
          <NavLink to="/search" className={({ isActive }) => "nav-item" + (isActive ? " active" : "")} onClick={closeSidebar}>
            <span className="nav-icon">⌕</span>Search
          </NavLink>

          <div className="sidebar-spacer" />
          <div className="sidebar-bottom-bar" />
        </aside>

        <main className="main">
          {/* Hamburger button — only visible on mobile */}
          <button
            className="hamburger-btn"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
          >
            <span />
            <span />
            <span />
          </button>

          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/sessions" element={<Sessions />} />
            <Route path="/sessions/:id" element={<SessionDetail />} />
            <Route path="/prompts" element={<Prompts />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/terminal" element={<Terminal />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/providers" element={<Providers />} />
            <Route path="/search" element={<Search />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
