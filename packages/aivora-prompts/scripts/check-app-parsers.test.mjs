import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkAction, checkArt, loadTypeScript, transpile } from "./check-app-parsers.mjs";
import { loadLibrary } from "./validate.mjs";

const out = await mkdtemp(join(tmpdir(), "aivora-parser-check-test-"));
after(() => rm(out, { recursive: true, force: true }));
const app = await transpile(loadTypeScript(), out);
const library = await loadLibrary();
function check(checker, parser, example, mutate = () => {}) {
  const parsed = app[parser](example.output);
  mutate(parsed);
  const errors = [];
  checker({ [parser]: () => parsed }, example, { fail: (text) => errors.push(text) });
  return errors;
}

for (const example of library.roles.art.examples) {
  test(`${example.id}: current complete art contract passes`, () => {
    assert.deepEqual(check(checkArt, "artFromModel", example), []);
  });
  for (const field of ["name", "identity", "gender", "ageBand"]) {
    test(`${example.id}: missing identity ${field} fails`, () => {
      assert.ok(
        check(checkArt, "artFromModel", example, (art) => {
          delete art.identities[0][field];
        }).length,
      );
    });
  }
  for (const field of ["name", "prompt", "ambience", "layout"]) {
    test(`${example.id}: missing location ${field} fails`, () => {
      assert.ok(
        check(checkArt, "artFromModel", example, (art) => {
          delete art.places[0][field];
        }).length,
      );
    });
  }
}
for (const example of library.roles.action.examples) {
  test(`${example.id}: merged nodes and beats pass without losing either source`, () => {
    assert.deepEqual(check(checkAction, "actionFromModel", example), []);
  });
  const firstNode = example.output.shots.flatMap((shot) => shot.nodes)[0];
  const beat = example.output.beats.find((beat) => beat.node_id === firstNode.node_id);
  test(`${example.id}: retaining only beat prose fails on missing node content`, () => {
    assert.ok(
      check(checkAction, "actionFromModel", example, (rows) => {
        rows[0].text = beat.text;
      }).length,
    );
  });
  test(`${example.id}: retaining only node prose fails on missing beat content`, () => {
    assert.ok(
      check(checkAction, "actionFromModel", example, (rows) => {
        rows[0].text = [
          firstNode.actor,
          firstNode.move,
          firstNode.target,
          firstNode.body_part,
          firstNode.direction,
          firstNode.reaction,
        ]
          .filter(Boolean)
          .join("，");
      }).length,
    );
  });
  for (const field of ["shotId", "at", "feasibility", "workaround"]) {
    test(`${example.id}: corrupted ${field} fails`, () => {
      assert.ok(
        check(checkAction, "actionFromModel", example, (rows) => {
          rows[0][field] = "corrupted";
        }).length,
      );
    });
  }
  test(`${example.id}: dropped or duplicated action fails`, () => {
    assert.ok(
      check(checkAction, "actionFromModel", example, (rows) => {
        rows.pop();
      }).length,
    );
    assert.ok(
      check(checkAction, "actionFromModel", example, (rows) => {
        rows.push(rows[0]);
      }).length,
    );
  });
}
