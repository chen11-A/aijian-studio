import type { CreativeContent } from "./adapters/creativeLibrary";
import { CharacterRelationships } from "./CharacterRelationships";
import { CharacterCostumes } from "./CharacterCostumes";
import { CharacterReferenceAssets } from "./CharacterReferenceAssets";
import "./character-details.css";

export type CharacterDetailsProps = {
  content: CreativeContent;
  characterId: string;
  locked: boolean;
  edit: (update: (content: CreativeContent) => CreativeContent) => void;
  onNotice: (message: string) => void;
};
export function CharacterDetails(props: CharacterDetailsProps) {
  return (
    <fieldset disabled={props.locked} className="manual-creative-fields character-details">
      <p className="manual-creative-muted">
        关系、服装和参考关联随作品设定另存不可变版本，旧版本保留。保存关联不表示身份批准或本集镜头选用。
      </p>
      <CharacterRelationships {...props} />
      <CharacterCostumes {...props} />
      <CharacterReferenceAssets {...props} />
    </fieldset>
  );
}
