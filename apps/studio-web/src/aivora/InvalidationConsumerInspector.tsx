import { useEffect, useRef, useState } from "react";
import {
  invalidationConsumerData,
  invalidationConsumerResponse,
  type InvalidationConsumerData,
  type InvalidationConsumerIdentity,
} from "@aijian/contracts/invalidation-consumer";
import { Button } from "./Common";

/** A read-only inspection of the saved impacted object; never opens a newer editor version. */
export function InvalidationConsumerInspector({
  identity,
}: {
  identity: InvalidationConsumerIdentity;
}) {
  const scope = JSON.stringify(identity);
  const epoch = useRef(0),
    inFlight = useRef(false);
  const [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false);
  const [data, setData] = useState<InvalidationConsumerData | null>(null);
  useEffect(() => {
    epoch.current++;
    inFlight.current = false;
    setBusy(false);
    setUnknown(false);
    setData(null);
    return () => {
      epoch.current++;
      inFlight.current = false;
    };
  }, [scope]);
  const inspect = window.aijian?.inspectInvalidationConsumer;
  async function read() {
    if (inFlight.current || typeof inspect !== "function") return;
    inFlight.current = true;
    const operation = ++epoch.current;
    const original = { ...identity };
    setBusy(true);
    setUnknown(false);
    try {
      const response = await inspect(original);
      if (epoch.current !== operation) return;
      if (!invalidationConsumerResponse(response, original))
        throw new Error("Wrong affected-version context");
      setData(response.data);
    } catch {
      if (epoch.current === operation) setUnknown(true);
    } finally {
      if (epoch.current === operation) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  const verified = data && invalidationConsumerData(data, identity) ? data : null;
  const kind =
    verified?.artifact_type === "episode_storyboard"
      ? "分镜"
      : verified?.artifact_type === "episode_media_assembly"
        ? "装配"
        : "产物";
  return (
    <section aria-label={`受影响版本定位 ${identity.version_id}`} aria-busy={busy}>
      <Button disabled={busy || typeof inspect !== "function"} onClick={() => void read()}>
        {verified ? "重新核对分集与镜头" : "查看分集与镜头"}
      </Button>
      {typeof inspect !== "function" && <p>当前桌面桥尚未提供精确版本定位；原影响报告保留。</p>}
      {busy && <p role="status">正在读取这条路径的精确历史版本…</p>}
      {unknown && (
        <p role="alert">
          此版本定位未通过核对，原影响和选择保留。请明确重新读取，不能据此认定没有影响。
        </p>
      )}
      {verified && (
        <div>
          {unknown && <p>以下为上次已核对的同一版本摘要，当前读取结果未知。</p>}
          <p>
            {verified.episode
              ? `第${verified.episode.position}集 · ${verified.episode.title}`
              : "作品共享产物"}{" "}
            · {kind} v{verified.version_number}
          </p>
          {verified.episode && <p>分集名称为当前登记名称；版本和镜头摘要来自下述精确历史对象。</p>}
          <details>
            <summary>版本核对信息</summary>
            <p>
              {verified.artifact_type} · {verified.version_id} · {verified.content_hash}
            </p>
            {verified.episode && (
              <p>
                分集 {verified.episode.id} · 登记修订 {verified.episode.revision}
              </p>
            )}
          </details>
          <p>
            {verified.shot_scope === "WHOLE_STORYBOARD_VERSION"
              ? "影响按整个分镜版本记录，请人工复核本版本全部镜头。"
              : verified.shot_scope === "ASSEMBLY_REFERENCED_SHOTS"
                ? "以下仅列此装配实际引用的精确分镜镜头；读取不表示自动重做或重新批准。"
                : "此类产物没有镜头摘要投影，完整影响仍以原报告为准。"}
          </p>
          {verified.shots.length ? (
            <ol>
              {verified.shots.map((shot) => (
                <li key={`${shot.storyboard_version_id}/${shot.shot_id}`}>
                  镜头 {shot.ordinal} · {shot.title}
                  <details>
                    <summary>镜头来源</summary>
                    <p>
                      {shot.shot_id} · {shot.storyboard_version_id} · {shot.storyboard_content_hash}
                    </p>
                  </details>
                </li>
              ))}
            </ol>
          ) : (
            <p>此历史对象没有保存镜头关联；这不表示影响已解除。</p>
          )}
        </div>
      )}
    </section>
  );
}
