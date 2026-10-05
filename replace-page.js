document.getElementById("run").onclick = () => {
  const out = document.getElementById("result");
  out.replaceChildren();
  try {
    const data = Replacement.replaceAll(
      document.getElementById("pattern").value,
      document.getElementById("source").value,
      document.getElementById("template").value,
    );
    out.textContent = JSON.stringify(data, null, 2);
    const a = document.createElement("a");
    a.textContent = "下载替换文本";
    a.download = "replacement.txt";
    a.href = URL.createObjectURL(new Blob([data.text], { type: "text/plain" }));
    out.append(a);
  } catch (e) {
    out.textContent = e.message;
  }
};
