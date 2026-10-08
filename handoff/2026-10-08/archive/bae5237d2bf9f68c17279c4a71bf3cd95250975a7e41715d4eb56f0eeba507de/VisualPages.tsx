import { useState } from "react";
import type { CSSProperties } from "react";
import { useDemo } from "./model";
import { art } from "./data";
import { Button, FlowFooter, PageTitle } from "./Common";
import { Icon } from "./Icon";
import { ScenePage, AssetsPage } from "./SceneAndAssets";
import { WorldPage } from "./WorldPage";
import { CharacterPage } from "./CharacterPage";
import { useVisualLayout } from "./VisualLayoutSwitch";
import { Dropdown } from "./Dropdown";
import front from "./assets/v2/front.png";
import "./v2-visual.css";

export function VisualPages() {
  const d = useDemo();
  const compact = useVisualLayout();
  const [mediaAspect, setMediaAspect] = useState(212 / 502);
  if (d.page === "world") return <WorldPage />;
  if (d.page === "character") return <CharacterPage />;
  if (d.page === "scenes") return <ScenePage />;
  if (d.page === "assets") return <AssetsPage />;
  const current = d.characters.find((item) => item.id === d.selectedCharacter) ?? d.characters[0]!;
  const others = d.characters.filter((item) => item.id !== current.id);
  const outfits =
    d.scenario === "empty"
      ? []
      : d.outfits.filter(
          (item) => item.characterId === current.id && item.episode === d.value("episode"),
        );
  const addCharacter = () =>
    d.edit(
      "新增角色",
      [
        { key: "name", label: "角色名称", value: "", required: true },
        { key: "role", label: "身份与作用", value: "配角", required: true },
      ],
      (data) => {
        const id = Date.now();
        d.setCharacters((old) => [
          ...old,
          { id, name: data.name!, role: data.role!, note: "待补充角色设定", image: art.portrait },
        ]);
        d.setSelectedCharacter(id);
        d.put("assetsConfirmed", "false");
        d.go("character");
      },
    );
  const editRelation = () =>
    d.edit("修改人物关系", [
      {
        key: "relation",
        label: "人物关系",
        value: d.value("relation"),
        type: "textarea",
        required: true,
      },
    ]);
  const chooseCharacter = () =>
    d.setEditor({
      title: "选择当前角色",
      presentation: "drawer",
      fields: [
        {
          key: "person",
          label: "角色",
          value: `${current.id} · ${current.name}`,
          options: d.characters.map((item) => `${item.id} · ${item.name}`),
        },
      ],
      confirm: "查看角色",
      save: (values) => d.setSelectedCharacter(Number(values.person!.split(" · ")[0])),
    });
  const showPerson = (id: number) => {
    d.setSelectedCharacter(id);
    d.go("character");
  };
  return (
    <>
      <PageTitle
        actions={
          <>
            <Dropdown className="v2-visual-actions" summaryClassName="button" summary="角色详情">
              <div>
                <Button onClick={chooseCharacter}>选择角色</Button>
                <Button onClick={addCharacter}>新增角色</Button>
                <Button onClick={editRelation}>修改人物关系</Button>
              </div>
            </Dropdown>
          </>
        }
      />
      <div
        className={`v2-characters-body${compact ? " v21-characters" : ""}`}
        style={{ "--character-aspect": mediaAspect } as CSSProperties}
      >
        <section className="v2-characters-current v2-visual-card">
          <h2>
            <Icon name="users" size={18} />
            当前角色 · {current.name}
          </h2>
          {d.scenario === "empty" ? (
            <div className="v2-characters-full-reference v2-visual-empty">
              <p>尚无角色参考</p>
              <Button onClick={addCharacter}>新增角色</Button>
            </div>
          ) : (
            <button
              className="v2-characters-full-reference v2-visual-image"
              onClick={() =>
                d.setEditor({
                  title: `${current.name} · 角色参考`,
                  image: current.id === 1 ? front : current.image,
                })
              }
              aria-label={`大屏查看${current.name}角色参考`}
            >
              <img
                src={current.id === 1 ? front : current.image}
                alt={`${current.name}角色参考`}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  if (image.naturalHeight) setMediaAspect(image.naturalWidth / image.naturalHeight);
                }}
              />
            </button>
          )}
          <div className="v2-characters-current-copy">
            <h3>{current.role}</h3>
            <p>{current.note}</p>
            {compact && (
              <section className="v21-character-outfit-summary" aria-label="本集造型摘要">
                <h4>
                  本集造型 <span>{outfits.length} 套</span>
                </h4>
                {outfits.length ? (
                  <ul>
                    {outfits.map((item) => (
                      <li key={item.id}>{item.name}</li>
                    ))}
                  </ul>
                ) : (
                  <p>尚未安排本集造型</p>
                )}
                <p>
                  {d.value(`locked-${current.id}`) === "true" ? "角色造型已确认" : "角色造型待确认"}
                </p>
              </section>
            )}
            <Button onClick={() => showPerson(current.id)}>模型与本集造型</Button>
          </div>
        </section>
        <div className="v2-characters-side">
          {others.slice(0, 2).map((item) => (
            <section className="v2-characters-other v2-visual-card" key={item.id}>
              <h2>
                <Icon name="users" size={18} />
                {item.name}
              </h2>
              <img src={item.image} alt={`${item.name}头像`} />
              <p>
                {item.role} · {item.note}
              </p>
              <Button onClick={() => showPerson(item.id)}>查看角色</Button>
            </section>
          ))}
          <section className="v2-characters-relation v2-visual-card">
            <h2>
              <Icon name="globe" size={18} />
              人物关系
            </h2>
            {!compact && (
              <p>
                角色列表只保留一份。关系、造型与出场顺序可在详情中展开，不在主画布复制第二套列表。
              </p>
            )}
            <button className="v2-visual-text-link" onClick={editRelation}>
              {d.value("relation")}
            </button>
            {d.characters.length > 3 && (
              <Button onClick={chooseCharacter}>查看全部 {d.characters.length} 位角色</Button>
            )}
          </section>
        </div>
      </div>
      <FlowFooter
        label="确认本集角色"
        secondaryLabel="哪里不对？"
        secondaryAction={() => d.focusAssistant("调整本集角色与人物关系：")}
        reason={`样例角色 ${d.characters.length} 位 · 不新增真实角色资产`}
        action={() => showPerson(current.id)}
      />
    </>
  );
}
