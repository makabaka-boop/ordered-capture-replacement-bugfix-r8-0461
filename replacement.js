(function (root) {
  var core =
    typeof module !== "undefined" ? require("./regex-core.js") : root;

  function expandTemplate(template, text, start, end, groups, groupCount) {
    var value = "";
    for (var i = 0; i < template.length; i++) {
      if (template[i] !== "$") {
        value += template[i];
        continue;
      }

      var ch = template[++i];
      if (ch === "$") value += "$";
      else if (ch === "&") value += text.slice(start, end);
      else if (ch === "`") value += text.slice(0, start);
      else if (ch === "'") value += text.slice(end);
      else if (ch >= "1" && ch <= "8") {
        var n = Number(ch);
        if (n <= groupCount) {
          var g = groups[n - 1];
          if (g !== null) value += text.slice(g[0], g[1]);
        } else {
          value += "$" + ch;
        }
      } else {
        value += "$" + (ch === undefined ? "" : ch);
      }
    }
    return value;
  }

  function replaceAll(pattern, text, template) {
    var parsed = core.parsePattern(pattern);
    var prog = core.compileProgram(parsed);
    var groupCount = parsed.groupCount;
    var matches = [];
    var output = "";
    var copyStart = 0;
    var search = 0;

    while (search <= text.length) {
      var match = core.runToEnd(prog, text.slice(search));
      if (!match) break;

      var start = search + match.start;
      var end = search + match.end;
      var groups = match.groups
        .slice(0, groupCount)
        .map(function (g) {
          return g === null ? null : [search + g[0], search + g[1]];
        });
      var value = expandTemplate(
        template,
        text,
        start,
        end,
        groups,
        groupCount,
      );

      output += text.slice(copyStart, start) + value;
      matches.push({ start: start, end: end, groups: groups, replacement: value });

      copyStart = end;
      if (start === end) {
        if (search === text.length) break;
        search++;
      } else {
        search = end;
      }
    }

    return { text: output + text.slice(copyStart), matches: matches };
  }

  if (typeof module !== "undefined") module.exports = { replaceAll: replaceAll };
  else root.Replacement = { replaceAll: replaceAll };
})(globalThis);
