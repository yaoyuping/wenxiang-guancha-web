// Rebuild the portable content snapshot from the supplied V1.23 mini-program.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const root = process.argv[2];
if (!root) throw Error("Usage: node scripts/import-source.cjs <V1.23 project>");
const mini = path.join(root, "miniprogram"),
  out = path.resolve("static"),
  req = (f) => require(path.join(mini, f));
const idx = req("data/curriculum-r10-index"),
  art = req("utils/handpainted"),
  server = path.join(root, "cloudfunctions/wxPersonalHub");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const manifest = { sourceVersion: "V1.23.0-rc.1", files: {}, contentCount: 0 };
function copyTree(dir, rel = "") {
  for (const x of fs.readdirSync(dir, { withFileTypes: true })) {
    if (x.name.startsWith(".") || x.name === "node_modules") continue;
    const r = path.join(rel, x.name),
      p = path.join(dir, x.name);
    if (x.isDirectory()) copyTree(p, r);
    else if (/\.(webp|png|jpe?g|svg)$/i.test(x.name)) {
      const dest = path.join(out, "assets", r);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(p, dest);
      manifest.files[r] = sha(fs.readFileSync(p));
    }
  }
}
copyTree(mini);
const entries = [],
  questions = {};
function add(c) {
  if (entries.some((x) => x.id === c.id)) throw Error("duplicate " + c.id);
  c.hero =
    require("../static/data/atlas-covers.json")[c.id] ||
    art.get(c.id)?.path ||
    "/images/handpainted/" +
      (c.series === "tea" ? "tea-sprig" : "incense-burner") +
      ".webp";
  c.text = c.sections.map((s) => s.markdown || "").join("\n");
  const meta = {
    id: c.id,
    title: c.title,
    series: c.series,
    kind: c.kind,
    unitId: c.unitId || "",
    group: c.group,
    level: c.level || null,
    domain: c.domain || "",
    hero: c.hero,
    sectionCount: c.sections.length,
    summary:
      c.summary ||
      c.sections
        .map((s) => s.markdown.replace(/<!--[^]*?-->/g, ""))
        .join("\n\n")
        .split(/\n\s*\n/)
        .find(
          (p) =>
            p.trim().length > 45 &&
            !/^(?:#|!|\*|内容 ID|新增版本|关联课|原题|[|])/.test(p.trim()),
        )
        ?.replace(/[#*\n]/g, " ")
        .slice(0, 100) ||
      "慢慢读，细细观。",
    search: (c.title + " " + c.text).replace(/<!--[^]*?-->/g, ""),
  };
  entries.push(meta);
  delete c.text;
  fs.writeFileSync(
    path.join(out, "data", encodeURIComponent(c.id) + ".json"),
    JSON.stringify(c),
  );
}
for (const p of idx.packages) {
  const b = req(p.packageRoot + "/data/content");
  for (const q of b.questions) questions[q.id] = q;
  for (const c of b.contents) {
    const media = b.media.map((m) => ({ ...m }));
    const sections = c.sections.map((s) => ({
      ...s,
      markdown: s.markdown.replace(
        /!\[([^\]]*)\]\(([^\s)]+)\)/g,
        (all, alt, url) => {
          const key = decodeURIComponent(url),
            mapped = b.assetPaths[key] || b.assetPaths[key.split("/").pop()];
          if (!mapped) throw Error("Missing image " + url);
          if (!fs.existsSync(path.join(mini, mapped)))
            throw Error("Missing asset " + mapped);
          return "![" + alt + "](assets" + mapped + ")";
        },
      ),
    }));
    add({
      ...c,
      unitId: c.unit_id,
      group: "curriculum",
      sections,
      sources: b.sources.filter((s) => c.source_ids.includes(s.id)),
      media: media.filter(m => sections.some(s => s.markdown.includes("(assets" + m.path + ")"))),
      questionIds: b.questions
        .filter((q) => q.lesson_id === c.id)
        .map((q) => q.id),
    });
  }
}
const knowledge = req("packageKnowledge/data/knowledge");
for (const e of knowledge.entries)
  add({
    ...e,
    series: e.kind,
    kind: "atlas",
    group: "knowledge",
    sections: [{ heading: "正文", markdown: e.body }],
    sources: knowledge.sources.filter((s) => e.source_ids.includes(s.id)),
    questionIds: [],
  });
const ref = req("packageReference/data/v28");
for (const e of ref.lessons)
  add({
    ...e,
    series: /茶|tea/.test(e.domain) ? "tea" : "incense",
    kind: "lesson",
    group: "reference",
    sections: [{ heading: "正文", markdown: e.body_md }],
    sources: ref.sources.filter((s) => e.source_ids.includes(s.id)),
    questionIds: e.question_ids,
  });
for (const q of ref.questions)
  questions[q.id] = { ...q, text: q.prompt, type: q.answer_format };
const tea = req("data/tea34"),
  inc = req("data/xiang32");
for (const m of tea.modules)
  for (const e of m.lessons)
    add({
      ...e,
      series: "tea",
      kind: "lesson",
      group: "legacy",
      unitId: m.id,
      sections: [{ heading: "正文", markdown: e.body_md }],
      sources: [],
      questionIds: tea.questions
        .filter((q) => q.lesson_id === e.id)
        .map((q) => q.question_id),
      media: tea.artworks.filter((a) => a.lessonId === e.id),
    });
for (const e of inc.lessons)
  add({
    ...e,
    series: "incense",
    kind: "lesson",
    group: "legacy",
    unitId: e.module_id,
    sections: [{ heading: "正文", markdown: e.body_md }],
    sources: [],
    questionIds: inc.questions
      .filter((q) => q.lesson_id === e.id)
      .map((q) => q.question_id),
  });
for (const q of [...tea.questions, ...inc.questions])
  questions[q.question_id] = {
    ...q,
    id: q.question_id,
    text: q.question || q.prompt,
    type: q.type || "single_choice",
  };
const curriculum = require(path.join(server, "curriculum"));
const answers = {};
for (const id of Object.keys(questions)) {
  const a = curriculum.answerFor(id);
  if (a) {
    const f = curriculum.feedbackFor(a, -1);
    answers[id] = {
      index: a.correct_option_index,
      explanation: f.reference || f.explanation || "",
      manual: f.manual,
    };
  }
}
for (const f of ["answers.json", "answers-xiang.json"])
  for (const [id, a] of Object.entries(require(path.join(server, "data", f))))
    answers[id] = {
      index: a.correct_option_index,
      explanation: a.reference || a.explanation || a.answer || "",
      manual: a.type === "open_response",
    };
for (const q of require(path.join(server, "data/v28-questions.json")))
  answers[q.id] = {
    index:
      q.correct_option_id == null
        ? null
        : q.options.findIndex((o) => o.id === q.correct_option_id),
    explanation: q.answer_md,
    manual: q.feedback_mode !== "auto",
  };
fs.writeFileSync(
  path.join(out, "data/index.json"),
  JSON.stringify({
    version: "1.23.1-web",
    sourceVersion: manifest.sourceVersion,
    units: idx.units,
    entries,
    glossary: ref.glossary,
    reviewSets: ref.review_sets,
    stages: ref.stage_assessments,
  }),
);
fs.writeFileSync(
  path.join(out, "data/questions.json"),
  JSON.stringify({ questions, answers }),
);
// Pure domain rules only. Cloud SDK, credentials and deployment configuration are excluded.
for (const f of [
  "core.js",
  "curriculum.js",
  "collection/domain.js",
  "tasting/domain.js",
  "tasting/time.js",
  "tasting/backup.js",
  "data/curriculum-r11.js",
  "data/tasting-lessons.json",
  "data/knowledge-index.json",
]) {
  const dest = path.join("src/domain", f);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(server, f), dest);
}
fs.writeFileSync(
  "src/domain/package.json",
  JSON.stringify({ type: "commonjs" }),
);
// The original 80-write limit belongs to CloudBase. IndexedDB commits one whole snapshot atomically.
for (const f of [
  "src/domain/tasting/backup.js",
  "src/domain/tasting/domain.js",
]) {
  let s = fs.readFileSync(f, "utf8");
  s = s.replace(/if\(changes.length>80\)d.fail\([^;]+;/g, "");
  fs.writeFileSync(f, s);
}
fs.copyFileSync(
  path.join(mini, "packageCollection/utils/forms.js"),
  "src/forms.cjs",
);
fs.copyFileSync(
  path.join(mini, "utils/journal-compose.js"),
  "src/journal-fields.cjs",
);
manifest.contentCount = entries.length;
manifest.questionCount = Object.keys(questions).length;
fs.writeFileSync("SOURCE-MANIFEST.json", JSON.stringify(manifest, null, 2));
console.log({
  entries: entries.length,
  questions: Object.keys(questions).length,
  assets: Object.keys(manifest.files).length,
});
