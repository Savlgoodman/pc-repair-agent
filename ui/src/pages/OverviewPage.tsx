import { useEffect, useState, type CSSProperties } from "react";

import { Cpu, Gauge, MemoryStick, RefreshCw } from "lucide-react";

import { loadSystemOverview } from "../services/systemOverview";
import type { SystemOverview, SystemUsageMetric } from "../types";
import "./OverviewPage.css";

const emptyOverview: SystemOverview = {
  collectedAt: 0,
  profile: [
    { label: "CPU 型号", value: "待检测" },
    { label: "CPU 核心", value: "待检测" },
    { label: "内存", value: "待检测" },
    { label: "主板", value: "待检测" },
    { label: "显卡", value: "待检测" },
    { label: "显存", value: "待检测" },
    { label: "设备型号", value: "待检测" },
    { label: "操作系统", value: "待检测" }
  ],
  usage: [
    { detail: "待检测", id: "cpu", label: "CPU 占用", value: null },
    { detail: "待检测", id: "gpu", label: "GPU 占用", value: null },
    { detail: "待检测", id: "memory", label: "内存占用", value: null }
  ]
};

function metricIcon(metricId: SystemUsageMetric["id"]) {
  if (metricId === "cpu") {
    return <Cpu size={17} />;
  }
  if (metricId === "memory") {
    return <MemoryStick size={17} />;
  }
  return <Gauge size={17} />;
}

function metricColor(metricId: SystemUsageMetric["id"]) {
  if (metricId === "cpu") {
    return "#1677ff";
  }
  if (metricId === "memory") {
    return "#12845a";
  }
  return "#0f766e";
}

function UsageGauge({ metric }: { metric: SystemUsageMetric }) {
  const percent = metric.value ?? 0;
  const meterStyle = {
    background: `conic-gradient(${metricColor(metric.id)} ${percent * 3.6}deg, #e8e5e0 0deg)`
  } satisfies CSSProperties;

  return (
    <article className={`overview-gauge ${metric.value === null ? "muted" : ""}`}>
      <div className="overview-gauge-head">
        <span>{metricIcon(metric.id)}</span>
        <strong>{metric.label}</strong>
      </div>
      <div className="overview-meter" style={meterStyle}>
        <div>
          <strong>{metric.value === null ? "--" : metric.value}</strong>
          <span>{metric.value === null ? "待检测" : "%"}</span>
        </div>
      </div>
      <p>{metric.detail ?? "待检测"}</p>
    </article>
  );
}

function formatCollectedAt(value: number) {
  if (!value) {
    return "待检测";
  }
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export function OverviewPage() {
  const [overview, setOverview] = useState<SystemOverview>(emptyOverview);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function refreshOverview() {
    setIsLoading(true);
    setError(null);
    try {
      setOverview(await loadSystemOverview());
    } catch (requestError) {
      setOverview(emptyOverview);
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refreshOverview();
  }, []);

  return (
    <main className="main-panel overview-panel">
      <header className="overview-header">
        <div>
          <span className="eyebrow">本机状态</span>
          <h1>总览</h1>
        </div>
        <button className="outline-action" disabled={isLoading} onClick={() => void refreshOverview()} type="button">
          <RefreshCw className={isLoading ? "spin-icon" : ""} size={15} />
          <span>刷新</span>
        </button>
      </header>

      <div className="overview-scroll">
        {error ? <div className="overview-error">本机概览读取失败：{error}</div> : null}

        <section className="overview-section">
          <div className="overview-section-title">
            <span className="eyebrow">占用率</span>
            <strong>当前采样：{formatCollectedAt(overview.collectedAt)}</strong>
          </div>
          <div className="overview-gauge-grid">
            {overview.usage.map((metric) => (
              <UsageGauge key={metric.id} metric={metric} />
            ))}
          </div>
        </section>

        <section className="overview-section">
          <div className="overview-section-title">
            <span className="eyebrow">硬件属性</span>
            <strong>基础配置</strong>
          </div>
          <div className="overview-profile-grid">
            {overview.profile.map((item) => (
              <article className="overview-profile-item" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
