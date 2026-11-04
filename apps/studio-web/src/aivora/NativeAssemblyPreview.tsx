import { useEffect, useRef, useState } from "react";
import type { NativePreviewPlanGateway } from "@aijian/contracts/native-preview-plan";
import type { AssemblyVersion } from "./adapters/episodeMediaAssembly";
import type { MediaPreviewSessionGateway } from "./adapters/mediaPreviewSession";
import {
  verifyNativePreviewPlan,
  type VerifiedNativePreviewPlan,
} from "./adapters/nativePreviewPlan";
import { MltPreviewPanel } from "./MltPreviewPanel";
import { Button } from "./Common";

type Props = {
  projectId: string;
  episodeId: string;
  savedVersion: AssemblyVersion | null;
  eligible: boolean;
  planGateway: NativePreviewPlanGateway | undefined;
  sessionGateway: MediaPreviewSessionGateway | undefined;
};

export function NativeAssemblyPreview(props: Props) {
  const scope = JSON.stringify([
    props.projectId,
    props.episodeId,
    props.savedVersion?.artifact_id,
    props.savedVersion?.version_id,
    props.savedVersion?.content_hash,
    props.savedVersion?.head_revision,
  ]);
  // Remount even for A→B→A so pending results and native sessions cannot cross a scope change.
  return <ScopedNativePreview key={scope} {...props} />;
}

function ScopedNativePreview({
  projectId,
  episodeId,
  savedVersion,
  eligible,
  planGateway,
  sessionGateway,
}: Props) {
  const [plan, setPlan] = useState<VerifiedNativePreviewPlan | null>(null);
  const [reliable, setReliable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const epoch = useRef(0);
  const pending = useRef<number | null>(null);
  const eligibleRef = useRef(eligible);
  eligibleRef.current = eligible;
  useEffect(() => {
    epoch.current += 1;
    pending.current = null;
    setBusy(false);
    setReliable(false);
    return () => {
      epoch.current += 1;
    };
  }, [eligible, planGateway]);
  async function read() {
    if (
      !eligible ||
      !savedVersion ||
      !planGateway ||
      pending.current !== null ||
      savedVersion.content.project_id !== projectId ||
      savedVersion.content.episode_id !== episodeId
    )
      return;
    const version = structuredClone(savedVersion);
    const request = ++epoch.current;
    pending.current = request;
    setBusy(true);
    setReliable(false);
    try {
      const result = await planGateway.getNativeMediaPreviewPlan(
        projectId,
        episodeId,
        version.version_id,
      );
      const verified =
        result.kind === "READY" ? await verifyNativePreviewPlan(result.receipt, version) : null;
      if (epoch.current !== request || !eligibleRef.current) return;
      if (verified) {
        setPlan(verified);
        setReliable(true);
        setNotice("已核对精确保存版本的只读计划；打开本地窗口仍须单独操作。");
      } else
        setNotice(
          result.kind === "REJECTED"
            ? `此版本不能进入原生预览：${result.code}。`
            : "计划回执未知或不匹配；保留先前记录，预览控制已阻止，请显式重新核对。",
        );
    } catch {
      if (epoch.current === request)
        setNotice("计划读取结果未知；预览控制已阻止，请显式重新核对。");
    } finally {
      if (epoch.current === request) {
        pending.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <section aria-label="保存装配的原生预览计划">
      <h2>保存装配的 MLT 预览计划</h2>
      <p>
        先核对保存版本与原素材。当前执行计划支持同尺寸 CFR
        视频子集；图片、缩放、多轨音频和字幕仍需完整执行合同。
      </p>
      {!eligible && <p role="status">请先保存所有装配输入并读回可靠版本，再核对原生预览计划。</p>}
      {!planGateway && <p role="status">原生预览计划桌面桥尚未接入。</p>}
      <Button
        disabled={!eligible || !savedVersion || !planGateway || busy}
        onClick={() => void read()}
      >
        核对原生预览计划
      </Button>
      {notice && <p role="status">{notice}</p>}
      {plan && (
        <p>
          计划哈希 <code>{plan.identity.plan_hash}</code> · {plan.totalFrames} 帧
          {!reliable && " · 先前记录，当前未确认"}
        </p>
      )}
      <MltPreviewPanel
        projectId={projectId}
        episodeId={episodeId}
        identity={eligible && reliable ? (plan?.identity ?? null) : null}
        totalFrames={eligible && reliable ? (plan?.totalFrames ?? null) : null}
        gateway={sessionGateway}
      />
    </section>
  );
}
