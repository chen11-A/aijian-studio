import { useEffect, useState } from "react";
import { Button } from "./Common";
import { capabilitiesForListedModel } from "./account/model-capabilities";
import { grokBridge } from "./grok-auth/transport";
import { useDemo } from "./model";
import { Select } from "./Select";

export const SAMPLE_TITLE = "雾城来信";
export const SAMPLE_SCENE = "灯塔夜班";
export const SAMPLE_LINE = "雾散之前，不要回头。";

const steps = ["故事", "画面", "声音", "成片"] as const;
const filmStages = ["画面", "视频", "配音", "合成"] as const;
const stageKeys = ["image", "video", "speech", "assemble"] as const;
const fallbackVoices = [
  { id: "eve", label: "Eve" },
  { id: "ara", label: "Ara" },
  { id: "rex", label: "Rex" },
  { id: "sal", label: "Sal" },
  { id: "leo", label: "Leo" },
];

type ProviderId = "stub" | "grok_subscription" | "xai_api_key" | "chatgpt";

const choiceKey = "aivora.short-film.choices";

function readFilmChoices(): {
  scene?: string;
  line?: string;
  subtitle?: string;
  provider?: ProviderId;
  voiceId?: string;
} {
  try {
    const raw = window.localStorage.getItem(choiceKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const provider = parsed.provider;
    return {
      scene: typeof parsed.scene === "string" ? parsed.scene : undefined,
      line: typeof parsed.line === "string" ? parsed.line : undefined,
      subtitle: typeof parsed.subtitle === "string" ? parsed.subtitle : undefined,
      provider:
        provider === "stub" ||
        provider === "grok_subscription" ||
        provider === "xai_api_key" ||
        provider === "chatgpt"
          ? provider
          : undefined,
      voiceId: typeof parsed.voiceId === "string" ? parsed.voiceId : undefined,
    };
  } catch {
    return {};
  }
}

const providers: { id: ProviderId; label: string; billing: string }[] = [
  { id: "stub", label: "本地占位", billing: "不花钱" },
  { id: "grok_subscription", label: "Grok 订阅", billing: "包含在订阅里，不另收费" },
  { id: "xai_api_key", label: "密钥", billing: "会花钱，需要先确认" },
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
  preview_image?: string | null;
};

function desktopFilm() {
  const bridge = window.aijian;
  if (!bridge || typeof bridge.createStoryFilm !== "function") return null;
  return bridge;
}

export function ShortFilmGuide() {
  const d = useDemo();
  const step = Math.min(Math.max(d.filmStep, 0), 3);
  const savedChoices = readFilmChoices();
  const [scene, setScene] = useState(savedChoices.scene || SAMPLE_SCENE);
  const [line, setLine] = useState(savedChoices.line || SAMPLE_LINE);
  const [subtitle, setSubtitle] = useState(savedChoices.subtitle ?? "雾城来信");
  const [provider, setProvider] = useState<ProviderId>(savedChoices.provider ?? "stub");
  const [voiceId, setVoiceId] = useState(savedChoices.voiceId || "eve");
  const [voices, setVoices] = useState(fallbackVoices);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<FilmResult | null>(null);
  const [preview, setPreview] = useState("");
  const choice = providers.find((item) => item.id === provider) ?? providers[0]!;
  const voice = voices.find((item) => item.id === voiceId) ?? voices[0]!;

  useEffect(() => {
    window.localStorage.setItem(
      choiceKey,
      JSON.stringify({ scene, line, subtitle, provider, voiceId }),
    );
  }, [scene, line, subtitle, provider, voiceId]);

  useEffect(() => {
    const bridge = grokBridge();
    if (!bridge) return;
    let live = true;
    void bridge.models().then((listed) => {
      if (!live || listed.kind !== "OK") return;
      const speech = listed.models.filter((model) =>
        capabilitiesForListedModel(model).includes("SPEECH"),
      );
      if (speech.length === 0) return;
      setVoices(speech.map((model) => ({ id: model.id, label: model.label || model.id })));
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      setElapsed(Math.max(1, Math.floor((Date.now() - started) / 1000)));
      const projectId = d.backendProjectId;
      const progress = desktopFilm()?.getStoryFilmProgress;
      if (!projectId || !progress) return;
      void progress(projectId)
        .then((response) => {
          const key = response.data?.stage;
          const index = stageKeys.indexOf(key as (typeof stageKeys)[number]);
          if (index >= 0) setStage(index);
          const picture = response.data?.preview_image;
          if (typeof picture === "string" && picture.startsWith("data:image/")) setPreview(picture);
        })
        .catch(() => undefined);
    }, 800);
    return () => window.clearInterval(timer);
  }, [busy, d.backendProjectId]);

  const go = (next: number) => d.setFilmStep(next);

  const make = async (confirmed: boolean) => {
    const bridge = desktopFilm();
    const projectId = d.backendProjectId;
    if (!bridge || !projectId) {
      setNotice("网页预览不能生成成片。请打开安装好的 AIVORA，再点一次「开始做成片」。");
      return;
    }
    setBusy(true);
    setStage(0);
    setElapsed(0);
    setNotice("");
    setResult(null);
    try {
      const response = await bridge.createStoryFilm!(projectId, {
        scene_label: scene.trim() || SAMPLE_SCENE,
        narration: line.trim() || SAMPLE_LINE,
        subtitle: subtitle.trim(),
        provider,
        confirmed,
        voice_id: voiceId,
      });
      const data = (response.data ?? {}) as FilmResult;
      setResult(data);
      if (typeof data.preview_image === "string" && data.preview_image.startsWith("data:image/"))
        setPreview(data.preview_image);
      setNotice(data.message || "没有得到结果。");
    } catch {
      setNotice(
        provider === "grok_subscription" ? "成片没有做完。可以重试。" : "成片没有做完。可以重试。",
      );
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    const projectId = d.backendProjectId;
    const bridge = desktopFilm();
    if (projectId && bridge?.cancelStoryFilm) void bridge.cancelStoryFilm(projectId);
    setNotice("已停止等待。可以重试。");
  };

  return (
    <div className="v2-home-page v2-project-home short-film">
      <header className="page-title v2-home-heading">
        <div>
          <h1>{steps[step]}</h1>
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
            <label>
              配音
              <Select
                aria-label="配音"
                value={voiceId}
                onChange={(event) => setVoiceId(event.target.value)}
              >
                {voices.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </label>
            <p>当前配音：{voice.label}</p>
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
          {step === 3 && provider !== "xai_api_key" && !busy && (
            <Button primary onClick={() => void make(false)}>
              开始做成片
            </Button>
          )}
          {step === 3 && provider === "xai_api_key" && !busy && (
            <Button primary onClick={() => void make(true)}>
              确认花钱并继续
            </Button>
          )}
          {busy && <Button onClick={cancel}>取消</Button>}
        </div>
        {busy && (
          <ol className="film-progress" aria-label="生成进度">
            {filmStages.map((label, index) => (
              <li key={label} aria-current={index === stage ? "step" : undefined}>
                {label}
                {index === stage ? " · 进行中" : index < stage ? " · 已完成" : ""}
              </li>
            ))}
            <li>已用 {elapsed} 秒</li>
          </ol>
        )}
        {preview && <img className="film-still" alt="已生成的画面" src={preview} />}
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
