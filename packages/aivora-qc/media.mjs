import { execFile } from "node:child_process";
import { basename, join } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";

/** Return only after the process closes, including cancellation/error paths. */
export async function run(
  binary,
  args,
  { signal, timeoutMs = 600000, cwd, env, maxBuffer = 32 * 1024 * 1024, onProcess } = {},
) {
  if (signal?.aborted) throw Object.assign(new Error("检测已停止"), { code: "ABORT_ERR" });
  const result = await new Promise((resolve) => {
    let outcome,
      closed = false,
      timer,
      escalation,
      stopping,
      stopRequested = false,
      timedOut = false;
    const finish = async () => {
      if (!closed || !outcome) return;
      clearTimeout(timer);
      clearTimeout(escalation);
      signal?.removeEventListener("abort", abort);
      if (stopping) await stopping;
      resolve({ ...outcome, timedOut });
    };
    const child = execFile(
      binary,
      args,
      {
        encoding: "utf8",
        maxBuffer,
        detached: process.platform !== "win32",
        windowsHide: true,
        ...(cwd ? { cwd } : {}),
        ...(env ? { env } : {}),
      },
      (error, stdout, stderr) => {
        outcome = { error, stdout, stderr };
        void finish();
      },
    );
    if (child.pid) {
      try {
        onProcess?.(child.pid, false);
      } catch {
        /* Observers cannot interrupt process ownership. */
      }
    }
    const terminate = () => {
      if (!child.pid || stopRequested) return;
      stopRequested = true;
      if (process.platform === "win32") {
        stopping = new Promise((done) => {
          const killer = execFile(
            join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
            ["/PID", String(child.pid), "/T", "/F"],
            { windowsHide: true },
            () => {},
          );
          killer.once("close", done);
        });
      } else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
        escalation = setTimeout(() => {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }, 1000);
        escalation.unref();
      }
    };
    const abort = () => terminate();
    child.once("close", () => {
      closed = true;
      if (child.pid) {
        try {
          onProcess?.(child.pid, true);
        } catch {
          /* Observers cannot interrupt process cleanup. */
        }
      }
      void finish();
    });
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    timer.unref();
    if (signal?.aborted) abort();
  });
  if (!result.error && !signal?.aborted && !result.timedOut)
    return { stdout: result.stdout, stderr: result.stderr };
  const error = result.error;
  if (error?.code === "ENOENT")
    throw Object.assign(new Error("找不到视频检查工具，请安装工具或在设置中指定正确位置。"), {
      code: "FFMPEG_NOT_FOUND",
    });
  const code = signal?.aborted
    ? "ABORT_ERR"
    : result.timedOut
      ? "ETIMEDOUT"
      : (error?.code ?? "MEDIA_TOOL_FAILED");
  // Do not relay diagnostics, command arguments, file paths, or subtitle text.
  const label = /ffprobe(?:\.exe)?$/i.test(basename(binary))
    ? "ffprobe"
    : /ffmpeg(?:\.exe)?$/i.test(basename(binary))
      ? "ffmpeg"
      : "视频检查工具";
  throw Object.assign(new Error(`${label}未完成（${code}）`), { code });
}

export function readIntervals(log, type, duration, frameDuration = 0) {
  const intervals = [];
  if (type === "black") {
    for (const match of log.matchAll(
      /black_start:([\d.e+-]+)\s+black_end:([\d.e+-]+)\s+black_duration:/g,
    )) {
      let end = Number(match[2]);
      // blackdetect reports the last frame PTS for a black run reaching EOF.
      if (Math.abs(duration - end - frameDuration) < 1e-5) end = duration;
      intervals.push({ start: Number(match[1]), end });
    }
    return intervals;
  }
  let start;
  const pattern = new RegExp(
    `${type === "freeze" ? "freeze" : "silence"}_(start|end):\\s*([\\d.e+-]+)`,
    "g",
  );
  for (const match of log.matchAll(pattern)) {
    if (match[1] === "start") start = Number(match[2]);
    else if (start !== undefined) {
      intervals.push({ start, end: Number(match[2]) });
      start = undefined;
    }
  }
  if (start !== undefined) intervals.push({ start, end: duration });
  return intervals;
}

export function loudness(log) {
  const match = /\{\s*"input_i"\s*:[\s\S]*?\}/.exec(log);
  if (!match) throw new Error("ffmpeg 未返回 loudnorm 测量结果");
  const measurement = JSON.parse(match[0]);
  const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
  return {
    integratedLufs: finite(measurement.input_i),
    truePeakDbtp: finite(measurement.input_tp),
  };
}
