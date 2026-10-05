(function (root) {
  const core =
    typeof module !== "undefined" ? require("./regex-core.js") : root;

  // 展开替换模板。所有引用一律取自【原始输入】 original 与本次命中的区间：
  //   $$ 美元符号；$& 本次命中整体；$` 命中前的原文前缀；
  //   $' 命中后的原文后缀；$1~$8 本次命中中真正参与的捕获组。
  // 超出模式实际组数的编号按既有约定保留字面量（如 $9、$0）；
  // 已存在但本次未参与的组（null）与真正匹配空串的组（[x,x)）都展开为空串，
  // 区别仅保留在命中证据 matches[].groups 中。
  function expandTemplate(template, original, start, end, groups) {
    let value = "";
    for (let i = 0; i < template.length; i++) {
      if (template[i] !== "$") {
        value += template[i];
        continue;
      }
      const ch = template[++i];
      if (ch === "$") value += "$";
      else if (ch === "&") value += original.slice(start, end);
      else if (ch === "`") value += original.slice(0, start);
      else if (ch === "'") value += original.slice(end);
      else if (ch !== undefined && ch >= "1" && ch <= "8") {
        const n = Number(ch);
        const g = n <= groups.length ? groups[n - 1] : undefined;
        // undefined（不存在的组）保留字面量；null（未参与）取空串
        if (g === undefined) value += "$" + ch;
        else if (g !== null) value += original.slice(g[0], g[1]);
      } else {
        value += "$" + (ch ?? "");
      }
    }
    return value;
  }

  function replaceAll(pattern, text, template) {
    const parsed = core.parsePattern(pattern);
    const prog = core.compileProgram(parsed);
    const groupCount = parsed.groupCount;

    let cursor = 0; // 下一段未处理原文起点
    let output = "";
    const matches = [];

    // 全局有序匹配循环：每轮在最左起点找一个命中（沿用有序 NFA 的优先级）。
    //  - 非空命中：输出前缀 + 替换串，从其终点继续；
    //  - 零长度命中：输出替换串后，补回该位置的普通字符（末尾时无字符可补），
    //    再把起点推进一格。因此命中之间的字符一个不丢，零长度命中不可能无限
    //    重复；cursor === text.length 处的末尾空命中恰好处理一次。
    // 所有区间与捕获都是相对原始输入的绝对坐标，替换长短不影响后续范围。
    while (cursor <= text.length) {
      const match = core.runToEnd(prog, text.slice(cursor));
      if (!match) break;

      const start = cursor + match.start;
      const end = cursor + match.end;
      // 只保留模式中真实存在的组；未参与即为 null，绝不沿用上一次命中。
      const groups = match.groups.slice(0, groupCount).map(function (g) {
        return g === null ? null : [cursor + g[0], cursor + g[1]];
      });

      const value = expandTemplate(template, text, start, end, groups);
      output += text.slice(cursor, start) + value;
      matches.push({ start: start, end: end, groups: groups, replacement: value });

      if (start === end) {
        if (end < text.length) output += text[end]; // 零长度命中旁的普通字符不丢
        cursor = end + 1;
      } else {
        cursor = end;
      }
    }

    // 最后一段未匹配原文
    output += text.slice(cursor);
    return { text: output, matches: matches };
  }

  if (typeof module !== "undefined") module.exports = { replaceAll };
  else root.Replacement = { replaceAll };
})(globalThis);
