# Issue tracker: GitHub

Issues and specs live in GitHub Issues. Use the `gh` CLI.

## Repository

GitHub repository: `ducchinhpro123/Peeloodle` (private).
Preferred SSH host alias: `github.com-ducchinhpro123`.

Resolve owner/repo from the Git remote. The SSH alias is not the GitHub
API hostname; use `gh --repo ducchinhpro123/Peeloodle` if automatic
detection fails.

## Operations

- Create: `gh issue create --title "..." --body-file <file>`
- Read ticket: `gh issue view <number> --comments`
- List: `gh issue list --state open --json number,title,body,labels`
- Comment: `gh issue comment <number> --body-file <file>`
- Label: `gh issue edit <number> --add-label "..." --remove-label "..."`
- Close: `gh issue close <number> --comment "..."`

“Publish to the issue tracker” means create a GitHub issue.
“Fetch the relevant ticket” means read the issue and its comments.

## Pull requests as a triage surface

PRs as a request surface: no.
