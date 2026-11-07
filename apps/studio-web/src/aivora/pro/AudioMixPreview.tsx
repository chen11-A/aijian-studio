import { useEffect, useRef, useState, useMemo } from "react";
import {
  evaluateAudioMix,
  soloAudioMixPlan,
  audioMixBaseGain,
  audioMixEnvelopeCurves,
} from "@aijian/contracts/film-audio-mix-plan";
import type { AudioMixPreviewResult, MixLane } from "@aijian/contracts/film-audio-mix";
import { scheduleEnvelopeCurve } from "./audio-envelope-schedule";
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_DECODED_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_BYTES = 96 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 8;
/** Main-verified media bytes over the existing authorized IPC. No new protocol/CORS grant,
 * unbounded whole-library decode, duplicate native audio or final-normalization claim. */
export function AudioMixPreview({
  result,
  clock,
  playing,
  rate = 1,
  audible,
  solo = "",
}: {
  result: Extract<AudioMixPreviewResult, { kind: "READY" }> | null;
  clock: () => number;
  playing: boolean;
  rate?: number;
  audible: boolean;
  solo?: MixLane | "";
}) {
  const [failed, setFailed] = useState(false),
    [loading, setLoading] = useState(false);
  const activePlan = useMemo(
    () => (result ? soloAudioMixPlan(result.plan, solo || null) : null),
    [result, solo],
  );
  const controls = useRef({ clock, playing, rate, audible, activePlan });
  controls.current = { clock, playing, rate, audible, activePlan };
  useEffect(() => {
    setFailed(false);
    setLoading(false);
    if (!result) return;
    const read = window.aijian?.readFilmMedia;
    if (typeof AudioContext !== "function" || !read) {
      setFailed(true);
      return;
    }
    const context = new AudioContext();
    let active = true,
      broken = false,
      frame = 0;
    const cache = new Map<string, { buffer: AudioBuffer; bytes: number; used: number }>();
    const pending = new Map<string, Promise<AudioBuffer | null>>();
    const reserved = new Map<string, number>();
    let neededSources = new Set<string>();
    const nodes = new Map<
      string,
      {
        source: AudioBufferSourceNode;
        gain: GainNode;
        envelopes: GainNode[];
        startedAt: number;
        fromSource: number;
        rate: number;
      }
    >();
    function stop(key: string) {
      const node = nodes.get(key);
      if (!node) return;
      try {
        node.source.stop();
      } catch {
        /* already ended */
      }
      node.source.disconnect();
      node.gain.disconnect();
      for (const envelope of node.envelopes) envelope.disconnect();
      nodes.delete(key);
    }
    function fail() {
      if (!active) return;
      broken = true;
      for (const key of nodes.keys()) stop(key);
      setFailed(true);
    }
    async function bufferFor(sourceKey: string) {
      const sha = result!.sourceSha256[sourceKey],
        path = result!.sourcePaths[sourceKey],
        info = result!.sourceInfo[sourceKey];
      const key = `${sourceKey}:${sha}`;
      const existing = cache.get(key);
      if (existing) {
        existing.used = performance.now();
        return existing.buffer;
      }
      const inflight = pending.get(key);
      if (inflight) return inflight;
      if (pending.size >= 2) return null;
      const estimated = info
        ? (info.durationSeconds + 0.05) * Math.max(1, info.channels ?? 2) * context.sampleRate * 4
        : Infinity;
      const occupied = () =>
        [...cache.values()].reduce((sum, value) => sum + value.bytes, 0) +
        [...reserved.values()].reduce((sum, value) => sum + value, 0);
      while (
        cache.size &&
        (cache.size >= MAX_CACHE_ENTRIES || occupied() + estimated > MAX_CACHE_BYTES)
      ) {
        const oldest = [...cache.entries()]
          .filter(([entry]) => !neededSources.has(entry))
          .sort(([, a], [, b]) => a.used - b.used)[0];
        if (!oldest) break;
        cache.delete(oldest[0]);
      }
      if (occupied() + estimated > MAX_CACHE_BYTES) throw new Error("PREVIEW_CAPACITY");
      reserved.set(key, estimated);
      const work = (async () => {
        if (
          !sha ||
          !path ||
          !info ||
          !info.byteLength ||
          info.byteLength > MAX_SOURCE_BYTES ||
          info.durationSeconds * Math.max(1, info.channels ?? 2) * context.sampleRate * 4 >
            MAX_DECODED_BYTES
        )
          throw new Error("PREVIEW_CAPACITY");
        const data = await read!(path, { maxBytes: MAX_SOURCE_BYTES, expectedSha256: sha });
        if (!active) return null;
        if (data.byteLength !== info.byteLength || data.byteLength > MAX_SOURCE_BYTES)
          throw new Error("PREVIEW_SOURCE_CHANGED");
        const bytes = Uint8Array.from(data).buffer;
        const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("");
        if (!active) return null;
        if (digest !== sha) throw new Error("PREVIEW_SOURCE_CHANGED");
        const buffer = await context.decodeAudioData(bytes);
        if (!active) return null;
        const size = buffer.length * buffer.numberOfChannels * 4;
        if (size > MAX_DECODED_BYTES) throw new Error("PREVIEW_CAPACITY");
        while (
          cache.size &&
          (cache.size >= MAX_CACHE_ENTRIES ||
            [...cache.values()].reduce((sum, value) => sum + value.bytes, 0) + size >
              MAX_CACHE_BYTES)
        ) {
          const oldest = [...cache.entries()]
            .filter(([entry]) => !neededSources.has(entry))
            .sort(([, a], [, b]) => a.used - b.used)[0];
          if (!oldest) throw new Error("PREVIEW_CAPACITY");
          cache.delete(oldest[0]);
        }
        cache.set(key, { buffer, bytes: size, used: performance.now() });
        return buffer;
      })();
      pending.set(key, work);
      if (active) setLoading(true);
      try {
        return await work;
      } finally {
        pending.delete(key);
        reserved.delete(key);
        if (active) setLoading(pending.size > 0);
      }
    }
    const tick = () => {
      if (!active || broken) return;
      const { clock, playing, rate, audible, activePlan } = controls.current;
      const time = clock(),
        values = evaluateAudioMix(activePlan ?? result.plan, time);
      const plan = activePlan ?? result.plan;
      const needed = new Set(
        plan.tracks
          .filter((track) => time >= track.startSeconds && time < track.endSeconds)
          .map((track) => track.key),
      );
      neededSources = new Set(
        values
          .filter((value) => audible && needed.has(value.key))
          .map((value) => `${value.sourceKey}:${result.sourceSha256[value.sourceKey]}`),
      );
      let complete = true;
      for (const value of values)
        if (
          audible &&
          needed.has(value.key) &&
          !cache.has(`${value.sourceKey}:${result.sourceSha256[value.sourceKey]}`)
        ) {
          complete = false;
          if (!pending.has(`${value.sourceKey}:${result.sourceSha256[value.sourceKey]}`))
            void bufferFor(value.sourceKey).catch(fail);
        }
      if (!complete) for (const key of nodes.keys()) stop(key);
      for (const key of nodes.keys()) if (!needed.has(key) || !playing || !audible) stop(key);
      for (const value of values) {
        if (!needed.has(value.key)) continue;
        const cached = cache.get(`${value.sourceKey}:${result.sourceSha256[value.sourceKey]}`);
        if (!cached || !complete || !playing || !audible) continue;
        const track = result.plan.tracks.find((track) => track.key === value.key)!;
        let node = nodes.get(value.key);
        const elapsed = node
          ? node.fromSource -
            track.offsetSeconds +
            (context.currentTime - node.startedAt) * node.rate
          : 0;
        const predicted = node
          ? track.offsetSeconds + (track.loopSeconds ? elapsed % track.loopSeconds : elapsed)
          : 0;
        if (node && (Math.abs(predicted - value.sourceSeconds) > 0.04 || node.rate !== rate)) {
          stop(value.key);
          node = undefined;
        }
        if (!node) {
          const source = context.createBufferSource(),
            gain = context.createGain(),
            audioAt = context.currentTime;
          source.buffer = cached.buffer;
          if (track.loopSeconds) {
            source.loop = true;
            source.loopStart = track.offsetSeconds;
            source.loopEnd = track.offsetSeconds + track.loopSeconds;
          }
          source.playbackRate.value = rate;
          // WebAudio speaker upmix duplicates mono equally to L/R, matching the explicit
          // FFmpeg mono pan; it does not apply an extra equal-power -3dB attenuation.
          gain.channelCount = 2;
          gain.channelCountMode = "explicit";
          gain.channelInterpretation = "speakers";
          source.connect(gain);
          let tail = gain;
          const envelopes = audioMixEnvelopeCurves(track).map((curve) => {
            const envelope = context.createGain();
            tail.connect(envelope);
            tail = envelope;
            scheduleEnvelopeCurve(envelope.gain, curve, time, audioAt, rate);
            return envelope;
          });
          tail.connect(context.destination);
          gain.gain.value = audioMixBaseGain(plan, track, time);
          source.start(
            audioAt,
            value.sourceSeconds,
            Math.max(
              0,
              track.loopSeconds
                ? track.endSeconds - time
                : Math.min(track.endSeconds - time, cached.buffer.duration - value.sourceSeconds),
            ),
          );
          node = {
            source,
            gain,
            envelopes,
            startedAt: audioAt,
            fromSource: value.sourceSeconds,
            rate,
          };
          nodes.set(value.key, node);
        }
        node.gain.gain.setValueAtTime(audioMixBaseGain(plan, track, time), context.currentTime);
      }
      if (playing && audible && context.state === "suspended") void context.resume().catch(fail);
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      for (const key of nodes.keys()) stop(key);
      cache.clear();
      pending.clear();
      reserved.clear();
      void context.close().catch(() => undefined);
    };
  }, [result]);
  return result?.plan.limitations.includes("SCENE_AUDIO_BINDING_STALE") ? (
    <span className="role-desc" role="status">
      整场配声的选版、实际时钟或完整成员已变化，整组未试听；请重新核对并选用。
    </span>
  ) : failed ? (
    <span className="role-desc" role="status">
      当前音源无法在受控容量内完整试听，未播放未核验的声音；请在桌面版检查成片，不把静音当作试听成功。
    </span>
  ) : loading ? (
    <span className="role-desc" role="status">
      正在读取当前时间窗的已核验音源…
    </span>
  ) : null;
}
