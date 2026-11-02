#!/bin/bash

POSITIONAL=()

while [ $# -gt 0 ]; do
  if [[ $1 == -* ]]; then
    case "$1" in
      --raw-apply)
        RAW_APPLY=1
        ;;
      --)
        break
        ;;
      esac
  else
		 POSITIONAL+=("$1")
  fi
  shift
done

set -- "${POSITIONAL[@]}"

if [ -n "$1" ]; then
  PULLREQUEST_ID="$1"
else
  echo "Usage: $0 [--raw-apply] <Pull Request ID>"
  echo "Backport patches to Cataclysm: TLG by specifying a pull request ID."
  echo "See <https://github.com/Cataclysm-TLG/Cataclysm-TLG/blob/master/doc/BACKPORTING.md> for more usage hints."
  echo
  echo " --raw-apply: Skips creating a branch and some other checks, enabling the application of multiple patches to a single branch."
  exit 1
fi

_check_required_component(){
  if ! which "$1" &>/dev/null; then
    echo "$1 not found. This script requires $1."
    exit 1
  fi
}

_check_required_component "git"
_check_required_component "curl"
_check_required_component "jq"

_ask_if_continue(){
  read -rp "Continue? (y/n) " choice
  if [ "$choice" != y ]; then
    echo "Aborting."
    exit 1
  fi
}

_check_if_ctlg_repo(){
  if ! git rev-parse --is-inside-work-tree &>/dev/null; then
    echo "Not in any git repository. cd to the right one and retry."
    exit 1
  fi
  if [[ $(git config --get remote.origin.url) == *Cataclysm-TLG/Cataclysm-TLG.git* ]]; then
     ORG=CleverRaven
     REPO=Cataclysm-DDA
  elif [[ $(git config --get remote.origin.url) == *Cataclysm-TLG/CTLG-Tilesets.git* ]]; then
     ORG=I-am-Erk
     REPO=CDDA-Tilesets
  else
    echo "This command must be run inside a Cataclysm-TLG repository."
    exit 1
  fi
  if [ "$(git remote | wc -l)" -lt 2 ]; then
    echo "Less than 2 remotes detected. This script requires the dda repo to be a remote. Not having the remote set up will make git am fail."
    echo "Set up the remote like this: git remote add cdda https://github.com/$ORG/$REPO.git"
    echo "This will pull over 1 GB in data but is required to continue: git fetch cdda"
    _ask_if_continue
  fi
}

_check_if_ctlg_repo

if [ -z "$GITHUB_TOKEN" ]; then
  API_RESPONSE=$(curl -Ls -H "Accept: application/json" -H "X-GitHub-Api-Version: 2022-11-28" "https://api.github.com/repos/$ORG/$REPO/pulls/$PULLREQUEST_ID")
else
  API_RESPONSE=$(curl -Ls -H "Accept: application/json" -H "X-GitHub-Api-Version: 2022-11-28" -H "Authorization: Bearer $GITHUB_TOKEN" "https://api.github.com/repos/$ORG/$REPO/pulls/$PULLREQUEST_ID")
fi

HTTP_STATUS=$(echo "$API_RESPONSE" | jq -r ".status")

if [ "$HTTP_STATUS" != "null" ]; then
  echo "API-supplied HTTP status code for supplied ID $PULLREQUEST_ID is $HTTP_STATUS."
  echo "Make sure you did not typo the ID or instead linked an issue instead of a pull request."
  echo "Do note that, as of writing, the ratelimit for unauthenticated API requests is 60/h. API response follows:"
  echo "$API_RESPONSE"
  exit 1
fi

COMMIT=$(echo "$API_RESPONSE" | jq -r ".merge_commit_sha" -)
# Sanity check
if [ "$COMMIT" == "null" ]; then
  echo "API response was ok but no merge_commit_sha? API response follows:"
  echo "$API_RESPONSE"
  exit 1
fi

URL=https://patch-diff.githubusercontent.com/$ORG/$REPO/commit/$COMMIT.patch

PATCH_BODY=$(curl -Lfs "$URL")
CURL_EXIT=$?

if [ "$CURL_EXIT" != "0" ]; then
  # curl already has mostly descriptive errors, except on 404 it appears
  if [ "$CURL_EXIT" = "22" ]; then
    echo "Server indicates URL <$URL> is unavailable. Maybe a force push on the targeted repo has happened?"
  fi
  exit 1
fi

echo "$PATCH_BODY" | git apply --stat -

if echo "$PATCH_BODY" | git apply --check -; then
  echo -e "     \e[1;32m[✓]\e[0m Patch can be applied cleanly"
  PATCH_STATUS=CLEAN
else
  echo -e "     \e[1;31m[✗]\e[0m Patch can not be applied cleanly"
  PATCH_STATUS=UNCLEAN
fi

if ! git status --porcelain &>/dev/null; then
  echo "Warning: Working tree is dirty. You may want to commit/stash or otherwise clean up your changes first. This may prevent doing a git pull, but this is being attempted anyways."
  _ask_if_continue
fi

if [ -z "$RAW_APPLY" ] && [ "$(git rev-parse --abbrev-ref HEAD)" != "master" ]; then
  echo "not on master, switching to it."
  git checkout master
  git pull
fi

if [ -z "$RAW_APPLY" ] && git rev-parse --verify backport-"$PULLREQUEST_ID" &>/dev/null; then
  echo "Backport branch 'backport-$PULLREQUEST_ID' already exists. Make sure this is not an aborted attempt with half-applied changes. If you choose to continue, the branch will be switched to and rebased on master."
  _ask_if_continue
  git checkout backport-"$PULLREQUEST_ID"
  git rebase master
else
  if [ -z "$RAW_APPLY" ]; then
    echo "Creating new branch backport-$PULLREQUEST_ID"
    git checkout -b backport-"$PULLREQUEST_ID"
  fi
fi

if [ -n "$RAW_APPLY" ] && [ "$(git rev-parse --abbrev-ref HEAD)" = "master" ]; then
  echo "You are trying to raw apply a patch to master! Backports should never be applied to master."
  _ask_if_continue
fi

if [ "$PATCH_STATUS" = "UNCLEAN" ]; then
  echo "As the patch will not apply cleanly, you will probably need to use git mergetool. The following git output will contain hints regarding it."
  echo -e "\e[1;33mShould this merge conflict be caused by recursive backport dependencies, copying the file from the dda repo will lead to attribution issues.\e[0m"
fi

echo "${ORG}/${REPO}#${PULLREQUEST_ID}" > $(git rev-parse --show-toplevel)/dda-backport-tracked-pr
echo "$PATCH_BODY" | git am -3 -
