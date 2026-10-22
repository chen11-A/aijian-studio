import { useState } from "react";
import type { VisualContent } from "@aijian/contracts/visual-bible";
import { Button, Pill } from "./Common";
import { useVisualWorkspace } from "./useVisualWorkspace";
import { visualNewId } from "./visualWorkspace";
import { CharacterReferencePreview } from "./CharacterReferencePreview";
import { VisualBibleHistory } from "./VisualBibleHistory";
import { VisualEnvironmentScopeEditor } from "./VisualEnvironmentScopeEditor";
import type { AssetLibraryGateway, MediaAsset } from "./adapters/assetLibrary";
import { Select } from "./Select";

type AssetRef = VisualContent["scenes"][number]["assets"][number];
function AssetChoices({
  assets,
  value,
  locked,
  change,
  label,
}: {
  assets: MediaAsset[];
  value: AssetRef[];
  locked: boolean;
  change: (v: AssetRef[]) => void;
  label: string;
}) {
  const candidates = assets.flatMap((a) =>
    a.versions
      .filter((v) => v.kind === "image" || v.kind === "video")
      .map((v) => ({ asset: a, version: v, key: `${a.id}/${v.id}` })),
  );
  return (
    <div>
      <Select
        aria-label={label}
        value=""
        disabled={locked}
        onChange={(e) => {
          const picked = candidates.find((x) => x.key === e.target.value);
          if (
            picked &&
            !value.some(
              (x) => x.asset_id === picked.asset.id && x.asset_version_id === picked.version.id,
            )
          )
            change([
              ...value,
              {
                asset_id: picked.asset.id,
                asset_version_id: picked.version.id,
                sha256: picked.version.sha256,
              },
            ]);
        }}
      >
        <option value="">添加一个明确素材版本</option>
        {candidates.map((x) => (
          <option key={x.key} value={x.key}>
            {x.version.filename} · v{x.version.ordinal} · {x.version.id}
          </option>
        ))}
      </Select>
      {!assets.length && <p>尚无已核对的素材列表；请在素材页登记或核对读取状态。</p>}
      <ul>
        {value.map((x) => (
          <li key={`${x.asset_id}/${x.asset_version_id}`}>
            <code>
              {x.asset_id} / {x.asset_version_id} / {x.sha256}
            </code>
            <Button disabled={locked} onClick={() => change(value.filter((r) => r !== x))}>
              移除此候选引用
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
export function VisualBibleEditor({
  projectId,
  setNavigationGuard,
}: {
  projectId: string;
  setNavigationGuard: (guard: (() => boolean) | null) => void;
}) {
  const w = useVisualWorkspace(projectId, setNavigationGuard),
    [historyId, setHistoryId] = useState("");
  const content = w.content,
    library = w.library?.content;
  function edit(change: (content: VisualContent) => VisualContent) {
    if (!w.locked) w.setContent((c) => (c ? change(c) : c));
  }
  const refs =
    library?.schema_version === "1.2.0" || library?.schema_version === "1.3.0"
      ? library.references
      : [];
  const head = w.selected?.head ?? w.index?.head;
  const inReview = !!w.selected && head?.review_version_id === w.selected.version.id;
  const signedReport = w.review?.reports.find(
    (r) =>
      r.submission_id === head?.review_submission_id &&
      r.review_evidence_revision === head?.review_evidence_revision &&
      ["continuity_reviewer", "producer"].every((role) =>
        w.review?.signoffs.some(
          (s) =>
            s.role === role &&
            s.readiness_report_id === r.id &&
            s.submission_id === r.submission_id &&
            s.review_evidence_revision === r.review_evidence_revision,
        ),
      ),
  );
  const originals = new Map<string, AssetRef>();
  for (const r of refs.filter((r) => content?.character_reference_ids.includes(r.reference_id)))
    originals.set(`${r.asset_id}/${r.asset_version_id}`, {
      asset_id: r.asset_id,
      asset_version_id: r.asset_version_id,
      sha256: r.asset_sha256,
    });
  for (const item of [...(content?.scenes ?? []), ...(content?.props ?? [])])
    for (const r of item.assets) originals.set(`${r.asset_id}/${r.asset_version_id}`, r);
  if (content?.schema_version === "1.1.0" && library?.schema_version === "1.3.0")
    for (const r of library.environment_references.filter((r) =>
      content.environment_scope.environment_reference_ids.includes(r.reference_id),
    ))
      originals.set(`${r.asset_id}/${r.asset_version_id}`, {
        asset_id: r.asset_id,
        asset_version_id: r.asset_version_id,
        sha256: r.asset_sha256,
      });
  const actionsLocked = w.locked || w.dirty || !w.selected;
  return (
    <section
      className="manual-creative-page visual-bible-page"
      aria-label="G5视觉版本审签"
      aria-busy={w.busy}
    >
      <header>
        <h2>作品视觉版本与 G5 人工审签</h2>
        <Pill>
          {w.dirty
            ? "未保存视觉候选"
            : w.authority?.status === "CURRENT"
              ? "G5当前批准"
              : w.selected
                ? "视觉候选 / 历史版本"
                : "尚无视觉候选"}
        </Pill>
        <Button disabled={w.busy} onClick={() => void w.reload()}>
          重新读取视觉状态
        </Button>
      </header>
      <p>
        视觉版本固定同一设定库、角色真实参考、服装、场景、道具与9:16安全区。保存、技术检查、送审、签字和批准分别确认；不执行生成、编码、发布或付费。作品共享改动影响所有引用它的分集。
      </p>
      <p role="status" aria-label="视觉当前操作状态">
        {w.notice}
      </p>
      <VisualBibleHistory
        projectId={projectId}
        selectedId={w.selected?.version.id}
        locked={w.locked}
        select={w.selectVersion}
      />
      {w.journal.kind !== "EMPTY" && (
        <div className="manual-creative-recovery">
          <p>原操作记录已保留，核对前暂停新写入。找不到回执仍属于未知结果。</p>
          <Button
            disabled={w.busy || w.journal.kind !== "PENDING"}
            onClick={() => void w.recover()}
          >
            只读核对原操作
          </Button>
          <Button disabled={!w.terminal || w.busy} onClick={w.abandon}>
            结束已过期且未写入的挑战
          </Button>
        </div>
      )}
      <div>
        <Button disabled={w.locked || !w.latestLibrary} onClick={w.newCandidate}>
          从当前已保存设定库建立新候选
        </Button>
        {w.latestLibrary && (
          <p>
            当前库：
            <code>
              {w.latestLibrary.version_id} / {w.latestLibrary.content_hash}
            </code>
          </p>
        )}
      </div>
      {w.index && (
        <nav aria-label="视觉精确版本">
          <Button
            disabled={w.locked}
            onClick={() => void w.selectVersion(w.index!.latest_version.id)}
          >
            打开最新候选
          </Button>
          {w.index.review_version && (
            <Button
              disabled={w.locked}
              onClick={() => void w.selectVersion(w.index!.review_version!.id)}
            >
              打开在审版本
            </Button>
          )}
          {w.index.accepted_version && (
            <Button
              disabled={w.locked}
              onClick={() => void w.selectVersion(w.index!.accepted_version!.id)}
            >
              打开已批准版本
            </Button>
          )}
          <label>
            历史版本ID
            <input
              value={historyId}
              onChange={(e) => setHistoryId(e.target.value)}
              disabled={w.locked}
            />
          </label>
          <Button
            disabled={w.locked || !/^ver_[0-9a-f]{32}$/.test(historyId)}
            onClick={() => void w.selectVersion(historyId)}
          >
            按精确ID读取历史
          </Button>
        </nav>
      )}
      {w.selected && (
        <div>
          <p>
            正在查看：
            <code>
              {w.selected.version.id} / {w.selected.version.content_hash}
            </code>
            ；头修订 {w.selected.head.revision}
          </p>
          <p>
            批准依据状态：{w.authority?.status ?? "未核对"}；决定：
            {w.authority?.gate_decision_id ?? "无"}
          </p>
        </div>
      )}
      {content && library && (
        <>
          <p>
            本候选来源：
            <code>
              {content.creative_library_version_id} / {content.creative_library_content_hash}
            </code>
          </p>
          <fieldset disabled={w.locked}>
            <legend>身份与服装参考范围</legend>
            <p>每个角色和服装都需要自己的真实参考。以下选择来自本候选精确设定库版本。</p>
            {refs.map((r) => (
              <label key={r.reference_id}>
                <input
                  type="checkbox"
                  checked={content.character_reference_ids.includes(r.reference_id)}
                  onChange={(e) =>
                    edit((c) => ({
                      ...c,
                      character_reference_ids: e.target.checked
                        ? [...c.character_reference_ids, r.reference_id]
                        : c.character_reference_ids.filter((id) => id !== r.reference_id),
                    }))
                  }
                />
                {library.characters.find((c) => c.character_id === r.character_id)?.name ??
                  r.character_id}{" "}
                · {r.label} · {r.costume_id ?? "身份参考"} · <code>{r.reference_id}</code>
              </label>
            ))}
            {!refs.length && <p>本库没有真实角色参考，不能通过G5。请先在角色设定中登记并保存。</p>}
          </fieldset>
          <fieldset disabled={w.locked}>
            <legend>场景参考</legend>
            {content.scenes.map((scene) => (
              <article key={scene.scene_id}>
                <h3>
                  {library.scenes.find((s) => s.scene_id === scene.scene_id)?.name ??
                    scene.scene_id}
                </h3>
                <AssetChoices
                  assets={w.assets}
                  value={scene.assets}
                  locked={w.locked}
                  label={`场景${scene.scene_id}素材`}
                  change={(assets) =>
                    edit((c) => ({
                      ...c,
                      scenes: c.scenes.map((s) =>
                        s.scene_id === scene.scene_id ? { ...s, assets } : s,
                      ),
                    }))
                  }
                />
              </article>
            ))}
          </fieldset>
          <VisualEnvironmentScopeEditor
            content={content}
            library={library}
            locked={w.locked}
            edit={edit}
          />
          <fieldset disabled={w.locked}>
            <legend>道具版本</legend>
            <p>空清单表示本视觉版本没有独立道具，人工签核时必须核对这一声明。</p>
            {content.props.map((prop) => (
              <article key={prop.prop_id}>
                <label>
                  道具名称
                  <input
                    aria-label={`道具${prop.ordinal}名称`}
                    value={prop.name}
                    onChange={(e) =>
                      edit((c) => ({
                        ...c,
                        props: c.props.map((p) =>
                          p.prop_id === prop.prop_id ? { ...p, name: e.target.value } : p,
                        ),
                      }))
                    }
                  />
                </label>
                <label>
                  道具说明
                  <textarea
                    value={prop.description}
                    onChange={(e) =>
                      edit((c) => ({
                        ...c,
                        props: c.props.map((p) =>
                          p.prop_id === prop.prop_id ? { ...p, description: e.target.value } : p,
                        ),
                      }))
                    }
                  />
                </label>
                <AssetChoices
                  assets={w.assets}
                  value={prop.assets}
                  locked={w.locked}
                  label={`道具${prop.prop_id}素材`}
                  change={(assets) =>
                    edit((c) => ({
                      ...c,
                      props: c.props.map((p) =>
                        p.prop_id === prop.prop_id ? { ...p, assets } : p,
                      ),
                    }))
                  }
                />
                <Button
                  onClick={() => {
                    if (window.confirm("从当前候选移除此道具吗？历史版本保留。"))
                      edit((c) => ({
                        ...c,
                        props: c.props
                          .filter((p) => p.prop_id !== prop.prop_id)
                          .map((p, i) => ({ ...p, ordinal: i + 1 })),
                      }));
                  }}
                >
                  移除此候选道具
                </Button>
              </article>
            ))}
            <Button
              disabled={w.locked || content.props.length >= 2000}
              onClick={() => {
                const id = visualNewId("prop");
                if (id)
                  edit((c) => ({
                    ...c,
                    props: [
                      ...c.props,
                      {
                        prop_id: id,
                        ordinal: c.props.length + 1,
                        name: "",
                        description: "",
                        assets: [],
                      },
                    ],
                  }));
              }}
            >
              添加道具版本
            </Button>
          </fieldset>
          <fieldset disabled={w.locked}>
            <legend>9:16画布与安全区</legend>
            {(Object.keys(w.area) as (keyof typeof w.area)[]).map((key) => (
              <label key={key}>
                {
                  {
                    canvas_width: "画布宽度",
                    canvas_height: "画布高度",
                    x: "安全区X",
                    y: "安全区Y",
                    width: "安全区宽度",
                    height: "安全区高度",
                  }[key]
                }
                <input
                  aria-label={key}
                  inputMode="numeric"
                  value={w.area[key]}
                  onChange={(e) => w.setArea((a) => ({ ...a, [key]: e.target.value }))}
                />
              </label>
            ))}
            {!w.candidate && (
              <p>请输入合法9:16画布、内部安全区及完整字段；输入保留，暂不能保存。</p>
            )}
          </fieldset>
          <label>
            共享改动原因
            <textarea
              disabled={w.locked}
              value={content.change_reason}
              onChange={(e) => edit((c) => ({ ...c, change_reason: e.target.value }))}
            />
          </label>
          <label>
            本次版本说明
            <input
              disabled={w.locked}
              value={w.summary}
              onChange={(e) => w.setSummary(e.target.value)}
            />
          </label>
          <Button
            primary
            disabled={w.locked || !w.candidate || !w.summary.trim()}
            onClick={() => void w.save()}
          >
            另存视觉候选版本
          </Button>
          <section aria-label="精确原始参考检查">
            <h3>原始参考预览与技术检查</h3>
            <p>
              图片检查必须明确点击；预览本身不写入通过证据。视频还需要完整技术检查，当前不能凭元数据批准。
            </p>
            {[...originals.values()].map((ref) => {
              const asset = w.assets.find((a) => a.id === ref.asset_id),
                version = asset?.versions.find(
                  (v) => v.id === ref.asset_version_id && v.sha256 === ref.sha256,
                );
              return (
                <article key={`${ref.asset_id}/${ref.asset_version_id}`}>
                  <p>
                    <code>
                      {ref.asset_id} / {ref.asset_version_id} / {ref.sha256}
                    </code>
                  </p>
                  {version && (
                    <CharacterReferencePreview
                      projectId={projectId}
                      assetId={ref.asset_id}
                      version={version}
                      gateway={window.aijian as AssetLibraryGateway}
                    />
                  )}
                  <Button
                    disabled={w.locked || w.dirty || version?.kind !== "image"}
                    onClick={() => void w.inspect(ref.asset_id, ref.asset_version_id, ref.sha256)}
                  >
                    明确检查此原始图片
                  </Button>
                </article>
              );
            })}
          </section>
        </>
      )}
      {w.selected && (
        <section aria-label="人工G5动作">
          <h3>精确视觉版本人工审签</h3>
          <p>当前账户允许 continuity_reviewer / producer 两角色自审；这不等于两个独立人员审批。</p>
          <p>
            就绪检查：
            {w.readiness?.report.ready === true
              ? "当前原件、权利与技术证据通过核对"
              : w.readiness
                ? "存在阻塞检查"
                : "结果未知，不能审批"}
          </p>
          {w.readiness && (
            <ul>
              {(w.readiness.report.blocking as string[]).map((v, i) => (
                <li key={`${i}:${v}`}>{v}</li>
              ))}
            </ul>
          )}
          <label>
            人工决定理由
            <textarea
              value={w.rationale}
              disabled={w.locked}
              onChange={(e) => w.setRationale(e.target.value)}
            />
          </label>
          <Button
            disabled={
              actionsLocked ||
              head?.latest_version_id !== w.selected.version.id ||
              inReview ||
              w.readiness?.report.ready !== true
            }
            onClick={() =>
              void w.act({
                action: "submit",
                roles: [],
                decision: null,
                rationale: null,
                readiness_report_id: null,
              })
            }
          >
            明确送审此版本
          </Button>
          <Button
            disabled={actionsLocked || !inReview || w.readiness?.report.ready !== true}
            onClick={() =>
              void w.act({
                action: "signoff",
                roles: ["continuity_reviewer", "producer"],
                decision: null,
                rationale: null,
                readiness_report_id: null,
              })
            }
          >
            明确签署两角色证据
          </Button>
          <Button
            primary
            disabled={
              actionsLocked ||
              !inReview ||
              !signedReport ||
              !w.rationale.trim() ||
              w.readiness?.report.ready !== true
            }
            onClick={() =>
              void w.act({
                action: "decision",
                roles: [],
                decision: "approved",
                rationale: w.rationale.trim(),
                readiness_report_id: signedReport!.id,
              })
            }
          >
            明确批准此版本 G5
          </Button>
          <Button
            disabled={actionsLocked || !inReview || !w.rationale.trim()}
            onClick={() =>
              void w.act({
                action: "decision",
                roles: [],
                decision: "rejected",
                rationale: w.rationale.trim(),
                readiness_report_id: null,
              })
            }
          >
            明确驳回此版本
          </Button>
        </section>
      )}
    </section>
  );
}
