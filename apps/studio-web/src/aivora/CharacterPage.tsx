import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, FlowFooter, PageTitle, Pill, Section, Tabs } from "./Common";
import { Icon } from "./Icon";
import { useCurrentObject } from "./useCurrentObject";
import type { Outfit } from "./model";
import avatar from "./assets/v2/avatar.png";
import portrait from "./assets/v2/portrait.png";
import front from "./assets/v2/front.png";
import side from "./assets/v2/side.png";
import back from "./assets/v2/back.png";
import coat from "./assets/v2/coat.png";
import workwear from "./assets/v2/workwear.png";
import medical from "./assets/v2/medical.png";
import homewear from "./assets/v2/homewear.png";
import "./v2-character.css";

const modelViews = [
  { id: "front", label: "正面", image: front },
  { id: "side", label: "侧面", image: side },
  { id: "back", label: "背面", image: back },
];
const outfitReferences = [
  { image: coat, scenes: "08–09" },
  { image: workwear, scenes: "01–04" },
  { image: medical, scenes: "05–07" },
  { image: homewear, scenes: "10–13" },
];
function outfitReference(item: Outfit) {
  return item.characterId === 1 ? outfitReferences[item.id - 100] : undefined;
}
function sceneLabel(item: Outfit) {
  const reference = outfitReference(item);
  return reference ? `场次 ${reference.scenes}` : "场次待指定";
}
function sampleShotLabel(item: Outfit) {
  return item.rangeBindingExplicit
    ? `样例镜头 ${item.startShot}–${item.endShot}（单独选择）`
    : "未选择样例镜头";
}
type CharacterReview = {
  characterId: number;
  episode: string;
  outfitId?: number;
  revision: string;
};

export function CharacterPage() {
  const triptychRef = useRef<HTMLElement>(null);
  const [triptychColumns, setTriptychColumns] = useState<string>();
  useLayoutEffect(() => {
    const element = triptychRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const available = Math.max(0, Math.floor(element.getBoundingClientRect().width) - 48);
      const base = Math.floor(available / 3);
      const remainder = available % 3;
      setTriptychColumns([0, 1, 2].map((i) => `${base + (i < remainder ? 1 : 0)}px`).join(" "));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const { d, person, field, putField } = useCurrentObject();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsRef = useRef<HTMLDialogElement>(null);
  const [review, setReview] = useState<CharacterReview | null>(null);
  const reviewRef = useRef<HTMLDialogElement>(null);
  const episode = d.value("episode");
  const plans = d.outfits.filter(
    (item) => item.characterId === person.id && item.episode === episode,
  );
  const selected = plans.find((item) => String(item.id) === field("outfitId")) ?? plans[0];
  const tab = field("mainTab", "角色模型");
  const hasThreeViews = person.id === 1 && d.scenario !== "empty";
  const loading = d.scenario === "loading";
  const failed = d.scenario === "error";
  const visiblePlans = d.scenario === "empty" ? [] : plans;
  const locked = d.value(`locked-${person.id}`) === "true";
  function blockingReasonFor(characterId: number, items: Outfit[]) {
    const invalidRange = items.some((item) => {
      if (!item.rangeBindingExplicit) return false;
      const start = d.shots.findIndex((shot) => shot.id === item.startShot);
      const end = d.shots.findIndex((shot) => shot.id === item.endShot);
      return start < 0 || end < start;
    });
    return loading
      ? "正在读取角色参考，请稍候"
      : failed
        ? "参考加载失败，请重试"
        : characterId !== 1 || d.scenario === "empty"
          ? "请补齐同一角色的正面、侧面和背面参考"
          : !items.length
            ? "请先在角色详情中新增本集造型"
            : invalidRange
              ? "已选择的样例镜头范围无效，请在角色详情中修正"
              : "";
  }
  function revisionFor(characterId: number, items: Outfit[]) {
    const ignoredFields = ["mainTab", "view", "outfitId"];
    return JSON.stringify({
      person: d.characters.find((item) => item.id === characterId),
      outfits: items,
      fields: Object.entries(d.values).filter(
        ([key]) =>
          key.startsWith(`character-${characterId}-`) &&
          !ignoredFields.some((fieldName) => key === `character-${characterId}-${fieldName}`),
      ),
      shots: d.shots.map((shot) => shot.id),
      scenario: d.scenario,
    });
  }
  const blockingReason = blockingReasonFor(person.id, plans);
  const reviewPerson = d.characters.find((item) => item.id === review?.characterId);
  const reviewPlans = review
    ? d.outfits.filter(
        (item) =>
          item.characterId === review.characterId &&
          item.episode === review.episode &&
          (review.outfitId === undefined || item.id === review.outfitId),
      )
    : [];
  const reviewRevision = review ? revisionFor(review.characterId, reviewPlans) : "";
  const reviewStale = !!review && review.revision !== reviewRevision;
  const reviewReason = review
    ? !reviewPerson
      ? "角色已移除，请关闭后重新选择"
      : blockingReasonFor(review.characterId, reviewPlans)
    : "";

  useEffect(() => {
    const dialog = detailsRef.current;
    if (detailsOpen && dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, [detailsOpen]);
  useEffect(() => {
    const dialog = reviewRef.current;
    if (review && dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, [review]);

  if (!d.characters.length || !person) {
    return (
      <section className="v2-character-page">
        <h1>角色模型与本集造型</h1>
        <p>尚未从已确认的故事资料读取角色。</p>
      </section>
    );
  }

  function invalidate() {
    d.put(`locked-${person.id}`, "false");
    d.put("assetsConfirmed", "false");
  }
  function openDetails(next = tab) {
    putField("mainTab", next);
    setDetailsOpen(true);
  }
  function preview(image: string, title: string) {
    setDetailsOpen(false);
    d.setEditor({
      title,
      image,
      description: "本地样例参考 · 保持图片原始比例",
      images:
        person.id === 1
          ? [
              { src: portrait, title: `${person.name} · 肖像原图` },
              ...modelViews.map((view) => ({
                src: view.image,
                title: `${person.name} · ${view.label}参考`,
              })),
              ...outfitReferences.map((view, index) => ({
                src: view.image,
                title: `${person.name} · 场次 ${view.scenes} 服装样例 ${index + 1}`,
              })),
            ]
          : undefined,
    });
  }
  function editOutfit(item?: Outfit) {
    setDetailsOpen(false);
    d.edit(
      item ? "编辑本集造型" : "新增本集造型",
      [{ key: "name", label: "造型名称", value: item?.name ?? "新造型", required: true }],
      (data) => {
        const next: Outfit = {
          ...item,
          id: item?.id ?? Date.now(),
          characterId: person.id,
          episode,
          name: data.name!,
          startShot: item?.startShot ?? d.shots[0]!.id,
          endShot: item?.endShot ?? d.shots.at(-1)!.id,
          rangeBindingExplicit: item?.rangeBindingExplicit ?? false,
          version: (item?.version ?? 0) + 1,
          confirmed: false,
        };
        d.setOutfits((old) =>
          item ? old.map((entry) => (entry.id === item.id ? next : entry)) : [...old, next],
        );
        putField("outfitId", String(next.id));
        invalidate();
      },
    );
  }
  function selectSampleShots(item: Outfit) {
    setDetailsOpen(false);
    const options = d.shots.map((shot) => String(shot.id));
    d.edit(
      "单独选择样例镜头范围",
      [
        {
          key: "start",
          label: "起始样例镜头",
          value: item.rangeBindingExplicit ? String(item.startShot) : "",
          options: ["", ...options],
          required: true,
        },
        {
          key: "end",
          label: "结束样例镜头",
          value: item.rangeBindingExplicit ? String(item.endShot) : "",
          options: ["", ...options],
          required: true,
        },
      ],
      (data) => {
        const start = d.shots.findIndex((shot) => shot.id === Number(data.start));
        const end = d.shots.findIndex((shot) => shot.id === Number(data.end));
        if (!data.start || !data.end || start < 0 || end < start) {
          d.notify("请选择现有样例镜头，结束镜头须位于起始镜头之后");
          return false;
        }
        d.setOutfits((old) =>
          old.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  startShot: Number(data.start),
                  endShot: Number(data.end),
                  rangeBindingExplicit: true,
                  version: entry.version + 1,
                  confirmed: false,
                }
              : entry,
          ),
        );
        invalidate();
      },
    );
  }
  function editIdentity() {
    setDetailsOpen(false);
    d.edit(
      "编辑角色身份",
      [
        { key: "name", label: "姓名", value: person.name, required: true },
        { key: "role", label: "身份与作用", value: person.role, required: true },
        {
          key: "age",
          label: "年龄",
          value: field("age", person.id === 1 ? "26" : "28"),
          type: "number",
          min: 1,
          max: 120,
        },
        {
          key: "personality",
          label: "性格",
          value: field("personality", person.note),
          type: "textarea",
        },
        {
          key: "appearance",
          label: "外观要点",
          value: field("appearance", person.id === 1 ? "深色长发，银色耳饰" : "待补充"),
          type: "textarea",
        },
      ],
      (data) => {
        d.setCharacters((old) =>
          old.map((item) =>
            item.id === person.id ? { ...item, name: data.name!, role: data.role! } : item,
          ),
        );
        ["age", "personality", "appearance"].forEach((key) => putField(key, data[key]!));
        invalidate();
      },
    );
  }
  function confirm(outfitId?: number) {
    setDetailsOpen(false);
    const items = outfitId === undefined ? plans : plans.filter((item) => item.id === outfitId);
    setReview({
      characterId: person.id,
      episode,
      outfitId,
      revision: revisionFor(person.id, items),
    });
  }
  function saveReview() {
    if (!review || !reviewPerson || reviewReason || reviewStale) return;
    const approvedIds = new Set(reviewPlans.map((item) => item.id));
    d.setOutfits((old) =>
      old.map((item) => (approvedIds.has(item.id) ? { ...item, confirmed: true } : item)),
    );
    setReview(null);
    if (review.outfitId !== undefined) {
      invalidate();
      d.notify("当前造型已确认；样例镜头选择与场次映射仍分别保留");
      return;
    }
    d.put(`locked-${review.characterId}`, "true");
    const next = d.characters.find(
      (item) => item.id !== review.characterId && d.value(`locked-${item.id}`) !== "true",
    );
    if (next) {
      d.setSelectedCharacter(next.id);
      d.notify(`${reviewPerson.name}已确认，继续检查${next.name}`);
    } else d.go("world");
  }
  return (
    <>
      <PageTitle
        actions={
          <Button className="button v2-character-details-entry" onClick={() => openDetails()}>
            角色详情
          </Button>
        }
      />
      <div className="v2-character-body" aria-busy={loading}>
        <div className="v2-character-identity">
          <button
            className="v2-character-portrait"
            aria-label={`大屏查看${person.name}肖像`}
            onClick={() =>
              preview(person.id === 1 ? portrait : person.image, `${person.name} · 肖像原图`)
            }
          >
            <img src={person.id === 1 ? avatar : person.image} alt="" />
          </button>
          <h2>{person.name}</h2>
          <p>
            {person.role} · {person.note}
          </p>
          <button
            className="v2-character-status"
            onClick={() => (failed ? d.setScenario("normal") : openDetails("角色模型"))}
          >
            {loading
              ? "正在读取参考"
              : failed
                ? "加载失败 · 重试"
                : locked
                  ? "角色已确认"
                  : hasThreeViews
                    ? "三视图样例"
                    : "缺少三视图"}
          </button>
        </div>
        <div className="v2-character-grid">
          <section
            ref={triptychRef}
            style={{ gridTemplateColumns: triptychColumns }}
            className="v2-character-triptych"
            aria-label={`${person.name} 三视图`}
          >
            {modelViews.map((view, index) => {
              const image = hasThreeViews
                ? view.image
                : index === 0 && d.scenario !== "empty"
                  ? person.image
                  : null;
              return (
                <div className="v2-character-view" key={view.id} data-view={view.id}>
                  <h3>{view.label}</h3>
                  {loading || failed ? (
                    <div
                      className={`v2-character-missing ${loading ? "is-loading" : ""}`}
                      role="status"
                    >
                      <Icon name="image" size={28} />
                      <span>{loading ? "正在读取参考" : `${view.label}参考加载失败`}</span>
                      {failed && <Button onClick={() => d.setScenario("normal")}>重试</Button>}
                    </div>
                  ) : image ? (
                    <button
                      className="v2-character-image"
                      onClick={() => preview(image, `${person.name} · ${view.label}参考`)}
                      aria-label={`大屏查看${person.name}${view.label}参考`}
                    >
                      <img src={image} alt={`${person.name} ${view.label}参考`} />
                    </button>
                  ) : (
                    <div className="v2-character-missing" role="status">
                      <Icon name="image" size={28} />
                      <span>缺少{view.label}参考</span>
                      <Button
                        onClick={() => {
                          putField("view", view.label);
                          openDetails("外观");
                        }}
                      >
                        查看参考要求
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
          <section className="v2-character-wardrobe" aria-label="本集服装">
            <header>
              <Icon name="folder" size={18} />
              <h2>本集服装</h2>
              <button onClick={() => openDetails("造型")}>{visiblePlans.length} 套 · 样例</button>
            </header>
            <div className="v2-character-outfits">
              {visiblePlans.slice(0, 4).map((item, index) => (
                <button
                  key={item.id}
                  className={`v2-character-outfit ${selected?.id === item.id ? "is-selected" : ""}`}
                  aria-pressed={selected?.id === item.id}
                  aria-label={`选择造型 ${item.name}`}
                  onClick={() => putField("outfitId", String(item.id))}
                >
                  <img
                    src={outfitReference(item)?.image ?? person.image}
                    alt={`${item.name}服装参考`}
                  />
                  <strong>{item.name}</strong>
                  <small>{sceneLabel(item)}</small>
                  {selected?.id === item.id && index === 0 && (
                    <span className="v2-character-selected" aria-label="当前选中">
                      <Icon name="check" size={14} />
                    </span>
                  )}
                </button>
              ))}
              {!visiblePlans.length && (
                <div className="v2-character-no-outfits">
                  <Icon name="folder" size={30} />
                  <p>本集尚未添加服装</p>
                  <Button onClick={() => editOutfit()} icon="plus">
                    新增造型
                  </Button>
                </div>
              )}
            </div>
            <p className="v2-character-wardrobe-note">
              {visiblePlans.length > 4 ? (
                <button onClick={() => openDetails("造型")}>
                  查看全部 {visiblePlans.length} 套并编辑适用镜头
                </button>
              ) : (
                "选服装不改人物比例；点击视图进入独立大屏。"
              )}
            </p>
          </section>
        </div>
      </div>
      <FlowFooter
        label="确认角色造型"
        secondaryLabel="哪里不对？"
        secondaryAction={() => d.focusAssistant(`调整角色「${person.name}」：`)}
        reason={blockingReason || "三视图完整同屏 · 仅确认演示造型"}
        action={() => confirm()}
      />
      {detailsOpen && (
        <dialog
          ref={detailsRef}
          className="v2-character-detail-drawer"
          aria-labelledby="v2-character-detail-title"
          onCancel={() => setDetailsOpen(false)}
          onClick={(event) => {
            if (event.target === detailsRef.current) setDetailsOpen(false);
          }}
        >
          <header>
            <div>
              <small>角色与本集造型</small>
              <h2 id="v2-character-detail-title">{person.name} · 角色详情</h2>
            </div>
            <Button icon="close" aria-label="关闭角色详情" onClick={() => setDetailsOpen(false)} />
          </header>
          <label className="v2-character-switch">
            当前角色
            <select
              value={person.id}
              onChange={(event) => d.setSelectedCharacter(Number(event.target.value))}
            >
              {d.characters.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <Tabs
            items={["角色模型", "身份", "外观", "造型", "状态", "声音", "关联"]}
            value={tab}
            onChange={(next) => putField("mainTab", next)}
          />
          <div className="v2-character-detail-content">
            {tab === "角色模型" || tab === "外观" ? (
              <Section title={tab === "角色模型" ? "三视图参考" : "外观设定"}>
                <p>
                  {hasThreeViews
                    ? "正面、侧面、背面使用同一角色的独立参考图。"
                    : "此角色目前仅有人物参考，缺少独立侧面和背面，补齐前不能确认角色造型。"}
                </p>
                <Tabs
                  items={["多视图", "正面", "面部"]}
                  value={field("view", "多视图")}
                  onChange={(next) => putField("view", next)}
                />
                <div
                  className={`v2-character-detail-preview ${field("view", "多视图") === "多视图" && hasThreeViews ? "is-triptych" : ""}`}
                >
                  {(field("view", "多视图") === "多视图" && hasThreeViews
                    ? modelViews
                    : [
                        {
                          id: "detail",
                          label: field("view", "多视图"),
                          image:
                            field("view", "多视图") === "面部"
                              ? person.image
                              : hasThreeViews
                                ? front
                                : person.image,
                        },
                      ]
                  ).map((item) => (
                    <button
                      key={item.id}
                      onClick={() => preview(item.image, `${person.name} · ${item.label}`)}
                      aria-label={`大屏查看${item.label}`}
                    >
                      <img src={item.image} alt={`${person.name}${item.label}参考`} />
                    </button>
                  ))}
                </div>
                <p>
                  {field("appearance", person.id === 1 ? "深色长发，银色耳饰" : "尚未补充外观要点")}
                </p>
                <div className="actions">
                  <Button
                    onClick={() =>
                      preview(person.id === 1 ? front : person.image, `${person.name} · 人物参考`)
                    }
                    icon="expand"
                  >
                    大屏查看参考
                  </Button>
                  <Button onClick={editIdentity}>编辑外观要点</Button>
                </div>
                {d.professional && (
                  <Pill>
                    角色 {field("version", "v4")} · 参考覆盖 {hasThreeViews ? "3 / 3" : "1 / 3"}
                  </Pill>
                )}
              </Section>
            ) : tab === "身份" ? (
              <Section title="身份设定">
                <dl className="identity-grid">
                  <dt>姓名</dt>
                  <dd>{person.name}</dd>
                  <dt>年龄</dt>
                  <dd>{field("age", person.id === 1 ? "26" : "28")}</dd>
                  <dt>身份</dt>
                  <dd>{person.role}</dd>
                  <dt>性格</dt>
                  <dd>{field("personality", person.note)}</dd>
                  <dt>外观</dt>
                  <dd>{field("appearance", person.id === 1 ? "深色长发，银色耳饰" : "待补充")}</dd>
                </dl>
                <Button onClick={editIdentity}>编辑身份</Button>
              </Section>
            ) : tab === "造型" ? (
              <Section
                title="本集造型计划"
                action={
                  <Button icon="plus" onClick={() => editOutfit()}>
                    新增造型
                  </Button>
                }
              >
                <div className="v2-character-plan-list">
                  {plans.map((item) => (
                    <button
                      key={item.id}
                      className={item.id === selected?.id ? "selected" : ""}
                      onClick={() => putField("outfitId", String(item.id))}
                    >
                      <strong>{item.name}</strong>
                      <span>
                        {sceneLabel(item)} · v{item.version}
                      </span>
                      <span>{sampleShotLabel(item)}</span>
                      <Pill tone={item.confirmed ? "green" : "amber"}>
                        {item.confirmed ? "已确认" : "待确认"}
                      </Pill>
                    </button>
                  ))}
                </div>
                {selected && (
                  <div className="actions">
                    <Button onClick={() => editOutfit(selected)}>编辑当前造型</Button>
                    <Button onClick={() => selectSampleShots(selected)}>选择样例镜头范围</Button>
                    {selected.rangeBindingExplicit && (
                      <Button
                        onClick={() => {
                          d.setOutfits((old) =>
                            old.map((item) =>
                              item.id === selected.id
                                ? {
                                    ...item,
                                    rangeBindingExplicit: false,
                                    version: item.version + 1,
                                    confirmed: false,
                                  }
                                : item,
                            ),
                          );
                          invalidate();
                        }}
                      >
                        清除样例镜头选择
                      </Button>
                    )}
                    <Button
                      onClick={() => {
                        if (!selected.confirmed) {
                          confirm(selected.id);
                          return;
                        }
                        d.setOutfits((old) =>
                          old.map((item) =>
                            item.id === selected.id
                              ? { ...item, confirmed: !item.confirmed }
                              : item,
                          ),
                        );
                        invalidate();
                      }}
                    >
                      {selected.confirmed ? "撤回造型确认" : "确认当前造型"}
                    </Button>
                  </div>
                )}
              </Section>
            ) : tab === "状态" ? (
              <Section title="当前状态">
                <Tabs
                  items={["平静", "迟疑", "紧张", "释然"]}
                  value={field("state", "平静")}
                  onChange={(next) => putField("state", next)}
                />
                <label>
                  表演备注
                  <textarea
                    value={field("stateNote")}
                    onChange={(event) => putField("stateNote", event.target.value)}
                  />
                </label>
                <p className="muted">状态作为后续镜头参考，当前图片保持原样。</p>
              </Section>
            ) : tab === "声音" ? (
              <Section title="角色声音">
                <label>
                  声线
                  <input
                    aria-label="角色声线"
                    value={field("tone", "沉静、克制")}
                    onChange={(event) => putField("tone", event.target.value)}
                  />
                </label>
                <p className="muted">尚无音频样本</p>
                <div className="actions">
                  <Button disabled>试听</Button>
                  <Button
                    onClick={() => {
                      setDetailsOpen(false);
                      d.go("voice");
                    }}
                  >
                    声音设置
                  </Button>
                </div>
              </Section>
            ) : (
              <Section title="人物关系与故事依据">
                <p>{d.value("relation")}</p>
                <p>
                  相关镜头：
                  {d.shots
                    .filter(
                      (shot) =>
                        Number(
                          d.value(`shot-${shot.id}-characterId`, shot.id === 4 ? "2" : "1"),
                        ) === person.id,
                    )
                    .map((shot) => `Shot ${shot.id}`)
                    .join("、") || "暂无"}
                </p>
                <Button
                  onClick={() => {
                    setDetailsOpen(false);
                    d.setEditor({
                      title: `${person.name} · 故事依据`,
                      description: d.value("source"),
                      presentation: "drawer",
                    });
                  }}
                >
                  查看原文依据
                </Button>
              </Section>
            )}
          </div>
          <footer>
            <span>{locked ? "身份与造型已确认" : "修改设定后需重新确认"}</span>
            <Button onClick={() => setDetailsOpen(false)}>返回三视图</Button>
          </footer>
        </dialog>
      )}
      {review && (
        <dialog
          ref={reviewRef}
          className="demo-dialog detail-drawer v2-character-review"
          aria-labelledby="v2-character-review-title"
          onCancel={() => setReview(null)}
          onClick={(event) => {
            if (event.target === reviewRef.current) setReview(null);
          }}
        >
          <form
            method="dialog"
            onSubmit={(event) => {
              event.preventDefault();
              saveReview();
            }}
          >
            <header>
              <Pill>演示造型审核</Pill>
              <Button aria-label="关闭角色造型审核" icon="close" onClick={() => setReview(null)} />
            </header>
            <h2 id="v2-character-review-title">确认 {reviewPerson?.name ?? "角色"} 的本集造型</h2>
            <p className="dialog-description">
              {review.episode} · {reviewReason || "三视图：正面、侧面、背面已齐备。"}
            </p>
            <ul className="v2-character-review-list">
              {reviewPlans.map((item) => (
                <li key={item.id}>
                  <strong>
                    {item.name} · v{item.version}
                  </strong>
                  <span>
                    {sceneLabel(item)} · {sampleShotLabel(item)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="dialog-description">
              未建立场次与镜头的映射。此次仅确认角色外观和服装；不代表镜头绑定或跨镜头连续性已完成。
            </p>
            <p className="dialog-description">修改身份或造型后需要重新确认。仅保存本地演示数据。</p>
            {reviewStale && <p role="alert">审核对象或参考状态已变化，请重新检查当前版本。</p>}
            <footer>
              <Button onClick={() => setReview(null)}>关闭</Button>
              {reviewStale && (
                <Button
                  disabled={loading}
                  onClick={() => setReview({ ...review, revision: reviewRevision })}
                >
                  重新检查当前版本
                </Button>
              )}
              <button
                className="button primary"
                type="submit"
                disabled={!!reviewReason || reviewStale}
              >
                {review.outfitId === undefined ? "确认本集全部造型并继续" : "确认此造型"}
              </button>
            </footer>
          </form>
        </dialog>
      )}
    </>
  );
}
