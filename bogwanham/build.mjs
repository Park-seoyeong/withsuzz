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
const deadlines = JSON.parse(readFileSync(join(here, "deadlines.json"), "utf8"));

// 할인·쿠폰·프로모션·예약 마감일 찾기(자동). 축제 운영 기간·무비자 기한은 마감으로 보지 않음.
const DL_KW = /쿠폰|프로모션|할인|세일|특가|판매|코드|얼리버드|선착순|예매|예약/;
export function findDeadline(html, written) {
  const i = html.indexOf('id="post"');
  const text = html.slice(i < 0 ? 0 : i)
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/td|\/h\d)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&[a-z]+;/g, " ");
  const lines = text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const wy = Number(written.slice(0, 4)), wm = Number(written.slice(5, 7));
  const found = [];
  lines.forEach((line, k) => {
    const near = lines.slice(Math.max(0, k - 2), k + 1).join(" ");
    if (!DL_KW.test(near)) return;
    const re = /(?:(\d{4})\s*(?:년\s*|\.\s*))?(\d{1,2})\s*(?:월\s*|[./]\s*)(\d{1,2})\s*일?\s*(?:\([^)]*\)\s*)?(?:\d{1,2}:\d{2}\s*)?(?:까지|마감)/g;
    let m;
    while ((m = re.exec(line))) {
      const mo = +m[2], d = +m[3];
      if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
      let y = m[1] ? +m[1] : wy;
      if (!m[1] && mo < wm - 3) y++;
      found.push(`${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
  });
  return found.sort()[0] || "";
}
// 써즈가 보관함에서 빼 달라고 한 옛 버전은 hidden.json에 적음. 원고 파일은 그대로 두고 보관함에만 안 나옴.
let hidden = [];
try { hidden = JSON.parse(readFileSync(new URL("./hidden.json", import.meta.url), "utf8")); } catch {}
const files = readdirSync(draftsDir).filter((f) => f.endsWith("_새서식.html") && !hidden.includes(f)).sort();
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
    deadline: base in deadlines ? deadlines[base] : findDeadline(html, base.slice(0, 10)),
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


// 원고 코치: 말투 교정기 문항(오늘 것)·학습 기록·다녀온 곳 표. 라이브러리 파일은 읽기만 한다.
const libDir = dirname(draftsDir);
let tone = null;
try {
  const h = readFileSync(join(draftsDir, "말투교정기", "써즈_말투교정기.html"), "utf8");
  const m = h.match(/<script type="application\/json" id="quiz-data">([\s\S]*?)<\/script>/);
  if (m) tone = JSON.parse(m[1]);
} catch { console.warn("말투 교정기 문항을 읽지 못함"); }
let toneHistory = [];
try {
  const md = readFileSync(join(libDir, "써즈_말투학습기록.md"), "utf8");
  const sec = md.split("## 날짜별 기록")[1] || "";
  for (const part of sec.split(/\n(?=### )/)) {
    const h = part.match(/^###\s*(\d{4}-\d{2}-\d{2})\s*(.*)$/m);
    if (!h) continue;
    const body = part.replace(/^###.*\n/, "").trim();
    toneHistory.push({ date: h[1], title: h[2].trim(), body });
  }
  toneHistory.sort((a, b) => b.date.localeCompare(a.date));
} catch { console.warn("말투 학습 기록을 읽지 못함"); }
let visited = [];
try {
  const md = readFileSync(join(libDir, "써즈_다녀온곳.md"), "utf8");
  const sec = md.split("## 확인됨")[1] || "";
  visited = sec.split(/\n## /)[0].split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).replace(/\s*\(.*$/, "").trim()).filter(Boolean);
} catch { console.warn("다녀온 곳 표를 읽지 못함"); }
const jsonSafe = (x) => JSON.stringify(x).replace(/</g, "\\u003c");
const tpl = readFileSync(join(here, "template.html"), "utf8");
const data = JSON.stringify(posts).replace(/</g, "\\u003c");
const guideData = JSON.stringify(guide).replace(/</g, "\\u003c");
const out = tpl.replace("/*__POSTS__*/[]", data).replace("/*__GUIDE_CHINA__*/{}", guideData).replace("/*__TONE__*/null", () => jsonSafe(tone)).replace("/*__TONE_HISTORY__*/[]", () => jsonSafe(toneHistory)).replace("/*__VISITED__*/[]", () => jsonSafe(visited)).replace("__BUILT__", new Date().toISOString())
  // 동방.zip 그림: img/<이름>.webp → data URI (template의 DONGBANG.images 자리)
  .replace(/__IMG_([a-z_]+)__/g, (m, name) => {
    try { return "data:image/webp;base64," + readFileSync(join(here, "img", name + ".webp")).toString("base64"); }
    catch { console.warn("그림 없음:", name); return ""; }
  });
writeFileSync(outFile, out);
console.log(`원고 ${posts.length}편, 중국 도시 ${Object.keys(guide).length}곳 → ${outFile} (${Math.round(out.length / 1024)}KB)`);
