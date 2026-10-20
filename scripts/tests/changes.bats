#!/usr/bin/env bats

setup() {
  script="$(cd "$BATS_TEST_DIRNAME/.." && pwd)/ci/changes.sh"
}

@test "application code runs the tests but not the arm64 image" {
  run "$script" <<<"apps/web/server/api/session.ts"
  [ "$status" -eq 0 ]
  [ "$output" = $'code=true\narm64=false' ]
}

@test "documentation only skips the tests and the arm64 image" {
  run "$script" <<<$'docs/flusso-git.md\ndesign/reviews/n1.md\nREADME.md\n.claude/settings.json'
  [ "$status" -eq 0 ]
  [ "$output" = $'code=false\narm64=false' ]
}

@test "a markdown file inside the code counts as code" {
  run "$script" <<<"packages/core/README.md"
  [ "$output" = $'code=true\narm64=false' ]
}

@test "dependencies, Dockerfile, Node version and this workflow run the arm64 image" {
  for file in pnpm-lock.yaml apps/worker/package.json docker/Dockerfile .nvmrc .github/workflows/ci.yml; do
    run "$script" <<<"$file"
    [ "$output" = $'code=true\narm64=true' ]
  done
}

@test "code moved into docs still counts as code" {
  repo="$BATS_TEST_TMPDIR/repo"
  git init -q -b main "$repo" && cd "$repo"
  git config user.email test@example.invalid && git config user.name test
  mkdir -p apps docs && echo x >apps/x.ts && git add -A && git commit -q -m base
  git mv apps/x.ts docs/x.ts && git commit -q -m move
  run env GITHUB_EVENT_NAME=pull_request GITHUB_OUTPUT=/dev/null "$(dirname "$script")/changes-step.sh"
  [ "$status" -eq 0 ]
  [ "$output" = $'code=true\narm64=false' ]
}

@test "an unreadable diff runs everything" {
  run "$script" </dev/null
  [ "$status" -eq 0 ]
  [ "$output" = $'code=true\narm64=true' ]
}
