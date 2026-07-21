const defaultCore = require("@actions/core");
const defaultGithub = require("@actions/github");

const DEFAULT_MERGE_MESSAGE = "Merge {source} into {target}";

// Split on newlines/commas, trim, drop empties, dedupe — order preserved.
function parseTargetBranches(raw) {
  const seen = new Set();
  const targets = [];
  for (const item of raw.split(/[\n,]/)) {
    const branch = item.trim();
    if (!branch || seen.has(branch)) continue;
    seen.add(branch);
    targets.push(branch);
  }
  return targets;
}

function renderMergeMessage(template, source, target) {
  return template.replaceAll("{source}", source).replaceAll("{target}", target);
}

function mergeBranchName(source, target) {
  return `merge/${source}-into-${target}`;
}

// Point the merge branch at the source head, or bring the latest source into an
// existing one (in-progress conflict resolutions are preserved, never force-pushed).
async function ensureMergeBranch(octokit, { core, owner, repo, source, sourceSha, mergeBranch }) {
  try {
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${mergeBranch}`,
      sha: sourceSha,
    });
    return;
  } catch (error) {
    if (error.status !== 422) throw error; // 422 → branch already exists
  }

  try {
    await octokit.rest.repos.merge({
      owner,
      repo,
      base: mergeBranch,
      head: source,
      commit_message: `Merge ${source} into ${mergeBranch}`,
    });
  } catch (error) {
    if (error.status !== 409) throw error;
    core.warning(
      `Could not update ${mergeBranch} with ${source}: it conflicts with the in-progress resolution`
    );
  }
}

// Open a conflict-resolution PR from the merge branch into the target, reusing
// an already-open one for the pair instead of spamming duplicates.
async function openOrReuseConflictPr(octokit, { core, owner, repo, source, sourceSha, target }) {
  const mergeBranch = mergeBranchName(source, target);
  await ensureMergeBranch(octokit, { core, owner, repo, source, sourceSha, mergeBranch });

  const existing = await octokit.rest.pulls.list({
    owner,
    repo,
    state: "open",
    base: target,
    head: `${owner}:${mergeBranch}`,
  });
  if (existing.data.length > 0) {
    core.info(`Reusing conflict PR for ${target}: ${existing.data[0].html_url}`);
    return existing.data[0].html_url;
  }

  const created = await octokit.rest.pulls.create({
    owner,
    repo,
    base: target,
    head: mergeBranch,
    title: `Sync ${source} → ${target}`,
    body:
      "Automated environment sync.\n\n" +
      `Merging \`${source}\` into \`${target}\` conflicts and needs manual resolution. ` +
      "Resolve the conflicts in this PR and merge.",
  });
  core.info(`Opened conflict PR for ${target}: ${created.data.html_url}`);
  return created.data.html_url;
}

async function action({ core = defaultCore, github = defaultGithub } = {}) {
  try {
    const { owner, repo } = github.context.repo;
    const octokit = github.getOctokit(core.getInput("github-token", { required: true }));

    const source = core.getInput("source-branch");
    if (!source) {
      return core.setFailed("source-branch is required");
    }

    const targets = parseTargetBranches(core.getInput("target-branches", { required: true }));
    if (targets.length === 0) {
      return core.setFailed("target-branches must list at least one branch");
    }

    const template = core.getInput("merge-message") || DEFAULT_MERGE_MESSAGE;

    let sourceSha;
    try {
      const ref = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${source}` });
      sourceSha = ref.data.object.sha;
    } catch (error) {
      if (error.status === 404) {
        return core.setFailed(`source branch '${source}' not found`);
      }
      throw error;
    }

    const synced = [];
    const conflicts = [];
    const prUrls = [];

    for (const target of targets) {
      if (target === source) {
        core.info(`Skipping ${target}: same as source`);
        continue;
      }

      try {
        const response = await octokit.rest.repos.merge({
          owner,
          repo,
          base: target,
          head: source,
          commit_message: renderMergeMessage(template, source, target),
        });
        if (response.status === 204) {
          core.info(`${target} already contains ${source}`);
        } else {
          core.info(`Merged ${source} into ${target}`);
          synced.push(target);
        }
      } catch (error) {
        if (error.status === 404) {
          core.warning(`Skipping ${target}: branch not found`);
          continue;
        }
        if (error.status !== 409) throw error;

        core.info(`Merging ${source} into ${target} conflicts — opening a resolution PR`);
        const prUrl = await openOrReuseConflictPr(octokit, {
          core,
          owner,
          repo,
          source,
          sourceSha,
          target,
        });
        conflicts.push(target);
        prUrls.push(prUrl);
      }
    }

    core.setOutput("synced", synced.join("\n"));
    core.setOutput("conflicts", conflicts.join("\n"));
    core.setOutput("pr-urls", prUrls.join("\n"));
  } catch (error) {
    if (error.request && error.request.url) {
      return core.setFailed(`Error fetching ${error.request.url} - HTTP ${error.status}`);
    }
    return core.setFailed(error.message);
  }
}

module.exports = { action, parseTargetBranches, renderMergeMessage, mergeBranchName };
