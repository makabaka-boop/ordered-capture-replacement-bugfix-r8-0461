function escapeHtml(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out +=
      c === 38 ? "&amp;" : c === 60 ? "&lt;" : c === 62 ? "&gt;" : s[i];
  }
  return out;
}

function showVisible(s) {
  let out = "";
  for (const ch of s)
    out += ch === "\n" ? "↵\n" : ch === "\t" ? "\\t" : ch === "\r" ? "\\r" : ch;
  return out;
}

document.addEventListener("DOMContentLoaded", function () {
  const $ = (id) => document.getElementById(id);
  const patternEl = $("pattern"),
    sourceEl = $("source"),
    templateEl = $("template"),
    outText = $("outText"),
    outMeta = $("outMeta"),
    download = $("download"),
    evidence = $("evidence"),
    inputErr = $("inputErr");

  let lastURL = null;

  function updateCounters() {
    $("patCount").textContent = patternEl.value.length + " / 120";
    $("srcCount").textContent = sourceEl.value.length + " / 2000";
    $("tplCount").textContent = templateEl.value.length + " / 2000";
  }
  [patternEl, sourceEl, templateEl].forEach((el) =>
    el.addEventListener("input", updateCounters),
  );
  updateCounters();

  $("run").addEventListener("click", function () {
    inputErr.textContent = "";
    const source = sourceEl.value;
    for (let i = 0; i < source.length; i++) {
      if (source.charCodeAt(i) > 127) {
        inputErr.textContent =
          "原文只能包含 ASCII 字符（码点 < 128），首个非法字符在位置 " + i;
        return;
      }
    }

    // 页面显示、证据表、下载 Blob 全部来自这同一次结果。
    let data;
    try {
      data = Replacement.replaceAll(
        patternEl.value,
        source,
        templateEl.value,
      );
    } catch (e) {
      inputErr.textContent =
        e.pos !== undefined ? "模式位置 " + e.pos + "：" + e.message : e.message;
      return;
    }

    outText.classList.remove("mn");
    outText.innerHTML =
      escapeHtml(showVisible(data.text)) || '<span class="mn">（空文本）</span>';
    outMeta.textContent =
      "命中 " + data.matches.length + " 次；结果长度 " + data.text.length;

    let rows = "";
    data.matches.forEach(function (m, i) {
      const hit = escapeHtml(showVisible(source.slice(m.start, m.end)));
      const reps = escapeHtml(showVisible(m.replacement));
      let cells = "";
      for (let g = 0; g < m.groups.length; g++) {
        const span = m.groups[g];
        if (span === null) {
          cells +=
            '<div><span class="badge g' +
            (g + 1) +
            '">' +
            (g + 1) +
            '</span><span class="mn">null（未参与）</span></div>';
        } else {
          const cap = escapeHtml(showVisible(source.slice(span[0], span[1])));
          cells +=
            '<div><span class="badge g' +
            (g + 1) +
            '">' +
            (g + 1) +
            "</span>[" +
            span[0] +
            ", " +
            span[1] +
            ") “" +
            cap +
            '”</div>';
        }
      }
      rows +=
        "<tr><td>" +
        i +
        "</td><td>[" +
        m.start +
        ", " +
        m.end +
        ")</td><td>“" +
        hit +
        '”</td><td>' +
        (cells || '<span class="mn">无捕获组</span>') +
        '</td><td>“' +
        reps +
        '”</td></tr>';
    });
    evidence.innerHTML =
      "<tr><th>#</th><th>整体区间</th><th>命中原文</th><th>捕获组</th><th>替换为</th></tr>" +
      (rows ||
        '<tr><td colspan="5" class="mn">无命中，结果即原文</td></tr>');

    if (lastURL) URL.revokeObjectURL(lastURL);
    lastURL = URL.createObjectURL(
      new Blob([data.text], { type: "text/plain;charset=utf-8" }),
    );
    download.href = lastURL;
    download.download = "replacement.txt";
    download.style.display = "";
    download.textContent = "下载替换文本";
  });
});
