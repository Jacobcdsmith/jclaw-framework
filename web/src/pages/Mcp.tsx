import { useEffect, useState } from "react";
import { call } from "../ws.ts";

interface McpToolDef {
  serverId: string;
  serverName: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface McpServerEntry {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  enabled: boolean;
  status: "connecting" | "connected" | "disconnected" | "error";
  error?: string;
  tools: McpToolDef[];
}

const STATUS_COLOR: Record<string, string> = {
  connected: "var(--accent)",
  connecting: "#f5c518",
  disconnected: "var(--muted)",
  error: "#e05c5c"
};

const STATUS_LABEL: Record<string, string> = {
  connected: "connected",
  connecting: "connecting...",
  disconnected: "disabled",
  error: "error"
};

type FormState = {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command: string;
  args: string;
  url: string;
  enabled: boolean;
};

const EMPTY_FORM: FormState = {
  id: "",
  name: "",
  transport: "stdio",
  command: "",
  args: "",
  url: "",
  enabled: true
};

export default function Mcp() {
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    loadServers();
  }, []);

  async function loadServers() {
    setLoading(true);
    try {
      const r = await call<{ servers: McpServerEntry[] }>("mcp.servers.list");
      setServers(r.servers);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function startAdd() {
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function startEdit(server: McpServerEntry) {
    setForm({
      id: server.id,
      name: server.name,
      transport: server.transport,
      command: server.command ?? "",
      args: (server.args ?? []).join(", "),
      url: server.url ?? "",
      enabled: server.enabled
    });
    setShowForm(true);
  }

  async function saveServer() {
    setSaving(true);
    setError(null);
    try {
      await call("mcp.servers.upsert", {
        id: form.id || undefined,
        name: form.name,
        transport: form.transport,
        command: form.command || undefined,
        args: form.args ? form.args.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
        url: form.url || undefined,
        enabled: form.enabled
      });
      setShowForm(false);
      setForm(EMPTY_FORM);
      await loadServers();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteServer(id: string) {
    if (!confirm("Remove this MCP server?")) return;
    try {
      await call("mcp.servers.delete", { id });
      await loadServers();
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  async function toggleEnabled(server: McpServerEntry) {
    try {
      await call("mcp.servers.upsert", {
        ...server,
        args: server.args,
        enabled: !server.enabled
      });
      await loadServers();
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  async function reload() {
    setReloading(true);
    try {
      await call("mcp.servers.reload");
      await loadServers();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setReloading(false);
    }
  }

  function toggleTools(serverId: string) {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(serverId)) next.delete(serverId);
      else next.add(serverId);
      return next;
    });
  }

  return (
    <div>
      <div className="page-title">MCP Servers</div>

      {error && (
        <div style={{
          background: "#2d1a1a", border: "1px solid #e05c5c", color: "#e05c5c",
          padding: "10px 14px", marginBottom: "16px", fontSize: "13px"
        }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        <button className="trek-btn primary" onClick={startAdd}>+ Add Server</button>
        <button className="trek-btn" onClick={reload} disabled={reloading}>
          {reloading ? "reloading..." : "Reload Connections"}
        </button>
      </div>

      {showForm && (
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderTop: "2px solid var(--accent)", padding: "16px",
          marginBottom: "20px"
        }}>
          <div style={{ fontSize: "10px", color: "var(--accent)", letterSpacing: "0.2em", marginBottom: "14px" }}>
            {form.id ? "EDIT MCP SERVER" : "ADD MCP SERVER"}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
            <div>
              <div className="config-label">Name *</div>
              <input
                className="trek-input"
                placeholder="My MCP Server"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <div className="config-label">Transport</div>
              <select
                className="trek-input"
                value={form.transport}
                onChange={(e) => setForm((f) => ({ ...f, transport: e.target.value as "stdio" | "http" }))}
              >
                <option value="stdio">stdio</option>
                <option value="http">HTTP/SSE</option>
              </select>
            </div>
          </div>

          {form.transport === "stdio" ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
              <div>
                <div className="config-label">Command *</div>
                <input
                  className="trek-input"
                  placeholder="e.g. npx, python, node"
                  value={form.command}
                  onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                />
              </div>
              <div>
                <div className="config-label">Arguments (comma-separated)</div>
                <input
                  className="trek-input"
                  placeholder="e.g. @modelcontextprotocol/server-filesystem, /path"
                  value={form.args}
                  onChange={(e) => setForm((f) => ({ ...f, args: e.target.value }))}
                />
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: "12px" }}>
              <div className="config-label">Server URL *</div>
              <input
                className="trek-input"
                placeholder="e.g. http://localhost:6006/sse"
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              />
            </div>
          )}

          <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "12px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "12px" }}>
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              />
              Enabled
            </label>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              className="trek-btn primary"
              onClick={saveServer}
              disabled={saving || !form.name}
            >
              {saving ? "saving..." : "Save"}
            </button>
            <button className="trek-btn" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: "var(--muted)", fontSize: "13px" }}>Loading...</div>
      ) : servers.length === 0 ? (
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          padding: "32px", textAlign: "center", color: "var(--muted)"
        }}>
          <div style={{ fontSize: "14px", marginBottom: "8px" }}>No MCP servers configured</div>
          <div style={{ fontSize: "12px" }}>
            Add an MCP server to give jclaw access to external tools during chat sessions.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {servers.map((server) => (
            <div
              key={server.id}
              style={{
                background: "var(--surface)", border: "1px solid var(--border)",
                borderLeft: `3px solid ${STATUS_COLOR[server.status] ?? "var(--border)"}`,
                padding: "14px 16px"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "4px" }}>
                    {server.name}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "6px" }}>
                    {server.transport === "stdio"
                      ? `stdio: ${server.command ?? "?"} ${(server.args ?? []).join(" ")}`
                      : `http: ${server.url ?? "?"}`}
                  </div>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <span style={{
                      fontSize: "10px", padding: "2px 6px",
                      background: "var(--bg)",
                      border: `1px solid ${STATUS_COLOR[server.status] ?? "var(--border)"}`,
                      color: STATUS_COLOR[server.status] ?? "var(--muted)"
                    }}>
                      {STATUS_LABEL[server.status] ?? server.status}
                    </span>
                    {server.error && (
                      <span style={{ fontSize: "11px", color: "#e05c5c" }}>{server.error}</span>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    className="trek-btn"
                    style={{ fontSize: "11px", padding: "4px 8px" }}
                    onClick={() => toggleEnabled(server)}
                  >
                    {server.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    className="trek-btn"
                    style={{ fontSize: "11px", padding: "4px 8px" }}
                    onClick={() => startEdit(server)}
                  >
                    Edit
                  </button>
                  <button
                    className="trek-btn"
                    style={{ fontSize: "11px", padding: "4px 8px", color: "#e05c5c" }}
                    onClick={() => deleteServer(server.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>

              {server.tools.length > 0 && (
                <div style={{ marginTop: "10px" }}>
                  <button
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: "var(--accent)", fontSize: "11px", padding: 0
                    }}
                    onClick={() => toggleTools(server.id)}
                  >
                    {expandedTools.has(server.id) ? "▼" : "▶"} {server.tools.length} tool{server.tools.length !== 1 ? "s" : ""}
                  </button>

                  {expandedTools.has(server.id) && (
                    <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
                      {server.tools.map((tool) => (
                        <div
                          key={tool.name}
                          style={{
                            background: "var(--bg)", border: "1px solid var(--border)",
                            padding: "8px 12px"
                          }}
                        >
                          <div style={{ fontFamily: "monospace", fontSize: "12px", color: "var(--accent)" }}>
                            {tool.name}
                          </div>
                          {tool.description && (
                            <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>
                              {tool.description}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: "32px", padding: "16px", background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div style={{ fontSize: "10px", color: "var(--accent)", letterSpacing: "0.2em", marginBottom: "10px" }}>
          JCLAW AS MCP SERVER
        </div>
        <div style={{ fontSize: "12px", color: "var(--muted)", lineHeight: 1.6 }}>
          jclaw can also act as an MCP server for external clients like Claude Desktop or Cursor.
          Run: <code style={{ fontFamily: "monospace", color: "var(--text)" }}>jclaw mcp serve</code> (stdio) or{" "}
          <code style={{ fontFamily: "monospace", color: "var(--text)" }}>jclaw mcp serve --transport http --port 6006</code> (HTTP/SSE)
        </div>
      </div>
    </div>
  );
}
