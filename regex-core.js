function RegexError(message, pos) {
  const e = new Error(message);
  e.pos = pos;
  return e;
}

/* ----------------------------- 工具 ----------------------------- */
function showCh(code) {
  if (code === 9) return "\\t";
  if (code === 10) return "\\n";
  if (code === 13) return "\\r";
  if (code < 32 || code === 127)
    return "\\x" + code.toString(16).padStart(2, "0");
  return String.fromCharCode(code);
}
function isDigit(c) {
  return c >= 48 && c <= 57;
}
function isHex(c) {
  return isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
}
function isAlpha(c) {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

/* ----------------------------- 解析器 ----------------------------- */
// AST: lit / dot / class / cat / alt / group / quant
// class.items: [lo,hi] 或 {cat:'d'|'D'|'w'|'W'|'s'|'S'}
function parsePattern(src) {
  let p = 0;
  let groupCount = 0;
  const groups = []; // {n,pos}

  function peek() {
    return p < src.length ? src.charCodeAt(p) : -1;
  }

  // 解析转义，入口 p 指向反斜杠；返回 {code|null, cat|null, next, pos}
  function readEscape() {
    const escPos = p;
    p++; // 跳过 '\'
    if (p >= src.length) throw RegexError("转义在末尾不完整", escPos);
    const c = src.charCodeAt(p);
    const simple = {
      ")": 1,
      "(": -1,
      "[": -1,
      "]": -1,
      ".": -1,
      "*": -1,
      "+": -1,
      "?": -1,
      "|": -1,
      "\\": -1,
      "^": -1,
      $: -1,
      "/": -1,
      "-": -1,
      "{": -1,
      "}": -1,
    };
    p++;
    switch (c) {
      case 110:
        return { code: 10, next: p, pos: escPos }; // n
      case 116:
        return { code: 9, next: p, pos: escPos };
      case 114:
        return { code: 13, next: p, pos: escPos };
      case 102:
        return { code: 12, next: p, pos: escPos };
      case 118:
        return { code: 11, next: p, pos: escPos };
      case 97:
        return { code: 7, next: p, pos: escPos };
      case 101:
        return { code: 27, next: p, pos: escPos };
      case 48:
        return { code: 0, next: p, pos: escPos }; // 0
      case 120: {
        // xHH
        if (
          p + 1 >= src.length ||
          !isHex(peek()) ||
          !isHex(src.charCodeAt(p + 1))
        )
          throw RegexError("\\x 需要两位十六进制", escPos);
        const code = parseInt(src.substr(p, 2), 16);
        p += 2;
        return { code, next: p, pos: escPos };
      }
      case 100:
      case 68:
      case 119:
      case 87:
      case 115:
      case 83: // d D w W s S
        return { cat: String.fromCharCode(c), next: p, pos: escPos };
      default: {
        if (simple[String.fromCharCode(c)] !== undefined)
          return { code: c, next: p, pos: escPos };
        if (c === 98) return { backspace: true, next: p, pos: escPos }; // \b 仅字符类内作退格
        throw RegexError(
          "不支持或非法的转义 \\" + String.fromCharCode(c),
          escPos,
        );
      }
    }
  }

  // 字符类，入口 p 指向 '['
  function parseClass() {
    const openPos = p;
    p++;
    let neg = false;
    if (peek() === 94) {
      neg = true;
      p++;
    }
    const items = [];
    let contentStart = p;
    function classToken() {
      // 返回 {code|null, cat|null, tokenPos}
      if (peek() === 92) {
        const e = readEscape();
        if (e.backspace) return { code: 8, tokenPos: e.pos };
        if (e.cat) return { cat: e.cat, tokenPos: e.pos };
        return { code: e.code, tokenPos: e.pos };
      }
      const tokenPos = p;
      const code = peek();
      p++;
      return { code, tokenPos };
    }
    while (true) {
      if (p >= src.length) throw RegexError("字符类未闭合", openPos);
      if (peek() === 93 && p !== contentStart) {
        p++;
        break;
      }
      const t1 = classToken();
      // 范围？
      if (peek() === 45 && p + 1 < src.length && src.charCodeAt(p + 1) !== 93) {
        const dashPos = p;
        p++; // '-'
        const t2 = classToken();
        if (t1.cat || t2.cat)
          throw RegexError("字符类范围端点不能是 \\d 这类类别", dashPos);
        if (t2.code < t1.code)
          throw RegexError("字符类范围倒置（起点大于终点）", dashPos);
        items.push([t1.code, t2.code]);
      } else {
        if (t1.cat) items.push({ cat: t1.cat });
        else items.push([t1.code, t1.code]);
      }
    }
    return { t: "class", neg, items, pos: openPos };
  }

  function parseAtom() {
    const c = peek();
    if (c === -1) throw RegexError("此处缺少操作数", Math.max(0, p - 1));
    if (c === 40) {
      // (
      const openPos = p;
      if (groupCount >= 8) throw RegexError("最多支持 8 个捕获组", p);
      p++;
      if (peek() === 63)
        throw RegexError("不支持非捕获组 / 标记组（? 开头）", p);
      groupCount++;
      const n = groupCount;
      groups.push({ n, pos: openPos });
      const body = parseAlt();
      if (peek() !== 41) throw RegexError("捕获组未闭合", openPos);
      p++;
      return { t: "group", n, body, pos: openPos };
    }
    if (c === 91) return parseClass();
    if (c === 46) {
      p++;
      return { t: "dot", pos: p - 1 };
    }
    if (c === 92) {
      const ePos = p;
      const e = readEscape();
      if (e.backspace) throw RegexError("\\b 词边界断言不受支持", ePos);
      if (e.cat)
        return { t: "class", neg: false, items: [{ cat: e.cat }], pos: ePos };
      return { t: "lit", code: e.code, pos: ePos };
    }
    if (c === 94 || c === 36)
      throw RegexError("不支持锚点 " + String.fromCharCode(c), p);
    if (c === 42 || c === 43 || c === 63)
      throw RegexError("量词 " + String.fromCharCode(c) + " 前面没有操作数", p);
    if (c === 41 || c === 124) throw RegexError("此处缺少操作数", p);
    p++;
    return { t: "lit", code: c, pos: p - 1 };
  }

  function parseRepeat() {
    let node = parseAtom();
    const c = peek();
    if (c === 42 || c === 43 || c === 63) {
      const qpos = p;
      const op = String.fromCharCode(c);
      p++;
      if (nullable(node))
        throw RegexError("量词 " + op + " 的操作数可能匹配空串", qpos);
      node = { t: "quant", op, x: node, pos: qpos };
    }
    return node;
  }

  function parseCat() {
    const xs = [];
    while (p < src.length && peek() !== 41 && peek() !== 124)
      xs.push(parseRepeat());
    return xs.length === 1 ? xs[0] : { t: "cat", xs, pos: p };
  }

  function parseAlt() {
    const branches = [parseCat()];
    const poss = [p];
    while (peek() === 124) {
      p++;
      branches.push(parseCat());
      poss.push(p);
    }
    return branches.length === 1
      ? branches[0]
      : { t: "alt", xs: branches, pos: poss[0] };
  }

  const ast = src.length ? parseAlt() : { t: "cat", xs: [], pos: 0 };
  if (p !== src.length) throw RegexError("意外的字符 " + src.charAt(p), p);
  return { ast, groupCount, groups, src };
}

/* --------------------- 可空性 / 循环内捕获收集 --------------------- */
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
      return ast.op === "+" ? nullable(ast.x) : true; // * 与 ? 可空
  }
  return false;
}
function groupsUnder(ast, set) {
  set = set || [];
  if (!ast) return set;
  switch (ast.t) {
    case "group":
      set.push(ast.n);
      groupsUnder(ast.body, set);
      break;
    case "cat":
      ast.xs.forEach(function (x) {
        groupsUnder(x, set);
      });
      break;
    case "alt":
      ast.xs.forEach(function (x) {
        groupsUnder(x, set);
      });
      break;
    case "quant":
      groupsUnder(ast.x, set);
      break;
  }
  return set;
}

/* ----------------------------- 编译器 ----------------------------- */
// 指令：
//   {op:"Char", test, label, pos}  {op:"Any"}
//   {op:"Split", x(第一路), y(第二路)}  {op:"Jmp", to}
//   {op:"Save", reg}  {op:"Reset", regs:[...]}  {op:"Match"}
function categoryTest(cat) {
  switch (cat) {
    case "d":
      return function (c) {
        return isDigit(c);
      };
    case "D":
      return function (c) {
        return !isDigit(c);
      };
    case "w":
      return function (c) {
        return isDigit(c) || isAlpha(c) || c === 95;
      };
    case "W":
      return function (c) {
        return !(isDigit(c) || isAlpha(c) || c === 95);
      };
    case "s":
      return function (c) {
        return c === 32 || (c >= 9 && c <= 13);
      };
    case "S":
      return function (c) {
        return !(c === 32 || (c >= 9 && c <= 13));
      };
  }
}
function classTest(ast) {
  const rangeTests = ast.items.map(function (it) {
    if (it.cat) return categoryTest(it.cat);
    return function (c) {
      return c >= it[0] && c <= it[1];
    };
  });
  const base = function (c) {
    return rangeTests.some(function (f) {
      return f(c);
    });
  };
  return ast.neg
    ? function (c) {
        return !base(c);
      }
    : base;
}
function classLabel(ast) {
  const s = ast.items
    .map(function (it) {
      if (it.cat) return "\\" + it.cat;
      return it[0] === it[1]
        ? showCh(it[0])
        : showCh(it[0]) + "-" + showCh(it[1]);
    })
    .join("");
  return "[" + (ast.neg ? "^" : "") + s + "]";
}

function compileProgram(parsed) {
  const code = [];
  function emit(o) {
    code.push(o);
    return code.length - 1;
  }

  function gen(node) {
    switch (node.t) {
      case "lit":
        emit({
          op: "Char",
          test: function (c) {
            return c === node.code;
          },
          label: "'" + showCh(node.code) + "'",
          pos: node.pos,
        });
        return;
      case "dot":
        emit({
          op: "Char",
          test: function (c) {
            return c !== 10;
          },
          label: ".",
          pos: node.pos,
        });
        return;
      case "class":
        emit({
          op: "Char",
          test: classTest(node),
          label: classLabel(node),
          pos: node.pos,
        });
        return;
      case "cat":
        node.xs.forEach(gen);
        return;
      case "alt":
        genAlt(node.xs, 0);
        return;
      case "group":
        emit({ op: "Save", reg: 2 * node.n, gpos: node.pos });
        gen(node.body);
        emit({ op: "Save", reg: 2 * node.n + 1, gpos: node.pos });
        return;
      case "quant":
        genQuant(node);
        return;
    }
  }
  function genAlt(branches, i) {
    if (i === branches.length - 1) {
      gen(branches[i]);
      return;
    }
    const sp = emit({ op: "Split", x: 0, y: 0 });
    code[sp].x = code.length;
    gen(branches[i]);
    const j = emit({ op: "Jmp", to: 0 });
    code[sp].y = code.length;
    genAlt(branches, i + 1);
    code[j].to = code.length;
  }
  function genQuant(node) {
    const inner = node.x;
    const resetRegs = groupsUnder(inner)
      .reduce(function (acc, g) {
        acc.push(2 * g, 2 * g + 1);
        return acc;
      }, [])
      .sort(function (a, b) {
        return a - b;
      });
    function emitReset() {
      if (resetRegs.length) emit({ op: "Reset", regs: resetRegs });
    }
    if (node.op === "?") {
      const sp = emit({ op: "Split", x: 0, y: 0 }); // 第一路：尝试主体（贪婪）
      code[sp].x = code.length;
      gen(inner);
      code[sp].y = code.length;
    } else if (node.op === "*") {
      // SPLIT 第一路=再来一轮（此路先 NULL 清空上轮捕获再跑主体；
      // 该轮若最终失败，寄存器从父快照派生并随线程丢弃，不污染上一轮）；
      // 第二路=退出，最终轮捕获原样保留。
      const sp = emit({ op: "Split", x: 0, y: 0 });
      code[sp].x = code.length;
      emitReset();
      const bodyStart = code.length;
      gen(inner);
      emit({ op: "Jmp", to: sp });
      code[sp].y = code.length;
    } else {
      // +：首轮主体在 SPLIT 之前（保证至少一次），之后结构同 *
      const bodyStart = code.length;
      gen(inner);
      const sp = emit({ op: "Split", x: 0, y: 0 });
      code[sp].x = code.length;
      emitReset();
      emit({ op: "Jmp", to: bodyStart });
      code[sp].y = code.length;
    }
  }

  // 用户程序：SAVE r0 ; <ast> ; SAVE r1 ; MATCH
  emit({ op: "Save", reg: 0, whole: true });
  gen(parsed.ast);
  emit({ op: "Save", reg: 1, whole: true });
  emit({ op: "Match" });
  const userLen = code.length;

  // 非锚定外壳：
  //  0: SPLIT -> 1(用户程序，高优先), skip(推进起点，低优先)
  //  skip: ANY ; JMP 0
  const out = [{ op: "Split", x: 1, y: 0, prefix: true }];
  for (let i = 0; i < code.length; i++) {
    const ins = code[i];
    const copy = Object.assign({}, ins);
    if (ins.op === "Split") {
      copy.x = ins.x + 1;
      copy.y = ins.y + 1;
    }
    if (ins.op === "Jmp") copy.to = ins.to + 1;
    out.push(copy);
  }
  const skipPc = out.length;
  out[0].y = skipPc;
  out.push({ op: "Any", prefix: true });
  out.push({ op: "Jmp", to: 0, prefix: true });
  return { code: out, userStart: 1, userEnd: userLen, groups: parsed.groups };
}

/* ----------------------------- NFA 模拟 ----------------------------- */
// 生成器：每个输入位置 yield 一帧；最后 yield {kind:"done", result}
// 结果与可暂停轨迹来自同一个生成器实例。
function simulate(prog, text) {
  const code = prog.code;
  const n = text.length;
  const R = 2 * 9;
  function freshRegs() {
    const a = new Array(R);
    for (let i = 0; i < R; i++) a[i] = null;
    return a;
  }

  let list = []; // 当前位置活跃线程（仅消费型指令），按优先级有序
  let candidate = null; // {end, regs} 已发现的最高优先成功候选
  let pos = 0;
  let stepIndex = 0;

  function newSeen() {
    return new Array(code.length).fill(false);
  }

  // epsilon 闭包：深度优先、第一路先于第二路。返回到达 MATCH 时的寄存器，否则 null。
  function addThread(target, seen, pc, regs, ev) {
    if (seen[pc]) {
      ev.merges.push(pc);
      return null;
    }
    seen[pc] = true;
    const ins = code[pc];
    switch (ins.op) {
      case "Char":
      case "Any":
        target.push({ pc: pc, regs: regs });
        return null;
      case "Match":
        return regs;
      case "Jmp":
        return addThread(target, seen, ins.to, regs, ev);
      case "Save": {
        const r2 = regs.slice();
        r2[ins.reg] = pos;
        return addThread(target, seen, pc + 1, r2, ev);
      }
      case "Reset": {
        const r2 = regs.slice();
        for (let k = 0; k < ins.regs.length; k++) r2[ins.regs[k]] = null;
        return addThread(target, seen, pc + 1, r2, ev);
      }
      case "Split": {
        const m1 = addThread(target, seen, ins.x, regs, ev);
        if (m1) return m1; // 高优先路成功：立即中止本闭包
        return addThread(target, seen, ins.y, regs, ev);
      }
    }
    return null;
  }

  // 起点闭包（位置 0）
  let ev0 = { merges: [] };
  const m0 = addThread(list, newSeen(), 0, freshRegs(), ev0);
  if (m0) candidate = { end: 0, regs: m0.slice() };

  return {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      if (pos > n)
        return { value: { kind: "done", result: buildResult() }, done: true };

      // 先 yield 当前位置帧
      const frame = {
        kind: "step",
        step: stepIndex++,
        pos: pos,
        active: list.map(function (t) {
          return { pc: t.pc, regs: t.regs.slice() };
        }),
        candidate: candidate
          ? { end: candidate.end, regs: candidate.regs.slice() }
          : null,
        merges: ev0.merges.slice(0, 60),
      };

      // 推进到下一位置
      const ev = { merges: [] };
      const nextList = [];
      const seen = newSeen();
      let newCand = null;
      let processed = 0,
        consumed = 0,
        pruned = 0,
        cut = false;
      if (pos < n) {
        const ch = text.charCodeAt(pos);
        for (let i = 0; i < list.length; i++) {
          const t = list[i];
          const ins = code[t.pc];
          let ok = false;
          if (ins.op === "Any") ok = true;
          else if (ins.op === "Char") ok = ins.test(ch);
          if (ok) {
            processed++;
            const before = nextList.length;
            const savedPos = pos;
            pos = savedPos + 1; // 闭包内 SAVE 记录的位置
            const m = addThread(nextList, seen, t.pc + 1, t.regs, ev);
            pos = savedPos;
            if (nextList.length > before) consumed++;
            if (m) {
              newCand = { end: savedPos + 1, regs: m.slice() };
              cut = true;
              pruned = list.length - processed;
              break;
            }
          }
        }
      }
      const prevCand = candidate;
      if (newCand) candidate = newCand;
      frame.events = {
        merges: ev.merges.slice(0, 60),
        pruned: pruned,
        cut: cut,
        candidateReplaced: !!(prevCand && newCand),
        candidateNew: !prevCand && !!newCand,
        died: processed - consumed,
      };
      list = nextList;
      pos++;

      if (list.length === 0 || pos > n) {
        return {
          value: frame,
          done: false,
          thenDone: true,
          _result: buildResult(),
        };
      }
      ev0 = ev;
      return { value: frame, done: false };
    },
    finished: false,
    result: null,
  };

  function buildResult() {
    if (!candidate) return null;
    const regs = candidate.regs;
    const groups = [];
    for (let g = 1; g <= 8; g++) {
      const a = regs[2 * g],
        b = regs[2 * g + 1];
      groups.push(a === null || b === null ? null : [a, b]);
    }
    return { start: regs[0], end: candidate.end, groups: groups };
  }
}

function runToEnd(prog, text) {
  const it = simulate(prog, text);
  let v;
  while (!(v = it.next()).done) {
    if (v.thenDone) return v._result;
  }
  return v.value.result;
}

if (typeof module !== "undefined")
  module.exports = { parsePattern, compileProgram, runToEnd };
