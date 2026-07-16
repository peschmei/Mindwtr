import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

test("beta repository package versions preserve the prerelease tilde", () => {
  const workflow = parse(readFileSync(".github/workflows/publish-repo.yml", "utf8"));
  const normalizeStep = workflow.jobs["build-repo"].steps.find(
    (step) => step.name === "Normalize prerelease package versions"
  );

  expect(normalizeStep).toBeDefined();
  expect(normalizeStep.run).toContain('PKG_VERSION="${VERSION/-/\\~}"');
  expect(normalizeStep.run).toContain(
    "fedora@sha256:99e203b80b1c3d8f7e161ec10a68fd02b081ef83a3963553e513c82846b97814"
  );
  expect(normalizeStep.run).toContain("dnf -q install -y rpmrebuild");
  expect(normalizeStep.run).not.toContain("apt-get install -y rpm rpmrebuild");
});
