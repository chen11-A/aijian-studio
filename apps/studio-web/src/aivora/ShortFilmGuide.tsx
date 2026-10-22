import { useState } from "react";
import { Button } from "./Common";
import { useDemo } from "./model";
import { Select } from "./Select";

export const SAMPLE_TITLE = "雾城来信";
export const SAMPLE_SCENE = "灯塔夜班";
export const SAMPLE_LINE = "雾散之前，不要回头。";

const steps = ["故事", "画面", "声音", "成片"] as const;

type ProviderId = "stub" | "grok_subscription" | "xai_api_key" | "chatgpt";

const providers: { id: ProviderId; label: string; billing: string }[] = [
  { id: "stub", label: "本地占位", billing: "不花钱" },
  { id: "grok_subscription", label: "Grok 订阅", billing: "包含在订阅里，不另收费" },
  { id: "xai_api_key", label: "API Key", billing: "会花钱，需要先确认" },
  { id: "chatgpt", label: "ChatGPT 登录", billing: "不能生成画面和声音" },
];

type FilmResult = {
  status?: string;
  message?: string;
  provider_label?: string;
  billing_label?: string;
  fix?: string | null;
  suggested_provider?: ProviderId | null;
  output_path?: string | null;
  duration_seconds?: string | null;
  has_video?: boolean;
  has_audio?: boolean;
};

function desktopFilm() {
  const bridge = window.aijian;
  if (!bridge || typeof bridge.createStoryFilm !== "function") return null;
  return bridge;
}

export function ShortFilmGuide() {
  const d = useDemo();
  const step = Math.min(Math.max(d.filmStep, 0), 3);
  const [scene, setScene] = useState(SAMPLE_SCENE);
  const [line, setLine] = useState(SAMPLE_LINE);
  const [subtitle, setSubtitle] = useState("雾城来信");
  const [provider, setProvider] = useState<ProviderId>("stub");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<FilmResult | null>(null);
  const choice = providers.find((item) => item.id === provider) ?? providers[0]!;

  const go = (next: number) => d.setFilmStep(next);

  const make = async (confirmed: boolean) => {
    const bridge = desktopFilm();
    const projectId = d.backendProjectId;
    if (!bridge || !projectId) {
      setNotice("网页预览不能生成成片。请打开安装好的 AIVORA，再点一次「开始做成片」。");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const response = await bridge.createStoryFilm!(projectId, {
        scene_label: scene.trim() || SAMPLE_SCENE,
        narration: line.trim() || SAMPLE_LINE,
        subtitle: subtitle.trim(),
        provider,
        confirmed,
      });
      const data = (response.data ?? {}) as FilmResult;
      setResult(data);
      setNotice(data.message || "没有得到结果。");
      if (data.suggested_provider === "stub" || data.suggested_provider === "grok_subscription") {
        setProvider(data.suggested_provider);
      }
    } catch {
      setNotice("成片没有做完。可以改用本地占位再试一次。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="v2-home-page v2-project-home short-film">
      <header className="page-title v2-home-heading">
        <div>
          <h1>项目创作首页</h1>
          <p>四步做成片：故事、画面、声音、成片。这是草稿，还不是正式发行。</p>
        </div>
      </header>
      {d.projects.length === 0 && (
        <nav className="film-steps" aria-label="创作阶段">
          {steps.map((label, index) => (
            <button
              key={label}
              type="button"
              aria-current={index === step ? "step" : undefined}
              className={index === step ? "current" : ""}
              onClick={() => go(index)}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
      <section className="v2-utility-card" aria-label="短片向导">
        <p>
          第 {step + 1} 步 · {steps[step]} · {choice.label} · {choice.billing}
        </p>
        {step === 0 && (
          <label>
            这一场
            <input
              aria-label="这一场"
              value={scene}
              onChange={(event) => setScene(event.target.value)}
            />
          </label>
        )}
        {step === 1 && (
          <label>
            用什么生成
            <Select
              aria-label="用什么生成"
              value={provider}
              onChange={(event) => setProvider(event.target.value as ProviderId)}
            >
              {providers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label} · {item.billing}
                </option>
              ))}
            </Select>
          </label>
        )}
        {step === 2 && (
          <>
            <label>
              旁白
              <input
                aria-label="旁白"
                value={line}
                onChange={(event) => setLine(event.target.value)}
              />
            </label>
            <label>
              字幕
              <input
                aria-label="字幕"
                value={subtitle}
                onChange={(event) => setSubtitle(event.target.value)}
              />
            </label>
          </>
        )}
        {step === 3 && (
          <p>
            将用「{choice.label}」把「{scene || SAMPLE_SCENE}」做成大约两秒的草稿视频。
            {choice.billing}。这是草稿，不是正式发行。
          </p>
        )}
        {!d.backendProjectId && (
          <p>还没有保存到电脑上的作品。回到首页，打开「雾城来信」，或写一句话开始。</p>
        )}
        <div className="account-actions">
          {!d.backendProjectId && (
            <Button disabled={busy} onClick={() => d.go("home")}>
              回首页开始
            </Button>
          )}
          {step > 0 && (
            <Button disabled={busy} onClick={() => go(step - 1)}>
              上一步
            </Button>
          )}
          {step < 3 && (
            <Button primary disabled={busy} onClick={() => go(step + 1)}>
              下一步
            </Button>
          )}
          {d.projects.length === 0 && (
            <Button disabled={busy} onClick={() => d.setProfessional(true)}>
              专业模式
            </Button>
          )}
          {step === 3 && provider !== "xai_api_key" && (
            <Button primary disabled={busy} onClick={() => void make(false)}>
              {busy ? "正在做" : "开始做成片"}
            </Button>
          )}
          {step === 3 && provider === "xai_api_key" && (
            <Button primary disabled={busy} onClick={() => void make(true)}>
              {busy ? "正在检查" : "确认花钱并继续"}
            </Button>
          )}
        </div>
        {notice && <p role="status">{notice}</p>}
        {result?.status === "SUCCEEDED" && result.output_path && (
          <p>
            已保存{result.duration_seconds ? `，大约 ${result.duration_seconds} 秒` : ""}
            {result.has_video && result.has_audio ? "，有画面也有声音" : ""}。文件在本机：
            {result.output_path}
          </p>
        )}
        {result?.fix && result.status !== "SUCCEEDED" && <p>{result.fix}</p>}
      </section>
    </div>
  );
}
