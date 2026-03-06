"use client";

import { useState, useCallback, useEffect } from "react";
import type { ConfigSnapshot, ConfigSchemaResponse } from "@/lib/types";
import { useGateway } from "@/lib/use-gateway";

// ============================================
// Styles
// ============================================

const styles = {
  listItem: {
    background: "var(--card)",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--border)",
    borderRadius: "var(--radius-lg)",
    padding: "16px 20px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 24,
  } as React.CSSProperties,
  listContent: {
    flex: 1,
    minWidth: 0,
  } as React.CSSProperties,
  cardTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: "var(--text-strong)",
    margin: "0 0 6px 0",
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap" as const,
  } as React.CSSProperties,
  pluginId: {
    fontSize: 11,
    fontWeight: 500,
    color: "var(--muted)",
    padding: "2px 6px",
    background: "var(--bg)",
    borderRadius: 4,
    fontFamily: "var(--mono)",
  } as React.CSSProperties,
  description: {
    fontSize: 13,
    color: "var(--muted)",
    margin: 0,
    lineHeight: 1.5,
  } as React.CSSProperties,
  toggleSwitch: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
    userSelect: "none" as const,
    whiteSpace: "nowrap" as const,
    flexShrink: 0,
  } as React.CSSProperties,
  callout: {
    padding: "10px 14px",
    borderRadius: "var(--radius-md)",
    fontSize: 13,
    marginBottom: 20,
    background: "var(--danger-subtle)",
    color: "var(--danger)",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--danger)",
  } as React.CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } as React.CSSProperties,
  btn: {
    height: 32,
    padding: "0 14px",
    fontSize: 13,
    fontWeight: 500,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--border)",
    borderRadius: "var(--radius-md)",
    background: "var(--secondary)",
    color: "var(--text)",
    cursor: "pointer",
    transition: "background 0.15s, border-color 0.15s",
  } as React.CSSProperties,
  btnConfigure: {
    height: 32,
    padding: "0 14px",
    fontSize: 13,
    fontWeight: 500,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--border)",
    borderRadius: "var(--radius-md)",
    background: "var(--bg)",
    color: "var(--text)",
    cursor: "pointer",
    transition: "background 0.15s",
  } as React.CSSProperties,
  modalOverlay: {
    position: "fixed" as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0,0,0,0.5)",
    backdropFilter: "blur(4px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  } as React.CSSProperties,
  modalContent: {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-xl)",
    width: "100%",
    maxWidth: 600,
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
    animation: "rise 0.2s ease-out",
  } as React.CSSProperties,
  modalHeader: {
    padding: "20px 24px",
    borderBottom: "1px solid var(--border)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  } as React.CSSProperties,
  modalTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 600,
    color: "var(--text-strong)",
  } as React.CSSProperties,
  modalBody: {
    padding: 24,
    overflowY: "auto",
  } as React.CSSProperties,
  modalFooter: {
    padding: "16px 24px",
    borderTop: "1px solid var(--border)",
    display: "flex",
    justifyContent: "flex-end",
    gap: 12,
  } as React.CSSProperties,
  textarea: {
    width: "100%",
    minHeight: 300,
    padding: 12,
    fontSize: 13,
    fontFamily: "var(--mono)",
    background: "var(--bg)",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--border)",
    borderRadius: "var(--radius-md)",
    color: "var(--text)",
    resize: "vertical" as const,
    lineHeight: 1.5,
  } as React.CSSProperties,
};

// ============================================
// Plugins Page
// ============================================

type PluginItem = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  config: Record<string, unknown>;
};

export default function PluginsPage() {
  const { state, request } = useGateway();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [, setSchemaRes] = useState<ConfigSchemaResponse | null>(null);
  const [configSnap, setConfigSnap] = useState<ConfigSnapshot | null>(null);
  const [pluginsList, setPluginsList] = useState<PluginItem[]>([]);
  const [restarting, setRestarting] = useState(false);

  // Track patches in progress
  const [toggling, setToggling] = useState<string | null>(null);

  // Modal State
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const [configRaw, setConfigRaw] = useState<string>("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (state !== "connected") {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [cfg, sch] = await Promise.all([
        request<ConfigSnapshot>("config.get", {}),
        request<ConfigSchemaResponse>("config.schema", {}),
      ]);
      setConfigSnap(cfg);
      setSchemaRes(sch);

      // Extract plugin info
      const list: PluginItem[] = [];
      const s = sch.schema;
      const pluginsSchema = (
        s as {
          properties?: {
            plugins?: { properties?: { entries?: { properties?: Record<string, unknown> } } };
          };
        }
      )?.properties?.plugins?.properties?.entries?.properties;

      type PluginUserEntry = { enabled?: boolean; config?: Record<string, unknown> };
      type PluginsEntries = Record<string, PluginUserEntry | undefined>;
      const pluginsConfig = cfg.config?.plugins as Record<string, unknown> | undefined;
      const userPlugins: PluginsEntries =
        (pluginsConfig?.entries as PluginsEntries | undefined) ?? {};

      if (pluginsSchema) {
        for (const [id, def] of Object.entries(pluginsSchema)) {
          const pDef = def as { title?: string; description?: string };
          // Look up current status
          const userCfg = userPlugins[id];
          const isEnabled = userCfg ? userCfg.enabled !== false : false;

          list.push({
            id,
            name: pDef.title || id,
            description: pDef.description || "No description available.",
            enabled: isEnabled,
            config: userCfg?.config || {},
          });
        }
      }
      list.sort((a, b) => a.id.localeCompare(b.id));
      setPluginsList(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load plugins data");
    } finally {
      setLoading(false);
    }
  }, [state, request]);

  useEffect(() => {
    if (state === "connected") {
      setRestarting(false);
      void loadData();
    }
  }, [state, loadData]);

  const handleToggle = async (pluginId: string, currentEnabled: boolean) => {
    if (!configSnap?.hash) {
      return;
    }
    setToggling(pluginId);
    setError(null);

    const newState = !currentEnabled;
    const patchPayload = {
      baseHash: configSnap.hash,
      raw: JSON.stringify({
        plugins: {
          entries: {
            [pluginId]: {
              enabled: newState,
            },
          },
        },
      }),
    };

    try {
      // Apply the patch - config.patch restarts automatically
      await request("config.patch", patchPayload);

      // Eagerly update UI state
      setPluginsList((prev) =>
        prev.map((p) => (p.id === pluginId ? { ...p, enabled: newState } : p)),
      );
      setRestarting(true);
      setToggling(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to toggle ${pluginId}`);
      setToggling(null);
    }
  };

  const handleOpenConfig = (plugin: PluginItem) => {
    setConfiguringId(plugin.id);
    setConfigRaw(JSON.stringify(plugin.config, null, 2));
    setConfigError(null);
  };

  const handleCloseConfig = () => {
    setConfiguringId(null);
  };

  const handleSaveConfig = async () => {
    if (!configuringId || !configSnap?.hash) {
      return;
    }
    setSavingConfig(true);
    setConfigError(null);

    let parsedConfig: Record<string, unknown>;
    try {
      parsedConfig = JSON.parse(configRaw) as Record<string, unknown>;
    } catch {
      setConfigError("Invalid JSON configuration.");
      setSavingConfig(false);
      return;
    }

    const patchPayload = {
      baseHash: configSnap.hash,
      raw: JSON.stringify({
        plugins: {
          entries: {
            [configuringId]: {
              config: parsedConfig,
            },
          },
        },
      }),
    };

    try {
      await request("config.patch", patchPayload);

      // Eagerly update UI state
      setPluginsList((prev) =>
        prev.map((p) => (p.id === configuringId ? { ...p, config: parsedConfig } : p)),
      );

      setRestarting(true);
      setConfiguringId(null);
    } catch (err) {
      setConfigError(
        err instanceof Error ? err.message : `Failed to save config for ${configuringId}`,
      );
    } finally {
      setSavingConfig(false);
    }
  };

  return (
    <div style={{ animation: "rise 0.3s ease-out" }}>
      <div
        style={{
          marginBottom: 24,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.025em",
              color: "var(--text-strong)",
              margin: 0,
            }}
          >
            Plugins
          </h1>
          <p style={{ color: "var(--muted)", marginTop: 6, marginBottom: 0 }}>
            Manage and configure OpenClaw integration plugins.
          </p>
        </div>
        <div>
          <button
            style={styles.btn}
            onClick={loadData}
            disabled={loading || toggling !== null || state !== "connected" || restarting}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {error && <div style={styles.callout}>{error}</div>}

      {restarting && (
        <div
          style={{
            color: "var(--ok)",
            padding: 40,
            textAlign: "center",
            border: "1px dashed var(--ok)",
            borderRadius: "var(--radius-lg)",
            marginBottom: 16,
          }}
        >
          Applying changes and waiting for gateway to restart...
        </div>
      )}

      {state !== "connected" && !loading && !restarting && (
        <div
          style={{
            color: "var(--muted)",
            padding: 40,
            textAlign: "center",
            border: "1px dashed var(--border)",
            borderRadius: "var(--radius-lg)",
          }}
        >
          Gateway disconnected.
        </div>
      )}

      {loading && pluginsList.length === 0 && !restarting && (
        <div style={{ color: "var(--muted)" }}>Loading plugin registry...</div>
      )}

      {!loading && pluginsList.length === 0 && state === "connected" && !restarting && (
        <div style={{ color: "var(--muted)" }}>No plugins discovered in schema.</div>
      )}

      <div style={styles.list}>
        {pluginsList.map((plugin) => {
          const isToggling = toggling === plugin.id;
          return (
            <div
              key={plugin.id}
              style={{
                ...styles.listItem,
                opacity: isToggling ? 0.6 : 1,
                transition: "opacity 0.2s",
              }}
            >
              <div style={styles.listContent}>
                <h3 style={styles.cardTitle}>
                  {plugin.name}
                  {plugin.name !== plugin.id && <span style={styles.pluginId}>{plugin.id}</span>}
                  {plugin.name === plugin.id && <span style={styles.pluginId}>plugin</span>}
                </h3>
                <p style={styles.description}>{plugin.description}</p>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                <button
                  style={styles.btnConfigure}
                  onClick={() => handleOpenConfig(plugin)}
                  disabled={isToggling || restarting}
                >
                  Configure
                </button>
                <label style={styles.toggleSwitch}>
                  <span style={{ color: plugin.enabled ? "var(--ok)" : "var(--muted)" }}>
                    {isToggling ? "Applying..." : plugin.enabled ? "Active" : "Disabled"}
                  </span>
                  <input
                    type="checkbox"
                    checked={plugin.enabled}
                    onChange={() => handleToggle(plugin.id, plugin.enabled)}
                    disabled={isToggling || restarting}
                    style={{
                      width: 18,
                      height: 18,
                      accentColor: "var(--accent)",
                      cursor: isToggling || restarting ? "wait" : "pointer",
                      outline: "none",
                      margin: 0,
                    }}
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>

      {/* Editing Modal */}
      {configuringId && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>Configure {configuringId}</h2>
              <button
                onClick={handleCloseConfig}
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: 24,
                  cursor: "pointer",
                  color: "var(--muted)",
                  lineHeight: 1,
                }}
              >
                &times;
              </button>
            </div>
            <div style={styles.modalBody}>
              {configError && <div style={styles.callout}>{configError}</div>}
              <p style={{ marginTop: 0, color: "var(--text)", fontSize: 13 }}>
                Edit the JSON configuration payload for this plugin.
              </p>
              <textarea
                style={styles.textarea}
                value={configRaw}
                onChange={(e) => setConfigRaw(e.target.value)}
                spellCheck={false}
                disabled={savingConfig}
              />
            </div>
            <div style={styles.modalFooter}>
              <button
                style={styles.btnConfigure}
                onClick={handleCloseConfig}
                disabled={savingConfig}
              >
                Cancel
              </button>
              <button
                style={{
                  ...styles.btn,
                  background: "var(--accent)",
                  color: "var(--accent-foreground)",
                  borderColor: "var(--accent)",
                }}
                onClick={handleSaveConfig}
                disabled={savingConfig}
              >
                {savingConfig ? "Saving..." : "Save Config"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
