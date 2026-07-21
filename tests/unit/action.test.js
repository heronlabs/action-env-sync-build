import { beforeEach, describe, expect, it, vi } from "vitest";

import { action, mergeBranchName, parseTargetBranches, renderMergeMessage } from "../../src/action.js";

const SOURCE_SHA = "0123456789abcdef0123456789abcdef01234567";

const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

let inputs;
let core;
let github;
let octokit;

const outputs = () => Object.fromEntries(core.setOutput.mock.calls);

const run = () => action({ core, github });

beforeEach(() => {
  inputs = {
    "source-branch": "main",
    "target-branches": "staging",
    "github-token": "gh-token",
    "merge-message": "Merge {source} into {target}",
  };

  core = {
    getInput: vi.fn((name, options) => {
      const value = inputs[name] ?? "";
      if (options?.required && !value) {
        throw new Error(`Input required and not supplied: ${name}`);
      }
      return value;
    }),
    setOutput: vi.fn(),
    setFailed: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  };

  octokit = {
    rest: {
      git: {
        getRef: vi.fn().mockResolvedValue({ data: { object: { sha: SOURCE_SHA } } }),
        createRef: vi.fn().mockResolvedValue({}),
      },
      repos: {
        merge: vi.fn().mockResolvedValue({ status: 201 }),
      },
      pulls: {
        list: vi.fn().mockResolvedValue({ data: [] }),
        create: vi.fn().mockResolvedValue({
          data: { html_url: "https://github.com/heronlabs/demo/pull/1" },
        }),
      },
    },
  };

  github = {
    context: { repo: { owner: "heronlabs", repo: "demo" } },
    getOctokit: vi.fn(() => octokit),
  };
});

describe("parseTargetBranches", () => {
  it("splits on newlines", () => {
    expect(parseTargetBranches("staging\ndevelopment")).toEqual(["staging", "development"]);
  });

  it("splits on commas", () => {
    expect(parseTargetBranches("staging, development")).toEqual(["staging", "development"]);
  });

  it("trims, drops empties and dedupes on mixed separators", () => {
    expect(parseTargetBranches(" staging ,\n\ndevelopment\nstaging,")).toEqual([
      "staging",
      "development",
    ]);
  });
});

describe("renderMergeMessage", () => {
  it("substitutes every {source} and {target} placeholder", () => {
    expect(renderMergeMessage("chore: {source} → {target} ({source})", "main", "staging")).toBe(
      "chore: main → staging (main)"
    );
  });
});

describe("mergeBranchName", () => {
  it("is deterministic per source/target pair", () => {
    expect(mergeBranchName("main", "staging")).toBe("merge/main-into-staging");
  });
});

describe("action", () => {
  it("merges cleanly into the target via the merges API", async () => {
    await run();

    expect(github.getOctokit).toHaveBeenCalledWith("gh-token");
    expect(octokit.rest.repos.merge).toHaveBeenCalledWith({
      owner: "heronlabs",
      repo: "demo",
      base: "staging",
      head: "main",
      commit_message: "Merge main into staging",
    });
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(outputs()).toEqual({ synced: "staging", conflicts: "", "pr-urls": "" });
  });

  it("treats an already-up-to-date target (204) as a no-op", async () => {
    octokit.rest.repos.merge.mockResolvedValue({ status: 204 });

    await run();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(octokit.rest.pulls.create).not.toHaveBeenCalled();
    expect(outputs()).toEqual({ synced: "", conflicts: "", "pr-urls": "" });
  });

  it("opens a conflict PR from a merge branch when the merge conflicts", async () => {
    octokit.rest.repos.merge.mockRejectedValue(httpError(409));

    await run();

    expect(octokit.rest.git.createRef).toHaveBeenCalledWith({
      owner: "heronlabs",
      repo: "demo",
      ref: "refs/heads/merge/main-into-staging",
      sha: SOURCE_SHA,
    });
    expect(octokit.rest.pulls.create).toHaveBeenCalledWith({
      owner: "heronlabs",
      repo: "demo",
      base: "staging",
      head: "merge/main-into-staging",
      title: "Sync main → staging",
      body: expect.stringContaining("needs manual resolution"),
    });
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(outputs()).toEqual({
      synced: "",
      conflicts: "staging",
      "pr-urls": "https://github.com/heronlabs/demo/pull/1",
    });
  });

  it("reuses an existing conflict PR and refreshes the merge branch", async () => {
    octokit.rest.repos.merge.mockImplementation(({ base }) =>
      base === "staging" ? Promise.reject(httpError(409)) : Promise.resolve({ status: 201 })
    );
    octokit.rest.git.createRef.mockRejectedValue(httpError(422));
    octokit.rest.pulls.list.mockResolvedValue({
      data: [{ html_url: "https://github.com/heronlabs/demo/pull/7" }],
    });

    await run();

    // Existing merge branch is refreshed with the latest source, never recreated.
    expect(octokit.rest.repos.merge).toHaveBeenCalledWith(
      expect.objectContaining({ base: "merge/main-into-staging", head: "main" })
    );
    expect(octokit.rest.pulls.list).toHaveBeenCalledWith({
      owner: "heronlabs",
      repo: "demo",
      state: "open",
      base: "staging",
      head: "heronlabs:merge/main-into-staging",
    });
    expect(octokit.rest.pulls.create).not.toHaveBeenCalled();
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(outputs()).toEqual({
      synced: "",
      conflicts: "staging",
      "pr-urls": "https://github.com/heronlabs/demo/pull/7",
    });
  });

  it("fans out over multiple targets independently", async () => {
    inputs["target-branches"] = "staging, development\nqa";
    octokit.rest.repos.merge.mockImplementation(({ base }) => {
      if (base === "development") return Promise.reject(httpError(409));
      if (base === "qa") return Promise.resolve({ status: 204 });
      return Promise.resolve({ status: 201 });
    });

    await run();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(outputs()).toEqual({
      synced: "staging",
      conflicts: "development",
      "pr-urls": "https://github.com/heronlabs/demo/pull/1",
    });
  });

  it("joins multi-entry outputs with newlines", async () => {
    inputs["target-branches"] = "staging\ndevelopment";
    octokit.rest.repos.merge.mockImplementation(({ base }) =>
      base.startsWith("merge/") ? Promise.resolve({ status: 201 }) : Promise.reject(httpError(409))
    );
    octokit.rest.pulls.create
      .mockResolvedValueOnce({ data: { html_url: "https://github.com/heronlabs/demo/pull/1" } })
      .mockResolvedValueOnce({ data: { html_url: "https://github.com/heronlabs/demo/pull/2" } });

    await run();

    expect(outputs()).toEqual({
      synced: "",
      conflicts: "staging\ndevelopment",
      "pr-urls": "https://github.com/heronlabs/demo/pull/1\nhttps://github.com/heronlabs/demo/pull/2",
    });
  });

  it("applies the merge-message template per target", async () => {
    inputs["merge-message"] = "sync: {source} >> {target}";
    inputs["target-branches"] = "staging,development";

    await run();

    expect(octokit.rest.repos.merge).toHaveBeenCalledWith(
      expect.objectContaining({ base: "staging", commit_message: "sync: main >> staging" })
    );
    expect(octokit.rest.repos.merge).toHaveBeenCalledWith(
      expect.objectContaining({ base: "development", commit_message: "sync: main >> development" })
    );
  });

  it("skips a target equal to the source branch", async () => {
    inputs["target-branches"] = "main,staging";

    await run();

    expect(octokit.rest.repos.merge).toHaveBeenCalledTimes(1);
    expect(octokit.rest.repos.merge).toHaveBeenCalledWith(
      expect.objectContaining({ base: "staging" })
    );
    expect(outputs()).toEqual({ synced: "staging", conflicts: "", "pr-urls": "" });
  });

  it("skips a missing target branch (404) without failing", async () => {
    octokit.rest.repos.merge.mockRejectedValue(httpError(404));

    await run();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.warning).toHaveBeenCalledWith("Skipping staging: branch not found");
    expect(outputs()).toEqual({ synced: "", conflicts: "", "pr-urls": "" });
  });

  it("fails when the source branch does not exist", async () => {
    octokit.rest.git.getRef.mockRejectedValue(httpError(404));

    await run();

    expect(core.setFailed).toHaveBeenCalledWith("source branch 'main' not found");
    expect(octokit.rest.repos.merge).not.toHaveBeenCalled();
  });

  it("fails when target-branches has no usable entries", async () => {
    inputs["target-branches"] = " ,\n, ";

    await run();

    expect(core.setFailed).toHaveBeenCalledWith("target-branches must list at least one branch");
  });

  it("fails on unexpected API errors (plumbing)", async () => {
    const error = Object.assign(new Error("Server Error"), {
      status: 500,
      request: { url: "https://api.github.com/repos/heronlabs/demo/merges" },
    });
    octokit.rest.repos.merge.mockRejectedValue(error);

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(
      "Error fetching https://api.github.com/repos/heronlabs/demo/merges - HTTP 500"
    );
  });
});
