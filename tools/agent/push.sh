#!/bin/bash
# push.sh "message": bump ?v=, commit the checked airports' files, rebase on origin/main and push
set -e
cd "$(dirname "$0")/../.."
V=$(date +%Y%m%d%H%M)
sed -i -E "s/\?v=[0-9]+/?v=$V/g" index.html
git add index.html js/data/checks.js js/data/fixes.js js/data/layouts/ ${EXTRA_ADD:-}
git commit -q -m "$1" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git fetch -q
if ! git rebase -q origin/main; then
  # only ?v= can clash in index.html: keep origin/main's file (in a rebase that is --ours; --theirs would be
  # this commit's copy and drop new script tags) and bump its ?v= again
  git checkout --ours index.html
  sed -i -E "s/\?v=[0-9]+/?v=$V/g" index.html
  git add index.html
  GIT_EDITOR=true git rebase --continue
fi
git push -q origin HEAD:main
git log --oneline -1
