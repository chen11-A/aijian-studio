/** A casting default, never a claim that the character is middle-aged. */
export type AdultVoiceDefault = {
  basis: "adult-default";
  evidenceSource: "source" | "character-reply" | "casting-default";
  evidence: string;
};
export function adultAgeLabel(value: unknown): boolean {
  return typeof value === "string" && /^(成年|成人|adult)$/iu.test(value.trim());
}

export function adultVoiceEvidence(
  name: string,
  identity: string,
  source: string,
  declared?: AdultVoiceDefault,
): AdultVoiceDefault | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const narration = source
    .replace(/[“「"][^”」"]*[”」"]/gu, "")
    .split(/(?<=[。！？])/u)
    .filter((part) => !/未成年|非成年|非成人/.test(part))
    .join("");
  if (name.trim()) {
    const direct = narration.match(
      new RegExp(
        `${escaped}[，,\\s]*(?:是(?:个|一名|一位)?)?(成年(?:男人|女人|男子|女子)?|成人|男人|女人)`,
      ),
    );
    const group = narration.match(
      new RegExp(
        `(男人|女人)[^。！？\\n]{0,60}[。！？]\\s*(?:领头的|其中一个|为首的)(?:叫|名叫|是)${escaped}`,
      ),
    );
    if (direct || group)
      return {
        basis: "adult-default",
        evidenceSource: "source",
        evidence: `${name}：${direct?.[1] ?? group?.[1]}`,
      };
  }
  if (/未成年|非成年|非成人/.test(identity)) return undefined;
  const explicit = identity.match(/成年|成人|男人|女人|\badult\b/iu)?.[0];
  if (explicit)
    return { basis: "adult-default", evidenceSource: "character-reply", evidence: explicit };
  return declared?.basis === "adult-default" && declared.evidenceSource === "character-reply"
    ? declared
    : undefined;
}

/** Provisional voice casting only: this does not populate the character's factual age band. */
export function provisionalAdultVoice(
  name: string,
  identity: string,
  source: string,
): AdultVoiceDefault | undefined {
  const young = /未成年|儿童|幼童|小孩|少年|少女/u;
  const at = name.trim() ? source.indexOf(name) : -1;
  const local =
    at < 0 ? "" : (source.slice(at, at + name.length + 12).split(/[。！？\n]/u)[0] ?? "");
  if (young.test(identity) || young.test(local)) return undefined;
  return {
    basis: "adult-default",
    evidenceSource: "casting-default",
    evidence: "年龄未注明，暂用成人声音，可调整。",
  };
}
