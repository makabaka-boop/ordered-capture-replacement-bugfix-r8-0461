const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const root = path.join(__dirname, "..");

function runPage({ pattern, source, template }) {
  const elements = new Map();

  function element(id) {
    return {
      id,
      value: "",
      textContent: "",
      children: [],
      onclick: null,
      download: "",
      href: "",
      replaceChildren() {
        this.children.length = 0;
      },
      append(child) {
        this.children.push(child);
      },
    };
  }

  const ids = ["run", "result", "pattern", "source", "template"];
  for (const id of ids) elements.set(id, element(id));
  elements.get("pattern").value = pattern;
  elements.get("source").value = source;
  elements.get("template").value = template;

  let nextBlobId = 1;
  const blobs = new Map();

  const context = {
    console,
    Blob,
    URL: {
      createObjectURL(blob) {
        const href = `blob:test/${nextBlobId++}`;
        blobs.set(href, blob);
        return href;
      },
    },
    document: {
      getElementById(id) {
        return elements.get(id);
      },
      createElement() {
        return element("download");
      },
    },
  };
  context.globalThis = context;
  vm.createContext(context);

  for (const file of ["regex-core.js", "replacement.js", "replace-page.js"]) {
    vm.runInContext(
      fs.readFileSync(path.join(root, file), "utf8"),
      context,
      { filename: file },
    );
  }

  elements.get("run").onclick();
  const result = elements.get("result");
  const link = result.children[0];
  assert.ok(link, "page should append a download link");
  return {
    json: JSON.parse(result.textContent),
    link,
    downloadText: blobs.get(link.href).text(),
  };
}

test("replacement page evidence and download come from one replacement result", async () => {
  const page = runPage({
    pattern: "(a)?b",
    source: "ab b ab",
    template: "[$1]|prefix=[$`]",
  });

  assert.equal(page.json.text, "[a]|prefix=[] []|prefix=[ab ] [a]|prefix=[ab b ]");
  assert.deepEqual(
    page.json.matches.map((match) => ({
      range: [match.start, match.end],
      groups: match.groups,
    })),
    [
      { range: [0, 2], groups: [[0, 1]] },
      { range: [3, 4], groups: [null] },
      { range: [5, 7], groups: [[5, 6]] },
    ],
  );

  const source = "ab b ab";
  const expectedMatches = ["ab", "b", "ab"];
  const expectedCaptures = ["a", null, "a"];
  page.json.matches.forEach((match, i) => {
    assert.equal(source.slice(match.start, match.end), expectedMatches[i]);
    const capture = match.groups[0]
      ? source.slice(match.groups[0][0], match.groups[0][1])
      : null;
    assert.equal(capture, expectedCaptures[i]);
  });

  assert.equal(await page.downloadText, page.json.text);
  assert.equal(page.link.download, "replacement.txt");
});

test("replacement page exports empty-match replacements without lost source text", async () => {
  const page = runPage({
    pattern: "a?",
    source: "abc",
    template: "X",
  });

  assert.equal(page.json.text, "XXbXcX");
  assert.deepEqual(
    page.json.matches.map((match) => [match.start, match.end]),
    [[0, 1], [1, 1], [2, 2], [3, 3]],
  );
  assert.equal(await page.downloadText, "XXbXcX");
});
