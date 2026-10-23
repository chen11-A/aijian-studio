import { Pill } from "./Common";
import type { CharacterUsageRow } from "./useCharacterUsage";

export function CharacterUsageRowView({
  row,
  characterId,
  selected,
}: {
  row: CharacterUsageRow;
  characterId: string;
  selected: boolean;
}) {
  const { episode, result } = row;
  if (result.kind === "EMPTY") return <p>{episode.title}：尚无已保存分镜</p>;
  if (result.kind !== "FOUND")
    return <p role="status">{episode.title}：使用情况未知，读取结果待核对</p>;
  const version = result.version;
  let start = 0;
  const shots = version.content.shots
    .map((shot) => {
      const from = start;
      start += shot.duration_frames;
      return { shot, from, end: start };
    })
    .filter(({ shot }) => shot.character_ids.includes(characterId));
  return (
    <section className="character-detail-record" aria-label={`${episode.title}角色使用`}>
      <header>
        <strong>{episode.title}</strong>
        {selected && <Pill>当前集</Pill>}
      </header>
      {shots.length ? (
        <>
          <p>
            保存分镜 v{version.version_number} · <code>{version.version_id}</code>
          </p>
          <p>
            固定设定版本：<code>{version.content.creative_library_version_id}</code>
          </p>
          <ul>
            {shots.map(({ shot, from, end }) => (
              <li key={shot.shot_id}>
                <strong>{shot.title}</strong> · 第{shot.ordinal}镜头 · [{from}, {end})帧 /{" "}
                {version.content.fps}fps
                <br />
                <code>{shot.shot_id}</code>
                {"character_bindings" in shot &&
                  shot.character_bindings
                    .filter((binding) => binding.character_id === characterId)
                    .map((binding) => (
                      <p key={binding.character_id}>
                        保存的 草稿 服装选用：<code>{binding.costume_id ?? "未选用"}</code>
                        <br />
                        保存的参考选用：{" "}
                        {binding.reference_ids.length
                          ? binding.reference_ids.map((id) => <code key={id}>{id} </code>)
                          : "未选用"}
                      </p>
                    ))}
              </li>
            ))}
          </ul>
          <p className="manual-creative-muted">
            采用新的共享设定前，需核对以上镜头的身份、关系、造型和连续性。
          </p>
        </>
      ) : (
        <p>该已保存分镜未引用此角色</p>
      )}
    </section>
  );
}
