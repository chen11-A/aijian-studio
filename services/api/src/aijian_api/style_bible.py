"""Editable project style. Presets are starting points, not a locked sentence."""

from __future__ import annotations

from dataclasses import dataclass

# The historical realism line. Existing prompts keep this wording until a
# project picks another preset or the user edits the block.
DEFAULT_PROMPT_ZH = "写实电影感：自然光、真实镜头、人物有重量，动作遵守重力，不要卡通，不要血腥。"

DEFAULT_PRESET = "写实电影感"


@dataclass(frozen=True, slots=True)
class StylePreset:
    name: str
    prompt_block_zh: str
    prompt_block_en: str
    grain: str
    aspect: str


PRESETS: tuple[StylePreset, ...] = (
    StylePreset(
        "写实电影感",
        DEFAULT_PROMPT_ZH,
        "Cinematic live-action still, 35mm anamorphic look, motivated practical lighting, "
        "natural skin texture, soft film grain, high dynamic range with readable faces.",
        "轻",
        "16:9",
    ),
    StylePreset(
        "都市写实",
        "都市写实：干净的现场光，肤色自然，背景稍虚，不要夸张色彩。",
        "Contemporary live-action, clean commercial lighting, shallow depth of field, "
        "natural colors.",
        "无",
        "9:16",
    ),
    StylePreset(
        "古风武侠",
        "古风武侠：薄雾，衣料和木头的质感，颜色偏淡，不要现代物品。",
        "Live-action wuxia film still, misty atmosphere, silk and wood textures, "
        "muted ink-wash palette.",
        "轻",
        "16:9",
    ),
    StylePreset(
        "民国年代",
        "民国年代：钨丝灯，暖褐色，颗粒稍重，室内有装饰线条。",
        "1930s period film still, tungsten lamps, warm sepia palette, heavier grain.",
        "中",
        "16:9",
    ),
    StylePreset(
        "赛博夜景",
        "赛博夜景：雨、品红和青色的灯光、地面反光，脸要看得清。",
        "Neon-noir live-action, rain, magenta and cyan practicals, glossy reflections.",
        "轻",
        "16:9",
    ),
    StylePreset(
        "日系动漫",
        "日系动漫：干净线稿，平涂上色，背景是绘景，不要写成实拍。",
        "High-quality 2D anime key frame, clean line art, cel shading, painted backgrounds.",
        "无",
        "16:9",
    ),
    StylePreset(
        "国风动画",
        "国风动画：立体动画电影画面，肤色柔和，颜色饱满。",
        "Chinese 3D animated film still, stylized proportions, soft skin, rich colors.",
        "无",
        "16:9",
    ),
    StylePreset(
        "黑白悬疑",
        "黑白悬疑：硬光，影子深，颗粒明显，不要彩色。",
        "Black-and-white film noir still, hard low-key light, deep shadows, strong grain.",
        "中",
        "16:9",
    ),
)


def preset(name: str) -> StylePreset:
    for item in PRESETS:
        if item.name == name:
            return item
    raise KeyError(name)


def preset_or_default(name: str) -> StylePreset:
    try:
        return preset(name)
    except KeyError:
        return preset(DEFAULT_PRESET)
