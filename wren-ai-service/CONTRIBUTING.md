# Welcome to Wren AI Service contributing guide

Thank you for investing your time in contributing to our project! This document provides guidelines for contributing to the Wren AI service.

## New contributor guide

- To get an overview of the project, please read the [concepts](https://docs.getwren.ai/oss/concept/wren_ai_service).
- To set up the project for local development, please read [Environment Setup](README.md#environment-setup) and [Start the service for development](README.md#start-the-service-for-development)
- To understand the codebase more quickly, we've prepared [a codebase introduciton](docs/code_design.md) for you.

## Getting started

### Issues

#### Create a new issue

If you spot a problem, search if an issue already exists. If a related issue doesn't exist, you can open a new [issue](https://github.com/Canner/WrenAI/issues/new/choose).

#### Solve an issue

Scan through our [existing issues](https://github.com/Canner/WrenAI/issues?q=is%3Aopen+is%3Aissue+label%3Amodule%2Fai-service) to find one that interests you. As a general rule, we don't assign issues to anyone. If you find an issue to work on, you are welcome to open a PR with a fix.

### Pull Request

When you've finished with the changes, create a pull request, also known as a PR.
- Fill the description so that we can review your PR.
- Don't forget to [link PR to issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue) if you are solving one.
- Add the `module/ai-service` label to your PR.
- Enable the checkbox to [allow maintainer edits](https://docs.github.com/en/github/collaborating-with-issues-and-pull-requests/allowing-changes-to-a-pull-request-branch-created-from-a-fork) so the branch can be updated for a merge.
  Once you submit your PR, a Canner team member will review your proposal. We may ask questions or request additional information.
- We may ask for changes to be made before a PR can be merged, either using [suggested changes](https://docs.github.com/en/github/collaborating-with-issues-and-pull-requests/incorporating-feedback-in-your-pull-request) or pull request comments. You can apply suggested changes directly through the UI. You can make any other changes in your fork, then commit them to your branch.
- As you update your PR and apply changes, mark each conversation as [resolved](https://docs.github.com/en/github/collaborating-with-issues-and-pull-requests/commenting-on-a-pull-request#resolving-conversations).
- Be sure to add one of the prefixes to the PR title, so that our CI could automatically capture the changelog of this PR.
  - `feat(wren-ai-service)`: for new features
  - `chore(wren-ai-service)`: for maintenance work
  - `fix(wren-ai-service)`: for bug fixes
- If you run into any merge issues, checkout this [git tutorial](https://github.com/skills/resolve-merge-conflicts) to help you resolve merge conflicts and other issues.

### Your PR is merged!

Congratulations :tada::tada: The Canner team thanks you :sparkles:.

Once your PR is merged, your contributions will be worked on the next release.

Now that you are part of the Canner community.

## How to add your preferred LLM, Embedder or Document Store

- Please read [this documentation for further details](https://docs.getwren.ai/oss/installation/custom_llm#adding-a-custom-llm-embedder-or-document-store-to-wren-ai).
