import fs from "fs-extra";
import path from "path";
import yaml from "js-yaml";
import matter from "gray-matter";

export interface BookConfig {
  title?: string;
  summary?: string;
  chapters?: string[];
  [key: string]: unknown;
}

export interface Chapter {
  filename: string;
  slug: string;
  title: string;
  free: boolean;
  content: string;
}

export interface ParsedBook {
  config: BookConfig;
  chapters: Chapter[];
  bookPath: string;
}

export async function parseBook(bookPath: string): Promise<ParsedBook> {
  const configPath = path.join(bookPath, "config.yaml");

  if (!(await fs.pathExists(configPath))) {
    throw new Error(`config.yaml が見つかりません: ${configPath}`);
  }

  const configRaw = await fs.readFile(configPath, "utf8");
  const loadedConfig = yaml.load(configRaw);
  const config = isBookConfig(loadedConfig) ? loadedConfig : {};
  const chapterOrder =
    Array.isArray(config.chapters) &&
    config.chapters.every((chapter) => typeof chapter === "string")
      ? config.chapters
      : undefined;

  const chapters = await loadChapters(bookPath, chapterOrder);

  return { config, chapters, bookPath };
}

async function loadChapters(
  bookPath: string,
  chapterOrder: string[] | undefined,
): Promise<Chapter[]> {
  const files = await fs.readdir(bookPath);
  const mdFiles = files.filter(
    (file): file is string => typeof file === "string" && file.endsWith(".md"),
  );

  let orderedFiles: string[];

  if (chapterOrder && Array.isArray(chapterOrder)) {
    orderedFiles = chapterOrder.map((slug) =>
      slug.endsWith(".md") ? slug : `${slug}.md`,
    );
  } else {
    orderedFiles = mdFiles.sort((a, b) => {
      const numA = parseInt(a.match(/^(\d+)/)?.[1] ?? "9999", 10);
      const numB = parseInt(b.match(/^(\d+)/)?.[1] ?? "9999", 10);
      return numA - numB || a.localeCompare(b);
    });
  }

  const chapters: Chapter[] = [];
  for (const filename of orderedFiles) {
    const filepath = path.join(bookPath, filename);
    if (!(await fs.pathExists(filepath))) {
      console.warn(`警告: ファイルが見つかりません: ${filename}`);
      continue;
    }
    const raw = await fs.readFile(filepath, "utf8");
    const parsed = matter(raw);
    const frontmatter = isRecord(parsed.data) ? parsed.data : {};
    const title =
      typeof frontmatter.title === "string" ? frontmatter.title : "";
    const free =
      typeof frontmatter.free === "boolean" ? frontmatter.free : false;
    chapters.push({
      filename,
      slug: filename.replace(".md", ""),
      title,
      free,
      content: parsed.content,
    });
  }

  return chapters;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBookConfig(value: unknown): value is BookConfig {
  if (!isRecord(value)) {
    return false;
  }

  if (value.chapters == null) {
    return true;
  }

  return (
    Array.isArray(value.chapters) &&
    value.chapters.every((chapter) => typeof chapter === "string")
  );
}
