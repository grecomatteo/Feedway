#!/usr/bin/env bash
# CI step (integration job): puts on PATH an `ffmpeg` and an `ffprobe` that run inside the
# `media-tools` stage of docker/Dockerfile, the same ffmpeg as the worker's image (plan 04
# Task 10). The runner's /tmp and the checkout are mounted at the same paths, so the test files
# keep their names; the containers have no network.
set -euo pipefail

image="${MEDIA_TOOLS_IMAGE:-feedway-media-tools:ci}"
bin="${RUNNER_TEMP:-/tmp}/media-tools-bin"

if [ "${MEDIA_TOOLS_BUILD:-1}" = 1 ]; then
  docker build -f docker/Dockerfile --target media-tools -t "$image" .
fi
mkdir -p "$bin"
for tool in ffmpeg ffprobe; do
  cat >"$bin/$tool" <<SCRIPT
#!/usr/bin/env bash
# no tty: docker forwards SIGTERM to the tool (the worker's timeout), --init reaps it
exec docker run --rm -i --init --network none --user "\$(id -u):\$(id -g)" \\
  -v /tmp:/tmp -v "$PWD:$PWD" -w "\$PWD" "$image" $tool "\$@"
SCRIPT
  chmod +x "$bin/$tool"
done
if [ -n "${GITHUB_PATH:-}" ]; then echo "$bin" >>"$GITHUB_PATH"; fi
"$bin/ffmpeg" -version | head -n 1
