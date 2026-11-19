export interface SplitTitle {
  main: string;
  subtitle?: string;
}

/**
 * 「書名: 副題」「書名：副題」を書名と副題に分ける。
 * 半角のコロンは後ろに空白があるときだけ区切りとみなす（"Vue:Router" などは分けない）。
 */
export function splitTitle(title: string): SplitTitle {
  const match = /^(.+?)(?::\s+|：\s*)(.+)$/.exec(title);
  if (!match) {
    return { main: title };
  }
  return { main: (match[1] ?? "").trim(), subtitle: (match[2] ?? "").trim() };
}
