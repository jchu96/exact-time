#!/usr/bin/env bash
# Publish the files in dist/ as the GitHub release for the tag in
# GITHUB_REF_NAME. A version with a pre-release suffix (v1.2.3-beta.1) is
# published as a pre-release and is never marked Latest. Build metadata after
# "+" is not a pre-release suffix.
set -euo pipefail

tag="${GITHUB_REF_NAME:?GITHUB_REF_NAME is required}"
version="${tag%%+*}"
flags=()
if [[ "$version" == *-* ]]; then
  flags+=(--prerelease --latest=false)
fi

gh release create "$tag" dist/* ${flags[@]+"${flags[@]}"} --verify-tag --title "$tag" --generate-notes
