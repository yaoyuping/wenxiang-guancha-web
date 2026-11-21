import { marked } from "marked";
import DOMPurify from "dompurify";
import model from "./state.cjs";
import forms from "./forms.cjs";
import journalFields from "./journal-fields.cjs";
import { openStore, saveStore, readStore } from "./storage.js";
const { d, t, core, counts, clone } = model;
const $ = (s, r = document) => r.querySelector(s),
  $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const id = () => crypto.randomUUID(),
  time = () => new Date().toISOString(),
  day = () => new Date().toLocaleDateString("sv-SE");
const label = {
  tea: "茶",
  incense: "香",
  daily: "日常",
  equipment: "器物",
  teaware: "茶器",
  incenseware: "香器",
  book: "书",
  other: "其他",
};
const kindOptions = Object.entries(label).filter(([k]) => k !== "daily");
let state,
  dbReady = false,
  index,
  questionData,
  routeToken = 0,
  query = "",
  filter = "",
  articleCache = new Map(),
  dirty = false,
  importPlan = null;
const main = $("#main"),
  dialog = $("#dialog");
const asset = (p) => "assets/" + String(p || "").replace(/^\//, "");
const url = (id) => "#article/" + encodeURIComponent(id);
const meta = (id) => index.entries.find((e) => e.id === id);
const illustration = (key, cls = "") =>
  `<img class="illustration ${cls}" src="assets/images/handpainted/${key}.webp" alt="${esc({ gaiwan: "盖碗", "tea-sprig": "茶枝", "incense-burner": "香炉", books: "书册" }[key] || "香茶手绘意象")}" loading="lazy">`;
const badge = (s) => `<span class="badge">${esc(s)}</span>`;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 4500);
}
function error(e) {
  console.error(e);
  toast(e.message || String(e));
  const target = $(".form-error", dialog);
  if (target) target.textContent = e.message || String(e);
}
function html(md) {
  return DOMPurify.sanitize(
    marked.parse(String(md || "").replace(/<!--[^]*?-->/g, "")),
    {
      FORBID_TAGS: ["style", "iframe", "form", "input", "script"],
      FORBID_ATTR: ["style"],
    },
  );
}
function navigate(hash) {
  if (dirty && !confirm("还有未保存的输入，确定离开？")) return;
  dirty = false;
  location.hash = hash;
}
async function commit(fn, revision = state.revision) {
  if (!dbReady) throw Error("当前浏览器未开放本地存储，暂时无法保存。");
  state = await saveStore(revision, fn);
  return state;
}
function closeDialog() {
  if (dirty && !confirm("输入尚未保存，确定关闭？")) return;
  dirty = false;
  dialog.close();
  dialog.innerHTML = "";
}
function modal(title, body) {
  dialog.innerHTML = `<header class="dialog-head"><h2>${esc(title)}</h2><button class="icon-btn" type="button" data-close aria-label="关闭窗口">×</button></header>${body}<p class="form-error" role="alert"></p>`;
  if (!dialog.open) dialog.showModal();
  dialog.querySelector("[data-close]").onclick = closeDialog;
  dialog.oncancel = (e) => {
    if (dirty) {
      e.preventDefault();
      closeDialog();
    }
  };
  dialog.oninput = () => {
    dirty = true;
  };
}
function field(key, title, value = "", options = {}) {
  const {
    type = "text",
    required = false,
    choices,
    multiline = false,
    hint = "",
    max = 3000,
    readonly = false,
  } = options;
  const v = value == null ? "" : String(value);
  return `<label class="field"><span>${esc(title)}${required ? " <small>必填</small>" : ""}</span>${choices ? `<select name="${key}" ${readonly ? "disabled" : ""}>${choices.map(([v1, l]) => `<option value="${esc(v1)}" ${v === String(v1) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>` : multiline ? `<textarea name="${key}" maxlength="${max}" rows="4" ${required ? "required" : ""}>${esc(v)}</textarea>` : `<input name="${key}" value="${esc(v)}" type="${type}" maxlength="${max}" ${required ? "required" : ""} ${readonly ? "readonly" : ""} ${type === "number" ? 'step="any"' : ""}>`}${hint ? `<small>${esc(hint)}</small>` : ""}</label>`;
}
function bindForm(onSubmit) {
  const form = $("form", dialog);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const button = $("[type=submit]", form);
    button.disabled = true;
    try {
      await onSubmit(Object.fromEntries(new FormData(form)));
      dirty = false;
      dialog.close();
      toast("已保存到本机");
      await render();
    } catch (e) {
      error(e);
    } finally {
      button.disabled = false;
    }
  };
}
function blank(title, text, action = "") {
  return `<section class="empty">${illustration("books")}<h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</section>`;
}
function card(e) {
  const done =
    state.learning.progress[e.id]?.read || state.extra.progress[e.id]?.read;
  return `<a class="content-card" href="${url(e.id)}"><div class="card-art"><img src="${asset(e.hero)}" alt="${esc(e.title)} · 配图" loading="lazy"></div><div class="card-body"><div class="eyebrow">${e.kind === "atlas" ? "图鉴" : e.id.includes("REVIEW") ? "单元回顾" : label[e.series] + "学"}${done ? " · 已读" : ""}</div><h3>${esc(e.title)}</h3><p>${esc(e.summary?.replace(/!\[.*?\]\(.*?\)/g, "").slice(0, 65) || "慢慢读，细细观。")}</p><span class="card-link">打开阅读 <span>↗</span></span></div></a>`;
}
function sectionHead(kicker, title, sub = "", right = "") {
  return `<div class="section-heading"><div><div class="eyebrow">${esc(kicker)}</div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ""}</div>${right}</div>`;
}
function functionCards(items, cls = "") {
  return `<div class="function-grid ${cls}">${items.map(([href, title, text, art, featured]) => `<a class="function-card${featured ? " featured" : ""}" href="${esc(href)}"><img src="assets/images/handpainted/${art}.webp" alt="" loading="lazy"><div class="function-copy"><strong>${esc(title)}</strong><span>${esc(text)}</span></div><span class="function-arrow" aria-hidden="true">↗</span></a>`).join("")}</div>`;
}
function illustratedEmpty(art, title, text, href, action) {
  return `<div class="illustrated-empty">${illustration(art)}<div><h3>${esc(title)}</h3><p>${esc(text)}</p><a class="text-link" href="${href}">${esc(action)} →</a></div></div>`;
}
function shell() {
  const current = location.hash.slice(1).split("/")[0] || "home";
  const active =
    {
      backup: "my",
      glossary: "my",
      review: "my",
      item: "collection",
      batch: "collection",
    }[current] || current;
  const nav = [
    ["home", "书房"],
    ["tea", "茶学"],
    ["incense", "香学"],
    ["atlas", "图鉴"],
    ["collection", "珍藏"],
    ["journal", "手记"],
    ["my", "我的"],
  ];
  $("#header").innerHTML =
    `<a class="brand" href="#home"><span class="seal">闻香<br>观茶</span><span>闻香观茶<small>一盏茶 · 一炉香 · 一页书</small></span></a><form id="global-search" role="search"><input aria-label="搜索课程、图鉴与正文" placeholder="寻一味香，读一页茶…" name="q" autocomplete="off"><button aria-label="搜索">⌕</button></form><a class="save-status" href="#backup"><i></i>${dbReady ? "本机保存" : "存储不可用"}</a>`;
  $("#global-search").onsubmit = (e) => {
    e.preventDefault();
    navigate("#search/" + encodeURIComponent(new FormData(e.target).get("q")));
  };
  $("#sidebar").innerHTML =
    `<div class="sidebar-label">香 茶 书 房</div>${nav.map(([p, n]) => `<a href="#${p}" class="${current === p ? "active" : ""}"><span>${n}</span><span>↗</span></a>`).join("")}<div class="sidebar-foot"><p>静坐听风<br>闲来闻香</p><small>网页版 1.23.3<br>资料与时光，留在身边。</small><a href="#backup">备份与恢复 →</a></div>`;
  $("#mobile-nav").innerHTML = [
    ["home", "书房", "books"],
    ["tea", "茶学", "tea-sprig"],
    ["incense", "香学", "incense-burner"],
    ["collection", "珍藏", "storage"],
    ["my", "我的", "incense-journal"],
  ]
    .map(
      ([p, n, art]) =>
        `<a href="#${p}" class="${active === p ? "active" : ""}" ${active === p ? 'aria-current="page"' : ""}><img src="assets/images/handpainted/${art}.webp" alt=""><span>${n}</span></a>`,
    )
    .join("");
}
async function home() {
  const read = Object.values(state.learning.progress).filter(
    (x) => x.read,
  ).length;
  const recent = [
    ...Object.entries(state.learning.progress),
    ...Object.entries(state.extra.progress),
  ]
    .filter(([id]) => meta(id))
    .sort((a, b) =>
      String(b[1].updatedAt).localeCompare(String(a[1].updatedAt)),
    )[0];
  main.innerHTML = `<div class="home-top"><span class="eyebrow">香 茶 日 常 <span class="home-english">/ WENXIANG GUANCHA</span></span><span>${new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" })}</span></div>
    <section class="hero"><div class="hero-copy"><div class="eyebrow">以香静心 · 以茶观物</div><h1>把日子，<br>泡得慢一些。</h1></div><div class="hero-art">${illustration("home-tea")}<span>闲坐有味，草木有情。</span></div><p class="hero-description">从一片叶、一缕香开始。<br>读懂来处，认真感受，留下自己的观察。</p><div class="button-row hero-actions"><a class="button primary" href="${recent ? url(recent[0]) : "#tea"}">${recent ? "继续上次阅读" : "从一杯茶开始"} <span>→</span></a><a class="text-link" href="#journal">记下此刻 ↗</a></div><span class="hero-index">01 / 香茶书房</span></section>
    <div class="stats-strip"><div><strong>12</strong><span>香茶单元</span></div><div><strong>87</strong><span>课程与回顾</span></div><div><strong>36</strong><span>关联图鉴</span></div><div><strong>${read}</strong><span>已经读过</span></div></div><div class="section-heading small"><div><div class="eyebrow">循 序 入 门</div><h2>今日，从这里开始</h2></div><a class="text-link" href="#library">全部内容 ↗</a></div><div class="card-grid home-courses">${["T-U01-L01", "I-U01-L01", "K-TEA-GAIWAN"].map((id) => card(meta(id))).join("")}</div>
    <section class="journal-invite"><div><span class="eyebrow">清 赏 手 记</span><h2>感受真实，就很好。</h2><p>记一泡茶的香气，或一炉香的变化。</p><a class="text-link" href="#journal">打开我的手记 →</a></div>${illustration("incense-journal")}</section>
    <div class="section-heading small"><div><div class="eyebrow">书 房 小 事</div><h2>喜欢的，都有安放处</h2></div></div>${functionCards(
      [
        ["#atlas", "草木图鉴", "认一味香，识一片叶", "tea-sprig"],
        ["#glossary", "术语索引", "读懂草木与器物的名字", "tea-canon"],

        ["#review", "复习与进阶", "温故一遍，再读深一些", "tea-assessment"],
      ],
    )}<p class="quiet-note">个人记录仅存于当前浏览器。建议定期到「备份与恢复」下载备份，换设备时再导入。</p>`;
}
function unitsPage(series) {
  const units = index.units.filter((u) => u.series === series);
  main.innerHTML =
    sectionHead(
      series === "tea" ? "TEA STUDIES" : "INCENSE STUDIES",
      series === "tea" ? "循着一片叶，读懂茶。" : "循着一缕香，认识草木。",
      "六个单元，慢慢读；保留每一课的原文、配图与出处。",
      illustration(
        series === "tea" ? "gaiwan" : "incense-burner",
        "heading-art",
      ),
    ) +
    `<div class="unit-grid">${units.map((u, i) => `<a class="unit-card" href="#unit/${u.id}"><div class="unit-meta"><span class="unit-number">0${i + 1}</span><span class="eyebrow">${u.id} · ${u.lesson_count} 课</span></div><div class="unit-copy"><h2>${esc(u.title)}</h2><p>${esc(u.description)}</p><span class="text-link">进入单元 <span aria-hidden="true">→</span></span></div><img src="${asset(meta(u.lesson_ids[0]).hero)}" alt="${esc(u.title)}手绘意象" loading="lazy"></a>`).join("")}</div><div class="section-heading small"><div><div class="eyebrow">再 翻 一 页</div><h2>读过之后，继续探索</h2></div></div>${functionCards(
      [
        [
          "#atlas/" + series,
          label[series] + "学图鉴",
          "循着图画，认识草木器物",
          series === "tea" ? "gaiwan" : "herbs",
        ],
        ["#library/" + series, "课程书架", "原版课程与进阶资料", "books"],
        ["#glossary", "术语索引", "给所见所闻一个名字", "tea-canon"],
        ["#review", "复习与进阶", "带着问题，回看一遍", "tea-assessment"],
      ],
    )}`;
}
function unitPage(id) {
  const u = index.units.find((x) => x.id === id);
  if (!u) throw Error("没有找到这个单元");
  main.innerHTML =
    `<a class="back" href="#${u.series}">← ${label[u.series]}学</a>` +
    sectionHead("学习单元 " + u.id, u.title, u.description) +
    `<div class="lesson-list">${[...u.lesson_ids, u.review_id]
      .map((id, i) => {
        const e = meta(id);
        return `<a href="${url(id)}"><span class="lesson-index">${String(i + 1).padStart(2, "0")}</span><div><span class="eyebrow">${id.includes("REVIEW") ? "单元回顾" : "课程"}</span><h3>${esc(e.title)}</h3></div><span>${state.learning.progress[id]?.read ? "已读 ✓" : "→"}</span></a>`;
      })
      .join(
        "",
      )}</div><h2>带着问题，翻一翻图鉴</h2><div class="card-grid">${u.atlas_ids.map((id) => card(meta(id))).join("")}</div>`;
}
async function article(id, token) {
  let e = articleCache.get(id);
  if (!e) {
    const r = await fetch("data/" + encodeURIComponent(id) + ".json");
    if (!r.ok) throw Error("内容暂时无法读取。离线时请先联网打开这篇内容。");
    e = await r.json();
    articleCache.set(id, e);
  }
  if (token !== routeToken) return;
  const bodyImages = new Set(
    [
      ...e.sections
        .map((s) => s.markdown)
        .join("\n")
        .matchAll(/!\[[^\]]*\]\(([^\s)]+)/g),
    ].map((m) => m[1]),
  );
  const seenMedia = new Set();
  e = {
    ...e,
    media: (e.media || []).filter((m) => {
      const path = asset(m.path);
      if (!bodyImages.has(path) || seenMedia.has(path)) return false;
      seenMedia.add(path);
      return true;
    }),
  };
  const bookmarked = [
    ...state.learning.bookmarks,
    ...state.learning.referenceBookmarks,
    ...state.extra.bookmarks,
  ].includes(id);
  const read =
    state.learning.progress[id]?.read || state.extra.progress[id]?.read;
  main.innerHTML = `<div class="reading-top"><a class="back" href="${e.unitId && index.units.some((u) => u.id === e.unitId) ? "#unit/" + e.unitId : "#library"}">← 返回目录</a><div class="button-row"><button id="bookmark">${bookmarked ? "已收藏 ★" : "收藏 ☆"}</button><button id="font-size" aria-label="调整字号">字号 A+</button></div></div><div class="reading-layout"><article class="article"><header class="article-heading"><div class="eyebrow">${e.group === "curriculum" ? "香茶课程" : "资料书架"} / ${esc(e.id)}</div><h1>${esc(e.title)}</h1><p>${badge(label[e.series] + "学")}${badge(e.kind === "atlas" ? "图鉴" : "阅读")}${badge(read ? "已读" : "待细读")}</p></header>${e.learning_objectives?.length ? `<details class="objectives"><summary>这一课，带着这些问题读</summary>${html(e.learning_objectives.map((x) => "- " + x).join("\n"))}</details>` : ""}<details class="chapter-menu"><summary>章节目录 · ${e.sections.length} 节</summary><nav aria-label="本课章节">${e.sections.map((s, i) => `<button data-chapter="${i}">${i + 1}. ${esc(s.heading || "正文")}</button>`).join("")}</nav></details><div class="chapter-status" aria-live="polite"></div><div class="article-body">${e.sections.map((s, i) => `<section id="section-${i}">${html(s.markdown)}</section>`).join("")}</div><div class="chapter-controls"><button id="previous-chapter">← 上一节</button><button id="next-chapter">下一节 →</button></div>${e.media?.length ? `<details class="source-panel"><summary>配图来源与说明（${e.media.length}）</summary>${e.media.map((m) => `<div><h4>${esc(m.title || m.alt)}</h4>${m.path ? `<img class="source-thumb" src="${asset(m.path)}" alt="${esc(m.title || m.alt)}" loading="lazy">` : ""}<p>${esc(m.caption || "")}</p><small>${esc([m.author || m.creator, m.license, m.changes || m.display_changes].filter(Boolean).join(" · "))}</small>${safeLink(m.source_url || m.sourceUrl, "来源页面")}</div>`).join("")}</details>` : ""}<details class="source-panel"><summary>本篇出处与阅读边界</summary>${(e.sources || []).map((s) => `<div><h4>${esc(s.book_title || s.title || s.id)}</h4><p>${esc(typeof s.locator === "object" ? JSON.stringify(s.locator) : s.locator || s.anchor || "")}</p><p>${esc(s.distinction || s.limits || s.supports || "")}</p>${safeLink(s.url || s.source_url, "查阅来源")}</div>`).join("") || "<p>沿用原课程的正文及出处标记，未新增书目核验。</p>"}${e.publication_state || e.review_status ? `<p class="muted">原稿状态：${esc(e.publication_state || e.review_status)}</p>` : ""}</details><div class="reading-actions"><button class="primary" id="mark-read">${read ? "标记为未读" : "已读，留下进度 ✓"}</button>${e.questionIds?.length ? `<a class="button" href="#quiz/${encodeURIComponent(id)}">课后练习 · ${e.questionIds.length} 题</a>` : ""}<button id="add-note">写一则笔记</button></div><section class="article-notes"><h2>我的读书笔记</h2>${notesFor(id)}</section></article><aside class="toc"><div class="eyebrow">本 篇 目 录</div>${e.sections.map((s, i) => `<button data-section="${i}">${esc(s.heading || "正文")}</button>`).join("")}<span class="muted">原文与配图沿用 V1.23</span></aside></div>`;
  $(".article-body")
    .querySelectorAll("img")
    .forEach((img) => {
      img.loading = "lazy";
      img.tabIndex = 0;
      img.onclick = () => showImage(img.src, img.alt);
      img.onkeydown = (e) => {
        if (e.key === "Enter") img.click();
      };
    });
  $$('a[href^="http"]', main).forEach((a) => {
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  });
  let chapter = 0;
  const mobileReading = matchMedia("(max-width: 760px)");
  const showChapter = (next, scroll = true) => {
    chapter = Math.max(0, Math.min(next, e.sections.length - 1));
    $$(".article-body > section").forEach((section, i) => {
      section.hidden = mobileReading.matches && i !== chapter;
    });
    $(".chapter-status").textContent =
      `${chapter + 1} / ${e.sections.length} · ${e.sections[chapter]?.heading || "正文"}`;
    $("#previous-chapter").disabled = chapter === 0;
    $("#next-chapter").disabled = chapter === e.sections.length - 1;
    $$("[data-chapter]").forEach((b) =>
      b.setAttribute(
        "aria-current",
        Number(b.dataset.chapter) === chapter ? "step" : "false",
      ),
    );
    if (scroll) $("#section-" + chapter).scrollIntoView({ block: "start" });
  };
  $$("[data-chapter], [data-section]").forEach(
    (b) =>
      (b.onclick = () => {
        $(".chapter-menu").open = false;
        showChapter(Number(b.dataset.chapter ?? b.dataset.section));
      }),
  );
  $("#previous-chapter").onclick = () => showChapter(chapter - 1);
  $("#next-chapter").onclick = () => showChapter(chapter + 1);
  mobileReading.addEventListener("change", () => {
    if (token === routeToken) showChapter(chapter, false);
  });
  showChapter(0, false);
  $("#font-size").onclick = () => {
    $(".article").classList.toggle("large-type");
  };
  $("#bookmark").onclick = async () => {
    try {
      await commit((s) => {
        s.extra.bookmarks = bookmarked
          ? s.extra.bookmarks.filter((x) => x !== id)
          : [...new Set([...s.extra.bookmarks, id])];
        if (bookmarked) {
          s.learning.bookmarks = s.learning.bookmarks.filter((x) => x !== id);
          s.learning.referenceBookmarks = s.learning.referenceBookmarks.filter(
            (x) => x !== id,
          );
        }
      });
      toast(bookmarked ? "已取消收藏" : "已收藏到本机");
      await render(false);
    } catch (e) {
      error(e);
    }
  };
  $("#mark-read").onclick = async () => {
    try {
      await commit((s) => {
        if (e.group === "curriculum" || e.group === "legacy")
          s.learning = core.patch(
            s.learning,
            { type: "progress", lessonId: id, field: "read", value: !read },
            {},
          ).state;
        else s.extra.progress[id] = { read: !read, updatedAt: time() };
      });
      toast("阅读进度已保存");
      await render(false);
    } catch (e) {
      error(e);
    }
  };
  $("#add-note").onclick = () => noteForm(id);
  bindNoteButtons();
}
function safeLink(href, title) {
  return /^https?:\/\//.test(href || "")
    ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(title)} ↗</a>`
    : "";
}
function notesFor(lesson) {
  return (
    [...state.learning.notes, ...state.extra.notes]
      .filter((n) => !lesson || n.lessonId === lesson)
      .map(
        (n) =>
          `<div class="note-card"><small>${esc(meta(n.lessonId)?.title || n.lessonId)} · ${esc(n.updatedAt?.slice(0, 10))}</small><p class="pre-wrap">${esc(n.body)}</p><button data-note="${esc(n.id)}">编辑笔记</button></div>`,
      )
      .join("") || '<p class="muted">还没有笔记，留一句自己的理解吧。</p>'
  );
}
function bindNoteButtons() {
  $$("[data-note]", main).forEach(
    (b) =>
      (b.onclick = () => {
        const n = [...state.learning.notes, ...state.extra.notes].find(
          (n) => n.id === b.dataset.note,
        );
        noteForm(n.lessonId, n);
      }),
  );
}
function noteForm(lesson, n) {
  const rev = state.revision;
  modal(
    n ? "编辑读书笔记" : "写一则读书笔记",
    `<form>${field("body", "我的理解", n?.body || "", { multiline: true, max: 8000, required: true })}<button type="submit" class="primary">保存笔记</button>${n ? '<button type="button" id="delete-note" class="danger">删除笔记</button>' : ""}</form>`,
  );
  bindForm(async (v) => {
    await commit((s) => {
      const row = {
        id: n?.id || id(),
        lessonId: lesson,
        body: v.body,
        createdAt: n?.createdAt || time(),
        updatedAt: time(),
      };
      s.learning.notes = s.learning.notes.filter((x) => x.id !== row.id);
      s.extra.notes = [...s.extra.notes.filter((x) => x.id !== row.id), row];
    }, rev);
  });
  if (n)
    $("#delete-note").onclick = async () => {
      if (!confirm("删除这则笔记？已导出的备份不受影响。")) return;
      try {
        await commit((s) => {
          s.learning.notes = s.learning.notes.filter((x) => x.id !== n.id);
          s.extra.notes = s.extra.notes.filter((x) => x.id !== n.id);
        }, rev);
        dirty = false;
        dialog.close();
        render();
      } catch (e) {
        error(e);
      }
    };
}
function listingPage(type, series) {
  let rows = index.entries;
  if (type === "atlas") rows = rows.filter((e) => e.kind === "atlas");
  if (series) rows = rows.filter((e) => e.series === series);
  const title =
    type === "atlas" ? "草木与器物，翻开细看。" : "书架上的香茶世界";
  main.innerHTML =
    sectionHead(
      type === "atlas" ? "ILLUSTRATED ATLAS" : "READING LIBRARY",
      title,
      type === "atlas"
        ? "关联图鉴与百科原文，留住材料的来处。"
        : "新课程、原版课程与进阶资料，都在这里。",
    ) +
    `<div class="filter-bar"><input id="list-query" aria-label="筛选内容" placeholder="按名称或正文关键词查找"><select id="list-group" aria-label="内容类型"><option value="">全部内容</option><option value="curriculum">新版课程与图鉴</option><option value="reference">进阶研读</option><option value="knowledge">知识百科</option><option value="legacy">原版课程</option></select></div><p id="list-count" class="muted"></p><div id="list-results" class="card-grid"></div><button id="load-more">继续加载</button>`;
  let limit = 24;
  const update = () => {
    const q = $("#list-query").value.trim().toLowerCase(),
      g = $("#list-group").value;
    const found = rows.filter(
      (e) =>
        (!g || e.group === g) &&
        q.split(/\s+/).every((w) => e.search.toLowerCase().includes(w)),
    );
    $("#list-count").textContent = `共 ${found.length} 篇`;
    $("#list-results").innerHTML =
      found.slice(0, limit).map(card).join("") ||
      blank("暂时没有找到", "换一个关键词试试。");
    $("#load-more").hidden = limit >= found.length;
  };
  $("#list-query").oninput = () => {
    limit = 24;
    update();
  };
  $("#list-group").onchange = () => {
    limit = 24;
    update();
  };
  $("#load-more").onclick = () => {
    limit += 24;
    update();
  };
  update();
}
function searchPage(q) {
  main.innerHTML =
    sectionHead("SEARCH", "找一页，慢慢读。", `搜索「${q}」`) +
    `<div class="search-results"></div>`;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = words.length
    ? index.entries.filter((e) =>
        words.every((w) => e.search.toLowerCase().includes(w)),
      )
    : [];
  $(".search-results").innerHTML =
    `<p class="muted">找到 ${rows.length} 篇内容</p><div class="lesson-list">${rows.map((e) => `<a href="${url(e.id)}"><div><span class="eyebrow">${esc(e.id)} · ${label[e.series]}学</span><h3>${esc(e.title)}</h3><p>${esc(e.search.slice(Math.max(0, e.search.toLowerCase().indexOf(words[0]) - 20), Math.max(0, e.search.toLowerCase().indexOf(words[0]) - 20) + 160))}</p></div><span>→</span></a>`).join("")}</div>`;
}
async function quizPage(id, token) {
  if (!questionData)
    questionData = await (await fetch("data/questions.json")).json();
  const review = index.reviewSets.find((x) => x.id === id);
  let e = review
    ? { id, title: review.title, questionIds: review.question_ids }
    : articleCache.get(id);
  const backHref = review ? "#review" : url(id);
  if (!e) {
    e = await (await fetch("data/" + encodeURIComponent(id) + ".json")).json();
    articleCache.set(id, e);
  }
  if (token !== routeToken) return;
  const questions = (e.questionIds || [])
    .map((id) => questionData.questions[id])
    .filter(Boolean);
  if (!questions.length) {
    main.innerHTML = blank(
      "本篇没有独立练习",
      "可以返回正文写一则读书笔记。",
      `<a href="${backHref}" class="button">返回正文</a>`,
    );
    return;
  }
  let current = 0,
    correct = 0;
  const draw = () => {
    const q = questions[current];
    if (!q) {
      main.innerHTML =
        sectionHead(
          "PRACTICE",
          "这一页，读进心里。",
          `已完成 ${questions.length} 题；选择题答对 ${correct} 题，开放题请对照参考要点自评。`,
        ) + `<a class="button primary" href="${backHref}">返回正文</a>`;
      return;
    }
    const options = (q.options || []).map((o) =>
      typeof o === "string" ? o : o.text || o.label || o.value,
    );
    const choice =
      ["single_choice", "single"].includes(q.type) || options.length > 0;
    main.innerHTML =
      `<a class="back" href="${backHref}">← 返回正文</a>` +
      sectionHead(
        "课后练习",
        e.title,
        `${current + 1} / ${questions.length} · 自学练习，答案保存在网页中`,
      ) +
      `<div class="quiz-card"><h2>${esc(q.text || q.prompt)}</h2><form id="quiz-form">${choice ? options.map((o, i) => `<label class="choice"><input type="radio" name="choice" value="${i}" required><span>${String.fromCharCode(65 + i)}.</span>${esc(o)}</label>`).join("") : field("body", "写下你的理解", "", { multiline: true, max: 8000, required: true })}<button class="primary" type="submit">保存作答并查看解析</button></form><div id="feedback" aria-live="polite"></div></div>`;
    $("#quiz-form").onsubmit = async (event) => {
      event.preventDefault();
      const btn = $("[type=submit]", event.target);
      btn.disabled = true;
      try {
        const v = Object.fromEntries(new FormData(event.target)),
          a = questionData.answers[q.id],
          selected = choice ? Number(v.choice) : null;
        const result = choice && a?.index != null ? selected === a.index : null;
        await commit((s) =>
          s.extra.attempts.push({
            id: crypto.randomUUID(),
            lessonId: id,
            questionId: q.id,
            choice: selected,
            body: v.body || "",
            correct: result,
            createdAt: time(),
          }),
        );
        if (result) correct++;
        const body =
          typeof a?.explanation === "string"
            ? a.explanation
            : JSON.stringify(
                a?.explanation || "此题暂无可用解析，请参照正文。",
                null,
                2,
              );
        $("#feedback").innerHTML =
          `<div class="feedback ${result === false ? "incorrect" : ""}"><h3>${result === true ? "回答正确" : result === false ? "再对照正文想一想" : "对照要点，自己评一评"}</h3>${choice && a?.index != null ? `<p>参考选项：${String.fromCharCode(65 + a.index)}</p>` : ""}${html(body)}<p class="muted">作答已保存到本机。</p><button id="next-question" class="primary">${current === questions.length - 1 ? "完成练习" : "下一题 →"}</button></div>`;
        $("#next-question").onclick = () => {
          current++;
          draw();
        };
      } catch (e) {
        error(e);
        btn.disabled = false;
      }
    };
  };
  draw();
}
function collectionPage() {
  const rows = state.collection.items;
  main.innerHTML =
    sectionHead(
      "MY COLLECTION",
      "喜欢的，认真留存。",
      "茶、香、器物与书，记下每一件的来处。",
      '<button class="primary" id="new-item">＋ 添一件珍藏</button>',
    ) +
    `<div class="filter-bar"><input id="collection-query" placeholder="找一件藏品…" aria-label="搜索珍藏"><select id="collection-kind" aria-label="珍藏类别"><option value="">全部类别</option>${kindOptions.map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select></div><div class="card-grid" id="collection-list"></div>${state.learning.collections.length ? '<details class="source-panel"><summary>旧版藏品文字（保留原记录）</summary>' + state.learning.collections.map((c) => `<div><h3>${esc(c.name)}</h3><p class="pre-wrap">${esc(c.notes)}</p><p>${esc(c.source)}</p></div>`).join("") + "</details>" : ""}`;
  $("#new-item").onclick = () => newItem();
  const update = () => {
    const q = $("#collection-query").value,
      k = $("#collection-kind").value;
    const found = rows.filter(
      (r) =>
        (!k || r.kind === k) &&
        [r.name, r.category, r.region, r.notes].join(" ").includes(q),
    );
    $("#collection-list").innerHTML =
      found
        .map((r) => {
          const p = state.photos.find((p) => p.entityId === r.id),
            b = state.collection.batches.filter((b) => b.itemId === r.id);
          return `<a class="content-card" href="#item/${r.id}"><div class="card-art">${p ? `<img src="${p.data}" alt="${esc(p.caption || r.name)}" loading="lazy">` : illustration(r.kind === "tea" ? "green-tea" : r.kind === "incense" ? "sandalwood" : "gaiwan")}</div><div class="card-body"><div class="eyebrow">${label[r.kind]} · ${esc(r.category || "尚未分类")}</div><h3>${esc(r.name)}</h3><p>${esc(r.observation || r.region || "等待你写下更多故事。")}</p><span class="card-link">${b.length} 个批次 <span>↗</span></span></div></a>`;
        })
        .join("") ||
      blank("还没有这类珍藏", "先从手边的一件开始，知道多少就记多少。");
  };
  $("#collection-query").oninput = update;
  $("#collection-kind").onchange = update;
  update();
}
function newItem() {
  modal(
    "添一件珍藏",
    `<div class="kind-picker">${kindOptions.map(([k, n]) => `<button data-kind="${k}">${n}</button>`).join("")}</div>`,
  );
  $$("[data-kind]", dialog).forEach(
    (b) => (b.onclick = () => itemForm(null, b.dataset.kind)),
  );
}
function itemForm(row, kind) {
  kind = row?.kind || kind;
  const rev = state.revision;
  const input = {
    ...row,
    capacity: row?.capacityMilli == null ? "" : row.capacityMilli / 1000,
  };
  const groups = forms.sections(kind, false, input);
  modal(
    row ? "编辑珍藏" : "添一件" + label[kind],
    `<form>${field("name", kind === "book" ? "书名" : "名称", row?.name, { required: true, max: 120 })}${field("category", kind === "book" ? "书籍类别" : ["equipment", "teaware", "incenseware"].includes(kind) ? "器形／器物类别" : "品类", row?.category)}${groups
      .map(
        (g) =>
          `<details ${g.open ? "open" : ""}><summary>${esc(g.title)}</summary><div class="form-grid">${g.fields
            .map((f) =>
              field(f.key, f.label, input[f.key], {
                multiline: f.multiline,
                max: f.max,
                hint: f.placeholder,
                ...(f.key === "nature"
                  ? {
                      choices: [
                        ["", "暂不填写"],
                        ["天然单方", "天然单方"],
                        ["合香", "合香"],
                      ],
                    }
                  : {}),
              }),
            )
            .join("")}</div></details>`,
      )
      .join("")}${
      kind === "tea"
        ? field("teaCategory", "茶类", row?.teaCategory, {
            choices: [
              ["", "暂不分类"],
              ["green", "绿茶"],
              ["white", "白茶"],
              ["yellow", "黄茶"],
              ["oolong", "乌龙茶"],
              ["red", "红茶"],
              ["dark", "黑茶"],
              ["reprocessed", "再加工茶"],
              ["special", "其他专题"],
            ],
          })
        : ""
    }${field("notes", "补充记录", row?.notes, { multiline: true, max: 12000 })}<div class="form-actions"><button class="primary" type="submit">保存珍藏</button></div></form>`,
  );
  bindForm(async (v) => {
    await commit((s) => {
      s.collection = d.mutate(
        s.collection,
        {
          type: "itemSave",
          item: { ...input, ...v, id: row?.id || id(), kind },
          expectedVersion: row?.version || 0,
        },
        id(),
        time(),
      ).data;
    }, rev);
  });
}
function itemPage(key) {
  const r = state.collection.items.find((x) => x.id === key);
  if (!r) throw Error("珍藏不存在");
  const batches = state.collection.batches.filter((x) => x.itemId === key);
  main.innerHTML =
    `<a class="back" href="#collection">← 我的珍藏</a>` +
    sectionHead(
      label[r.kind] + " / 我的珍藏",
      r.name,
      r.category,
      `<button id="edit-item">编辑档案</button>`,
    ) +
    `<div class="detail-card"><div class="detail-meta">${forms
      .itemFields(r.kind)
      .filter((f) => r[f.key] != null && r[f.key] !== "" && f.key !== "name")
      .map(
        (f) => `<div><dt>${esc(f.label)}</dt><dd>${esc(r[f.key])}</dd></div>`,
      )
      .join(
        "",
      )}${r.capacityMilli != null ? `<div><dt>容量</dt><dd>${r.capacityMilli / 1000} ml</dd></div>` : ""}</div><p class="pre-wrap">${esc(r.notes)}</p></div><div class="section-heading small"><h2>照片与细节</h2><button id="add-photo">＋ 添加照片</button></div>${photoGallery(key)}<div class="section-heading small"><h2>批次与库存</h2><button id="new-batch">＋ 登记一批</button></div><div class="lesson-list">${batches.map((b) => `<a href="#batch/${b.id}"><div><h3>${esc(b.label)}</h3><p>${esc([b.seller, b.storage, b.purchasedAt].filter(Boolean).join(" · "))}</p></div><div><strong>${b.quantityMilli == null ? "未登记数量" : d.stock(state.collection, b.id) / 1000 + " " + b.unit}</strong><small>当前库存 →</small></div></a>`).join("") || '<p class="muted">尚未登记批次。数量未知可以留空。</p>'}</div><div class="button-row"><button id="item-journal">为它写一则手记</button></div>`;
  $("#edit-item").onclick = () => itemForm(r);
  $("#new-batch").onclick = () => batchForm(r);
  $("#add-photo").onclick = () => photoForm("items", key);
  $("#item-journal").onclick = () =>
    journalForm(
      null,
      ["tea", "incense"].includes(r.kind) ? r.kind : "daily",
      r,
    );
  bindPhotoButtons();
}
function batchForm(item, row) {
  const rev = state.revision;
  const input = {
    ...row,
    quantity: row?.quantityMilli == null ? "" : row.quantityMilli / 1000,
    price: row?.priceCents == null ? "" : row.priceCents / 100,
  };
  modal(
    row ? "编辑批次" : "登记新批次",
    `<form><div class="form-grid">${forms.batch.map((f) => field(f.key, f.label, input[f.key], { required: f.key === "label", readonly: !!row && f.key === "quantity", multiline: ["storageNotes", "claim", "verificationNotes"].includes(f.key), ...(f.key === "verification" ? { choices: ["未核验", "部分核验", "已核验", "存疑"].map((x) => [x, x]) } : {}) })).join("")}${field("unit", "单位", row?.unit || (item.kind === "book" ? "本" : ["equipment", "teaware", "incenseware"].includes(item.kind) ? "件" : "g"), { choices: d.UNITS.map((x) => [x, x]), readonly: !!row })}</div><p class="muted">入库数量一旦保存，通过库存流水调整；留空代表未知，0 代表已知为零。</p><button class="primary" type="submit">保存批次</button></form>`,
  );
  bindForm(async (v) => {
    await commit((s) => {
      s.collection = d.mutate(
        s.collection,
        {
          type: "batchSave",
          batch: {
            ...input,
            ...v,
            id: row?.id || id(),
            itemId: item.id,
            unit: row?.unit || v.unit,
          },
          expectedVersion: row?.version || 0,
        },
        id(),
        time(),
      ).data;
    }, rev);
  });
}
function batchPage(key) {
  const b = state.collection.batches.find((x) => x.id === key);
  if (!b) throw Error("批次不存在");
  const item = state.collection.items.find((x) => x.id === b.itemId),
    tx = state.collection.transactions.filter((x) => x.batchId === key);
  main.innerHTML =
    `<a class="back" href="#item/${item.id}">← ${esc(item.name)}</a>` +
    sectionHead(
      "批次档案",
      b.label,
      b.quantityMilli == null
        ? "库存数量尚未登记"
        : `当前库存 ${d.stock(state.collection, key) / 1000} ${b.unit}`,
      '<button id="edit-batch">编辑批次</button>',
    ) +
    `<div class="detail-card"><div class="detail-meta">${[
      ["购自", b.seller],
      ["购入日期", b.purchasedAt],
      ["存放位置", b.storage],
      ["总价", b.priceCents == null ? "未知" : b.priceCents / 100 + " 元"],
      ["核验", b.verification],
      ["依据", b.verificationNotes],
    ]
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v || "—")}</dd></div>`)
      .join(
        "",
      )}</div><p>${esc(b.storageNotes)}</p></div><div class="button-row">${b.quantityMilli == null ? '<button id="stock-init" class="primary">登记当前库存</button>' : '<button id="stock-adjust">调整库存</button><button id="stock-transfer">分装到新批次</button>'}<button id="batch-journal">写手记</button></div><h2>库存流水</h2><div class="table-wrap"><table><thead><tr><th>日期</th><th>变动</th><th>原因</th><th>操作</th></tr></thead><tbody>${[
      ...tx,
    ]
      .reverse()
      .map(
        (x) =>
          `<tr><td>${esc(x.createdAt.slice(0, 10))}</td><td>${x.deltaMilli > 0 ? "+" : ""}${x.deltaMilli / 1000} ${b.unit}</td><td>${esc(x.reason)}</td><td>${!x.sessionId && !x.transferId && !x.reversesId && !tx.some((a) => a.reversesId === x.id) ? `<button data-reverse="${x.id}">冲正</button>` : x.sessionId ? `<a href="#session/${x.sessionId}">对应手记</a>` : "—"}</td></tr>`,
      )
      .join("")}</tbody></table></div>`;
  $("#edit-batch").onclick = () => batchForm(item, b);
  $("#stock-init")?.addEventListener("click", () => stockForm(b, "stockInit"));
  $("#stock-adjust")?.addEventListener("click", () => stockForm(b, "adjust"));
  $("#stock-transfer")?.addEventListener("click", () =>
    stockForm(b, "transfer"),
  );
  $$("[data-reverse]", main).forEach(
    (el) => (el.onclick = () => stockForm(b, "reverse", el.dataset.reverse)),
  );
  $("#batch-journal").onclick = () => journalForm(null, item.kind, item, b);
}
function stockForm(b, type, transactionId) {
  const rev = state.revision;
  modal(
    {
      stockInit: "登记库存",
      adjust: "调整库存",
      transfer: "分装",
      reverse: "冲正流水",
    }[type],
    `<form>${type === "stockInit" ? field("quantity", "当前数量", "", { required: true }) : type === "adjust" ? field("delta", "变动数量（减少填负数）", "", { required: true }) : type === "transfer" ? field("amount", "分装数量", "", { required: true }) + field("label", "新批次名称", "", { required: true }) + field("storage", "存放位置") : ""}${field("reason", "原因与说明", "", { required: true, max: 300 })}<p class="muted">变更保留流水记录，不会直接改写历史数量。</p><button class="primary" type="submit">确认记录</button></form>`,
  );
  bindForm(async (v) => {
    await commit((s) => {
      s.collection = d.mutate(
        s.collection,
        {
          ...v,
          type,
          batchId: b.id,
          transactionId,
          expectedVersion: b.version,
        },
        id(),
        time(),
      ).data;
    }, rev);
  });
}
function photoGallery(entity) {
  const photos = state.photos.filter((p) => p.entityId === entity),
    missing = state.collection.links.filter((l) => l.entityId === entity);
  return `<div class="photo-grid">${photos.map((p) => `<figure><button class="photo-button" data-photo="${p.id}"><img src="${p.data}" alt="${esc(p.caption || "个人照片")}" loading="lazy"></button><figcaption>${esc(p.caption || p.filename)}</figcaption><button data-photo-remove="${p.id}">移除照片</button></figure>`).join("")}</div>${!photos.length ? '<p class="muted">尚无本机照片。</p>' : ""}${missing.length ? `<p class="notice">原小程序有 ${missing.length} 条图片关联，备份不含原图。请从自己的照片归档重新添加。原图片说明已保留。</p><details><summary>原图片说明</summary>${missing.map((l) => `<p>${esc(l.caption || l.altText || "未填写说明")} · ${esc(l.sourceType || "")}</p>`).join("")}</details>` : ""}`;
}
function showImage(src, title) {
  modal(
    title || "查看照片",
    `<img class="full-image" src="${esc(src)}" alt="${esc(title || "照片")}">`,
  );
}
function bindPhotoButtons() {
  $$("[data-photo]", main).forEach(
    (b) =>
      (b.onclick = () => {
        const p = state.photos.find((p) => p.id === b.dataset.photo);
        showImage(p.data, p.caption || p.filename);
      }),
  );
  $$("[data-photo-remove]", main).forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm("从当前浏览器移除这张照片？已导出的备份保留原图。"))
          return;
        try {
          await commit(
            (s) =>
              (s.photos = s.photos.filter(
                (p) => p.id !== b.dataset.photoRemove,
              )),
          );
          render();
        } catch (e) {
          error(e);
        }
      }),
  );
}
function photoForm(entityType, entityId) {
  const rev = state.revision;
  modal(
    "添加照片",
    `<form>${field("caption", "图片说明", "", { multiline: true, max: 2000 })}<label class="field"><span>选择照片（JPEG / PNG / WebP，单张不超过 8 MB）</span><input type="file" id="photo-file" accept="image/jpeg,image/png,image/webp" required></label><p class="muted">原图保存在本机，网页备份包含这些照片。不会上传到 GitHub。</p><button class="primary" type="submit">保存照片</button></form>`,
  );
  bindForm(async (v) => {
    const file = $("#photo-file").files[0];
    if (
      !file ||
      file.size > 8 * 1024 * 1024 ||
      !["image/jpeg", "image/png", "image/webp"].includes(file.type)
    )
      throw Error("请选择不超过 8 MB 的 JPEG、PNG 或 WebP 图片");
    const data = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    const probe = new Image();
    probe.src = data;
    await probe.decode();
    await commit((s) => {
      s.photos.push({
        id: id(),
        entityId,
        entityType,
        data,
        mime: file.type,
        filename: file.name,
        caption: v.caption,
        bytes: file.size,
        createdAt: time(),
      });
    }, rev);
  });
}
function journalPage() {
  main.innerHTML =
    sectionHead(
      "DAILY JOURNAL",
      "一日一记，清赏人间。",
      "品茶、闻香，或只是记下今天。",
      '<button class="primary" id="new-journal">＋ 写一则手记</button>',
    ) +
    `<div class="button-row journal-kinds"><button data-jkind="tea">品茶手记</button><button data-jkind="incense">闻香手记</button><button data-jkind="daily">日常手札</button></div><div class="journal-list">${
      [...state.collection.sessions]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(
          (s) =>
            `<a class="journal-card" href="#session/${s.id}"><div class="journal-date"><strong>${esc((s.observedAt || s.createdAt).slice(8, 10))}</strong><span>${esc((s.observedAt || s.createdAt).slice(0, 7))}</span></div><div><span class="eyebrow">${label[s.kind]} · ${s.status === "cancelled" ? "已撤销" : "手记"}</span><h2>${esc(s.title)}</h2><p>${esc((s.summary || s.body || "").slice(0, 150))}</p></div><span>↗</span></a>`,
        )
        .join("") ||
      blank("给今天留一页", "不必写得完整，一点真实的感受就很好。")
    }</div>${state.learning.journals.length ? '<details class="source-panel"><summary>旧版手记文字</summary>' + state.learning.journals.map((j) => `<h3>${esc(j.title)}</h3><p class="pre-wrap">${esc(j.body)}</p>`).join("") + "</details>" : ""}${
      Object.keys(state.drafts).filter((k) => k.startsWith("journal-")).length
        ? `<h2>已保存的草稿</h2>${Object.entries(state.drafts)
            .filter(([k]) => k.startsWith("journal-"))
            .map(
              ([k, v]) =>
                `<button data-draft="${k}">${esc(v.title || "未题名草稿")}</button>`,
            )
            .join("")}`
        : ""
    }`;
  $("#new-journal").onclick = () => journalForm(null, "daily");
  $$("[data-jkind]", main).forEach(
    (b) => (b.onclick = () => journalForm(null, b.dataset.jkind)),
  );
  $$("[data-draft]", main).forEach(
    (b) =>
      (b.onclick = () =>
        journalForm(
          null,
          state.drafts[b.dataset.draft].kind,
          null,
          null,
          state.drafts[b.dataset.draft],
          b.dataset.draft,
        )),
  );
}
function journalForm(row, kind, item, batch, draft, draftKey) {
  kind = row?.kind || kind;
  let rev = state.revision;
  const original = row
    ? t.inputFrom(row)
    : {
        kind,
        title: "",
        observedAt: day(),
        itemId: item?.id || "",
        batchId: batch?.id || "",
        unit: batch?.unit || "",
        infusions: [],
        stages: [],
        scores: [],
        ...draft,
      };
  const recordId = row?.id || id(),
    dk = draftKey || "journal-" + recordId;
  let rounds = clone(original[kind === "tea" ? "infusions" : "stages"] || []);
  const items = state.collection.items.filter((i) => i.kind === kind);
  const equipment = state.collection.items.filter((i) =>
    ["equipment", kind === "tea" ? "teaware" : "incenseware"].includes(i.kind),
  );
  modal(
    row ? "编辑清赏手记" : "写一则" + label[kind] + "手记",
    `<form id="journal-form">${field("title", "题名", original.title, { required: true, max: 120 })}${field("observedAt", "发生日期或时间", original.observedAt, { hint: "YYYY-MM-DD，或 YYYY-MM-DDTHH:mm" })}${field("body", "此刻的记录", original.body, { multiline: true, max: 12000 })}${kind !== "daily" ? `<details ${row ? "open" : ""}><summary>关联藏品与使用参数</summary><div class="form-grid">${field("itemId", "这次品赏的藏品", original.itemId, { choices: [["", "暂不关联"], ...items.map((i) => [i.id, i.name])] })}${field("batchId", "批次", original.batchId, { choices: [["", "暂不关联"], ...state.collection.batches.filter((b) => items.some((i) => i.id === b.itemId)).map((b) => [b.id, (state.collection.items.find((i) => i.id === b.itemId)?.name || "") + " / " + b.label])] })}${field("equipmentId", "使用器物", original.equipmentId, { choices: [["", "暂不关联"], ...equipment.map((i) => [i.id, i.name])] })}${field("method", "品赏方法", original.method)}${field("used", "实际用量", original.used)}${field("unit", "用量单位", original.unit, { choices: [["", "未填写"], ...d.UNITS.map((x) => [x, x])] })}${kind === "tea" ? field("waterMl", "水量 ml", original.waterMl) + field("waterTemp", "水温 ℃", original.waterTemp) + field("capacity", "器物容量 ml", original.capacity) : field("heatSource", "热源与隔火观察", original.heatSource) + field("durationMinutes", "持续时间（分钟）", original.durationMinutes)}${field("liked", "喜爱程度 0～10", original.liked)}</div><label class="check-row"><input type="checkbox" name="stockConfirmed" ${original.stockConfirmed ? "checked" : ""}>确认按实际用量扣减关联批次库存</label><p class="muted">仅勾选后扣库存。修改或撤销手记时，系统用流水冲正，避免重复扣减。</p></details><details open><summary>${kind === "tea" ? "逐泡观察" : "闻香变化"}</summary><div id="rounds"></div><button type="button" id="add-round">＋ ${kind === "tea" ? "加一泡" : "加一段"}</button></details>${field("summary", "回看与小结", original.summary, { multiline: true })}` : ""}<div class="form-actions"><button type="submit" class="primary">保存手记</button><button type="button" id="save-draft">保存草稿</button></div></form>`,
  );
  const roundGroup = kind === "tea" ? "infusions" : "stages";
  function captureRounds() {
    rounds = $$(".round", dialog).map((el, i) => ({
      id: rounds[i]?.id || id(),
      ...Object.fromEntries(
        $$("input,textarea", el).map((n) => [n.dataset.field, n.value]),
      ),
    }));
  }
  const roundFields =
    kind === "tea"
      ? [
          "seconds",
          "aroma",
          "taste",
          "texture",
          "color",
          "aftertaste",
          "salivation",
          "leafBase",
        ]
      : ["minutes", "setTemp", "aroma", "observation"];
  const roundLabels = {
    seconds: "浸泡秒数",
    minutes: "经过分钟",
    setTemp: "电子炉设定温度",
    aroma: "香气",
    taste: "滋味",
    texture: "汤感",
    color: "汤色",
    aftertaste: "回甘",
    salivation: "生津",
    leafBase: "叶底",
    observation: "变化与观察",
  };
  function drawRounds() {
    if (!$("#rounds", dialog)) return;
    $("#rounds", dialog).innerHTML = rounds
      .map(
        (r, i) =>
          `<div class="round"><h4>${kind === "tea" ? "第 " + (i + 1) + " 泡" : "第 " + (i + 1) + " 段"} <button type="button" data-remove-round="${i}" aria-label="移除第${i + 1}条观察">×</button></h4><div class="form-grid">${roundFields.map((k) => `<label class="field"><span>${roundLabels[k]}</span><input data-field="${k}" value="${esc(r[k])}" maxlength="1000"></label>`).join("")}</div></div>`,
      )
      .join("");
    $$("[data-remove-round]", dialog).forEach(
      (b) =>
        (b.onclick = () => {
          captureRounds();
          rounds.splice(Number(b.dataset.removeRound), 1);
          drawRounds();
          dirty = true;
        }),
    );
  }
  drawRounds();
  $("#add-round")?.addEventListener("click", () => {
    captureRounds();
    rounds.push({ id: id() });
    drawRounds();
    dirty = true;
  });
  const values = (v) => {
    captureRounds();
    const x = {
      ...original,
      ...v,
      id: recordId,
      kind,
      stockConfirmed: !!v.stockConfirmed,
      [roundGroup]: rounds,
    };
    if (kind === "daily") {
      x.stockConfirmed = false;
      x.infusions = [];
      x.stages = [];
    }
    return x;
  };
  $("#save-draft").onclick = async () => {
    try {
      const v = values(Object.fromEntries(new FormData($("#journal-form"))));
      await commit((s) => {
        s.drafts[dk] = v;
      }, rev);
      rev = state.revision;
      dirty = false;
      toast("草稿已保存到本机，网页备份会一并保存");
    } catch (e) {
      error(e);
    }
  };
  $("[name=batchId]")?.addEventListener("change", (e) => {
    const b = state.collection.batches.find((b) => b.id === e.target.value);
    if (b) {
      $("[name=itemId]").value = b.itemId;
      $("[name=unit]").value = b.unit;
    }
  });
  bindForm(async (v) => {
    const x = values(v);
    await commit((s) => {
      const batchVersions = Object.fromEntries(
        s.collection.batches.map((b) => [b.id, b.version]),
      );
      s.collection = t.plan(
        s.collection,
        {
          type: "sessionSave",
          session: x,
          expectedVersion: row?.version || 0,
          batchVersions,
        },
        id(),
        time(),
      ).data;
      delete s.drafts[dk];
    }, rev);
  });
}
function sessionPage(key) {
  const r = state.collection.sessions.find((s) => s.id === key);
  if (!r) throw Error("手记不存在");
  main.innerHTML =
    `<a class="back" href="#journal">← 清赏手记</a>` +
    sectionHead(
      label[r.kind] + " / " + (r.observedAt || r.createdAt.slice(0, 10)),
      r.title,
      r.status === "cancelled" ? "已撤销，库存流水已按原记录冲正。" : "",
      r.status === "active"
        ? '<button id="edit-session">编辑手记</button>'
        : "",
    ) +
    `<article class="session-body"><p class="pre-wrap">${esc(r.body)}</p>${r.itemId ? `<a class="button" href="#item/${r.itemId}">${esc(state.collection.items.find((i) => i.id === r.itemId)?.name || "关联珍藏")} ↗</a>` : ""}<div class="detail-meta">${[
      ["方法", r.method],
      ["用量", r.usedMilli == null ? "" : r.usedMilli / 1000 + " " + r.unit],
      ["水量", r.waterMl == null ? "" : r.waterMl + " ml"],
      ["水温", r.waterTemp == null ? "" : r.waterTemp + " ℃"],
      ["热源", r.heatSource],
      ["喜爱程度", r.liked == null ? "" : r.liked + " / 10"],
    ]
      .filter((x) => x[1] !== "")
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`)
      .join("")}</div>${(r.kind === "tea" ? r.infusions : r.stages)
      .map(
        (s, i) =>
          `<div class="observation"><h3>${r.kind === "tea" ? "第 " + (i + 1) + " 泡" : "第 " + (i + 1) + " 段"}</h3><div class="detail-meta">${Object.entries(
            s,
          )
            .filter(
              ([k, v]) =>
                !["id", "position"].includes(k) && v !== null && v !== "",
            )
            .map(
              ([k, v]) =>
                `<div><dt>${esc({ seconds: "秒数", minutes: "分钟", setTemp: "设定温度", aroma: "香气", taste: "滋味", texture: "汤感", color: "汤色", aftertaste: "回甘", salivation: "生津", leafBase: "叶底", observation: "变化" }[k] || k)}</dt><dd>${esc(v)}</dd></div>`,
            )
            .join("")}</div></div>`,
      )
      .join(
        "",
      )}<p class="pre-wrap">${esc(r.summary)}</p></article><div class="section-heading small"><h2>留一张照片</h2>${r.status === "active" ? '<button id="session-photo">＋ 添加照片</button>' : ""}</div>${photoGallery(key)}${r.status === "active" ? '<button class="danger" id="cancel-session">撤销这则手记</button>' : ""}`;
  $("#edit-session")?.addEventListener("click", () => journalForm(r));
  $("#session-photo")?.addEventListener("click", () =>
    photoForm("sessions", key),
  );
  $("#cancel-session")?.addEventListener("click", () => {
    const rev = state.revision;
    modal(
      "撤销手记",
      `<form>${field("reason", "撤销原因", "", { required: true, max: 300 })}<p>记录将保留为已撤销，关联扣减用冲正流水退回。</p><button class="danger" type="submit">确认撤销</button></form>`,
    );
    bindForm(async (v) => {
      await commit((s) => {
        s.collection = t.plan(
          s.collection,
          {
            type: "sessionCancel",
            id: key,
            reason: v.reason,
            expectedVersion: r.version,
            batchVersions: Object.fromEntries(
              s.collection.batches.map((b) => [b.id, b.version]),
            ),
          },
          id(),
          time(),
        ).data;
      }, rev);
    });
  });
  bindPhotoButtons();
}
const countNames = {
  items: "珍藏",
  sessions: "手记",
  batches: "批次",
  transactions: "库存流水",
  notes: "笔记",
  attempts: "作答",
  bookmarks: "收藏",
  photos: "本机照片",
};
function statCards(c) {
  return `<div class="data-stats">${Object.entries(c)
    .map(
      ([k, n]) =>
        `<div><strong>${n}</strong><span>${countNames[k] || k}</span></div>`,
    )
    .join("")}</div>`;
}
function download(data, name, type = "application/json") {
  const blob = new Blob([data], { type });
  const href = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60000);
}
async function exportBackup() {
  const fresh = await readStore();
  state = fresh;
  const backup = model.exportWeb(fresh),
    text = JSON.stringify(backup);
  const reread = JSON.parse(await new Blob([text]).text());
  if (
    reread.sha256 !== backup.sha256 ||
    d.hash((({ sha256, ...rest }) => rest)(reread)) !== backup.sha256
  )
    throw Error("备份回读校验失败，未下载");
  download(
    text,
    "闻香观茶-网页完整备份-" +
      new Date().toISOString().replace(/[:.]/g, "-") +
      ".json",
  );
  toast("已生成并校验备份，请在下载目录确认文件并另存到 iCloud。");
}
function backupPage() {
  main.innerHTML = `<a class="back" href="#my">← 我的书房</a><section class="personal-cover backup-cover"><div><div class="eyebrow">BACKUP & RESTORE</div><h1>把记录，妥善留住。</h1><p>一份留在书房，一份随身带走。</p><span class="local-tag"><i></i>当前浏览器 · 本机保存</span></div>${illustration("storage")}</section>
    <details class="backup-inventory"><summary>查看本机资料数量<span>珍藏 · 手记 · 笔记 · 照片</span></summary>${statCards(counts(state))}</details>
    <div class="backup-grid"><section class="panel backup-card export-card"><div class="backup-card-top"><div><span class="eyebrow">SAVE A COPY</span><h2>存一份，安心留底</h2></div>${illustration("books")}</div><p>完整保存个人记录、库存流水、网页照片原件和已保存的草稿。</p><button class="primary" id="export-backup">下载完整备份 <span aria-hidden="true">↓</span></button><p class="backup-footnote">文件经完整性校验后下载，再手动另存到 iCloud Drive 或自己的备份目录。</p></section>
    <section class="panel backup-card import-card"><div class="backup-card-top"><div><span class="eyebrow">BRING IT BACK</span><h2>带回来，接着记录</h2></div>${illustration("incense-journal")}</div><p>导入网页或小程序 JSON 备份。先预览，再确认，只补回缺失的记录。</p><label class="button file-label">选择 JSON 备份 <span aria-hidden="true">↑</span><input id="backup-file" type="file" accept="application/json,.json"></label><p class="backup-footnote">支持小程序 V1–V4 文字备份与本机珍藏文件；小程序照片原件需另行添加。</p></section></div>
    <section id="import-preview" aria-live="polite"></section>
    <section class="backup-guide"><div class="section-heading small"><div><div class="eyebrow">一 个 小 习 惯</div><h2>换设备前，做这三步</h2></div></div><ol><li><span>01</span><div><strong>下载一份</strong><p>记录更新后，导出最新的完整备份。</p></div></li><li><span>02</span><div><strong>另存一处</strong><p>确认下载文件，再放进自己的云盘或文件夹。</p></div></li><li><span>03</span><div><strong>在新设备接着用</strong><p>打开本站，选择备份，预览后确认导入。</p></div></li></ol></section>
    <section class="panel backup-about"><div class="backup-about-title">${illustration("tea-sprig")}<div><span class="eyebrow">留 在 自 己 手 中</span><h2>资料存在哪里</h2></div></div><p>个人资料保存在当前设备、当前浏览器中，不会上传到 GitHub，也不会自动同步到 iCloud。清除网站数据、结束无痕模式或更换浏览器，可能使本机记录不可用。</p><details><summary>关于小程序迁移</summary><p>网页版不连接微信 CloudBase，也不自动读取微信身份或云端资料。请使用自己导出的备份迁移；文件完整性校验不能代替微信身份认证。</p></details><button id="request-persistence">请求浏览器保留本机数据</button><p id="persist-status" class="muted" aria-live="polite"></p></section>`;
  $("#export-backup").onclick = async () => {
    try {
      await exportBackup();
    } catch (e) {
      error(e);
    }
  };
  $("#backup-file").onchange = async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      if (file.size > 160 * 1024 * 1024)
        throw Error("当前支持不超过 160 MB 的备份");
      $("#import-preview").textContent = "正在校验备份…";
      const parsed = JSON.parse(await file.text());
      const fresh = await readStore();
      state = fresh;
      importPlan = {
        ...model.previewImport(fresh, parsed),
        revision: fresh.revision,
      };
      const c = importPlan.counts;
      $("#import-preview").innerHTML =
        `<section class="panel"><h2>导入预览 · ${esc(file.name)}</h2><p>将补回以下记录，当前已有资料保留。</p>${statCards(c)}<p>${importPlan.conflicts} 条冲突保留当前版本；关联库存有冲突时，整组历史不会强行合并。</p>${importPlan.warning ? `<p class="notice">${esc(importPlan.warning)}</p>` : ""}<p>确认时先下载当前资料的安全备份，再提交导入。</p><button id="confirm-import" class="primary">确认补回缺失记录</button><button id="cancel-import">取消</button></section>`;
      $("#cancel-import").onclick = () => {
        importPlan = null;
        $("#import-preview").innerHTML = "";
        $("#backup-file").value = "";
      };
      $("#confirm-import").onclick = async () => {
        const button = $("#confirm-import");
        button.disabled = true;
        try {
          await exportBackup();
          const plan = importPlan;
          await commit((s) => Object.assign(s, plan.state), plan.revision);
          importPlan = null;
          toast("导入已完成，当前资料已保留");
          await render();
        } catch (e) {
          error(e);
          button.disabled = false;
        }
      };
    } catch (e) {
      $("#import-preview").innerHTML =
        `<p class="notice error">${esc(e.message)}。当前资料未改动。</p>`;
    }
  };
  $("#request-persistence").onclick = async () => {
    const granted = await navigator.storage?.persist?.();
    $("#persist-status").textContent = granted
      ? "浏览器已允许持久存储，仍请定期备份。"
      : "浏览器暂未允许持久存储；本机保存仍可使用，请定期导出备份。";
  };
}
function myPage() {
  const bookmarks = [
    ...new Set([
      ...state.learning.bookmarks,
      ...state.learning.referenceBookmarks,
      ...state.extra.bookmarks,
    ]),
  ]
    .map(meta)
    .filter(Boolean);
  main.innerHTML = `<section class="study-overview"><div class="personal-cover"><div><div class="eyebrow">MY STUDY</div><h1>我的香茶书房</h1><p>读过的、喜欢的、记下的，<br>都在这里慢慢积累。</p></div>${illustration("books")}</div>${statCards(counts(state))}</section>
    ${functionCards(
      [
        [
          "#backup",
          "备份与恢复",
          "为积累留个底，换设备也能带走",
          "storage",
          true,
        ],
        ["#journal", "清赏手记", "记下今天的香与茶", "incense-journal"],
        ["#library", "全部书架", "找一页喜欢的，慢慢读", "books"],
        ["#glossary", "术语索引", "读懂草木与器物的名字", "tea-canon"],
        ["#review", "复习与进阶", "回看一遍，再理解一点", "tea-assessment"],
      ],
      "my-tools",
    )}
    <div class="section-heading small"><div><div class="eyebrow">留 下 喜 欢</div><h2>我的收藏</h2></div><a class="text-link" href="#library">去书架 ↗</a></div>${bookmarks.length ? `<div class="card-grid">${bookmarks.map(card).join("")}</div>` : illustratedEmpty("tea-sprig", "把心动的一页，留在这里", "阅读时点一下「收藏」，下次就能轻松找到。", "#tea", "去读一页茶")}
    <div class="section-heading small"><div><div class="eyebrow">字 里 行 间</div><h2>读书笔记</h2></div></div>${state.learning.notes.length || state.extra.notes.length ? notesFor() : illustratedEmpty("incense-journal", "留一句自己的理解", "在课程里写下笔记，让读过的内容与你有关。", "#library", "翻开书架")}<details class="source-panel"><summary>最近的作答记录</summary>${
      [
        ...state.learning.attempts,
        ...state.learning.openAttempts,
        ...state.extra.attempts,
      ]
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 50)
        .map(
          (a) =>
            `<div><a href="${url(a.lessonId)}">${esc(meta(a.lessonId)?.title || a.lessonId)}</a><p>${esc(a.body || "选择 " + String.fromCharCode(65 + (a.choice || 0)))} ${a.correct === true ? "✓" : a.correct === false ? "· 可再复习" : ""}</p><small>${esc(a.createdAt?.slice(0, 10))}</small></div>`,
        )
        .join("") || "<p>尚无作答记录。</p>"
    }</details><p class="quiet-note">网页版 1.23.3 · 内容源自 V1.23 · 自学练习答案随网页提供。</p>`;
  bindNoteButtons();
}
function glossaryPage() {
  main.innerHTML =
    sectionHead(
      "GLOSSARY",
      "给草木一个准确的名字。",
      "保留原稿中的术语解释与关联课程。",
    ) +
    `<div class="filter-bar"><input id="glossary-query" aria-label="查找术语" placeholder="查找术语…"></div><div id="glossary-list"></div>`;
  const update = () => {
    const q = $("#glossary-query").value;
    $("#glossary-list").innerHTML = index.glossary
      .filter((g) => (g.term + g.definition).includes(q))
      .map(
        (g) =>
          `<section class="panel"><h2>${esc(g.term)}</h2><p>${esc(g.definition)}</p>${meta(g.lesson_id) ? `<a href="${url(g.lesson_id)}">关联课程 →</a>` : ""}</section>`,
      )
      .join("");
  };
  $("#glossary-query").oninput = update;
  update();
}
function reviewPage() {
  main.innerHTML =
    sectionHead(
      "REVIEW & REFLECTION",
      "回看一遍，让理解更清楚。",
      "跨主题复习与五级研读，不用打卡天数衡量理解。",
    ) +
    `<div class="card-grid">${index.reviewSets.map((r) => `<a class="panel" href="#quiz/${r.id}"><span class="eyebrow">跨主题复习 · ${r.question_ids.length} 题</span><h2>${esc(r.title)}</h2><span class="text-link">开始自评 →</span></a>`).join("")}</div><h2>进阶研读路径</h2>${index.stages
      .map(
        (g) =>
          `<details class="panel"><summary>${esc(g.domain)} · ${esc(g.title)}</summary><p>${esc(g.evidence)}</p><ul>${g.criteria.map((c) => `<li><strong>${esc(c.name)}</strong>：${esc(c.pass)}</li>`).join("")}</ul><p class="muted">${esc(g.note)}</p><div class="lesson-list">${index.entries
            .filter(
              (e) =>
                e.group === "reference" &&
                e.level === g.level &&
                e.domain === g.domain,
            )
            .map(
              (e) =>
                `<a href="${url(e.id)}"><h3>${esc(e.title)}</h3><span>→</span></a>`,
            )
            .join("")}</div></details>`,
      )
      .join("")}`;
}

async function render(resetScroll = true) {
  const token = ++routeToken;
  try {
    if (dbReady) state = await readStore();
    const [page = "home", ...parts] = (location.hash.slice(1) || "home").split(
      "/",
    );
    const param = decodeURIComponent(parts.join("/"));
    shell();
    if (resetScroll) window.scrollTo(0, 0);
    switch (page) {
      case "home":
        await home();
        break;
      case "tea":
      case "incense":
        unitsPage(page);
        break;
      case "unit":
        unitPage(param);
        break;
      case "article":
        await article(param, token);
        break;
      case "quiz":
        await quizPage(param, token);
        break;
      case "atlas":
      case "library":
        listingPage(page, param);
        break;
      case "search":
        searchPage(param);
        break;
      case "collection":
        collectionPage();
        break;
      case "item":
        itemPage(param);
        break;
      case "batch":
        batchPage(param);
        break;
      case "journal":
        journalPage();
        break;
      case "session":
        sessionPage(param);
        break;
      case "backup":
        backupPage();
        break;
      case "my":
        myPage();
        break;
      case "glossary":
        glossaryPage();
        break;
      case "review":
        reviewPage();
        break;
      default:
        main.innerHTML = blank(
          "这页不在书架上",
          "返回书房继续阅读。",
          '<a href="#home" class="button">返回书房</a>',
        );
    }
    document.title = ($("h1", main)?.textContent || "香茶书房") + " · 闻香观茶";
  } catch (e) {
    main.innerHTML = `<section class="panel"><h1>这一页暂时没打开</h1><p>${esc(e.message)}</p><a class="button" href="#home">返回书房</a><button id="retry">重试</button></section>`;
    $("#retry").onclick = () => render();
    console.error(e);
  }
}
window.addEventListener("hashchange", () => {
  if (dialog.open) {
    if (dirty) {
      location.hash = location.hash;
      toast("请先保存或关闭当前编辑窗口。");
      return;
    }
    dialog.close();
  }
  render();
});
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
document.addEventListener("click", (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (a && dirty) {
    if (!confirm("输入尚未保存，确定离开？")) e.preventDefault();
    else dirty = false;
  }
});
(async () => {
  try {
    try {
      state = await openStore();
      dbReady = true;
    } catch (e) {
      state = model.empty();
      toast("本机存储不可用：" + e.message + "。可浏览课程，暂不能保存。");
    }
    const r = await fetch("data/index.json");
    if (!r.ok) throw Error("内容目录加载失败，请联网重试");
    index = await r.json();
    await render();
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.register("sw.js");
      if (registration.waiting)
        toast("新版本已准备，关闭本网站所有标签后重新打开即可更新。");
      registration.addEventListener("updatefound", () =>
        registration.installing?.addEventListener("statechange", () => {
          if (registration.waiting && navigator.serviceWorker.controller)
            toast("新版本已准备，下次重新打开时更新。");
        }),
      );
    }
  } catch (e) {
    main.innerHTML = `<section class="panel"><h1>暂时无法打开书房</h1><p>${esc(e.message)}</p><button onclick="location.reload()">重新打开</button></section>`;
  }
})();
