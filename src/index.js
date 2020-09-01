const github = require("@actions/github");
const core = require("@actions/core");
const { Octokit } = require("@octokit/rest");
const slack = require("slack-notify")(core.getInput("webhook_url"));

const token = core.getInput("github_token");
const octokit = new Octokit({ auth: token });
const repo = github.context.repo;

function slackSuccessMessage(source, target, prUrl, status) {
  return {
    color: "#27ae60",
    icon: ":git:",
    message: `PR to merge ${source} into ${target} created/updated.`,
    description: `${prUrl}`,
  };
}

function slackErrorMessage(source, target, status) {
  return {
    color: "#C0392A",
    icon: ":alert:",
    message: `Error creating PR merging ${source} into ${target}`,
    description: ":face_with_head_bandage: Fix me please :pray:",
  };
}

async function slackMessage(source, target, prUrl, status) {
  if (core.getInput("webhook_url")) {
    const slack = require("slack-notify")(core.getInput("webhook_url"));

    let payload =
      status == "success"
        ? slackSuccessMessage(source, target, status)
        : slackErrorMessage(source, target, status);

    slack.send({
      icon_emoji: payload.icon,
      username: payload.message,
      attachments: [
        {
          author_name: github.context.payload.repository.full_name,
          author_link: `https://github.com/${github.context.payload.repository.full_name}/`,
          title: payload.message,
          text: payload.description,
          color: payload.color,
          fields: [{ title: "Job Status", value: status, short: false }],
        },
      ],
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

  try {
    console.log(`Making a pull request for ${target} from ${source}.`);
    const {
      payload: { repository },
    } = github.context;

    const octokit = new github.GitHub(githubToken);
    //part of test
    const { data: currentPulls } = await octokit.pulls.list({
      owner: repository.owner.login,
      repo: repository.name,
    });

    //create new branch from source branch and PR between new branch and target branch
    const context = github.context;
    const newBranch = `${target}-sync-${source}-${context.sha.slice(-4)}`;
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
        title: `sync: ${target}  with ${newBranch}`,
        body: `sync-branches: syncing branch with ${newBranch}`,
        draft: false,
      });

      console.log(
        `Pull request (${pullRequest.number}) successful! You can view it here: ${pullRequest.url}.`
      );

      core.setOutput("PULL_REQUEST_URL", pullRequest.url.toString());
      core.setOutput("PULL_REQUEST_NUMBER", pullRequest.number.toString());
      await slackMessage(source, target, pullRequest.url.toString(), "success");
    } else {
      console.log(
        `There is already a pull request (${currentPull.number}) to ${target} from ${newBranch}.`,
        `You can view it here: ${currentPull.url}`
      );
      core.setOutput("PULL_REQUEST_URL", currentPull.url.toString());
      core.setOutput("PULL_REQUEST_NUMBER", currentPull.number.toString());
      await slackMessage(source, target, currentPull.url.toString(), "success");
    }
  } catch (error) {
    await slackMessage(source, target, "", "failure");
    core.setFailed(error.message);
  }
}

run();
