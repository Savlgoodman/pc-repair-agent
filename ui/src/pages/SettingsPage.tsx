import { useEffect, useMemo, useState } from "react";

import {
  ArchiveRestore,
  ArrowLeft,
  Bot,
  Check,
  Database,
  Info,
  RefreshCw,
  RotateCcw,
  Trash2,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { formatTimeLabel } from "../lib/formatters";
import { fetchProviderModels, loadAppAbout } from "../services/settingsStore";
import type { AppAboutInfo, Session } from "../types";
import "./SettingsPage.css";

type SettingsSection = "providers" | "archive" | "about";

interface SettingsPageProps {
  archivedSessions: Session[];
  onBack: () => void;
  onDeleteArchivedSession: (sessionId: string) => Promise<void>;
  onRestoreArchivedSession: (sessionId: string) => void;
}

interface LocalModelProvider {
  baseUrl: string;
  endpoint: string;
  id: string;
  models: string[];
  name: string;
  supportsMultimodal: boolean;
  supportsReasoning: boolean;
}

interface ModelProvidersSettingsProps {
  onProviderAdded: (provider: LocalModelProvider) => void;
  providers: LocalModelProvider[];
}

const settingsMenu = [
  { id: "providers", icon: Bot, label: "模型提供商配置" },
  { id: "archive", icon: ArchiveRestore, label: "归档会话" },
  { id: "about", icon: Info, label: "关于" }
] satisfies Array<{ id: SettingsSection; icon: LucideIcon; label: string }>;

function providerNameFromUrl(value: string) {
  try {
    return new URL(value).host || value;
  } catch {
    return value;
  }
}

function ModelProvidersSettings({ onProviderAdded, providers }: ModelProvidersSettingsProps) {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [supportsReasoning, setSupportsReasoning] = useState(false);
  const [supportsMultimodal, setSupportsMultimodal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addProvider() {
    const trimmedBaseUrl = baseUrl.trim();
    const trimmedApiKey = apiKey.trim();
    if (!trimmedBaseUrl || !trimmedApiKey) {
      setError("请填写 URL 和 API Key");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchProviderModels({
        apiKey: trimmedApiKey,
        baseUrl: trimmedBaseUrl
      });
      const provider: LocalModelProvider = {
        baseUrl: trimmedBaseUrl,
        endpoint: result.endpoint,
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        models: result.models,
        name: providerNameFromUrl(trimmedBaseUrl),
        supportsMultimodal,
        supportsReasoning
      };
      onProviderAdded(provider);
      setApiKey("");
      setBaseUrl("");
      setSupportsMultimodal(false);
      setSupportsReasoning(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="settings-content-column">
      <div className="settings-page-heading">
        <span className="eyebrow">配置</span>
        <h1>模型提供商配置</h1>
      </div>

      <div className="settings-card">
        <div className="settings-form-grid">
          <label className="settings-field">
            <span>URL</span>
            <input
              autoComplete="off"
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.example.com/v1"
              value={baseUrl}
            />
          </label>
          <label className="settings-field">
            <span>API Key</span>
            <input
              autoComplete="off"
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="sk-..."
              type="password"
              value={apiKey}
            />
          </label>
        </div>

        <div className="settings-toggle-row">
          <label className="settings-check">
            <input
              checked={supportsReasoning}
              onChange={(event) => setSupportsReasoning(event.target.checked)}
              type="checkbox"
            />
            <span>支持思考</span>
          </label>
          <label className="settings-check">
            <input
              checked={supportsMultimodal}
              onChange={(event) => setSupportsMultimodal(event.target.checked)}
              type="checkbox"
            />
            <span>支持多模态</span>
          </label>
          <button className="settings-primary-button" disabled={isLoading} onClick={() => void addProvider()} type="button">
            <RefreshCw className={isLoading ? "spin-icon" : ""} size={15} />
            <span>获取模型并添加</span>
          </button>
        </div>

        {error ? <div className="settings-inline-error">{error}</div> : null}
      </div>

      <div className="settings-list">
        {providers.length === 0 ? (
          <div className="settings-empty">暂无模型提供商</div>
        ) : (
          providers.map((provider) => (
            <article className="settings-provider-row" key={provider.id}>
              <div className="settings-provider-main">
                <div>
                  <strong>{provider.name}</strong>
                  <span>{provider.baseUrl}</span>
                </div>
                <div className="settings-provider-flags">
                  <span className={provider.supportsReasoning ? "enabled" : ""}>
                    {provider.supportsReasoning ? <Check size={13} /> : <X size={13} />}
                    思考
                  </span>
                  <span className={provider.supportsMultimodal ? "enabled" : ""}>
                    {provider.supportsMultimodal ? <Check size={13} /> : <X size={13} />}
                    多模态
                  </span>
                </div>
              </div>
              <div className="settings-model-cloud" aria-label="可用模型">
                {provider.models.slice(0, 18).map((model) => (
                  <span key={model}>{model}</span>
                ))}
                {provider.models.length > 18 ? <span>共 {provider.models.length} 个</span> : null}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function ArchivedSessionsSettings({
  archivedSessions,
  onDeleteArchivedSession,
  onRestoreArchivedSession
}: Pick<SettingsPageProps, "archivedSessions" | "onDeleteArchivedSession" | "onRestoreArchivedSession">) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function deleteSession(session: Session) {
    if (!window.confirm(`确定彻底删除“${session.title}”吗？`)) {
      return;
    }

    setDeletingId(session.id);
    setDeleteError(null);
    try {
      await onDeleteArchivedSession(session.id);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="settings-content-column">
      <div className="settings-page-heading">
        <span className="eyebrow">会话</span>
        <h1>归档会话</h1>
      </div>

      {deleteError ? <div className="settings-inline-error">删除失败：{deleteError}</div> : null}

      <div className="settings-list">
        {archivedSessions.length === 0 ? (
          <div className="settings-empty">暂无归档会话</div>
        ) : (
          archivedSessions.map((session) => (
            <article className="settings-archive-row" key={session.id}>
              <div>
                <strong>{session.title}</strong>
                <span>{session.preview}</span>
              </div>
              <time>{formatTimeLabel(session.updatedAt)}</time>
              <div className="settings-row-actions">
                <button className="settings-secondary-button" onClick={() => onRestoreArchivedSession(session.id)} type="button">
                  <RotateCcw size={14} />
                  <span>恢复</span>
                </button>
                <button
                  className="settings-danger-button"
                  disabled={deletingId === session.id}
                  onClick={() => void deleteSession(session)}
                  type="button"
                >
                  <Trash2 size={14} />
                  <span>{deletingId === session.id ? "删除中" : "彻底删除"}</span>
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function AboutSettings() {
  const [about, setAbout] = useState<AppAboutInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function refreshAbout() {
    setIsLoading(true);
    setError(null);
    try {
      setAbout(await loadAppAbout());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refreshAbout();
  }, []);

  const maxUsageBytes = useMemo(() => {
    const usage = about?.dataUsage ?? [];
    return Math.max(1, ...usage.map((item) => item.bytes));
  }, [about]);

  return (
    <section className="settings-content-column">
      <div className="settings-page-heading with-action">
        <div>
          <span className="eyebrow">应用</span>
          <h1>关于</h1>
        </div>
        <button className="settings-secondary-button" disabled={isLoading} onClick={() => void refreshAbout()} type="button">
          <RefreshCw className={isLoading ? "spin-icon" : ""} size={14} />
          <span>刷新</span>
        </button>
      </div>

      {error ? <div className="settings-inline-error">关于信息读取失败：{error}</div> : null}

      <div className="settings-card">
        <div className="settings-about-grid">
          <div>
            <span>当前版本</span>
            <strong>{about?.appVersion ?? "待检测"}</strong>
          </div>
          <div>
            <span>Backend 版本</span>
            <strong>{about?.backendVersion ?? "待检测"}</strong>
          </div>
          <div>
            <span>运行时环境</span>
            <strong>{about?.runtimeEnv ?? "待检测"}</strong>
          </div>
          <div>
            <span>Agent Adapter</span>
            <strong>{about?.agentAdapter ?? "待检测"}</strong>
          </div>
          <div>
            <span>Git 地址</span>
            <strong>{about?.git.remote ?? "待检测"}</strong>
          </div>
          <div>
            <span>Git 版本</span>
            <strong>{about ? `${about.git.branch} / ${about.git.commit}` : "待检测"}</strong>
          </div>
          <div>
            <span>工作目录</span>
            <strong>{about?.workspace ?? "待检测"}</strong>
          </div>
          <div>
            <span>Data 目录</span>
            <strong>{about?.dataDir ?? "待检测"}</strong>
          </div>
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-storage-head">
          <Database size={16} />
          <strong>Data 目录占用</strong>
          <span>{about?.dataDirSize ?? "待检测"}</span>
        </div>
        <div className="settings-storage-list">
          {(about?.dataUsage ?? []).map((item) => (
            <div className="settings-storage-item" key={item.label}>
              <div>
                <strong>{item.label}</strong>
                <span>{item.path}</span>
              </div>
              <span>{item.size}</span>
              <div className="settings-storage-bar">
                <i style={{ width: `${Math.max(3, (item.bytes / maxUsageBytes) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function SettingsPage({
  archivedSessions,
  onBack,
  onDeleteArchivedSession,
  onRestoreArchivedSession
}: SettingsPageProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("providers");
  const [providers, setProviders] = useState<LocalModelProvider[]>([]);

  return (
    <div className="settings-shell">
      <aside className="settings-sidebar">
        <button className="settings-back-button" onClick={onBack} type="button">
          <ArrowLeft size={17} />
          <span>返回应用</span>
        </button>

        <nav className="settings-nav" aria-label="设置菜单">
          {settingsMenu.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={`settings-nav-item ${activeSection === item.id ? "active" : ""}`}
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                type="button"
              >
                <Icon size={17} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="settings-main">
        {activeSection === "providers" ? (
          <ModelProvidersSettings
            onProviderAdded={(provider) => setProviders((current) => [provider, ...current])}
            providers={providers}
          />
        ) : null}
        {activeSection === "archive" ? (
          <ArchivedSessionsSettings
            archivedSessions={archivedSessions}
            onDeleteArchivedSession={onDeleteArchivedSession}
            onRestoreArchivedSession={onRestoreArchivedSession}
          />
        ) : null}
        {activeSection === "about" ? <AboutSettings /> : null}
      </main>
    </div>
  );
}
