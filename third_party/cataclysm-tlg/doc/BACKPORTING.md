# Backporting from DDA, BN or other forks

There will always be fixes from upstream or other variants which will benefit us, too.
In order to get fixes and content in, they need to be backported.
There is no need to do it manually - we have a script for that.

## Work chronologically

The number 1 issue when backporting are conflicts and to avoid those, go through the porting queue chronologically.
If you cherry-pick something that is months in the future from our current backporting stage, it may make future
backporting endeavors harder.

## Preserve authorship at all costs

Use the script. Do not backport manually unless its your own changes.

> [!CAUTION]
> Messing up attribution leads to you or the project potentially being chased with the DMCA hammer. No one wants that.

## Usage of the script

### Prerequisites

This script only runs on Linux. For Windows, use [WSL](https://learn.microsoft.com/en-us/windows/wsl/install).
Choose Ubuntu if you do not know about Linux.

The script has 3 dependencies: [git](https://git-scm.com/) (duh), [curl](https://curl.se/) and [jq](https://jqlang.github.io/jq/).
git is used to clone and work with the repo, curl is used to fetch patches and API responses, jq parses the API responses which
come in json.

Install them like this:

```bash
apt install git curl jq
```

> [!TIP]
> [Using SSH](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/about-ssh) to clone and work with the repo usually works much better than doing it over HTTPS.

Next, clone the repo. As of writing, the repository is still private, so make sure you either created an [access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) for use over HTTPS or just use SSH.

The script is located at `tools/dda-backport.sh`.

> [!IMPORTANT]
> Windows users must [configure git line endings to be CRLF](https://stackoverflow.com/questions/73363367/wsl-ways-to-deal-with-bash-script-that-was-checked-out-on-windows).
> Additionally, it was discovered that WSL places `bash` in `/usr/bin/bash`, making the shebang in the script invalid for Windows users. Instead of just specifiying the path,
> run `bash tools/dda-backport.sh` to circumvent this.

You will also need to add a `git remote`:

```bash
git remote add cdda https://github.com/CleverRaven/Cataclysm-DDA.git
# Warning: Running the below will pull over a GB of data.
# This is mandatory to proceed, so maybe do not do this on cellular data.
git fetch cdda
```

### Usage

The following will instruct the script to backport the CDDA PR 12345.

```bash
tools/dda-backport.sh 12345
```

It will automatically switch to a new branch called `backport-12345` and apply the patch file of the targeted PR, keeping author information intact.

> [!TIP]
> It is tedious to manually file a backport PR for every single tiny JSON fix. You can batch apply PRs:
> First, manually create a new branch and switch to it. On the command line it is `git checkout -b backport-batch1`.
> Then, invoke the script with the parameter `--raw-apply`, which causes it to skip branch creation and some other checks, applying the patch raw:
> `tools/dda-backport.sh --raw-apply 12345`.
> Repeat this invocation for all PRs you want to batch together. Do not batch too many or it is getting hard to review and test. Around 5 is a sensible number.

If you are lucky, the patch will apply cleanly and no further action is required. Sometimes however there are [merge conflicts](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/addressing-merge-conflicts/about-merge-conflicts).
You will know there is a merge conflict because (1) the patch can not be applied cleanly and this will be reported by the script (2) There will be a yellow hint text of git itself and mentions of `CONFLICT`.

In some cases, the patch can not be applied cleanly but git can resolve the situation on its own, the following output demonstrates that git can auto-merge `src/item.cpp` and `src/fault.h` but `src/fault.cpp` needs manual merging:

```
Applying: Faults can modify the price of an item (#72142)
Using index info to reconstruct a base tree...
M       src/fault.cpp
M       src/fault.h
M       src/item.cpp
Falling back to patching base and 3-way merge...
Auto-merging src/item.cpp
Auto-merging src/fault.h
Auto-merging src/fault.cpp
CONFLICT (content): Merge conflict in src/fault.cpp
```

> [!TIP]
> [Mergiraf](https://mergiraf.org/) can help dealing with merge conflicts. It has been tested on this repo and it sucessfully resolves most of the conflicts.

There are multiple ways to solve the merge conflict. Apparently the github desktop app can do so, but you can also use `git mergetool`.
After you are done, run `git am --continue`.

> [!WARNING]
> Only resolve the conflict. Avoid tinkering with it because everything you do will be shown as if the original author did it, which causes some attribution problems.
> You can do whatever you want *after* you resolved the conflict and ran `git am --continue`.

Then `git push` like normal and file a PR. In the PR body, mention the backports like this:

```
- Backport CleverRaven/Cataclysm-DDA#12345
- Backport CleverRaven/Cataclysm-DDA#12346
```

If you are a maintainer, do not forget to check the box on the appropriate backport queue issue and add `Backported in #<PR ID here>` to the entry so it is complete and consistent.
