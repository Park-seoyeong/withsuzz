// 원고 보관함 만들기
// 사용법: node bogwanham/build.mjs <원고 폴더> [출력 파일]
// 원고 폴더 안의 *_새서식.html 을 읽어 본문(#post)만 뽑고, template.html 에 넣어 한 페이지로 만든다.
// 원고 파일은 읽기만 하고 고치지 않는다.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const draftsDir = process.argv[2] || "/mnt/project-files/drafts";
const outFile = process.argv[3] || join(here, "dist", "index.html");

// 파일 이름으로 만드는 고정 id (상태 저장 키). 파일 이름이 같으면 id도 같다.
export function postId(file) {
  let h = 0x811c9dc5;
  for (const ch of Buffer.from(file, "utf8")) {
    h ^= ch;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return "p" + h.toString(16).padStart(8, "0");
}

export function extractPost(html) {
  const start = html.indexOf('id="post"');
  if (start < 0) return null;
  const open = html.indexOf(">", start) + 1;
  // 본문은 </div></div> 바로 앞(.post 닫힘 + .paper 닫힘)에서 끝난다
  const end = html.indexOf("</div></div>", open);
  if (end < 0) return null;
  return html.slice(open, end).trim();
}

export function extractTitle(html, file) {
  const h1 = html.match(/<h1>([\s\S]*?)<\/h1>/);
  const t = html.match(/<title>([\s\S]*?)<\/title>/);
  let s = (h1 && h1[1]) || (t && t[1]) || file;
  s = s.replace(/<[^>]+>/g, "").replace(/\s*·\s*새\s*서식.*$/, "").replace(/\s*새서식\s*$/, "").trim();
  return s;
}

const links = JSON.parse(readFileSync(join(here, "artifact-links.json"), "utf8"));
const files = readdirSync(draftsDir).filter((f) => f.endsWith("_새서식.html")).sort();
const posts = [];
for (const file of files) {
  const html = readFileSync(join(draftsDir, file), "utf8");
  const body = extractPost(html);
  if (!body) {
    console.warn("본문을 찾지 못해 건너뜀:", file);
    continue;
  }
  const base = file.replace(/_새서식\.html$/, "");
  posts.push({
    id: postId(file),
    file: base,
    written: base.slice(0, 10),
    title: extractTitle(html, base),
    artifact: links[base] ? "https://claude.ai/artifact/" + links[base] : "",
    html: body,
  });
}

// 중국글 구성가이드 4번 목록(같은 도시 링크용). 가이드 파일은 읽기만 한다.
export function parseChinaGuide(md) {
  const out = {};
  const start = md.indexOf("## 4.");
  if (start < 0) return out;
  const rest = md.slice(start + 5);
  const next = rest.search(/\n## /);
  const section = next < 0 ? rest : rest.slice(0, next);
  let city = "";
  for (const line of section.split("\n")) {
    const h = line.match(/^###\s*\[(.+?)\]/);
    if (h) { city = h[1].trim(); out[city] = []; continue; }
    const m = line.match(/^-\s+(.+?)\s+(https:\/\/blog\.naver\.com\/\S+)/);
    if (m && city) out[city].push({ title: m[1].trim(), url: m[2] });
  }
  return out;
}
const guidePath = join(dirname(draftsDir), "써즈_중국글_구성가이드.md");
let guide = {};
try { guide = parseChinaGuide(readFileSync(guidePath, "utf8")); } catch { console.warn("중국글 구성가이드를 읽지 못함:", guidePath); }

const tpl = readFileSync(join(here, "template.html"), "utf8");
const data = JSON.stringify(posts).replace(/</g, "\\u003c");
const guideData = JSON.stringify(guide).replace(/</g, "\\u003c");
const out = tpl.replace("/*__POSTS__*/[]", data).replace("/*__GUIDE_CHINA__*/{}", guideData).replace("__BUILT__", new Date().toISOString());
writeFileSync(outFile, out);
console.log(`원고 ${posts.length}편, 중국 도시 ${Object.keys(guide).length}곳 → ${outFile} (${Math.round(out.length / 1024)}KB)`);
