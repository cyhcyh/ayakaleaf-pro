import { useEffect, useRef, useState } from "react";
import MaterialIcon from "@/shared/components/material-icon";
import type { SettingsTab } from "@/features/ide-settings/context/types";
import {
  api,
  settingsChanged,
  type Binding,
  type Connection,
  type Profile,
} from "./api";
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
    Record<string, { id: string; name: string }[]>
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
    const result = await api<{ models: { id: string; name: string }[] }>(
      `/connections/${id}/models`,
      {},
    );
    setCatalogs((current) => ({ ...current, [id]: result.models }));
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
          <p>管理你的模型连接，为写作、审阅和翻译选择合适的模型。</p>
        </div>
        <MaterialIcon type="auto_awesome" />
      </div>
      <div className="pa-tabs" role="tablist" aria-label="AI 与翻译设置">
        {(
          [
            ["connections", "模型连接"],
            ["bindings", "功能分配"],
            ["translation", "划词翻译"],
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
                className="btn btn-primary btn-sm"
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
                className="btn btn-link btn-sm"
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
                            await save();
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
                    <label className="pa-field">
                      测试用模型
                      <input
                        className="form-control"
                        list={`models-${connection.id}`}
                        value={testModels[connection.id] || ""}
                        placeholder="模型 ID，可手动填写"
                        onChange={(event) =>
                          setTestModels({
                            ...testModels,
                            [connection.id]: event.target.value,
                          })
                        }
                      />
                    </label>
                    <datalist id={`models-${connection.id}`}>
                      {(catalogs[connection.id] || []).map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name}
                        </option>
                      ))}
                    </datalist>
                    <div className="pa-actions">
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() =>
                          execute(async () => {
                            await save();
                            await models(connection.id);
                          })
                        }
                      >
                        获取模型
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={!testModels[connection.id]}
                        onClick={() =>
                          execute(async () => {
                            await save();
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
                  </div>
                )}
              </section>
            ))}
          </>
        )}
        {tab === "bindings" && (
          <>
            <p className="pa-muted">
              为各功能独立选模型。留空的功能继承 AI 助手配置；AI
              助手留空时使用管理员默认连接。
            </p>
            {Object.entries(featureNames).map(([feature, name]) => {
              const key = feature as keyof Profile["bindings"];
              const value = profile.bindings[key];
              return (
                <section className="pa-card" key={key}>
                  <h4>{name}</h4>
                  <div className="pa-binding">
                    <label className="pa-field">
                      连接
                      <select
                        className="form-select form-control"
                        value={value.connectionId}
                        onChange={(event) =>
                          bind(key, {
                            connectionId: event.target.value,
                            model: "",
                          })
                        }
                      >
                        <option value="">
                          {key === "chat" ? "管理员默认连接" : "继承 AI 助手"}
                        </option>
                        {textConnections.map((connection) => (
                          <option value={connection.id} key={connection.id}>
                            {connection.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="pa-field">
                      模型
                      <input
                        className="form-control"
                        disabled={!value.connectionId}
                        list={`models-${key}`}
                        value={value.model}
                        placeholder="选择或填写模型 ID"
                        onChange={(event) =>
                          bind(key, { model: event.target.value })
                        }
                      />
                    </label>
                    <datalist id={`models-${key}`}>
                      {(catalogs[value.connectionId] || []).map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name}
                        </option>
                      ))}
                    </datalist>
                  </div>
                </section>
              );
            })}
          </>
        )}
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
              Google 免 Key 模式无需配置密钥；MyMemory
              有每日免费额度。选择大模型时，使用“功能分配”中的翻译模型。
            </p>
          </section>
        )}
        <div className="pa-footer">
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
        </div>
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
