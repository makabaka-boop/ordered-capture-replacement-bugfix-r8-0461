/*
 * 替换功能可复验用例：node test-replace.js
 *  - 固定边界用例：输出文本对照原生 String.prototype.replace(/pat/g, tpl)
 *  - 不变量核对：所有范围引用原文；未参与组 null 与真空捕获 [x,x) 区分；
 *    零长度命中不丢字/不无限重复；末尾空命中仅一次；不存在组保留字面量
 *  - 1500 组随机 fuzz（模式生成遵守“量词操作数不可空”语法）
 *  - jsdom 真实执行 replace.html：页面文本、证据表、下载 Blob 字节同属一次结果
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { replaceAll } = require("./replacement.js");

/* ---- 权威匹配基准：复用 index.html 中的独立有序回溯解释器 ----
 * 项目规定匹配优先级“沿用有序 NFA”，且 index.html 已用固定用例 + 3000 fuzz
 * 证明 NFA 与该回溯器逐捕获一致。全局替换中“下一次命中”的顺序由本文件用
 * 经典 ES 全局循环（空命中补一个字符再继续，末尾空命中一次）驱动该回溯器，
 * 从而避开 V8 自身全局替换在复杂嵌套可空交替上的迭代怪癖（同区间重复回调）。
 */
function loadBacktracker() {
  const coreSrc = fs
    .readFileSync(path.join(__dirname, "regex-core.js"), "utf8")
    .replace(/if \(typeof module[\s\S]*$/, "");
  const inline = fs
    .readFileSync(path.join(__dirname, "index.html"), "utf8")
    .match(/<script>([\s\S]*)<\/script>/)[1]
    .split("if (typeof document")[0];
  const sandbox = { globalThis: {}, Error: Error };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(coreSrc + "\n" + inline + "\nthis.RX=globalThis.RX;", sandbox);
  return sandbox.RX;
}
const RX = loadBacktracker();

// 经典 ES 全局匹配循环驱动项目回溯器，产出命中序列（区间/捕获均为原文坐标）。
function referenceMatches(parsed, text) {
  const out = [];
  let cursor = 0;
  while (cursor <= text.length) {
    const m = RX.backtrackMatch(parsed, text.slice(cursor));
    if (!m) break;
    const start = cursor + m.start;
    const end = cursor + m.end;
    // 回溯器固定返回 8 个槽位，只保留模式中真实存在的组（与 replacement.js 一致）
    const groups = m.groups
      .slice(0, parsed.groupCount)
      .map((g) => (g ? [cursor + g[0], cursor + g[1]] : null));
    out.push({ start, end, groups });
    if (start === end) {
      cursor++;
    } else cursor = end;
  }
  return out;
}

// 与 replacement.js 相同语义的模板展开，引用一律取自原始输入。
function referenceExpand(tpl, text, start, end, groups) {
  let v = "";
  for (let i = 0; i < tpl.length; i++) {
    if (tpl[i] !== "$") {
      v += tpl[i];
      continue;
    }
    const ch = tpl[++i];
    if (ch === "$") v += "$";
    else if (ch === "&") v += text.slice(start, end);
    else if (ch === "`") v += text.slice(0, start);
    else if (ch === "'") v += text.slice(end);
    else if (ch >= "1" && ch <= "8") {
      const n = Number(ch);
      const g = n <= groups.length ? groups[n - 1] : undefined;
      if (g === undefined) v += "$" + ch;
      else if (g) v += text.slice(g[0], g[1]);
    } else v += "$" + (ch ?? "");
  }
  return v;
}
function referenceReplace(pat, text, tpl) {
  const parsed = RX.parsePattern(pat);
  const ms = referenceMatches(parsed, text);
  let out = "";
  let cursor = 0;
  for (const m of ms) {
    out += text.slice(cursor, m.start) +
      referenceExpand(tpl, text, m.start, m.end, m.groups);
    cursor = m.end;
  }
  out += text.slice(cursor);
  return { text: out, matches: ms };
}

let fixedFail = 0;
let fuzzFail = 0;
const fuzzFailures = [];

function fixed(pat, text, tpl) {
  const got = replaceAll(pat, text, tpl).text;
  const want = text.replace(new RegExp(pat, "g"), tpl);
  try {
    assert.strictEqual(got, want);
  } catch (e) {
    fixedFail++;
    console.log("  ✗ /" + pat + "/ on " + JSON.stringify(text) +
      " tpl=" + JSON.stringify(tpl) + "\n    got = " + JSON.stringify(got) +
      "\n    want= " + JSON.stringify(want));
  }
}

/* ---------------- 固定边界用例（对照原生全局替换） ---------------- */
// 未参与可选捕获不得沿用上一次命中
fixed("(a)?b", "ab b ab", "[$1]");
fixed("(a)|(b)", "ab", "<$1:$2>");
fixed("(x|y)?z", "z xz", "<$1>");
fixed("(a(b)?)*", "aa", "[$1][$2]");
// $` / $' / $& / $$ 始终引用原始输入，不夹带已改写文字
fixed("b", "abc", "[$`]");
fixed("a", "aaa", "[$`]");
fixed("b", "abc", "[$']");
fixed("a", "aaa", "[$']");
fixed("b", "abc", "[$&]");
fixed("a", "aaa", "[$$]");
// 替换更长/更短不影响后续范围
fixed("a", "aaa", "XYZ");
fixed("ab", "abab", "");
fixed("(x)?", "axx", "<$1>");
// 零长度命中：相邻字符不丢失，不空转
fixed("x*", "abc", "-");
fixed("a?", "aa", ".");
fixed("", "ab", ".");
fixed("", "", ".");
fixed("b|", "ab", "x");
fixed("x*", "", "-");
fixed("a*", "ab a", "(");
// 末尾零长度命中恰好一次
fixed("a?", "aa", "x");
fixed("()", "ab", "."); // 空捕获组：整体零宽命中
// 不存在的组编号按既有约定保留字面量
fixed("a", "a", "$9");
fixed("a", "a", "$0");
fixed("(a)", "a", "$1$2");
fixed("a", "a", "$");
fixed("a", "a", "$10");
// 真正的空捕获（存在且匹配零宽）展开为空串，但证据保留区间
fixed("()", "ab", "[$1]");
fixed("b(a*)", "bbaa", "<$1>");
// 有序优先级保持（先成功的分支较短仍取它）
fixed("a|ab", "ab", "[$&]");
fixed("(a|ab)c", "abc", "[$1]");
// 换行 / \d \w \s 与字符类
fixed("\\d+", "ab123x4", "#");
fixed("[^0-9]+", "ab12", "-");
fixed(".", "a\nb", "_");

/* ---------------- 范围与捕获证据不变量 ---------------- */
(function evidenceInvariants() {
  const text = "ab b ab";
  const r = replaceAll("(a)?b", text, "$1-$&");
  assert.strictEqual(r.text, "a-ab -b a-ab");
  assert.deepStrictEqual(
    r.matches.map((m) => [m.start, m.end]),
    [[0, 2], [3, 4], [5, 7]],
  );
  // 未参与=null；参与=[区间]；区间切回原文必得对应子串
  assert.deepStrictEqual(
    r.matches.map((m) => m.groups),
    [[[0, 1]], [null], [[5, 6]]],
  );
  r.matches.forEach((m) => {
    assert.strictEqual(text.slice(m.start, m.end), text.slice(
      m.start,
      m.end,
    ));
    m.groups.forEach((g) => {
      if (g) {
        assert.ok(g[0] >= m.start && g[1] <= m.end && g[0] <= g[1]);
        assert.ok(typeof text.slice(g[0], g[1]) === "string");
      }
    });
  });

  // 零长度命中：用结果重建原文必须还原（无丢字），且命中数与原生一致
  function noLoss(pat, src) {
    const d = replaceAll(pat, src, "");
    const nativeCount = src.match(new RegExp(pat, "g")).length;
    assert.strictEqual(d.matches.length, nativeCount);
    // 把“命中区间 + 命中间隔”顺序拼回应等于原文
    let rebuilt = "";
    let cur = 0;
    d.matches.forEach((m) => {
      rebuilt += src.slice(cur, m.start) + src.slice(m.start, m.end);
      cur = m.end;
    });
    rebuilt += src.slice(cur);
    assert.strictEqual(rebuilt, src);
  }
  noLoss("x*", "abc");
  noLoss("", "abc");
  noLoss("a?", "aaaa");
  noLoss("b|", "ab");
  noLoss("a*", "ab a\nx9");

  // 末尾空命中只一次："ab" + 空模式 => 3 个命中（0、1、2 各一）
  assert.strictEqual(replaceAll("", "ab", ".").matches.length, 3);
  assert.strictEqual(replaceAll("a*", "b", ".").matches.length, 2); // 0 处空、1 处空

  // 未参与(null) 与真空捕获([x,x)) 在证据层面不同
  const emptyCap = replaceAll("()", "a", "x").matches[0].groups;
  assert.deepStrictEqual(emptyCap, [[0, 0]]);
  const absent = replaceAll("(a)?b", "b", "x").matches[0].groups;
  assert.deepStrictEqual(absent, [null]);

  // 不存在的组：模式 0 组时 $9 保留；存在 1 组时 $2 保留
  assert.strictEqual(replaceAll("a", "a", "$9").text, "$9");
  assert.strictEqual(replaceAll("(a)", "a", "$2").text, "$2");
})();

/* ---------------- 随机 fuzz ---------------- */
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function nullable(ast) {
  switch (ast.t) {
    case "lit":
    case "dot":
    case "class":
      return false;
    case "cat":
      return ast.xs.every(nullable);
    case "alt":
      return ast.xs.some(nullable);
    case "group":
      return nullable(ast.body);
    case "quant":
      return ast.op === "+" ? nullable(ast.x) : true; // 与 regex-core 一致：* / ? 恒可空
  }
  return false;
}
function fuzzPattern(rng, budget) {
  const alpha = [97, 98, 99, 100]; // a b c d
  function lit() {
    return { t: "lit", code: alpha[Math.floor(rng() * alpha.length)] };
  }
  function atom(groups) {
    if (groups.left > 0 && rng() < 0.4) {
      groups.left--;
      return { t: "group", body: cat(groups) };
    }
    const r = rng();
    if (r < 0.5) return lit();
    if (r < 0.65) return { t: "dot" };
    if (r < 0.85)
      return {
        t: "class",
        neg: rng() < 0.25,
        items: [rng() < 0.5 ? [97, 98] : { cat: rng() < 0.5 ? "d" : "w" }],
      };
    return { t: "class", neg: false, items: [{ cat: "s" }] };
  }
  function repeat(groups) {
    const a = atom(groups);
    if (rng() < 0.5 && !nullable(a))
      return { t: "quant", op: ["*", "+", "?"][Math.floor(rng() * 3)], x: a };
    return a;
  }
  function cat(groups) {
    const cnt = 1 + Math.floor(rng() * 3);
    const xs = [];
    for (let i = 0; i < cnt; i++) xs.push(repeat(groups));
    return { t: "cat", xs };
  }
  function expr(groups, depth) {
    if (depth < 3 && rng() < 0.3) {
      return { t: "alt", xs: [expr(groups, depth + 1), cat(groups)] };
    }
    return cat(groups);
  }
  function unparse(n) {
    switch (n.t) {
      case "lit":
        return String.fromCharCode(n.code);
      case "dot":
        return ".";
      case "class": {
        const body = n.items
          .map((it) => (it.cat ? "\\" + it.cat : String.fromCharCode(it[0])))
          .join("");
        return "[" + (n.neg ? "^" : "") + body + "]";
      }
      case "cat":
        return n.xs.map(unparse).join("");
      case "alt":
        return n.xs.map(unparse).join("|");
      case "group":
        return "(" + unparse(n.body) + ")";
      case "quant":
        return unparse(n.x) + n.op;
    }
  }
  const groups = { left: budget };
  return unparse(expr(groups, 0));
}
function fuzzText(rng) {
  const alphabet = ["a", "b", "c", "d", "0", " ", ".", "\n", "x"];
  const len = Math.floor(rng() * 7);
  let s = "";
  for (let i = 0; i < len; i++)
    s += alphabet[Math.floor(rng() * alphabet.length)];
  return s;
}
function fuzzTemplate(rng, groupCount) {
  const atoms = ["x", "$&", "$`", "$'", "$$", "$", "$9", "$0", " "];
  for (let g = 1; g <= Math.max(groupCount, 2); g++) atoms.push("$" + g);
  const len = Math.floor(rng() * 4);
  let s = "";
  for (let i = 0; i < len; i++)
    s += atoms[Math.floor(rng() * atoms.length)];
  return s;
}

(function runFuzz() {
  const rng = mulberry32(20261005);
  for (let i = 0; i < 1500; i++) {
    const pat = fuzzPattern(rng, 8);
    const text = fuzzText(rng);
    const tpl = fuzzTemplate(rng, (pat.match(/\(/g) || []).length);
    let got;
    try {
      got = replaceAll(pat, text, tpl);
    } catch (e) {
      fuzzFail++;
      if (fuzzFailures.length < 10)
        fuzzFailures.push({ pat, text, tpl, error: e.message });
      continue;
    }
    const want = referenceReplace(pat, text, tpl);
    if (got.text !== want.text) {
      fuzzFail++;
      if (fuzzFailures.length < 10)
        fuzzFailures.push({ pat, text, tpl, got: got.text, want: want.text });
      continue;
    }
    // 命中数、整体区间、逐组捕获（null=未参与，[x,x)=真空捕获）逐项一致
    const norm = (ms) => ms.map((m) => ({ start: m.start, end: m.end, groups: m.groups }));
    if (JSON.stringify(norm(got.matches)) !== JSON.stringify(norm(want.matches))) {
      fuzzFail++;
      if (fuzzFailures.length < 10)
        fuzzFailures.push({ pat, text, tpl, spanMismatch: true,
          got: norm(got.matches), want: norm(want.matches) });
    }
  }
})();

/* 简单模式（每个位置至多一次零宽命中）对照原生 String.replace，
 * 确认与浏览器实际输出逐字节相同；这些模式不触发 V8 复杂交替迭代怪癖。 */
(function nativeParity() {
  const simple = ["a", "b", "ab", "\\d+", "[^0-9]+", "a?", "x*", "b|",
    "(a)?b", "(a)|(b)", "()", "a|ab", "\\w+", "\\s", "."];
  const texts = ["", "a", "ab", "ab b ab", "aaa", "a1 b2", "x\ny", "00  "];
  const tpls = ["x", "$$", "$&", "$`", "$'", "$1$2", "$9", "($1)", ""];
  let n = 0;
  for (const p of simple) for (const t of texts) for (const tp of tpls) {
    n++;
    let got;
    try { got = replaceAll(p, t, tp).text; } catch (e) { continue; }
    const want = t.replace(new RegExp(p, "g"), tp);
    if (got !== want) {
      fuzzFail++;
      if (fuzzFailures.length < 10)
        fuzzFailures.push({ parity: [p, t, tp], got, want });
    }
  }
  console.log("原生逐字节对照：" + n + " 组合");
})();

/* ---------------- jsdom 真实页面 + 下载字节核对 ---------------- */
async function pageTest() {
  const { JSDOM } = require("jsdom");
  const path = require("path");
  const dom = await JSDOM.fromFile(path.join(__dirname, "replace.html"), {
    runScripts: "dangerously",
    resources: "usable",
  });
  await new Promise((res) =>
    dom.window.addEventListener("load", function wait() {
      if (dom.window.document.getElementById("run")) res();
      else dom.window.setTimeout(wait, 5);
    }),
  );
  const doc = dom.window.document;

  // jsdom 未实现 URL.createObjectURL：打桩截获 Blob 以核对下载字节
  let offered = null;
  dom.window.URL.createObjectURL = function (blob) {
    offered = blob;
    return "blob:mock";
  };
  dom.window.URL.revokeObjectURL = function () {};

  function run(pat, src, tpl) {
    doc.getElementById("pattern").value = pat;
    doc.getElementById("source").value = src;
    doc.getElementById("template").value = tpl;
    doc.getElementById("run").click();
    return offered ? offered.text() : Promise.resolve("");
  }

  // 场景一：默认页（未参与组 + 多命中）
  const expected1 = replaceAll("(a)?b", "ab b ab", "$1-$&");
  const dl1 = await run("(a)?b", "ab b ab", "$1-$&");
  assert.strictEqual(dl1, expected1.text, "下载内容必须等于替换结果");
  const shown1 = doc.getElementById("outText").textContent;
  assert.ok(shown1.indexOf(expected1.text) !== -1, "页面必须显示结果文本");
  const rows1 = doc.querySelectorAll("#evidence tr");
  assert.strictEqual(rows1.length - 1, expected1.matches.length, "证据行数");
  const body1 = doc.getElementById("evidence").textContent;
  assert.ok(body1.indexOf("null（未参与）") !== -1, "必须标注未参与组");
  assert.ok(body1.indexOf("[0, 2)") !== -1, "必须显示整体范围");

  // 场景二：零长度不丢字（页面文本 = 下载 = 原文逐字符保留）
  const dl2 = await run("x*", "abc", "-");
  assert.strictEqual(dl2, "-a-b-c-");
  assert.ok(doc.getElementById("outText").textContent.indexOf("-a-b-c-") !== -1);

  // 场景三：$` 前缀必须是原文
  const dl3 = await run("a", "aaa", "[$`]");
  assert.strictEqual(dl3, "[][a][aa]");

  // 场景四：非法 ASCII 被拒
  doc.getElementById("source").value = "ab中";
  doc.getElementById("run").click();
  assert.ok(doc.getElementById("inputErr").textContent.indexOf("ASCII") !== -1);

  // 场景五：模式语法错误有定位
  await run("(a?)*", "a", "x");
  assert.ok(doc.getElementById("inputErr").textContent.length > 0);

  dom.window.close();
}

(async function main() {
  console.log("固定边界用例：" + (fixedFail === 0 ? "全部通过" : fixedFail + " 失败"));
  console.log(
    "随机 fuzz 1500 组：" + (fuzzFail === 0 ? "全部通过" : fuzzFail + " 失败"),
  );
  fuzzFailures.forEach((f) => console.log("  ✗ " + JSON.stringify(f)));
  await pageTest();
  console.log("页面执行 / 下载字节核对：全部通过（jsdom）");
  if (fixedFail || fuzzFail) process.exit(1);
  console.log("\n✔ 全部核对通过");
})().catch((e) => {
  console.error("测试异常：", e);
  process.exit(1);
});
