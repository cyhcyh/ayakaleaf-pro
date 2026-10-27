import { useEffect, useRef, useState } from "react";
import MaterialIcon from "@/shared/components/material-icon";
import type { SettingsTab } from "@/features/ide-settings/context/types";
import {
  api,
  settingsChanged,
  type Binding,
  type Connection,
  type Profile,
  type ModelInfo,
} from "./api";
import { ModelPicker } from './model-controls';
import { BindingFields, CompressionSettings } from './settings-fields';
import DataSettings from './data-settings';
import "./style.scss";

const featureNames = {
  chat: "AI 助手",
  fix: "编译错误修复",
  review: "论文审阅",
  translation: "大模型翻译",
};
const providerNames: Record<string, string> = {
  "google-free": "Google 翻译 · 免 Key",
  mymemory: "MyMemory · 免费",
  llm: "大语言模型 / Codex",
  google: "Google Cloud · 官方 API",
};

export function PersonalAiSettings() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState("connections");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [catalogs, setCatalogs] = useState<
    Record<string, ModelInfo[]>
  >({});
  const [testModels, setTestModels] = useState<Record<string, string>>({});
  const [devices, setDevices] = useState<
    Record<
      string,
      {
        userCode: string;
        verificationURL: string;
        expiresAt: number;
        interval: number;
      }
    >
  >({});
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    api<Profile>("/settings")
      .then(setProfile)
      .catch((error) => setError(error.message));
    return () => {
      alive.current = false;
    };
  }, []);

  const execute = async (run: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await run();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const save = async () => {
    const saved = await api<Profile>("/settings", profile);
    setProfile(saved);
    settingsChanged(saved);
    setNotice("已保存，设置已生效");
    return saved;
  };
  const persistConnection = async (id: string) => {
    if (!profile) return;
    const saved = await api<Profile>('/connections/save', { revision: profile.revision, connection: profile.connections.find(c => c.id === id) });
    setProfile(current => current && ({ ...current, revision: saved.revision,
      connections: current.connections.map(c => c.id === id ? saved.connections.find(item => item.id === id)! : c) }));
    return saved;
  };
  const updateConnection = (id: string, values: Partial<Connection>) =>
    setProfile(
      (current) =>
        current && {
          ...current,
          connections: current.connections.map((connection) =>
            connection.id === id ? { ...connection, ...values } : connection,
          ),
        },
    );
  const add = (kind: Connection["kind"]) =>
    setProfile(
      (current) =>
        current && {
          ...current,
          connections: [
            ...current.connections,
            {
              id: crypto.randomUUID(),
              kind,
              name:
                kind === "codex"
                  ? "我的 Codex"
                  : kind === "google"
                    ? "Google Cloud"
                    : "我的模型服务",
              baseURL: "",
            },
          ],
        },
    );
  const remove = (id: string) =>
    setProfile(
      (current) =>
        current && {
          ...current,
          connections: current.connections.filter(
            (connection) => connection.id !== id,
          ),
          bindings: Object.fromEntries(
            Object.entries(current.bindings).map(([key, binding]) => [
              key,
              binding.connectionId === id
                ? { connectionId: "", model: "" }
                : binding,
            ]),
          ) as Profile["bindings"],
          translation: {
            ...current.translation,
            googleConnectionId:
              current.translation.googleConnectionId === id
                ? ""
                : current.translation.googleConnectionId,
          },
        },
    );
  const models = async (id: string) => {
    const result = await api<{ models: ModelInfo[]; updatedAt: string }>(
      `/connections/${id}/models`,
      {},
    );
    setCatalogs((current) => ({ ...current, [id]: result.models }));
    updateConnection(id, { catalog: result });
    if (result.models[0])
      setTestModels((current) => ({
        ...current,
        [id]: current[id] || result.models[0].id,
      }));
    setNotice(`已获取 ${result.models.length} 个模型，也可以手动填写模型 ID`);
  };

  useEffect(() => {
    if (!Object.keys(devices).length) return;
    let polling = false;
    const timer = window.setInterval(
      async () => {
        if (polling) return;
        polling = true;
        try {
          for (const [id, device] of Object.entries(devices)) {
            if (Date.now() >= device.expiresAt) {
              setDevices((current) => {
                const next = { ...current };
                delete next[id];
                return next;
              });
              setError("设备码已过期，请重新登录 Codex");
              continue;
            }
            const result = await api(`/connections/${id}/codex/poll`, {});
            if (!alive.current) return;
            if (result.status === "ready") {
              setDevices((current) => {
                const next = { ...current };
                delete next[id];
                return next;
              });
              updateConnection(id, { authStatus: "ready" });
              setNotice("Codex 授权成功，可以获取模型并进行功能分配");
              try {
                await models(id);
              } catch (error) {
                setError((error as Error).message);
              }
            }
          }
        } catch (error) {
          if (alive.current) setError((error as Error).message);
        } finally {
          polling = false;
        }
      },
      Math.max(
        5000,
        ...Object.values(devices).map((device) => device.interval * 1000),
      ),
    );
    return () => window.clearInterval(timer);
  }, [devices]);

  if (!profile)
    return (
      <div className="pa-settings" role="status">
        {error || "正在读取你的模型设置…"}
      </div>
    );
  const bind = (
    feature: keyof Profile["bindings"],
    changes: Partial<Binding>,
  ) =>
    setProfile({
      ...profile,
      bindings: {
        ...profile.bindings,
        [feature]: { ...profile.bindings[feature], ...changes },
      },
    });
  const textConnections = profile.connections.filter(
    (connection) => connection.kind !== "google",
  );

  return (
    <div className="pa-settings">
      <div className="pa-heading">
        <div>
          <h3>AI 与翻译</h3>
          <p>设置模型连接、翻译和对话记录。</p>
        </div>
        <MaterialIcon type="auto_awesome" />
      </div>
      <div className="pa-tabs" role="tablist" aria-label="AI 与翻译设置">
        {(
          [
            ["connections", "模型连接"],
            ["bindings", "功能分配"],
            ["translation", "划词翻译"],
            ["compression", "上下文压缩"],
            ["data", "数据管理"],
          ] as const
        ).map(([key, name]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
          >
            {name}
          </button>
        ))}
      </div>
      {error && (
        <div className="alert alert-danger py-2" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="pa-success" role="status">
          {notice}
        </div>
      )}
      <fieldset disabled={busy}>
        {tab === "connections" && (
          <>
            <div className="pa-actions">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => add("cloud")}
              >
                ＋ OpenAI 兼容接口
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => add("codex")}
              >
                ＋ Codex
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => add("google")}
              >
                ＋ Google Cloud
              </button>
            </div>
            {!profile.connections.length && (
              <div className="pa-empty">
                <MaterialIcon type="hub" />
                <h4>添加你的第一个模型连接</h4>
                <p>
                  使用 API Key 连接模型服务，或通过 ChatGPT 账号授权 Codex。
                </p>
              </div>
            )}
            {profile.connections.map((connection) => (
              <section className="pa-card" key={connection.id}>
                <div className="pa-card-title">
                  <strong>
                    {connection.kind === "cloud"
                      ? "OpenAI 兼容接口"
                      : connection.kind === "codex"
                        ? "Codex"
                        : "Google Cloud 翻译"}
                  </strong>
                  <span
                    className={`pa-status ${connection.authStatus === "ready" || connection.hasKey ? "ready" : ""}`}
                  >
                    {connection.kind === "codex"
                      ? connection.authStatus === "ready"
                        ? "已授权"
                        : "未登录"
                      : connection.hasKey
                        ? "已保存密钥"
                        : "待配置"}
                  </span>
                  <button
                    className="btn btn-link btn-sm ms-auto"
                    aria-label={`移除 ${connection.name}`}
                    onClick={() => remove(connection.id)}
                  >
                    移除
                  </button>
                </div>
                <label className="pa-field">
                  连接名称
                  <input
                    className="form-control"
                    value={connection.name}
                    onChange={(event) =>
                      updateConnection(connection.id, {
                        name: event.target.value,
                      })
                    }
                  />
                </label>
                {connection.kind === "cloud" && (
                  <label className="pa-field">
                    Base URL
                    <input
                      className="form-control"
                      placeholder="https://api.example.com/v1"
                      value={connection.baseURL}
                      onChange={(event) =>
                        updateConnection(connection.id, {
                          baseURL: event.target.value,
                        })
                      }
                    />
                  </label>
                )}
                {connection.kind !== "codex" ? (
                  <>
                    <label className="pa-field">
                      API Key
                      <input
                        className="form-control"
                        type="password"
                        autoComplete="new-password"
                        placeholder={
                          connection.hasKey
                            ? "已保存，留空保持现有密钥"
                            : "输入此服务的 API Key"
                        }
                        value={connection.apiKey || ""}
                        onChange={(event) =>
                          updateConnection(connection.id, {
                            apiKey: event.target.value,
                            clearKey: false,
                          })
                        }
                      />
                    </label>
                    {connection.hasKey && (
                      <label className="pa-checkbox">
                        <input
                          type="checkbox"
                          checked={connection.clearKey || false}
                          onChange={(event) =>
                            updateConnection(connection.id, {
                              clearKey: event.target.checked,
                            })
                          }
                        />{" "}
                        清除已保存的密钥
                      </label>
                    )}
                  </>
                ) : (
                  <>
                    <p className="pa-muted">
                      使用自己的 ChatGPT 账号授权，凭据仅保存在服务端。
                    </p>
                    <div className="pa-actions">
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() =>
                          execute(async () => {
                            await persistConnection(connection.id);
                            const device = await api(
                              `/connections/${connection.id}/codex/login`,
                              {},
                            );
                            setDevices((current) => ({
                              ...current,
                              [connection.id]: device,
                            }));
                          })
                        }
                      >
                        {connection.authStatus === "ready"
                          ? "重新授权 Codex"
                          : "登录 Codex"}
                      </button>
                      {connection.authStatus === "ready" && (
                        <button
                          className="btn btn-link btn-sm"
                          onClick={() =>
                            execute(async () => {
                              await api(
                                `/connections/${connection.id}/codex/logout`,
                                {},
                              );
                              updateConnection(connection.id, {
                                authStatus: "logged_out",
                              });
                              settingsChanged(profile);
                            })
                          }
                        >
                          退出授权
                        </button>
                      )}
                    </div>
                    {devices[connection.id] && (
                      <div className="pa-device">
                        <span>在授权页面输入设备码</span>
                        <strong>{devices[connection.id].userCode}</strong>
                        <a
                          href={devices[connection.id].verificationURL}
                          target="_blank"
                          rel="noreferrer"
                        >
                          打开 ChatGPT 授权页面 ↗
                        </a>
                        <small>完成授权后，这里会自动更新。</small>
                      </div>
                    )}
                  </>
                )}
                {connection.kind !== "google" && (
                  <div className="pa-model-test">
                    <div className="pa-field">
                      <span>用于测试的模型</span>
                      <ModelPicker label={`用于测试的模型 · ${connection.name}`} value={testModels[connection.id] || ""}
                        models={catalogs[connection.id] || connection.catalog?.models || []}
                        onChange={value => setTestModels(current => ({ ...current, [connection.id]: value }))} />
                    </div>
                    <div className="pa-actions pa-test-actions">
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() =>
                          execute(async () => {
                            await persistConnection(connection.id);
                            await models(connection.id);
                          })
                        }
                      >
                        获取可用模型
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={!testModels[connection.id]}
                        onClick={() =>
                          execute(async () => {
                            await persistConnection(connection.id);
                            await api(`/connections/${connection.id}/test`, {
                              model: testModels[connection.id],
                            });
                            setNotice("测试成功，模型已返回回复");
                          })
                        }
                      >
                        测试连接
                      </button>
                    </div>
                    <p className="pa-muted mb-0">仅用于测试，不改变功能分配。</p>
                  </div>
                )}
              </section>
            ))}
          </>
        )}
        {tab === "bindings" && (
          <>
            <p className="pa-muted">可分别设置模型和思考参数，也可沿用 AI 助手的配置。</p>
            {Object.entries(featureNames).map(([feature, name]) => {
              const key = feature as keyof Profile["bindings"];
              return <section className="pa-card pa-feature-card" key={key}>
                <h4>{name}</h4>
                <div className="pa-binding"><BindingFields profile={profile} value={profile.bindings[key]}
                  primary={key === 'chat'} onChange={changes => bind(key, changes)} /></div>
              </section>;
            })}
          </>
        )}
        {tab === "compression" && <CompressionSettings profile={profile} onProfile={setProfile} />}
        {tab === 'data' && <DataSettings />}
        {tab === "translation" && (
          <section className="pa-card">
            <h4>划词翻译</h4>
            <label className="pa-checkbox">
              <input
                type="checkbox"
                checked={profile.translation.enabled}
                onChange={(event) =>
                  setProfile({
                    ...profile,
                    translation: {
                      ...profile.translation,
                      enabled: event.target.checked,
                    },
                  })
                }
              />{" "}
              在 PDF 预览和 LaTeX 编辑区启用
            </label>
            <label className="pa-field">
              默认翻译服务
              <select
                className="form-select form-control"
                value={profile.translation.provider}
                onChange={(event) =>
                  setProfile({
                    ...profile,
                    translation: {
                      ...profile.translation,
                      provider: event.target.value,
                    },
                  })
                }
              >
                {Object.entries(providerNames).map(([key, name]) => (
                  <option value={key} key={key}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="pa-field">
              默认目标语言
              <select
                className="form-select form-control"
                value={profile.translation.target}
                onChange={(event) =>
                  setProfile({
                    ...profile,
                    translation: {
                      ...profile.translation,
                      target: event.target.value,
                    },
                  })
                }
              >
                <option value="zh-CN">简体中文</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
                <option value="ko">한국어</option>
                <option value="de">Deutsch</option>
                <option value="fr">Français</option>
              </select>
            </label>
            {profile.translation.provider === "google" && (
              <label className="pa-field">
                Google Cloud 连接
                <select
                  className="form-select form-control"
                  value={profile.translation.googleConnectionId}
                  onChange={(event) =>
                    setProfile({
                      ...profile,
                      translation: {
                        ...profile.translation,
                        googleConnectionId: event.target.value,
                      },
                    })
                  }
                >
                  <option value="">请选择已添加的 Google Cloud 连接</option>
                  {profile.connections
                    .filter((connection) => connection.kind === "google")
                    .map((connection) => (
                      <option key={connection.id} value={connection.id}>
                        {connection.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <p className="pa-muted">
              Google 翻译无需密钥，MyMemory 有免费额度。大模型翻译使用“功能分配”中的模型。
            </p>
          </section>
        )}
        {tab !== 'data' && <div className="pa-footer">
          <span className="pa-muted">设置仅属于当前账号</span>
          <button
            className="btn btn-primary"
            onClick={() =>
              execute(async () => {
                await save();
              })
            }
          >
            {busy ? "正在保存…" : "保存设置"}
          </button>
        </div>}
      </fieldset>
    </div>
  );
}

export default {
  key: "personal-ai",
  title: "AI 与翻译",
  icon: "settings",
  sections: [
    {
      key: "personal-ai",
      settings: [{ key: "personalAi", component: <PersonalAiSettings /> }],
    },
  ],
} satisfies SettingsTab;
