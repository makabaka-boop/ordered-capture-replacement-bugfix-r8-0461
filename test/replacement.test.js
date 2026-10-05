const test = require("node:test");
const assert = require("node:assert/strict");
const { replaceAll } = require("../replacement.js");

function replace(pattern, text, template) {
  return replaceAll(pattern, text, template);
}

test("unmatched optional groups do not reuse captures from previous matches", () => {
  const result = replace("(a)?b", "ab b ab", "[$1]");
  assert.deepEqual(result, {
    text: "[a] [] [a]",
    matches: [
      {
        start: 0,
        end: 2,
        groups: [[0, 1]],
        replacement: "[a]",
      },
      {
        start: 3,
        end: 4,
        groups: [null],
        replacement: "[]",
      },
      {
        start: 5,
        end: 7,
        groups: [[5, 6]],
        replacement: "[a]",
      },
    ],
  });
});

test("a real empty capture stays distinct from a non-participating group", () => {
  const result = replace("(a?)b|(x)", "b", "1=$1;2=$2");
  assert.equal(result.text, "1=;2=");
  assert.deepEqual(result.matches[0].groups, [[0, 0], null]);
});

test("group references above the declared count keep their literal text", () => {
  const result = replace("(a)", "a", "$1$2$3$8");
  assert.equal(result.text, "a$2$3$8");
});

test("whole match, original prefix and original suffix are used", () => {
  const result = replace("a", "aXa", "[$&|$`|$']");
  assert.equal(result.text, "[a||Xa]X[a|aX|]");

  const prefixResult = replace("a", "aXa", "[$`]");
  assert.equal(prefixResult.text, "[]X[aX]");

  const suffixResult = replace("a", "aXa", "[$']");
  assert.equal(suffixResult.text, "[Xa]X[]");
});

test("replacement lengths do not move later match ranges", () => {
  const short = replace("x", "x-x", "[ab]");
  const long = replace("x", "x-x", "[abcdefghij]");
  assert.equal(short.text, "[ab]-[ab]");
  assert.equal(long.text, "[abcdefghij]-[abcdefghij]");
  assert.deepEqual(
    short.matches.map((m) => [m.start, m.end]),
    [
      [0, 1],
      [2, 3],
    ],
  );
  assert.deepEqual(
    short.matches.map((m) => [m.start, m.end]),
    long.matches.map((m) => [m.start, m.end]),
  );
});

test("empty matches preserve following and intervening characters", () => {
  const result = replace("a?", "abc", "X");
  assert.equal(result.text, "XXbXcX");
  assert.deepEqual(
    result.matches.map((m) => [m.start, m.end]),
    [[0, 1], [1, 1], [2, 2], [3, 3]],
  );
});

test("the trailing empty match is processed once", () => {
  const result = replace("a|", "a", "X");
  assert.equal(result.text, "XX");
  assert.deepEqual(
    result.matches.map((m) => [m.start, m.end]),
    [[0, 1], [1, 1]],
  );

  const endOnly = replace("", "", "X");
  assert.equal(endOnly.text, "X");
  assert.deepEqual(endOnly.matches, [
    { start: 0, end: 0, groups: [], replacement: "X" },
  ]);
});

test("an empty match adjacent to a normal match cannot consume the next character", () => {
  const result = replace("a|a?", "ab", "X");
  assert.equal(result.text, "XXbX");
  assert.deepEqual(
    result.matches.map((m) => [m.start, m.end]),
    [[0, 1], [1, 1], [2, 2]],
  );
});

test("$$ is a literal dollar and a trailing lone $ remains literal", () => {
  assert.equal(replace("x", "x", "$$").text, "$");
  assert.equal(replace("x", "x", "$").text, "$");
  assert.equal(replace("x", "x", "$$1").text, "$1");
});

test("non-overlapping ordered priority remains greedy for alternations", () => {
  const result = replace("a|ab", "ab", "<$&>");
  assert.equal(result.text, "<a>b");
  assert.deepEqual(result.matches[0], {
    start: 0,
    end: 1,
    groups: [],
    replacement: "<a>",
  });
});
