import novel from "../../../../../../packages/aivora-prompts/fixtures/test-novel-2000.txt?raw";
import { emptySoundPlan } from "../../film/audio";
import { detectDirectorCoverage } from "../../film/director-continuity";
import {
  DEFAULT_STYLE_ZH,
  type FilmCharacter,
  type FilmProject,
  type FilmScene,
  type FilmShot,
} from "../../film/project";

/**
 * The test novel 「晚照书店」 (packages/aivora-prompts/fixtures/test-novel-2000.txt) as one
 * episode right after 导演分镜, for the full-page layout check: three scenes, seven people, 28
 * shots, 149 seconds. The scene text is the novel itself and every line of dialogue is quoted
 * from it; the pictures retell it the way the director does. Nothing has been generated, so
 * every picture frame shows its empty state. Two problems the 3j fixes have to show are left
 * in: scene 1 stops before the brakes outside, so its coverage reports the missing tail, and
 * two moves of the fight in scene 2 are not tied to a shot. Coverage comes from
 * detectDirectorCoverage, the same check the director step runs.
 */
const SERIES = "film_wanzhaoseries000001";

/** The scene bodies of the novel, split at its 第一场 / 第二场 / 第三场 headings. */
export function novelScenes(): { title: string; text: string }[] {
  return novel
    .split(/^第[一二三]场[\u3000 ]*/mu)
    .slice(1)
    .map((part) => {
      const [title = "", ...body] = part.split("\n");
      return { title: title.trim(), text: body.join("\n").trim() };
    });
}

/** The last paragraph of a scene, which the director keeps word for word in the last shot. */
function lastParagraph(text: string): string {
  return text.split(/\n+/).at(-1)?.trim() ?? "";
}

const BODIES = novelScenes();

type Line = [speaker: string, text: string];

type ShotRow = {
  size: string;
  seconds: number;
  picture: string;
  characters: string[];
  lines?: Line[];
  action?: string;
  performance?: string;
  move?: string;
};

const SCENES: { id: string; where: string; tags: string[]; ambience: string; shots: ShotRow[] }[] =
  [
    {
      id: "scene-1",
      where: "内景 · 夜",
      tags: [],
      ambience: "大雨打在玻璃门上，屋里很静",
      shots: [
        {
          size: "远景",
          seconds: 6,
          picture: "雨夜的青石巷积满了水，路灯被雨帘切成昏黄的光，巷尾的晚照书店还亮着灯。",
          characters: [],
          move: "缓推",
        },
        {
          size: "特写",
          seconds: 3,
          picture: "玻璃门上贴着一张褪色的纸条：本店月底停业。",
          characters: [],
        },
        {
          size: "中景",
          seconds: 5,
          picture: "林晚蹲在书架前，把旧书一本本装进纸箱，袖口卷到手肘，手背沾着灰。",
          characters: ["林晚"],
        },
        {
          size: "全景",
          seconds: 5,
          picture: "门铃一响，穿黑色风衣的男人推门进来，肩头滴水，收起伞站在门口。",
          characters: ["沈砚"],
        },
        {
          size: "近景",
          seconds: 5,
          picture: "林晚头也没抬，手里还在装书。",
          characters: ["林晚"],
          lines: [
            ["林晚", "打烊了。"],
            ["林晚", "要买书的话，明天来吧，全场五折。"],
          ],
        },
        {
          size: "近景",
          seconds: 5,
          picture: "男人站在门口没有往里走，声音很低。",
          characters: ["沈砚"],
          lines: [
            ["沈砚", "我不买书。"],
            ["沈砚", "我找林国栋。"],
          ],
        },
        {
          size: "中近景",
          seconds: 6,
          picture: "林晚慢慢站起来转过身，看清他眉骨很高、左手虎口有一道旧疤。",
          characters: ["林晚", "沈砚"],
          lines: [
            ["林晚", "他三年前就不在了。"],
            ["林晚", "你是谁？"],
          ],
          performance: "手里的书停在半空，眼神从戒备变成疑惑。",
        },
        {
          size: "中景",
          seconds: 7,
          picture: "沈砚从风衣内袋掏出油纸包着的信封，放在收银台上。",
          characters: ["沈砚"],
          lines: [
            [
              "沈砚",
              "我叫沈砚。十年前，你父亲借给我母亲一笔钱，救了她一命。她临走前让我一定把钱还上。",
            ],
          ],
        },
        {
          size: "近景",
          seconds: 6,
          picture: "林晚盯着信封没有伸手，沈砚把它往前推了推。",
          characters: ["林晚", "沈砚"],
          lines: [
            ["林晚", "我爸从来没提过。"],
            ["沈砚", "他大概也没打算让人还。"],
            ["沈砚", "但我得还。"],
          ],
        },
        {
          size: "近景",
          seconds: 5,
          picture: "林晚低下头，假装整理收银台上的发票。",
          characters: ["林晚"],
          lines: [["林晚", "你来晚了。这家店，下个月就没了。"]],
          performance: "抿着嘴唇，眼眶发热，声音发紧，不让眼泪掉下来。",
        },
      ],
    },
    {
      id: "scene-2",
      where: "内景 · 夜",
      tags: ["打斗"],
      ambience: "铁皮屋顶被雨点砸得轰轰响",
      shots: [
        {
          size: "全景",
          seconds: 4,
          picture: "三个男人撞开书店的门，领头的周烈剃着寸头，挂着粗金链，手里转着车钥匙。",
          characters: ["周烈", "打手甲", "打手乙"],
        },
        {
          size: "近景",
          seconds: 8,
          picture: "周烈咧嘴一笑，露出一颗金牙。",
          characters: ["周烈"],
          lines: [
            ["周烈", "林小姐，"],
            [
              "周烈",
              "你爸欠我们老板的二十万，利滚利，现在是六十万。月底就到期了，我来提醒你一声。",
            ],
          ],
        },
        {
          size: "近景",
          seconds: 5,
          picture: "林晚攥紧衣角，指节发白。",
          characters: ["林晚"],
          lines: [
            ["林晚", "我爸没欠过你们钱！"],
            ["林晚", "那张借条是假的，我已经报警了。"],
          ],
        },
        {
          size: "中景",
          seconds: 4,
          picture: "周烈嗤笑着抬手一挥，两个打手把书架推倒，书砸了一地，被雨水打湿。",
          characters: ["周烈", "打手甲", "打手乙"],
          lines: [["周烈", "报警？"]],
        },
        {
          size: "中景",
          seconds: 5,
          picture: "林晚扑过去护书，被周烈一把抓住手腕往外拖。",
          characters: ["周烈", "林晚"],
          lines: [["周烈", "走，跟我去码头见老板，有话当面说。"]],
        },
        {
          size: "中近景",
          seconds: 5,
          picture: "沈砚站在倒下的书架旁，脱下湿透的风衣搭在椅背上，慢慢卷起袖口。",
          characters: ["沈砚", "周烈"],
          lines: [
            ["沈砚", "放开她。"],
            ["周烈", "你哪根葱？"],
          ],
        },
        {
          size: "大全景",
          seconds: 6,
          picture: "城东废弃的码头仓库，地上是积水和生锈的铁链，林晚被推到一只木箱旁边。",
          characters: ["周烈", "林晚", "沈砚"],
          lines: [
            ["周烈", "小子，你倒是有胆。"],
            ["周烈", "今天就让你长长记性。"],
          ],
        },
        {
          size: "中景",
          seconds: 5,
          picture: "周烈挥棍砸来，沈砚侧身一让，扣住他的手腕一拧，铁棍落地。",
          characters: ["沈砚", "周烈"],
          action: "侧身让过铁棍，扣腕一拧，铁棍落地。",
          move: "跟拍",
        },
        {
          size: "近景",
          seconds: 5,
          picture: "第三个人掏出折叠刀，刀锋划过沈砚的小臂，血渗了出来。",
          characters: ["沈砚", "打手乙", "林晚"],
          lines: [["林晚", "小心！"]],
        },
        {
          size: "中景",
          seconds: 5,
          picture: "周烈看着满地呻吟的手下和沈砚流血的胳膊，远处警笛由远及近。",
          characters: ["周烈", "沈砚"],
          lines: [["周烈", "算你狠。"]],
          action: lastParagraph(BODIES[1]?.text ?? ""),
        },
      ],
    },
    {
      id: "scene-3",
      where: "内景 · 凌晨",
      tags: ["哭戏"],
      ambience: "日光灯嗡嗡作响",
      shots: [
        {
          size: "全景",
          seconds: 5,
          picture: "凌晨两点的急诊走廊空荡荡，沈砚坐在长椅上，左小臂缠着白纱布。",
          characters: ["沈砚", "林晚"],
        },
        {
          size: "近景",
          seconds: 5,
          picture: "林晚捏着那个泡软了一角的油纸信封。",
          characters: ["林晚"],
          lines: [
            ["林晚", "你本来可以不管的。"],
            ["林晚", "这是我家的事。"],
          ],
        },
        {
          size: "近景",
          seconds: 9,
          picture: "沈砚抬头看她。",
          characters: ["沈砚"],
          lines: [
            ["沈砚", "十年前，你父亲也可以不管。"],
            [
              "沈砚",
              "那年冬天，我妈在医院门口晕倒，是他把身上所有的钱都垫了。他说，谁家都有过不去的时候。",
            ],
          ],
        },
        {
          size: "特写",
          seconds: 4,
          picture: "林晚怔住，想笑，眼泪却先掉了下来，她转身用手背去擦。",
          characters: ["林晚"],
          performance: "肩膀轻轻发抖，死死咬住下唇，不哭出声。",
        },
        {
          size: "中景",
          seconds: 4,
          picture: "沈砚站起来犹豫了一下，把半干的风衣披在她肩上。",
          characters: ["沈砚", "林晚"],
        },
        {
          size: "中近景",
          seconds: 5,
          picture: "林晚转过头，泪痕还挂在脸上。",
          characters: ["沈砚", "林晚"],
          lines: [
            ["沈砚", "书店，"],
            ["沈砚", "我想试试帮你留下来。"],
            ["林晚", "为什么？"],
          ],
        },
        {
          size: "近景",
          seconds: 6,
          picture: "沈砚看向走廊尽头的窗户，雨停了，天边透出一线灰白的光。",
          characters: ["沈砚"],
          lines: [
            ["沈砚", "因为那张照片里，你爸笑得很开心。"],
            ["沈砚", "我想让那扇门一直亮着灯。"],
          ],
        },
        {
          size: "全景",
          seconds: 6,
          picture: "天亮后回到青石巷，林晚擦干净一本诗集，沈砚扶起书架，阿婆端来两碗热豆浆。",
          characters: ["林晚", "沈砚", "阿婆"],
          lines: [["阿婆", "灯还亮着，就好。"]],
          action: lastParagraph(BODIES[2]?.text ?? ""),
        },
      ],
    },
  ];

const PEOPLE: Omit<FilmCharacter, "source" | "userFields" | "portraits">[] = [
  {
    id: "lin-wan",
    name: "林晚",
    identity: "女，二十六岁，扎着低马尾，袖口卷到手肘，手背上沾着灰",
    gender: "女",
    ageBand: "青年",
    voiceId: "ara",
  },
  {
    id: "shen-yan",
    name: "沈砚",
    identity: "男，三十岁上下，眉骨很高，眼神沉静，左手虎口有一道旧疤，黑色风衣",
    gender: "男",
    ageBand: "青年",
    voiceId: "rex",
  },
  {
    id: "lin-guodong",
    name: "林国栋",
    identity: "男，林晚的父亲，照片里抱着小女儿站在书店门口笑的中年人",
    gender: "男",
    ageBand: "中年",
    voiceId: "orion",
  },
  {
    id: "zhou-lie",
    name: "周烈",
    identity: "男，剃着寸头，脖子上挂着粗金链，一颗金牙",
    gender: "男",
    ageBand: "",
    voiceId: "zagan",
  },
  {
    id: "thug-a",
    name: "打手甲",
    identity: "男，周烈的手下",
    gender: "男",
    ageBand: "",
    voiceId: "",
  },
  {
    id: "thug-b",
    name: "打手乙",
    identity: "男，周烈的手下，带着一把折叠刀",
    gender: "男",
    ageBand: "",
    voiceId: "",
  },
  {
    id: "a-po",
    name: "阿婆",
    identity: "女，巷口卖早点的老人",
    gender: "女",
    ageBand: "老年",
    voiceId: "",
  },
];

export function novelProject(): FilmProject {
  const scenes: FilmScene[] = SCENES.map((scene, index) => ({
    id: scene.id,
    no: index + 1,
    title: BODIES[index]?.title ?? "",
    where: scene.where,
    text: BODIES[index]?.text ?? "",
    ambience: scene.ambience,
    source: "agent:writer",
    userFields: [],
    tags: scene.tags,
  }));
  const shots: FilmShot[] = SCENES.flatMap((scene) =>
    scene.shots.map((row, index) => {
      const lines = (row.lines ?? []).map(([speaker, text]) => ({ speaker, text }));
      const speakers = [...new Set(lines.map((line) => line.speaker))];
      return {
        id: `${scene.id}-shot-${index + 1}`,
        sceneId: scene.id,
        no: index + 1,
        size: row.size,
        angle: "平视",
        move: row.move ?? "固定",
        seconds: row.seconds,
        picture: row.picture,
        action: row.action ?? row.picture,
        performance: row.performance ?? "",
        ...(row.performance ? { performanceSource: "agent:performance" } : {}),
        characters: row.characters,
        line: lines.map((line) => line.text).join("\n"),
        lines,
        speaker: speakers.length === 1 ? (speakers[0] ?? "") : "",
        sound: emptySoundPlan(scene.ambience),
        source: "agent:director",
        userFields: [],
        poster: "",
        posterPosition: "",
        takes: [],
        stills: [],
        selectedTakeId: "",
      };
    }),
  );
  return {
    schemaVersion: 1,
    id: "film_wanzhaoepisode00001",
    seriesId: SERIES,
    seriesTitle: "晚照书店",
    episodeNo: 1,
    episodeTitle: "第 1 集",
    title: "晚照书店",
    stylePreset: "写实电影感",
    styleZh: DEFAULT_STYLE_ZH,
    characters: PEOPLE.map((person) => ({
      ...person,
      source: "agent:art",
      userFields: [],
      portraits: [],
    })),
    scenes: scenes.map((scene) => ({ ...scene, coverage: detectDirectorCoverage(scene, shots) })),
    shots,
    unassignedBeats: [
      { sceneId: "scene-2", text: "另一个打手从背后扑上来，沈砚矮身一个肘击，正中对方肋下" },
      { sceneId: "scene-2", text: "反手抓住对方的手肘往下一压，膝盖顶上去，刀飞了出去" },
    ],
    takesPerShot: 1,
    parallelism: 2,
    maxRetryRounds: 2,
    draft: false,
    jobs: [],
    locations: [
      { id: "loc-1", name: "晚照书店", prompt: "老城区青石巷尽头的旧书店", ambience: "雨声" },
      { id: "loc-2", name: "码头仓库", prompt: "城东废弃的码头仓库，铁皮屋顶", ambience: "暴雨" },
      { id: "loc-3", name: "医院走廊", prompt: "市医院急诊室外的走廊", ambience: "日光灯声" },
    ],
    props: [
      { id: "prop-1", name: "油纸信封", note: "沈砚要还的钱" },
      { id: "prop-2", name: "旧合影", note: "林国栋抱着小林晚在书店门口" },
      { id: "prop-3", name: "铁棍", note: "周烈手里" },
      { id: "prop-4", name: "折叠刀", note: "第三个打手掏出来的" },
    ],
    sourceText: novel.trim(),
    savedAt: "",
    directory: "",
    assemblyPath: "",
    assemblyUrl: "",
    exportPath: "",
    narrationVoiceId: "",
    audioClips: [],
    backendProjectId: "",
    aspectRatio: "9:16",
  };
}
