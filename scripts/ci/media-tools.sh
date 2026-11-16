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
# no tty: docker forwards SIGTERM to the tool (the worker's timeout), --init reaps it. The
# worker's SIGKILL would kill only this script and leave the container running, so a guard
# stops the container, by its name, as soon as this script is gone.
name="media-tools-\$\$-\$RANDOM"
docker run --rm -i --init --name "\$name" --network none --user "\$(id -u):\$(id -g)" \\
  -v /tmp:/tmp -v "$PWD:$PWD" -w "\$PWD" "$image" $tool "\$@" <&0 &
child=\$!
trap 'kill -TERM "\$child" 2>/dev/null' TERM INT
parent=\$\$
( while kill -0 "\$parent" 2>/dev/null; do sleep 1; done
  docker kill "\$name" >/dev/null 2>&1 || true ) </dev/null >/dev/null 2>&1 &
status=0
wait "\$child" || status=\$?
# a TERM interrupts the first wait: the tool's own exit code comes with the second
if kill -0 "\$child" 2>/dev/null; then wait "\$child" || status=\$?; fi
exit "\$status"
SCRIPT
  chmod +x "$bin/$tool"
done
if [ -n "${GITHUB_PATH:-}" ]; then echo "$bin" >>"$GITHUB_PATH"; fi
"$bin/ffmpeg" -version | head -n 1
