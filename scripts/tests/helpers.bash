# Shared by install.bats and update.bats: a throw-away git repository with the scripts, the
# compose files and two release tags, plus a docker stub placed first in PATH.

setup_workdir() {
  repo_root="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  work="$(mktemp -d)"
  origin="$(mktemp -d)"
  export STUB_LOG="$work/../stub-$$-$BATS_TEST_NUMBER.log"
  : >"$STUB_LOG"
  export PATH="$repo_root/scripts/tests/stubs:$PATH"

  cp -r "$repo_root/scripts" "$repo_root/docker" "$work/"
  rm -rf "$work/scripts/tests/stubs" && cp -r "$repo_root/scripts/tests/stubs" "$work/scripts/tests/stubs"
  printf '.env\nsecrets/\n.state/\n' >"$work/.gitignore"
  cd "$work"
  git init -q -b main
  git config user.email test@example.invalid
  git config user.name test
  git add -A && git commit -q -m "release 0.1.0" && git tag v0.1.0
  echo "0.2.0" >VERSION && git add -A && git commit -q -m "release 0.2.0" && git tag v0.2.0
  git clone -q --bare "$work" "$origin"
  git remote add origin "$origin"
  git checkout -q v0.1.0
}

teardown_workdir() {
  cd /
  rm -rf "$work" "$origin" "$STUB_LOG"
}

run_install_noninteractive() {
  INSTALL_NONINTERACTIVE=1 \
    INSTALL_TS_HOSTNAME=pannello \
    INSTALL_TS_AUTHKEY_FILE="$work/../authkey-$$" \
    INSTALL_OWNER_EMAIL=owner@example.invalid \
    INSTALL_AGE_KEY_OUT="$work/../age-$$.key" \
    INSTALL_SKIP_CHOWN=1 \
    ./scripts/install.sh >/dev/null
}

prepare_authkey() {
  printf 'tskey-auth-not-real' >"$work/../authkey-$$"
}
