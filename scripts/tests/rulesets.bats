#!/usr/bin/env bats

load helpers

setup() {
  repo_root="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  export STUB_LOG="$BATS_TEST_TMPDIR/log"
  : >"$STUB_LOG"
  export PATH="$repo_root/scripts/tests/stubs:$PATH"
}

@test "ruleset json is valid and targets the default branch" {
  jq -e '.target == "branch" and .enforcement == "active" and (.conditions.ref_name.include | index("~DEFAULT_BRANCH"))' \
    "$repo_root/.github/rulesets/main.json"
}

@test "ruleset requires the nine checks of the git flow" {
  run jq -r '.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context' \
    "$repo_root/.github/rulesets/main.json"
  [ "$status" -eq 0 ]
  [ "$(echo "$output" | sort | tr '\n' ' ')" = "architecture commitlint e2e image install-smoke integration lint-types security unit " ]
}

@test "every required check is the name of a job in a workflow" {
  for check in $(jq -r '.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context' "$repo_root/.github/rulesets/main.json"); do
    grep -qE "^  $check:" "$repo_root"/.github/workflows/*.yml
  done
}

@test "ruleset forbids direct pushes, force pushes and merge commits" {
  jq -e '[.rules[].type] | (index("deletion") and index("non_fast_forward") and index("required_linear_history") and index("pull_request"))' \
    "$repo_root/.github/rulesets/main.json"
  jq -e '.rules[] | select(.type == "pull_request") | .parameters | (.allowed_merge_methods == ["squash"]) and .required_review_thread_resolution and (.required_approving_review_count == 0)' \
    "$repo_root/.github/rulesets/main.json"
  jq -e '.bypass_actors == []' "$repo_root/.github/rulesets/main.json"
}

@test "apply creates the ruleset when it does not exist" {
  run "$repo_root/scripts/github/apply-rulesets.sh" grecomatteo/Feedway
  [ "$status" -eq 0 ]
  grep -q 'api --method POST repos/grecomatteo/Feedway/rulesets' "$STUB_LOG"
}

@test "apply updates the ruleset when it already exists" {
  STUB_RULESET_ID=42 run "$repo_root/scripts/github/apply-rulesets.sh" grecomatteo/Feedway
  [ "$status" -eq 0 ]
  grep -q 'api --method PUT repos/grecomatteo/Feedway/rulesets/42' "$STUB_LOG"
  ! grep -q -- '--method POST' "$STUB_LOG"
}

@test "apply needs the repository name" {
  run "$repo_root/scripts/github/apply-rulesets.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"proprietario/nome"* ]]
}
