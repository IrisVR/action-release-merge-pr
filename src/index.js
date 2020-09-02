const github = require("@actions/github");
const core = require("@actions/core");
const { IncomingWebhook } = require("@slack/webhook");

function slackSuccessMessage(source, target, prUrl) {
  return {
    color: "#27ae60",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${source} branch has been updated.
pull request to update ${target} branch created:
${prUrl}`,
        },
      },
    ],
  };
}

function slackErrorMessage(source, target) {
  return {
    color: "#C0392A",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Failed to create pull request from ${source} branch into ${target}`,
        },
      },
    ],
  };
}

async function slackMessage(repo, source, target, prUrl, status) {
  if (core.getInput("webhook_url")) {
    const slack = new IncomingWebhook(core.getInput("webhook_url"));

    let payload =
      status == "success"
        ? slackSuccessMessage(source, target, prUrl)
        : slackErrorMessage(source, target);

    slack.send({
      username: `${repo} ${source}->${target} sync`,
      color: payload.color,
      icon_emoji: ":github:",
      blocks: payload.blocks,
    });
  }
}

async function createBranch(octokit, context, branch) {
  try {
    await octokit.repos.getBranch({
      ...context.repo,
      branch,
    });
  } catch (error) {
    if (error.name === "HttpError" && error.status === 404) {
      await octokit.git.createRef({
        ref: `refs/heads/${branch}`,
        sha: context.sha,
        ...context.repo,
      });
    } else {
      console.log("Error while creating new branch");
      throw Error(error);
    }
  }
}

async function run() {
  const source = core.getInput("source", { required: true });
  const target = core.getInput("target", { required: true });
  const githubToken = core.getInput("github_token", { required: true });

  const {
    payload: { repository },
  } = github.context;

  try {
    console.log(`Making a pull request for ${target} from ${source}.`);

    const octokit = github.getOctokit(githubToken);

    //part of test
    const { data: currentPulls } = await octokit.pulls.list({
      owner: repository.owner.login,
      repo: repository.name,
    });

    //create new branch from source branch and PR between new branch and target branch
    const context = github.context;
    const newBranch = `${target}-sync-${source}-${context.sha.slice(-6)}`;
    await createBranch(octokit, context, newBranch);

    const currentPull = currentPulls.find((pull) => {
      return pull.head.ref === newBranch && pull.base.ref === target;
    });

    if (!currentPull) {
      const { data: pullRequest } = await octokit.pulls.create({
        owner: repository.owner.login,
        repo: repository.name,
        head: newBranch,
        base: target,
        title: `sync: ${target}  with ${source}`,
        body: `sync-branches: syncing ${target} with ${source}`,
        draft: false,
      });

      console.log(
        `Pull request (${pullRequest.number}) successful! You can view it here: ${pullRequest.url}.`
      );

      core.setOutput("PULL_REQUEST_URL", pullRequest.url.toString());
      core.setOutput("PULL_REQUEST_NUMBER", pullRequest.number.toString());
      await slackMessage(
        repository.name,
        source,
        target,
        pullRequest.url.toString(),
        "success"
      );
    } else {
      console.log(
        `There is already a pull request (${currentPull.number}) to ${target} from ${newBranch}.`,
        `You can view it here: ${currentPull.url}`
      );
      core.setOutput("PULL_REQUEST_URL", currentPull.url.toString());
      core.setOutput("PULL_REQUEST_NUMBER", currentPull.number.toString());
      await slackMessage(
        repository.name,
        source,
        target,
        currentPull.url.toString(),
        "success"
      );
    }
  } catch (error) {
    await slackMessage(repository.name, source, target, "", "failure");
    core.setFailed(error.message);
  }
}

run();
