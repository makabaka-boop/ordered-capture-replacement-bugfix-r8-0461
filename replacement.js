(function (root) {
  const core =
    typeof module !== "undefined" ? require("./regex-core.js") : root;
  function replaceAll(pattern, text, template) {
    const prog = core.compileProgram(core.parsePattern(pattern));
    let search = 0,
      output = "",
      previous = [];
    const matches = [];
    while (search < text.length) {
      const match = core.runToEnd(prog, text.slice(search));
      if (!match) break;
      const start = search + match.start,
        end = search + match.end;
      const groups = match.groups.map((g, i) =>
        g === null ? (previous[i] ?? null) : [search + g[0], search + g[1]],
      );
      previous = groups;
      let value = "";
      for (let i = 0; i < template.length; i++) {
        if (template[i] !== "$") {
          value += template[i];
          continue;
        }
        const ch = template[++i];
        if (ch === "$") value += "$";
        else if (ch === "&") value += text.slice(start, end);
        else if (ch === "`") value += output;
        else if (ch === "'") value += text.slice(end);
        else if (ch >= "1" && ch <= "8") {
          const g = groups[Number(ch) - 1];
          value += g ? text.slice(...g) : "";
        } else value += "$" + (ch ?? "");
      }
      output += text.slice(search, start) + value;
      matches.push({ start, end, groups, replacement: value });
      search = end + (start === end ? 1 : 0);
    }
    return { text: output + text.slice(search), matches };
  }
  if (typeof module !== "undefined") module.exports = { replaceAll };
  else root.Replacement = { replaceAll };
})(globalThis);
